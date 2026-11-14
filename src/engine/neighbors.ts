import { octaveDistance, ratioToOctaves, toleranceOctaves } from "./tempo";

export interface TempoTrack {
  id: string;
  bpm: number;
  energy: number | null;
  genres: readonly string[];
}

export interface NeighborOptions {
  /** Tolerance as shown in the UI (±BPM at the reference tempo). */
  toleranceBpm: number;
  /** Treat half/double tempo as the same (the UI's fold toggle). */
  fold: boolean;
  limit?: number;
}

export interface Neighbor<T extends TempoTrack = TempoTrack> {
  track: T;
  /** Tempo distance in octaves. */
  distance: number;
}

/**
 * Tempo distances are compared in 0.5% buckets so energy and genre can break
 * near-ties; ranking on raw distance would make them unreachable.
 */
const BUCKET = ratioToOctaves(0.005);

export function rankNeighbors<T extends TempoTrack>(
  reference: { bpm: number; energy: number | null; genres: readonly string[]; id?: string },
  candidates: readonly T[],
  opts: NeighborOptions,
): Neighbor<T>[] {
  const tol = toleranceOctaves(opts.toleranceBpm, reference.bpm);
  const refGenres = new Set(reference.genres);
  const scored = [];
  for (const track of candidates) {
    if (track.id === reference.id) continue;
    const distance = octaveDistance(track.bpm, reference.bpm, opts.fold);
    if (distance > tol) continue;
    scored.push({
      track,
      distance,
      bucket: Math.floor(distance / BUCKET),
      energyGap:
        track.energy === null || reference.energy === null ? Infinity : Math.abs(track.energy - reference.energy),
      sharesGenre: track.genres.some((g) => refGenres.has(g)),
    });
  }
  scored.sort(
    (a, b) =>
      a.bucket - b.bucket ||
      a.energyGap - b.energyGap ||
      Number(b.sharesGenre) - Number(a.sharesGenre) ||
      a.distance - b.distance,
  );
  const top = opts.limit === undefined ? scored : scored.slice(0, opts.limit);
  return top.map(({ track, distance }) => ({ track, distance }));
}
