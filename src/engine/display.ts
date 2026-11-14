import { FOLD_LOW, fold } from "./tempo";

export interface TempoDisplay {
  /** Shown on cards and lanes: the value folded into the collection's axis band. */
  primary: number;
  /** The other octave, shown beside it. */
  alternate: number;
  alternateLabel: "half-time" | "double-time";
}

/**
 * Listeners disagree about octave (the spike ear check heard half-time on 8/20
 * tracks and no fixed band fit), so both readings are always shown. `low` is
 * the start of the collection's axis band, so the primary matches its lane.
 */
export function displayTempo(bpm: number, low = FOLD_LOW): TempoDisplay {
  const primary = fold(bpm, low);
  // Above the band's geometric midpoint the half-time reading is the closer alternative.
  return primary >= low * Math.SQRT2
    ? { primary, alternate: primary / 2, alternateLabel: "half-time" }
    : { primary, alternate: primary * 2, alternateLabel: "double-time" };
}
