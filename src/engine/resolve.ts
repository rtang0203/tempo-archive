import { fold, nearestOctave, relation } from "./tempo";

export const BPM_SOURCES = ["essentia", "reccobeats", "deezer"] as const;
export type BpmSource = (typeof BPM_SOURCES)[number];
export type BpmVotes = Partial<Record<BpmSource, number | null>>;
export type Confidence = "high" | "medium" | "low" | "unavailable";

export interface ResolvedBpm {
  bpm: number | null;
  folded: number | null;
  confidence: Confidence;
  /** Two estimates sit in a 3:2 relation (triplet / half-time feel). */
  ambiguousFeel: boolean;
  /** The 3:2 partner when `ambiguousFeel`. */
  bpmAlt: number | null;
  agreeing: BpmSource[];
}

// Tie-break order: Essentia measured the audio; ReccoBeats beat it on triplet-feel tracks in the spike.
const PREFERENCE: readonly BpmSource[] = BPM_SOURCES;

function result(bpm: number | null, confidence: Confidence, agreeing: BpmSource[], bpmAlt: number | null = null): ResolvedBpm {
  return {
    bpm,
    folded: bpm === null ? null : fold(bpm),
    confidence,
    ambiguousFeel: bpmAlt !== null,
    bpmAlt,
    agreeing,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Pick the final BPM from every source's raw estimate. */
export function resolveBpm(votes: BpmVotes): ResolvedBpm {
  const present = PREFERENCE.filter((s) => {
    const v = votes[s];
    return typeof v === "number" && Number.isFinite(v) && v > 0;
  });
  const v = (s: BpmSource) => votes[s] as number;

  if (present.length === 0) return result(null, "unavailable", []);
  if (present.length === 1) return result(v(present[0]!), "medium", present);

  // Largest group of mutually agreeing sources; earlier preference wins ties.
  let group: BpmSource[] = [];
  for (const s of present) {
    const g = present.filter((t) => relation(v(s), v(t)) === "same");
    if (g.length > group.length) group = g;
  }
  if (group.length >= 2) {
    const anchor = v(group[0]!);
    // Align octaves before the median so 139 and 71 don't average to 105.
    return result(median(group.map((s) => nearestOctave(v(s), anchor))), "high", group);
  }

  // 3:2 pairs: prefer the value ReccoBeats gave (or agrees with), keep the partner.
  const pairs: Array<[BpmSource, BpmSource]> = [];
  for (const a of present) for (const b of present) if (a < b && relation(v(a), v(b)) === "three-two") pairs.push([a, b]);
  const withRecco = pairs.find((p) => p.includes("reccobeats"));
  if (withRecco) {
    const other = withRecco[0] === "reccobeats" ? withRecco[1] : withRecco[0];
    return result(v("reccobeats"), "low", ["reccobeats"], v(other));
  }
  if (pairs.length > 0) {
    const [a, b] = pairs[0]!;
    const [chosen, alt] = PREFERENCE.indexOf(a) < PREFERENCE.indexOf(b) ? [a, b] : [b, a];
    return result(v(chosen), "low", [chosen], v(alt));
  }

  return result(v(present[0]!), "low", [present[0]!]);
}
