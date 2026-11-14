import { rankNeighbors } from "@/engine/neighbors";
import { FOLD_HIGH, fold as foldInto } from "@/engine/tempo";
import type { CollectionTrack } from "@/server/collections";

export type ResolvedTrack = CollectionTrack & { bpm: number; bpmFolded: number };

export const isResolved = (t: CollectionTrack): t is ResolvedTrack => t.bpm !== null && t.bpmFolded !== null;

/** The tempo a track sits at on the current axis: folded into [start, 2·start), or raw. */
export const axisTempo = (t: ResolvedTrack, fold: boolean, start: number) => (fold ? foldInto(t.bpm, start) : t.bpm);

/** Percentile rank (0–100) within the collection; raw energy/danceability scales are arbitrary. */
export function percentiles(tracks: CollectionTrack[], key: "energy" | "danceability"): Map<string, number> {
  const vals = tracks.filter((t) => t[key] !== null).sort((a, b) => a[key]! - b[key]!);
  const out = new Map<string, number>();
  vals.forEach((t, i) => out.set(t.trackId, vals.length === 1 ? 50 : Math.round((i / (vals.length - 1)) * 100)));
  return out;
}

export interface Lane {
  lo: number;
  hi: number;
}

/**
 * Folded: the 14 canonical lanes rotated to begin at `start`; lanes past 140 are
 * doubled (10 BPM wide) so they hold exactly the tempos of the 5-BPM lanes they replace.
 * Unfolded: 5-BPM lanes over the collection's raw range.
 */
export function lanesFor(tracks: ResolvedTrack[], fold: boolean, start: number): Lane[] {
  const lanes: Lane[] = [];
  if (fold) {
    for (let x = start; x < FOLD_HIGH; x += 5) lanes.push({ lo: x, hi: x + 5 });
    for (let x = FOLD_HIGH; x < 2 * start; x += 10) lanes.push({ lo: x, hi: x + 10 });
    return lanes;
  }
  if (!tracks.length) return lanes;
  const lo = Math.floor(Math.min(...tracks.map((t) => t.bpm)) / 5) * 5;
  const hi = Math.floor(Math.max(...tracks.map((t) => t.bpm)) / 5) * 5 + 5;
  for (let x = lo; x < hi; x += 5) lanes.push({ lo: x, hi: x + 5 });
  return lanes;
}

export const laneIndex = (lanes: Lane[], tempo: number) =>
  Math.max(0, Math.min(lanes.length - 1, lanes.findIndex((l) => tempo >= l.lo && tempo < l.hi)));

export interface MatchRef {
  label: string;
  bpm: number;
  energy: number | null;
  genres: string[];
  trackId?: string;
}

export function matches(ref: MatchRef, tracks: ResolvedTrack[], toleranceBpm: number, fold: boolean, limit?: number) {
  return rankNeighbors(
    { id: ref.trackId, bpm: ref.bpm, energy: ref.energy, genres: ref.genres },
    tracks.map((t) => ({ ...t, id: t.trackId })),
    { toleranceBpm, fold, limit },
  );
}

export const trackLabel = (t: CollectionTrack) =>
  `${t.title ?? "Unknown track"}${t.artists.length ? ` — ${t.artists.join(", ")}` : ""}`;

export const spotifyUrl = (spotifyId: string) => `https://open.spotify.com/track/${spotifyId}`;
