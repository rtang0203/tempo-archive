import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { SourceError } from "../adapters/http";
import type { DeezerTrack, TrackSources } from "../adapters/types";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { SOURCE_VERSIONS } from "../engine/version";
import { ensureTracks, recomputeFeatures, staleTrackIds, type TrackRef } from "./ensure";

const deezerTrack = (bpm: number | null, preview: string | null): DeezerTrack => ({
  deezerId: 1,
  title: "Song",
  artists: ["Artist"],
  durationMs: 1000,
  artworkUrl: "https://cdn/art.jpg",
  bpm,
  previewUrl: preview,
  genres: ["Rap"],
});

/** Fake outside world that counts every call. */
function fakeSources() {
  const calls = { deezer: 0, reccobeats: 0, previews: 0, analyzer: 0 };
  const state = { deezerFails: false };
  const sources: TrackSources = {
    deezer: {
      async byIsrc(isrc) {
        calls.deezer++;
        if (state.deezerFails) throw new SourceError("deezer", 503, "down");
        if (isrc === "NODEEZER") return null;
        return deezerTrack(isrc === "WITHBPM" ? 120.4 : null, isrc === "NOPREVIEW" ? null : `https://preview/${isrc}`);
      },
    },
    reccobeats: {
      async audioFeatures(ids) {
        calls.reccobeats++;
        return new Map(ids.filter((id) => id !== "sp-unknown").map((id) => [id, { tempo: 120, energy: 0.7, danceability: 0.5 }]));
      },
    },
    previews: {
      async findPreview() {
        calls.previews++;
        return null;
      },
    },
    analyzer: {
      async analyze() {
        calls.analyzer++;
        return { bpm: 120.2, bpmConfidence: 2.5, energy: 0.4, danceability: 1.1, key: "A", scale: "minor" };
      },
    },
  };
  return { sources, calls, state };
}

const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

const playlist: TrackRef[] = [
  { spotifyId: "sp-1", isrc: "WITHBPM" },
  { spotifyId: "sp-2", isrc: "PLAIN" },
  { spotifyId: "sp-3", isrc: "NOPREVIEW", title: "Song", artists: ["Artist"] },
  { spotifyId: "sp-unknown", isrc: "NODEEZER" },
  { spotifyId: "sp-noisrc", isrc: null },
];

let db: Db;

beforeEach(async () => {
  const pg = drizzle(new PGlite(), { schema });
  await migrate(pg, { migrationsFolder: "drizzle" });
  db = pg as unknown as Db;
});

describe("ensureTracks", () => {
  it("re-importing the same playlist makes zero external calls", async () => {
    const { sources, calls } = fakeSources();
    await ensureTracks(db, sources, playlist);
    expect(total(calls)).toBeGreaterThan(0);

    const before = { ...calls };
    await ensureTracks(db, sources, playlist);
    expect(calls).toEqual(before);
  });

  it("stores resolved features from every source", async () => {
    const { sources } = fakeSources();
    const [first] = await ensureTracks(db, sources, playlist);
    const [f] = await db.select().from(schema.trackFeatures).where(eq(schema.trackFeatures.trackId, first!.trackId));
    expect(f).toMatchObject({ bpmConfidence: "high", energy: 0.4, key: "A minor", camelot: "8A", rulesVersion: 1 });
    const [t] = await db.select().from(schema.tracks).where(eq(schema.tracks.id, first!.trackId));
    expect(t).toMatchObject({ title: "Song", artists: ["Artist"], genres: ["Rap"] });
  });

  it("recomputes after a rules bump from stored estimates with zero external calls", async () => {
    const { sources, calls } = fakeSources();
    const outcomes = await ensureTracks(db, sources, playlist);
    const before = { ...calls };

    expect(await staleTrackIds(db, 2)).toHaveLength(outcomes.length);
    await recomputeFeatures(db, await staleTrackIds(db, 2), { rulesVersion: 2 });
    expect(await staleTrackIds(db, 2)).toEqual([]);

    // ensureTracks under the new rules also finds nothing to fetch.
    await ensureTracks(db, sources, playlist, { rulesVersion: 2 });
    expect(calls).toEqual(before);
  });

  it("re-queries only the source whose version was bumped", async () => {
    const { sources, calls } = fakeSources();
    await ensureTracks(db, sources, playlist);
    const before = { ...calls };

    await ensureTracks(db, sources, playlist, {
      sourceVersions: { ...SOURCE_VERSIONS, reccobeats: SOURCE_VERSIONS.reccobeats + 1 },
    });
    expect(calls).toEqual({ ...before, reccobeats: before.reccobeats + 1 });
  });

  it("retries transient failures on the next import but caches misses", async () => {
    const { sources, calls, state } = fakeSources();
    state.deezerFails = true;
    const outcomes = await ensureTracks(db, sources, [{ spotifyId: "sp-2", isrc: "PLAIN" }]);
    expect(outcomes[0]!.errors.some((e) => e.startsWith("deezer"))).toBe(true);

    state.deezerFails = false;
    const deezerBefore = calls.deezer;
    await ensureTracks(db, sources, [{ spotifyId: "sp-2", isrc: "PLAIN" }]);
    expect(calls.deezer).toBe(deezerBefore + 1);
    const [t] = await db.select().from(schema.tracks).where(eq(schema.tracks.spotifyId, "sp-2"));
    expect(t?.title).toBe("Song");
  });
});
