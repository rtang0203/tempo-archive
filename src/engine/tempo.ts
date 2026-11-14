/**
 * Tempo math shared by the API and the UI. All comparisons happen in octaves
 * (log2 of the tempo ratio), so tolerances are ratios, never absolute BPM.
 */

export const FOLD_LOW = 70;
export const FOLD_HIGH = 140;

/** Sources agree when within ±1.5%. */
export const AGREE_RATIO = 0.015;

const THREE_TWO_OCTAVES = Math.log2(4 / 3); // 3:2 is 4:3 once reduced modulo an octave

/** Halve/double into the one-octave band [low, 2·low); canonical [70, 140) by default. */
export function fold(bpm: number, low = FOLD_LOW): number {
  if (!(bpm > 0) || !Number.isFinite(bpm)) throw new RangeError(`invalid bpm: ${bpm}`);
  let b = bpm;
  while (b < low) b *= 2;
  while (b >= 2 * low) b /= 2;
  return b;
}

/**
 * Distance between two tempos in octaves. Circular (the default) treats
 * half/double as identical, so 139 and 71 (≈142) are ~0.03 octaves apart.
 */
export function octaveDistance(a: number, b: number, circular = true): number {
  const d = Math.abs(Math.log2(a / b));
  if (!circular) return d;
  const m = d % 1;
  return Math.min(m, 1 - m);
}

export function ratioToOctaves(ratio: number): number {
  return Math.log2(1 + ratio);
}

export const AGREE_OCTAVES = ratioToOctaves(AGREE_RATIO);

/**
 * The UI shows tolerance in BPM; the engine converts it against the tempo being
 * matched: ±3 at 174 means ±1.7%, which is correct at either octave.
 */
export function toleranceOctaves(toleranceBpm: number, referenceBpm: number): number {
  return ratioToOctaves(toleranceBpm / referenceBpm);
}

export type TempoRelation = "same" | "three-two" | "other";

/** Octave-agnostic relation between two estimates. */
export function relation(a: number, b: number, tolerance = AGREE_OCTAVES): TempoRelation {
  const d = octaveDistance(a, b);
  if (d <= tolerance) return "same";
  if (Math.abs(d - THREE_TWO_OCTAVES) <= tolerance) return "three-two";
  return "other";
}

/** Move `value` by whole octaves to sit as close as possible to `anchor`. */
export function nearestOctave(value: number, anchor: number): number {
  return value * 2 ** Math.round(Math.log2(anchor / value));
}
