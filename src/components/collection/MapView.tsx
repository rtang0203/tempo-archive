import { tempoColor } from "../tempo-color";
import { axisTempo, type Lane, type ResolvedTrack } from "./model";

/** BPM (x) against energy percentile (y); each dot is album art. */
export function MapView({
  tracks,
  lanes,
  fold,
  start,
  energyPct,
  dimmed,
  onOpen,
}: {
  tracks: ResolvedTrack[];
  lanes: Lane[];
  fold: boolean;
  start: number;
  energyPct: Map<string, number>;
  dimmed: (t: ResolvedTrack) => boolean;
  onOpen: (trackId: string) => void;
}) {
  const W = 1000;
  const H = 520;
  const pad = 36;
  const lo = lanes[0]?.lo ?? 70;
  const hi = lanes.at(-1)?.hi ?? 140;
  // Log scale: equal tempo ratios get equal width, so the doubled lanes past 140 aren't stretched.
  const x = (bpm: number) => pad + (Math.log2(bpm / lo) / Math.log2(hi / lo)) * (W - 2 * pad);
  const y = (pct: number) => H - pad - (pct / 100) * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      {lanes.map((l) => (
        <g key={l.lo}>
          <line x1={x(l.lo)} x2={x(l.lo)} y1={pad} y2={H - pad} stroke="var(--line)" />
          <text x={x(l.lo) + 2} y={H - pad + 16} fontSize="11" fill={tempoColor(l.lo + 2, 1, start)} className="num">
            {l.lo}
          </text>
        </g>
      ))}
      <text x={6} y={pad} fontSize="11" fill="var(--muted)">
        high energy
      </text>
      <text x={6} y={H - pad} fontSize="11" fill="var(--muted)">
        low
      </text>
      <defs>
        <clipPath id="dot">
          <circle cx="0" cy="0" r="11" />
        </clipPath>
      </defs>
      {tracks.map((t) => {
        const cx = x(axisTempo(t, fold, start));
        const cy = y(energyPct.get(t.trackId) ?? 50);
        return (
          <g
            key={t.trackId}
            transform={`translate(${cx},${cy})`}
            opacity={dimmed(t) ? 0.15 : 1}
            className="cursor-pointer"
            onClick={() => onOpen(t.trackId)}
          >
            <title>{`${t.title ?? "Unknown"} · ${Math.round(t.bpm)} BPM`}</title>
            <circle r="12.5" fill={tempoColor(t.bpm, 1, start)} />
            {t.artworkUrl ? (
              <image
                href={t.artworkUrl.replace("1000x1000", "56x56")}
                x="-11"
                y="-11"
                width="22"
                height="22"
                clipPath="url(#dot)"
              />
            ) : (
              <circle r="11" fill="var(--line)" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
