import type { ResolvedTrack } from "./model";
import { Tempo } from "./Tempo";

export interface CardState {
  dimmed: boolean;
  glow: boolean;
  selected: boolean;
  focused: boolean;
}

export function TrackCard({
  track,
  energyPct,
  state,
  onOpen,
  onToggleSelect,
  onHover,
}: {
  track: ResolvedTrack;
  energyPct: number | undefined;
  state: CardState;
  onOpen: () => void;
  onToggleSelect: () => void;
  onHover: (on: boolean) => void;
}) {
  const lowConfidence = track.confidence === "low";
  return (
    <div
      role="button"
      tabIndex={-1}
      data-track={track.trackId}
      onClick={(e) => (e.shiftKey || e.metaKey ? onToggleSelect() : onOpen())}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={[
        "group relative flex cursor-pointer items-center gap-2 rounded-lg border bg-[var(--panel)] p-1.5 transition",
        lowConfidence ? "border-dashed opacity-70" : "border-[var(--line)]",
        state.dimmed ? "opacity-20" : "",
        state.glow ? "ring-2 ring-[var(--fg)]/40" : "",
        state.selected ? "ring-2 ring-[#1db954]" : "",
        state.focused ? "outline outline-2 outline-offset-1 outline-[var(--fg)]" : "",
      ].join(" ")}
      title={track.ambiguousFeel && track.bpmAlt ? `Ambiguous feel: could be ${Math.round(track.bpmAlt)}` : undefined}
    >
      <input
        type="checkbox"
        aria-label="Select"
        checked={state.selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        className={`absolute left-1 top-1 z-10 h-3.5 w-3.5 accent-[#1db954] ${state.selected ? "" : "opacity-0 group-hover:opacity-100"}`}
      />
      {track.artworkUrl ? (
        <img src={track.artworkUrl.replace("1000x1000", "120x120")} alt="" className="h-9 w-9 shrink-0 rounded" loading="lazy" />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded bg-[var(--line)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{track.title ?? "Unknown track"}</div>
        <div className="truncate text-[11px] text-[var(--muted)]">{track.artists.join(", ")}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <Tempo bpm={track.bpm} />
          {track.ambiguousFeel && <span className="text-[10px] text-[var(--muted)]">≈</span>}
          <div className="h-1 flex-1 overflow-hidden rounded bg-[var(--line)]">
            <div className="h-full bg-[var(--muted)]" style={{ width: `${energyPct ?? 0}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
