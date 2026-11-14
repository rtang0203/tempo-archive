import type { BpmSource } from "./resolve";

/**
 * Bump RULES_VERSION when the agreement rule changes: features are recomputed
 * from stored estimates with no external calls. Bump a source version when that
 * source's analysis changes: only that source is re-queried.
 */
export const RULES_VERSION = 1;

export type Source = BpmSource; // essentia | reccobeats | deezer

export const SOURCE_VERSIONS: Record<Source, number> = {
  essentia: 1,
  reccobeats: 1,
  deezer: 1,
};
