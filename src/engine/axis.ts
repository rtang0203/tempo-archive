import { FOLD_LOW } from "./tempo";

/** Canonical 5-BPM lane (0–13) of a tempo already folded into [70, 140). */
export const canonicalLane = (folded: number) => Math.min(13, Math.max(0, Math.floor((folded - FOLD_LOW) / 5)));

/**
 * Where a collection's folded axis starts (70, 75 … 135). The octave is circular,
 * so whatever tempo sits at the seam gets split across the two ends of the screen.
 * Start at the step whose seam has the fewest tracks on either side; ties keep 70.
 */
export function axisStart(foldedTempos: readonly number[]): number {
  const counts = Array<number>(14).fill(0);
  for (const f of foldedTempos) counts[canonicalLane(f)]!++;
  let best = 0;
  let bestCost = Infinity;
  for (let i = 0; i < 14; i++) {
    const cost = counts[(i + 13) % 14]! + counts[i]!;
    if (cost < bestCost) [best, bestCost] = [i, cost];
  }
  return FOLD_LOW + best * 5;
}

export interface LaneCount {
  /** Lane's lower bound on the collection's axis (≥ 140 means a doubled lane). */
  lo: number;
  count: number;
}

/** Track counts per canonical lane, in axis order starting at `axisStart`. */
export function rotatedHistogram(foldedTempos: readonly number[]): LaneCount[] {
  const counts = Array<number>(14).fill(0);
  for (const f of foldedTempos) counts[canonicalLane(f)]!++;
  const first = (axisStart(foldedTempos) - FOLD_LOW) / 5;
  return counts.map((_, j) => {
    const i = (first + j) % 14;
    return { lo: (FOLD_LOW + i * 5) * (i < first ? 2 : 1), count: counts[i]! };
  });
}
