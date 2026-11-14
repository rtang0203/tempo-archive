import { describe, expect, it } from "vitest";
import { axisStart, rotatedHistogram } from "./axis";
import { toCamelot } from "./camelot";
import { displayTempo } from "./display";
import { rankNeighbors, type TempoTrack } from "./neighbors";
import { resolveBpm } from "./resolve";
import { fold, octaveDistance, relation, toleranceOctaves } from "./tempo";

describe("tempo distance", () => {
  it("treats the fold seam as adjacent: 139 and 71 are ~2% apart, not an octave", () => {
    expect(fold(139)).toBeCloseTo(139);
    expect(fold(71)).toBeCloseTo(71);
    expect(octaveDistance(139, 71)).toBeLessThan(toleranceOctaves(3, 139));
  });

  it("matches half and double time only when folding", () => {
    expect(octaveDistance(87, 174)).toBeCloseTo(0);
    expect(octaveDistance(87, 174, false)).toBeCloseTo(1);
  });

  it("converts BPM tolerance against the reference tempo, consistently across octaves", () => {
    // ±3 at 174 is the same ratio as ±1.5 at 87.
    expect(toleranceOctaves(3, 174)).toBeCloseTo(toleranceOctaves(1.5, 87));
    expect(octaveDistance(174, 177)).toBeLessThanOrEqual(toleranceOctaves(3, 174) + 1e-12);
    expect(octaveDistance(87, 89)).toBeGreaterThan(toleranceOctaves(3, 174));
  });

  it("classifies 3:2 (and its folded form 4:3) separately from agreement", () => {
    expect(relation(147.9, 98.6)).toBe("three-two");
    expect(relation(104.5, 80)).toBe("other"); // 1.306: outside ±1.5% of 4:3
    expect(relation(114.8, 86.1)).toBe("three-two");
    expect(relation(120, 121.5)).toBe("same");
  });
});

describe("resolveBpm", () => {
  it("is high confidence when two sources agree, aligning octaves before the median", () => {
    const r = resolveBpm({ essentia: 139.5, reccobeats: 70.3 });
    expect(r.confidence).toBe("high");
    expect(r.bpm).toBeCloseTo(140.05); // median of 139.5 and 140.6, not ~105
  });

  it("agrees across octaves and anchors on Essentia's octave", () => {
    const r = resolveBpm({ essentia: 147.5, reccobeats: 148.1, deezer: 74 });
    expect(r.confidence).toBe("high");
    expect(r.agreeing).toEqual(["essentia", "reccobeats", "deezer"]);
    expect(r.bpm).toBeCloseTo(148);
  });

  it("uses a lone source at medium confidence", () => {
    expect(resolveBpm({ essentia: 84 })).toMatchObject({ bpm: 84, confidence: "medium", ambiguousFeel: false });
  });

  it("flags 3:2 disagreement as ambiguous feel and prefers ReccoBeats", () => {
    const r = resolveBpm({ essentia: 98.6, reccobeats: 147.9 });
    expect(r).toMatchObject({ bpm: 147.9, bpmAlt: 98.6, ambiguousFeel: true, confidence: "low" });
  });

  it("prefers Essentia when 3:2 disagreement doesn't involve ReccoBeats", () => {
    expect(resolveBpm({ essentia: 98.6, deezer: 147.9 })).toMatchObject({ bpm: 98.6, bpmAlt: 147.9 });
  });

  it("prefers Essentia at low confidence on other disagreement", () => {
    expect(resolveBpm({ essentia: 117.5, reccobeats: 128 })).toMatchObject({
      bpm: 117.5,
      confidence: "low",
      ambiguousFeel: false,
    });
  });

  it("lets two agreeing sources outvote a 3:2 third", () => {
    const r = resolveBpm({ essentia: 103.6, reccobeats: 156.2, deezer: 156 });
    expect(r.confidence).toBe("high");
    expect(r.agreeing).toEqual(["reccobeats", "deezer"]);
    expect(r.ambiguousFeel).toBe(false);
  });

  it("ignores zero and missing votes", () => {
    expect(resolveBpm({ deezer: 0, reccobeats: null }).confidence).toBe("unavailable");
  });
});

describe("displayTempo", () => {
  it("shows the folded value with the nearer other octave", () => {
    expect(displayTempo(142.4)).toMatchObject({ primary: 71.2, alternate: 142.4, alternateLabel: "double-time" });
    expect(displayTempo(64.9)).toMatchObject({ primary: 129.8, alternate: 64.9, alternateLabel: "half-time" });
  });
});

describe("rankNeighbors", () => {
  const t = (id: string, bpm: number, energy: number | null = 0.5, genres: string[] = []): TempoTrack => ({
    id,
    bpm,
    energy,
    genres,
  });
  const ref = { id: "ref", bpm: 124, energy: 0.6, genres: ["Rap"] };

  it("matches half-time tracks only when folding", () => {
    const [n] = rankNeighbors(ref, [t("c", 62)], { toleranceBpm: 3, fold: true });
    expect(n?.track.id).toBe("c");
    expect(rankNeighbors(ref, [t("c", 62)], { toleranceBpm: 3, fold: false })).toEqual([]);
  });

  it("excludes the reference and anything outside tolerance", () => {
    const ids = rankNeighbors(ref, [t("ref", 124), t("near", 126.5), t("far", 128)], { toleranceBpm: 3, fold: true }).map(
      (n) => n.track.id,
    );
    expect(ids).toEqual(["near"]);
  });

  it("breaks near-ties by energy, then shared genre", () => {
    const ids = rankNeighbors(
      ref,
      [t("loud", 124.2, 0.95), t("close-energy", 124.3, 0.62), t("same-genre", 124.3, 0.62, ["Rap"])],
      { toleranceBpm: 3, fold: true },
    ).map((n) => n.track.id);
    expect(ids).toEqual(["same-genre", "close-energy", "loud"]);
  });

  it("ranks clearly closer tempos first regardless of energy", () => {
    const ids = rankNeighbors(ref, [t("energy-match", 126, 0.6), t("tempo-match", 124.1, 0.1)], {
      toleranceBpm: 3,
      fold: true,
    }).map((n) => n.track.id);
    expect(ids).toEqual(["tempo-match", "energy-match"]);
  });
});

describe("toCamelot", () => {
  it("maps Essentia keys to the Camelot wheel", () => {
    expect(toCamelot("C", "major")).toBe("8B");
    expect(toCamelot("A", "minor")).toBe("8A");
    expect(toCamelot("F#", "minor")).toBe("11A");
    expect(toCamelot("Bb", "major")).toBe("6B");
    expect(toCamelot("H", "major")).toBeNull();
  });
});

describe("axis start", () => {
  // Shaped like mollyrock: clusters at both ends of 70–140, nearly empty around 100.
  const edges = [71, 72, 72, 73, 76, 78, 84, 88, 101, 118, 126, 131, 134, 136, 137, 138, 139];

  it("keeps 70 when the seam is already empty", () => {
    expect(axisStart([90, 95, 100, 105, 110])).toBe(70);
    expect(axisStart([])).toBe(70);
  });

  it("moves the seam to the emptiest stretch so edge clusters stay together", () => {
    const start = axisStart(edges);
    expect(start).toBeGreaterThanOrEqual(90);
    expect(start).toBeLessThanOrEqual(110);
    // 139 and 71 now sit next to each other on the axis instead of at opposite ends.
    expect(Math.abs(fold(139, start) - fold(71, start))).toBeLessThan(5);
  });

  it("rotates the histogram into axis order with doubled lanes past 140", () => {
    const start = axisStart(edges);
    const lanes = rotatedHistogram(edges);
    expect(lanes).toHaveLength(14);
    expect(lanes[0]!.lo).toBe(start);
    expect(lanes.map((l) => l.lo)).toEqual([...lanes.map((l) => l.lo)].sort((a, b) => a - b));
    expect(lanes.at(-1)!.lo).toBe(2 * start - 10);
    expect(lanes.reduce((n, l) => n + l.count, 0)).toBe(edges.length);
  });

  it("shows primary and alternate octaves within the collection's band", () => {
    expect(displayTempo(72, 100)).toMatchObject({ primary: 144, alternate: 72, alternateLabel: "half-time" });
  });
});
