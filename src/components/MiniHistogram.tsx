import type { LaneCount } from "@/engine/axis";
import { tempoColor } from "./tempo-color";

/** 14 lanes in the collection's axis order, bar height ∝ track count. */
export function MiniHistogram({ lanes, className = "h-10" }: { lanes: LaneCount[]; className?: string }) {
  const max = Math.max(1, ...lanes.map((l) => l.count));
  return (
    <div className={`flex items-end gap-px ${className}`} aria-hidden>
      {lanes.map((l) => (
        <div
          key={l.lo}
          className="flex-1 rounded-t-sm"
          style={{ height: `${Math.max(4, (l.count / max) * 100)}%`, background: tempoColor(l.lo + 2, l.count ? 0.9 : 0.15, lanes[0]!.lo) }}
        />
      ))}
    </div>
  );
}
