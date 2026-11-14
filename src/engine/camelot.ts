// Camelot wheel position per pitch class, for major (B) and minor (A).
const PITCH: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};
const MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

/** Essentia KeyExtractor output ("A", "minor") → Camelot code ("8A"). */
export function toCamelot(key: string, scale: "major" | "minor"): string | null {
  const pc = PITCH[key];
  if (pc === undefined) return null;
  return scale === "major" ? `${MAJOR[pc]}B` : `${MINOR[pc]}A`;
}
