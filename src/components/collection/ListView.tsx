"use client";

import { useState } from "react";
import type { CollectionTrack } from "@/server/collections";
import { Tempo } from "./Tempo";

type SortKey = "position" | "title" | "artist" | "bpm" | "energy" | "danceability" | "confidence";

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2, unavailable: 3 } as const;

/** Plain sortable table for sorting and copying. */
export function ListView({
  tracks,
  fold,
  energyPct,
  dancePct,
  selected,
  onToggleSelect,
  onOpen,
}: {
  tracks: CollectionTrack[];
  fold: boolean;
  energyPct: Map<string, number>;
  dancePct: Map<string, number>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "bpm", dir: 1 });
  const value = (t: CollectionTrack): number | string => {
    switch (sort.key) {
      case "position":
        return t.position;
      case "title":
        return (t.title ?? "").toLowerCase();
      case "artist":
        return (t.artists[0] ?? "").toLowerCase();
      case "bpm":
        return (fold ? t.bpmFolded : t.bpm) ?? Infinity;
      case "energy":
        return energyPct.get(t.trackId) ?? -1;
      case "danceability":
        return dancePct.get(t.trackId) ?? -1;
      case "confidence":
        return CONFIDENCE_ORDER[t.confidence ?? "unavailable"];
    }
  };
  const rows = [...tracks].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
  });
  const th = (key: SortKey, label: string) => (
    <th className="px-2 py-2 text-left font-medium">
      <button
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}
        className={sort.key === key ? "text-[var(--fg)]" : "text-[var(--muted)]"}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--line)] text-xs">
          <tr>
            <th className="w-8" />
            {th("position", "#")}
            {th("title", "Title")}
            {th("artist", "Artist")}
            {th("bpm", "BPM")}
            {th("energy", "Energy")}
            {th("danceability", "Dance")}
            {th("confidence", "Confidence")}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.trackId} className="cursor-pointer border-b border-[var(--line)]/60 hover:bg-[var(--line)]/30" onClick={() => onOpen(t.trackId)}>
              <td className="px-2" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(t.trackId)} onChange={() => onToggleSelect(t.trackId)} className="accent-[#1db954]" />
              </td>
              <td className="num px-2 text-[var(--muted)]">{t.position + 1}</td>
              <td className="max-w-[260px] truncate px-2">{t.title ?? "Unknown track"}</td>
              <td className="max-w-[200px] truncate px-2 text-[var(--muted)]">{t.artists.join(", ")}</td>
              <td className="px-2">{t.bpm ? <Tempo bpm={t.bpm} /> : "—"}</td>
              <td className="num px-2">{energyPct.get(t.trackId) ?? "—"}</td>
              <td className="num px-2">{dancePct.get(t.trackId) ?? "—"}</td>
              <td className="px-2 text-xs text-[var(--muted)]">{t.confidence ?? "analyzing"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
