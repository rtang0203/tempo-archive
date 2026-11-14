import { FOLD_LOW, fold } from "@/engine/tempo";

/**
 * Cool-to-warm along the collection's axis band [low, 2·low): the one color in the
 * UI that carries meaning. Slowest end is blue, fastest end is orange.
 */
export function tempoColor(bpm: number, alpha = 1, low = FOLD_LOW): string {
  const t = Math.log2(fold(bpm, low) / low);
  // Rounded: Math.log2 can differ in the last ulp between Node and the browser, which breaks hydration.
  return `hsl(${Math.round(210 - t * 190)} 75% 58% / ${alpha})`;
}
