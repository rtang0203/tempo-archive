import { eq, inArray, ne, sql } from "drizzle-orm";
import type { TrackSources } from "../adapters/types";
import type { Db } from "../db/client";
import { bpmFlags, featureEstimates, sourceLookups, trackFeatures, tracks } from "../db/schema";
import { toCamelot } from "../engine/camelot";
import { type BpmVotes, resolveBpm } from "../engine/resolve";
import { RULES_VERSION, SOURCE_VERSIONS, type Source } from "../engine/version";

export interface TrackRef {
  spotifyId: string;
  isrc: string | null;
  /** Transient Spotify metadata: used for the iTunes search, never persisted. */
  title?: string;
  artists?: string[];
}

export interface TrackOutcome {
  spotifyId: string;
  trackId: string;
  /** Sources that failed transiently this run; they are retried on the next import. */
  errors: string[];
}

export interface EnsureOptions {
  rulesVersion?: number;
  sourceVersions?: Record<Source, number>;
  concurrency?: number;
  onTrackDone?: (outcome: TrackOutcome) => void | Promise<void>;
}

type Estimate = { feature: (typeof featureEstimates.$inferInsert)["feature"]; value?: number | null; valueText?: string };

/**
 * Make sure every track has current features, calling outside sources only for
 * what isn't cached: each (track, source, source version) is looked up at most
 * once, misses included; rules changes recompute from stored estimates.
 */
export async function ensureTracks(
  db: Db,
  sources: TrackSources,
  refs: readonly TrackRef[],
  opts: EnsureOptions = {},
): Promise<TrackOutcome[]> {
  const rulesVersion = opts.rulesVersion ?? RULES_VERSION;
  const versions = opts.sourceVersions ?? SOURCE_VERSIONS;
  const unique = [...new Map(refs.map((r) => [r.spotifyId, r])).values()];
  if (unique.length === 0) return [];

  const rows = await db
    .insert(tracks)
    .values(unique.map((r) => ({ spotifyId: r.spotifyId, isrc: r.isrc })))
    .onConflictDoUpdate({ target: tracks.spotifyId, set: { isrc: sql`coalesce(excluded.isrc, ${tracks.isrc})` } })
    .returning();
  const bySpotify = new Map(rows.map((r) => [r.spotifyId, r]));
  const ids = rows.map((r) => r.id);

  const done = new Set(
    (await db.select().from(sourceLookups).where(inArray(sourceLookups.trackId, ids)))
      .filter((l) => l.sourceVersion === versions[l.source])
      .map((l) => `${l.trackId}:${l.source}`),
  );
  const has = (trackId: string, s: Source) => done.has(`${trackId}:${s}`);
  const featureVersion = new Map(
    (
      await db
        .select({ trackId: trackFeatures.trackId, v: trackFeatures.rulesVersion })
        .from(trackFeatures)
        .where(inArray(trackFeatures.trackId, ids))
    ).map((f) => [f.trackId, f.v]),
  );

  const record = async (trackId: string, s: Source, hit: boolean, estimates: Estimate[] = []) => {
    if (estimates.length) {
      await db
        .insert(featureEstimates)
        .values(estimates.map((e) => ({ trackId, source: s, sourceVersion: versions[s], ...e })))
        .onConflictDoNothing();
    }
    await db
      .insert(sourceLookups)
      .values({ trackId, source: s, sourceVersion: versions[s], status: hit ? "hit" : "miss" })
      .onConflictDoNothing();
  };

  const changed = new Set<string>();
  const errors = new Map<string, string[]>(ids.map((id) => [id, []]));

  // ReccoBeats takes batches, so query it once for every track that needs it.
  const needRecco = rows.filter((r) => !has(r.id, "reccobeats"));
  if (needRecco.length) {
    try {
      const found = await sources.reccobeats.audioFeatures(needRecco.map((r) => r.spotifyId));
      for (const r of needRecco) {
        const f = found.get(r.spotifyId);
        await record(
          r.id,
          "reccobeats",
          !!f,
          f
            ? ([
                { feature: "bpm", value: f.tempo },
                { feature: "energy", value: f.energy },
                { feature: "danceability", value: f.danceability },
              ] satisfies Estimate[]).filter((e) => e.value !== null)
            : [],
        );
        changed.add(r.id);
      }
    } catch (e) {
      for (const r of needRecco) errors.get(r.id)!.push(`reccobeats: ${(e as Error).message}`);
    }
  }

  const perTrack = async (ref: TrackRef): Promise<TrackOutcome> => {
    const row = bySpotify.get(ref.spotifyId)!;
    const trackErrors = errors.get(row.id)!;
    let preview: string | null | undefined;

    const lookupDeezer = async () => {
      const d = row.isrc ? await sources.deezer.byIsrc(row.isrc) : null;
      preview = d?.previewUrl ?? null;
      return d;
    };

    if (!has(row.id, "deezer")) {
      try {
        const d = await lookupDeezer();
        if (d) {
          await db
            .update(tracks)
            .set({
              deezerId: d.deezerId,
              title: d.title,
              artists: d.artists,
              durationMs: d.durationMs,
              artworkUrl: d.artworkUrl,
              genres: d.genres,
            })
            .where(eq(tracks.id, row.id));
          Object.assign(row, { title: d.title, artists: d.artists });
        }
        await record(row.id, "deezer", !!d, d?.bpm ? [{ feature: "bpm", value: d.bpm }] : []);
        changed.add(row.id);
      } catch (e) {
        trackErrors.push(`deezer: ${(e as Error).message}`);
      }
    }

    if (!has(row.id, "essentia")) {
      try {
        // Preview URLs expire, so a cached Deezer hit is re-queried only when Essentia still needs audio.
        if (preview === undefined && row.isrc) await lookupDeezer();
        const artist = row.artists?.[0] ?? ref.artists?.[0];
        const title = row.title ?? ref.title;
        if (!preview && artist && title) preview = await sources.previews.findPreview(artist, title);
        if (preview) {
          const a = await sources.analyzer.analyze(preview);
          await record(row.id, "essentia", true, [
            { feature: "bpm", value: a.bpm },
            { feature: "bpm_confidence", value: a.bpmConfidence },
            { feature: "energy", value: a.energy },
            { feature: "danceability", value: a.danceability },
            { feature: "key", valueText: `${a.key} ${a.scale}` },
          ]);
        } else {
          await record(row.id, "essentia", false);
        }
        changed.add(row.id);
      } catch (e) {
        trackErrors.push(`essentia: ${(e as Error).message}`);
      }
    }

    if (changed.has(row.id) || featureVersion.get(row.id) !== rulesVersion) {
      await recomputeFeatures(db, [row.id], { rulesVersion, sourceVersions: versions });
    }
    const outcome = { spotifyId: ref.spotifyId, trackId: row.id, errors: trackErrors };
    await opts.onTrackDone?.(outcome);
    return outcome;
  };

  return pool(unique, opts.concurrency ?? 4, perTrack);
}

/** Resolve features from stored estimates only; never calls outside sources. */
export async function recomputeFeatures(
  db: Db,
  trackIds: readonly string[],
  { rulesVersion = RULES_VERSION, sourceVersions = SOURCE_VERSIONS }: Omit<EnsureOptions, "concurrency" | "onTrackDone"> = {},
): Promise<void> {
  if (trackIds.length === 0) return;
  // A "BPM looks wrong" flag keeps the track at low confidence whatever the sources say.
  const flagged = new Set(
    (await db.select({ id: bpmFlags.trackId }).from(bpmFlags).where(inArray(bpmFlags.trackId, [...trackIds]))).map(
      (f) => f.id,
    ),
  );
  const estimates = await db
    .select()
    .from(featureEstimates)
    .where(inArray(featureEstimates.trackId, [...trackIds]));

  for (const trackId of trackIds) {
    const current = estimates.filter((e) => e.trackId === trackId && e.sourceVersion === sourceVersions[e.source]);
    const get = (s: Source, f: string) => current.find((e) => e.source === s && e.feature === f);
    const votes: BpmVotes = {
      essentia: get("essentia", "bpm")?.value,
      reccobeats: get("reccobeats", "bpm")?.value,
      deezer: get("deezer", "bpm")?.value,
    };
    const bpm = resolveBpm(votes);
    const [key, scale] = (get("essentia", "key")?.valueText ?? "").split(" ");
    const values = {
      bpm: bpm.bpm,
      bpmFolded: bpm.folded,
      bpmConfidence: flagged.has(trackId) && bpm.confidence !== "unavailable" ? ("low" as const) : bpm.confidence,
      ambiguousFeel: bpm.ambiguousFeel,
      bpmAlt: bpm.bpmAlt,
      energy: get("essentia", "energy")?.value ?? null,
      danceability: get("essentia", "danceability")?.value ?? null,
      key: key && scale ? `${key} ${scale}` : null,
      camelot: key && (scale === "major" || scale === "minor") ? toCamelot(key, scale) : null,
      rulesVersion,
      computedAt: new Date(),
    };
    await db
      .insert(trackFeatures)
      .values({ trackId, ...values })
      .onConflictDoUpdate({ target: trackFeatures.trackId, set: values });
  }
}

/** Tracks whose features predate the current rules; feed to recomputeFeatures after a rules bump. */
export async function staleTrackIds(db: Db, rulesVersion = RULES_VERSION): Promise<string[]> {
  const rows = await db
    .select({ id: trackFeatures.trackId })
    .from(trackFeatures)
    .where(ne(trackFeatures.rulesVersion, rulesVersion));
  return rows.map((r) => r.id);
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
