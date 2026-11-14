"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import { displayTempo } from "@/engine/display";
import type { CollectionTrack } from "@/server/collections";
import { matches, type ResolvedTrack, spotifyUrl } from "./model";
import { AxisStart, Tempo } from "./Tempo";

const TOLERANCES = [2, 3, 5, 8];
const CONFIDENCE_TEXT: Record<string, string> = {
  high: "sources agree · high confidence",
  medium: "one source · medium confidence",
  low: "sources disagree or flagged · low confidence",
  unavailable: "BPM unavailable",
};

type Neighbor = CollectionTrack & { bpm: number };

export function Drawer({
  track,
  tracks,
  fold,
  energyPct,
  dancePct,
  loggedIn,
  onClose,
  onOpen,
  onSave,
  onFlagged,
}: {
  track: ResolvedTrack;
  tracks: ResolvedTrack[];
  fold: boolean;
  energyPct: Map<string, number>;
  dancePct: Map<string, number>;
  loggedIn: boolean;
  onClose: () => void;
  onOpen: (trackId: string) => void;
  onSave: (name: string, spotifyIds: string[]) => void;
  onFlagged: (t: CollectionTrack) => void;
}) {
  const [tol, setTol] = useState(3);
  const [scope, setScope] = useState<"collection" | "global">("collection");
  const [global, setGlobal] = useState<Neighbor[] | null>(null);
  const [flagState, setFlagState] = useState<"idle" | "sending" | "done">("idle");

  useEffect(() => setFlagState("idle"), [track.trackId]);

  const local: Neighbor[] = useMemo(
    () =>
      matches(
        { label: "", bpm: track.bpm, energy: track.energy, genres: track.genres, trackId: track.trackId },
        tracks,
        tol,
        fold,
        25,
      ).map((n) => n.track),
    [track, tracks, tol, fold],
  );

  useEffect(() => {
    if (scope !== "global") return;
    setGlobal(null);
    const q = new URLSearchParams({ bpm: String(track.bpm), tol: String(tol), fold: fold ? "1" : "0", trackId: track.trackId });
    if (track.energy !== null) q.set("energy", String(track.energy));
    for (const g of track.genres) q.append("genre", g);
    const ctl = new AbortController();
    fetch(`/api/neighbors?${q}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((rows: Neighbor[]) => setGlobal(rows))
      .catch(() => {});
    return () => ctl.abort();
  }, [scope, track, tol, fold]);

  const list = scope === "collection" ? local : global;
  const d = displayTempo(track.bpm, useContext(AxisStart));
  const inCollection = new Set(tracks.map((t) => t.trackId));

  const flag = async () => {
    setFlagState("sending");
    const res = await fetch("/api/flag", { method: "POST", body: JSON.stringify({ trackId: track.trackId }) });
    if (res.ok) onFlagged(await res.json());
    setFlagState("done");
  };

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-30 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-[var(--line)] bg-[var(--panel)] p-4 shadow-2xl md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[400px] md:rounded-none md:border-l md:border-t-0"
      aria-label="Track details"
    >
      <div className="mb-3 flex items-start gap-3">
        {track.artworkUrl ? (
          <img src={track.artworkUrl.replace("1000x1000", "250x250")} alt="" className="h-16 w-16 rounded-md" />
        ) : (
          <div className="h-16 w-16 rounded-md bg-[var(--line)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{track.title ?? "Unknown track"}</div>
          <div className="text-sm text-[var(--muted)]">{track.artists.join(", ")}</div>
          <a href={spotifyUrl(track.spotifyId)} target="_blank" rel="noreferrer" className="text-xs text-[#1db954] hover:underline">
            Open in Spotify
          </a>
        </div>
        <button onClick={onClose} className="text-xl leading-none text-[var(--muted)] hover:text-[var(--fg)]" aria-label="Close">
          ×
        </button>
      </div>

      <iframe
        title="Spotify player"
        src={`https://open.spotify.com/embed/track/${track.spotifyId}?utm_source=generator&theme=0`}
        className="mb-4 h-[80px] w-full rounded-xl"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
      />

      <div className="mb-1 flex items-end justify-between">
        <div>
          <Tempo bpm={track.bpm} size="lg" />
          <div className="text-xs text-[var(--muted)]">
            {Math.round(d.primary)} or {d.alternateLabel} {Math.round(d.alternate)} BPM
            {track.ambiguousFeel && track.bpmAlt ? ` · feels like ${Math.round(track.bpmAlt)}` : ""}
          </div>
        </div>
        {loggedIn && (
          <button
            onClick={flag}
            disabled={flagState !== "idle"}
            className="rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--fg)] disabled:opacity-50"
          >
            {flagState === "done" ? "Flagged" : "BPM looks wrong"}
          </button>
        )}
      </div>
      <div className="mb-4 text-xs text-[var(--muted)]">{CONFIDENCE_TEXT[track.confidence ?? "unavailable"]}</div>

      <dl className="mb-5 grid grid-cols-[90px_1fr] items-center gap-y-2 text-sm">
        <dt className="text-[var(--muted)]">Energy</dt>
        <dd>
          <Bar pct={energyPct.get(track.trackId)} />
        </dd>
        <dt className="text-[var(--muted)]">Danceability</dt>
        <dd>
          <Bar pct={dancePct.get(track.trackId)} />
        </dd>
        <dt className="text-[var(--muted)]">Genre</dt>
        <dd>{track.genres.join(", ") || "—"}</dd>
        <dt className="text-[var(--muted)]">Key</dt>
        <dd>{track.key ? `${track.key}${track.camelot ? ` · ${track.camelot}` : ""}` : "—"}</dd>
      </dl>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Tempo neighbors</h3>
        <div className="flex gap-1">
          {TOLERANCES.map((t) => (
            <button
              key={t}
              onClick={() => setTol(t)}
              className={`num rounded-full border px-2 py-0.5 text-xs ${tol === t ? "border-[var(--fg)]" : "border-[var(--line)] text-[var(--muted)]"}`}
            >
              ±{t}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex gap-3 text-xs">
        {(["collection", "global"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={scope === s ? "font-semibold underline underline-offset-4" : "text-[var(--muted)]"}
          >
            {s === "collection" ? "This collection" : "All of Tempo Atlas"}
          </button>
        ))}
      </div>

      {list === null ? (
        <p className="py-4 text-sm text-[var(--muted)]">Searching public collections…</p>
      ) : list.length === 0 ? (
        <p className="py-4 text-sm text-[var(--muted)]">No tracks within ±{tol} BPM.</p>
      ) : (
        <ul className="mb-4 divide-y divide-[var(--line)]">
          {list.map((n) => (
            <li key={n.trackId}>
              <button
                onClick={() => (inCollection.has(n.trackId) ? onOpen(n.trackId) : window.open(spotifyUrl(n.spotifyId), "_blank"))}
                className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-[var(--line)]/40"
              >
                {n.artworkUrl ? (
                  <img src={n.artworkUrl.replace("1000x1000", "120x120")} alt="" className="h-7 w-7 rounded" loading="lazy" />
                ) : (
                  <div className="h-7 w-7 rounded bg-[var(--line)]" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {n.title ?? "Unknown track"}
                  <span className="text-[var(--muted)]"> · {n.artists.join(", ")}</span>
                </span>
                <Tempo bpm={n.bpm} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {list && list.length > 0 && loggedIn && (
        <button
          onClick={() =>
            onSave(`${track.title ?? "Track"} ±${tol} BPM`, [track.spotifyId, ...list.map((n) => n.spotifyId)])
          }
          className="w-full rounded-full bg-[#1db954] py-2 text-sm font-semibold text-black hover:brightness-110"
        >
          Save track + neighbors as Spotify playlist
        </button>
      )}
    </aside>
  );
}

/** Percentile within this collection; raw energy/danceability scales are arbitrary. */
function Bar({ pct }: { pct: number | undefined }) {
  if (pct === undefined) return <span className="text-[var(--muted)]">unknown</span>;
  return (
    <div className="flex items-center gap-2" title={`Higher than ${pct}% of this collection`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--line)]">
        <div className="h-full bg-[var(--fg)]/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="num w-16 text-right text-xs text-[var(--muted)]">{pct}th pct</span>
    </div>
  );
}
