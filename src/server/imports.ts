import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { LibraryItem, SpotifyLibrary } from "../adapters/spotify";
import type { TrackSources } from "../adapters/types";
import type { Db } from "../db/client";
import { collections, collectionTracks, importJobs } from "../db/schema";
import { ensureTracks } from "../tracks/ensure";

export type ImportSource = { kind: "playlist"; playlistId: string; title: string } | { kind: "liked" };

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Unguessable 12-char slug (~60 bits): unlisted collections rely on it. */
function newSlug(): string {
  return [...randomBytes(12)].map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

/**
 * Create (or reuse, for a re-import) the collection and a queued job.
 * Liked Songs defaults to unlisted; playlists default to public.
 */
export async function createImport(db: Db, ownerId: string, source: ImportSource): Promise<{ jobId: string; slug: string }> {
  const playlistId = source.kind === "playlist" ? source.playlistId : null;
  const [existing] = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.ownerId, ownerId),
        playlistId ? eq(collections.spotifyPlaylistId, playlistId) : isNull(collections.spotifyPlaylistId),
      ),
    );
  const collection =
    existing ??
    (
      await db
        .insert(collections)
        .values({
          slug: newSlug(),
          title: source.kind === "playlist" ? source.title : "Liked Songs",
          ownerId,
          spotifyPlaylistId: playlistId,
          visibility: source.kind === "liked" ? "unlisted" : "public",
        })
        .returning()
    )[0]!;
  await db.update(collections).set({ importStatus: "importing" }).where(eq(collections.id, collection.id));
  const [job] = await db.insert(importJobs).values({ collectionId: collection.id }).returning({ id: importJobs.id });
  return { jobId: job!.id, slug: collection.slug };
}

/**
 * Run one import: fetch the item list, refresh collection order, and resolve
 * tracks through the cache. Tracks land in the collection as each resolves;
 * a failing track is counted and skipped, never fatal.
 */
export async function runImport(
  db: Db,
  sources: TrackSources,
  jobId: string,
  library: (ownerId: string) => Promise<SpotifyLibrary>,
): Promise<void> {
  const [row] = await db
    .select({ job: importJobs, collection: collections })
    .from(importJobs)
    .innerJoin(collections, eq(collections.id, importJobs.collectionId))
    .where(eq(importJobs.id, jobId));
  if (!row) return; // collection deleted (user disconnected) before the job ran
  const { collection } = row;

  try {
    const lib = await library(collection.ownerId);
    const items: LibraryItem[] = collection.spotifyPlaylistId
      ? await lib.playlistItems(collection.spotifyPlaylistId)
      : await lib.likedSongs();

    const positions = new Map<string, Array<{ position: number; addedAt: string | null }>>();
    items.forEach((it, position) => {
      const list = positions.get(it.spotifyId) ?? [];
      list.push({ position, addedAt: it.addedAt });
      positions.set(it.spotifyId, list);
    });

    await db.transaction(async (tx) => {
      await tx.delete(collectionTracks).where(eq(collectionTracks.collectionId, collection.id));
      await tx
        .update(importJobs)
        .set({ state: "running", total: positions.size, done: 0, failed: 0 })
        .where(eq(importJobs.id, jobId));
    });

    await ensureTracks(
      db,
      sources,
      items.map((it) => ({ spotifyId: it.spotifyId, isrc: it.isrc, title: it.title, artists: it.artists })),
      {
        onTrackDone: async (o) => {
          await db
            .insert(collectionTracks)
            .values(
              positions.get(o.spotifyId)!.map((p) => ({
                collectionId: collection.id,
                trackId: o.trackId,
                position: p.position,
                addedAt: p.addedAt ? new Date(p.addedAt) : null,
              })),
            )
            .onConflictDoNothing();
          await db
            .update(importJobs)
            .set({
              done: sql`${importJobs.done} + 1`,
              failed: sql`${importJobs.failed} + ${o.errors.length ? 1 : 0}`,
            })
            .where(eq(importJobs.id, jobId));
        },
      },
    );

    await db.update(importJobs).set({ state: "done" }).where(eq(importJobs.id, jobId));
    await db.update(collections).set({ importStatus: "ready" }).where(eq(collections.id, collection.id));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(importJobs).set({ state: "failed", error: message }).where(eq(importJobs.id, jobId));
    await db.update(collections).set({ importStatus: "failed" }).where(eq(collections.id, collection.id));
    throw e;
  }
}
