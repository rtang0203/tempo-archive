"use client";

import { createContext, useContext } from "react";
import { displayTempo } from "@/engine/display";
import { FOLD_LOW } from "@/engine/tempo";
import { tempoColor } from "../tempo-color";

/** Start of the collection's folded axis band; every BPM shown in it uses the same band. */
export const AxisStart = createContext(FOLD_LOW);

/** Both octaves: band value bold, the other octave dimmed (listeners split ~50/50 on which they hear). */
export function Tempo({ bpm, size = "sm" }: { bpm: number; size?: "sm" | "lg" }) {
  const low = useContext(AxisStart);
  const d = displayTempo(bpm, low);
  return (
    <span className={`num whitespace-nowrap ${size === "lg" ? "text-3xl" : "text-xs"}`}>
      <b style={{ color: tempoColor(bpm, 1, low) }}>{Math.round(d.primary)}</b>
      <span className="text-[var(--muted)]"> / {Math.round(d.alternate)}</span>
    </span>
  );
}
