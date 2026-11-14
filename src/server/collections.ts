import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { type LaneCount, rotatedHistogram } from "../engine/axis";
import type { Db } from "../db/client";
import { collections, collectionTracks, importJobs, trackFeatures, tracks, users } from "../db/schema";
import { rankNeighbors } from "../engine/neighbors";
import { fold } from "../engine/tempo";

/** One track as the collection page sees it. Metadata is Deezer's; null when Deezer had no match. */
export interface CollectionTrack {
  trackId: string;
  spotifyId: string;
  position: number;
  title: string | null;
  artists: string[];
  artworkUrl: string | null;
  genres: string[];
  bpm: number | null;
  bpmFolded: number | null;
  confidence: "high" | "medium" | "low" | "unavailable" | null;
  ambiguousFeel: boolean;
  bpmAlt: number | null;
  energy: number | null;
  danceability: number | null;
  key: string | null;
  camelot: string | null;
  /** False while the import is still resolving this track. */
  resolved: boolean;
}

export interface CollectionView {
  id: string;
  slug: string;
  title: string;
  visibility: "public" | "unlisted";
  importStatus: string;
  ownerId: string;
  ownerName: string | null;
  isLikedSongs: boolean;
  job: { state: string; total: number; done: number; failed: number; error: string | null } | null;
  tracks: CollectionTrack[];
}

const trackColumns = {
  trackId: tracks.id,
  spotifyId: tracks.spotifyId,
  title: tracks.title,
  artists: tracks.artists,
  artworkUrl: tracks.artworkUrl,
  genres: tracks.genres,
  bpm: trackFeatures.bpm,
  bpmFolded: trackFeatures.bpmFolded,
  confidence: trackFeatures.bpmConfidence,
  ambiguousFeel: trackFeatures.ambiguousFeel,
  bpmAlt: trackFeatures.bpmAlt,
  energy: trackFeatures.energy,
  danceability: trackFeatures.danceability,
  key: trackFeatures.key,
  camelot: trackFeatures.camelot,
};

export async function getCollection(db: Db, slug: string): Promise<CollectionView | null> {
  const [c] = await db
    .select({ c: collections, ownerName: users.displayName })
    .from(collections)
    .innerJoin(users, eq(users.id, collections.ownerId))
    .where(eq(collections.slug, slug));
  if (!c) return null;
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.collectionId, c.c.id))
    .orderBy(desc(importJobs.createdAt))
    .limit(1);
  const rows = await db
    .select({ ...trackColumns, position: collectionTracks.position })
    .from(collectionTracks)
    .innerJoin(tracks, eq(tracks.id, collectionTracks.trackId))
    .leftJoin(trackFeatures, eq(trackFeatures.trackId, tracks.id))
    .where(eq(collectionTracks.collectionId, c.c.id))
    .orderBy(asc(collectionTracks.position));
  return {
    id: c.c.id,
    slug: c.c.slug,
    title: c.c.title,
    visibility: c.c.visibility,
    importStatus: c.c.importStatus,
    ownerId: c.c.ownerId,
    ownerName: c.ownerName,
    isLikedSongs: c.c.spotifyPlaylistId === null,
    job: job ? { state: job.state, total: job.total, done: job.done, failed: job.failed, error: job.error } : null,
    tracks: rows.map((r) => ({
      ...r,
      artists: r.artists ?? [],
      ambiguousFeel: r.ambiguousFeel ?? false,
      resolved: r.confidence !== null,
    })),
  };
}

export interface CollectionCard {
  slug: string;
  title: string;
  visibility: "public" | "unlisted";
  importStatus: string;
  trackCount: number;
  /** Track counts per lane, starting where the collection's axis starts. */
  histogram: LaneCount[];
}

async function cards(db: Db, where: SQL, limit: number): Promise<CollectionCard[]> {
  const cs = await db.select().from(collections).where(where).orderBy(desc(collections.createdAt)).limit(limit);
  if (cs.length === 0) return [];
  const rows = await db
    .select({ collectionId: collectionTracks.collectionId, folded: trackFeatures.bpmFolded })
    .from(collectionTracks)
    .leftJoin(trackFeatures, eq(trackFeatures.trackId, collectionTracks.trackId))
    .where(
      inArray(
        collectionTracks.collectionId,
        cs.map((c) => c.id),
      ),
    );
  return cs.map((c) => {
    const mine = rows.filter((r) => r.collectionId === c.id);
    const histogram = rotatedHistogram(mine.flatMap((r) => (r.folded ? [r.folded] : [])));
    return {
      slug: c.slug,
      title: c.title,
      visibility: c.visibility,
      importStatus: c.importStatus,
      trackCount: mine.length,
      histogram,
    };
  });
}

export async function getTrack(db: Db, trackId: string): Promise<CollectionTrack | null> {
  const [r] = await db
    .select(trackColumns)
    .from(tracks)
    .leftJoin(trackFeatures, eq(trackFeatures.trackId, tracks.id))
    .where(eq(tracks.id, trackId));
  return r
    ? { ...r, position: 0, artists: r.artists ?? [], ambiguousFeel: r.ambiguousFeel ?? false, resolved: r.confidence !== null }
    : null;
}

export const publicCollections = (db: Db, limit = 12) => cards(db, eq(collections.visibility, "public"), limit);
export const userCollections = (db: Db, ownerId: string) => cards(db, eq(collections.ownerId, ownerId), 100);

export async function setVisibility(db: Db, ownerId: string, slug: string, visibility: "public" | "unlisted") {
  await db
    .update(collections)
    .set({ visibility })
    .where(and(eq(collections.slug, slug), eq(collections.ownerId, ownerId)));
}

/**
 * "All of Tempo Atlas": neighbors among tracks in public collections only.
 * Returns tracks, never which collection they came from.
 */
export async function globalNeighbors(
  db: Db,
  reference: { bpm: number; energy: number | null; genres: string[]; trackId?: string },
  toleranceBpm: number,
  foldOn: boolean,
  limit = 25,
): Promise<Array<CollectionTrack & { bpm: number }>> {
  // Prefilter in SQL on the folded band; circular ranking happens in the shared engine module.
  const f = fold(reference.bpm);
  const pct = toleranceBpm / reference.bpm;
  const lo = f * (1 - pct);
  const hi = f * (1 + pct);
  const band = foldOn
    ? sql`(${trackFeatures.bpmFolded} between ${lo} and ${hi} or ${trackFeatures.bpmFolded} * 2 between ${lo} and ${hi} or ${trackFeatures.bpmFolded} / 2 between ${lo} and ${hi})`
    : sql`${trackFeatures.bpm} between ${reference.bpm * (1 - pct)} and ${reference.bpm * (1 + pct)}`;
  const rows = await db
    .selectDistinct(trackColumns)
    .from(trackFeatures)
    .innerJoin(tracks, eq(tracks.id, trackFeatures.trackId))
    .innerJoin(collectionTracks, eq(collectionTracks.trackId, tracks.id))
    .innerJoin(collections, eq(collections.id, collectionTracks.collectionId))
    .where(and(eq(collections.visibility, "public"), band))
    .limit(2000);
  const candidates = rows
    .filter((r) => r.bpm !== null)
    .map((r) => ({ ...r, id: r.trackId, bpm: r.bpm!, artists: r.artists ?? [], position: 0, ambiguousFeel: r.ambiguousFeel ?? false, resolved: true }));
  return rankNeighbors(
    { id: reference.trackId, bpm: reference.bpm, energy: reference.energy, genres: reference.genres },
    candidates,
    { toleranceBpm, fold: foldOn, limit },
  ).map((n) => n.track);
}
