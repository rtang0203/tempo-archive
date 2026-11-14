"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { changeVisibility } from "@/app/actions";
import type { CollectionTrack, CollectionView } from "@/server/collections";
import { tempoColor } from "../tempo-color";
import { Drawer } from "./Drawer";
import { ListView } from "./ListView";
import { MapView } from "./MapView";
import { axisStart } from "@/engine/axis";
import {
  axisTempo,
  isResolved,
  laneIndex,
  lanesFor,
  type MatchRef,
  matches,
  percentiles,
  type ResolvedTrack,
  spotifyUrl,
  trackLabel,
} from "./model";
import { AxisStart, Tempo } from "./Tempo";
import { TrackCard } from "./TrackCard";

type View = "lanes" | "map" | "list";

export function CollectionApp({
  initial,
  viewer,
}: {
  initial: CollectionView;
  viewer: { loggedIn: boolean; isOwner: boolean };
}) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState<View>("lanes");
  const [fold, setFold] = useState(true);
  const [range, setRange] = useState<[number, number] | null>(null); // lane indices
  const [energyMin, setEnergyMin] = useState(0);
  const [genre, setGenre] = useState("");
  const [match, setMatch] = useState<MatchRef | null>(null);
  const [matchTol, setMatchTol] = useState(3);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; href?: string } | null>(null);
  const matchInput = useRef<HTMLInputElement>(null);

  // Live import: poll until the job finishes so tracks land on their lanes as they resolve.
  const running = data.job && (data.job.state === "queued" || data.job.state === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/c/${data.slug}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    }, 1500);
    return () => clearInterval(t);
  }, [running, data.slug]);

  const resolved = useMemo(() => data.tracks.filter(isResolved), [data.tracks]);
  const analyzing = data.tracks.filter((t) => !t.resolved);
  const unavailable = data.tracks.filter((t) => t.resolved && !isResolved(t));
  const energyPct = useMemo(() => percentiles(data.tracks, "energy"), [data.tracks]);
  const dancePct = useMemo(() => percentiles(data.tracks, "danceability"), [data.tracks]);
  const genres = useMemo(() => [...new Set(data.tracks.flatMap((t) => t.genres))].sort(), [data.tracks]);
  const start = useMemo(() => axisStart(resolved.map((t) => t.bpmFolded)), [resolved]);
  const lanes = useMemo(() => lanesFor(resolved, fold, start), [resolved, fold, start]);
  useEffect(() => setRange(null), [fold, start]);

  const visible = useMemo(
    () =>
      resolved.filter((t) => {
        if (range) {
          const i = laneIndex(lanes, axisTempo(t, fold, start));
          if (i < range[0] || i > range[1]) return false;
        }
        if (energyMin > 0 && (energyPct.get(t.trackId) ?? -1) < energyMin) return false;
        if (genre && !t.genres.includes(genre)) return false;
        return true;
      }),
    [resolved, range, lanes, fold, start, energyMin, energyPct, genre],
  );

  const matchResult = useMemo(() => (match ? matches(match, visible, matchTol, fold) : null), [match, visible, matchTol, fold]);
  const matchSet = useMemo(() => new Set(matchResult?.map((m) => m.track.trackId)), [matchResult]);
  const hoverSet = useMemo(() => {
    const h = hoverId ? resolved.find((t) => t.trackId === hoverId) : null;
    if (!h) return new Set<string>();
    return new Set(
      matches({ label: "", bpm: h.bpm, energy: h.energy, genres: h.genres, trackId: h.trackId }, visible, 3, fold).map(
        (m) => m.track.trackId,
      ),
    );
  }, [hoverId, resolved, visible, fold]);

  const byLane = useMemo(() => {
    const cols = lanes.map(() => [] as ResolvedTrack[]);
    for (const t of visible) cols[laneIndex(lanes, axisTempo(t, fold, start))]!.push(t);
    for (const c of cols) c.sort((a, b) => (energyPct.get(b.trackId) ?? -1) - (energyPct.get(a.trackId) ?? -1));
    return cols;
  }, [visible, lanes, fold, start, energyPct]);

  const histogram = useMemo(() => {
    const counts = lanes.map(() => 0);
    for (const t of resolved) counts[laneIndex(lanes, axisTempo(t, fold, start))]!++;
    return counts;
  }, [resolved, lanes, fold, start]);

  const openTrack = openId ? resolved.find((t) => t.trackId === openId) ?? null : null;
  const toggleSelect = useCallback(
    (id: string) =>
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );

  const save = useCallback(async (name: string, spotifyIds: string[]) => {
    setToast({ text: "Saving to Spotify…" });
    const res = await fetch("/api/save", { method: "POST", body: JSON.stringify({ name, spotifyIds }) });
    const body = await res.json();
    setToast(res.ok ? { text: "Saved as a private playlist", href: body.url } : { text: `Save failed: ${body.error}` });
  }, []);

  const selectedTracks = data.tracks.filter((t) => selected.has(t.trackId));
  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setToast({ text: `Copied ${what}` });
  };

  // Keyboard: "/" match box, arrows move between cards, Enter opens, X selects, S saves, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (e.key === "Escape") {
        if (openId) setOpenId(null);
        else if (typing) (e.target as HTMLElement).blur();
        else setMatch(null);
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        matchInput.current?.focus();
        return;
      }
      if (view !== "lanes") return;
      const pos = (() => {
        for (let l = 0; l < byLane.length; l++) {
          const r = byLane[l]!.findIndex((t) => t.trackId === focusId);
          if (r >= 0) return { l, r };
        }
        return null;
      })();
      const move = (dl: number, dr: number) => {
        e.preventDefault();
        if (!pos) {
          const first = byLane.find((c) => c.length);
          if (first) setFocusId(first[0]!.trackId);
          return;
        }
        let l = pos.l + dl;
        while (dl !== 0 && l >= 0 && l < byLane.length && byLane[l]!.length === 0) l += dl;
        if (l < 0 || l >= byLane.length) return;
        const col = byLane[l]!;
        const r = Math.max(0, Math.min(col.length - 1, dl !== 0 ? pos.r : pos.r + dr));
        setFocusId(col[r]!.trackId);
        document.querySelector(`[data-track="${col[r]!.trackId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      };
      if (e.key === "ArrowLeft") move(-1, 0);
      else if (e.key === "ArrowRight") move(1, 0);
      else if (e.key === "ArrowUp") move(0, -1);
      else if (e.key === "ArrowDown") move(0, 1);
      else if (e.key === "Enter" && focusId) setOpenId(focusId);
      else if (e.key.toLowerCase() === "x" && focusId) toggleSelect(focusId);
      else if (e.key.toLowerCase() === "s" && viewer.loggedIn && selected.size) {
        save(`${data.title} selection`, selectedTracks.map((t) => t.spotifyId));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [byLane, focusId, openId, view, selected, selectedTracks, viewer.loggedIn, data.title, save, toggleSelect]);

  const dimmed = (t: ResolvedTrack) => (match ? !matchSet.has(t.trackId) : false);

  return (
    <AxisStart value={start}>
    <main className={`px-4 py-5 ${openTrack ? "md:pr-[416px]" : ""}`}>
      <Header data={data} viewer={viewer} onToast={setToast} setData={setData} />

      {running && data.job && (
        <div className="mb-4">
          <div className="mb-1 text-xs text-[var(--muted)]">
            <span className="num">
              {data.job.done} / {data.job.total || "…"}
            </span>{" "}
            tracks, <span className="num">{Math.max(0, data.job.total - data.job.done)}</span> analyzing
            {data.job.failed > 0 && <span> · {data.job.failed} will retry on re-import</span>}
          </div>
          <div className="h-1 overflow-hidden rounded bg-[var(--line)]">
            <div
              className="h-full bg-[#1db954] transition-all"
              style={{ width: `${data.job.total ? (data.job.done / data.job.total) * 100 : 2}%` }}
            />
          </div>
        </div>
      )}
      {data.job?.state === "failed" && (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
          Import failed: {data.job.error}. {viewer.isOwner && "Re-import from the home page to retry."}
        </p>
      )}

      <MatchBox
        inputRef={matchInput}
        tracks={resolved}
        loggedIn={viewer.loggedIn}
        match={match}
        setMatch={setMatch}
        tol={matchTol}
        setTol={setMatchTol}
        onToast={setToast}
      />
      {matchResult && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted)]">Best:</span>
          {matchResult.slice(0, 5).map((m) => (
            <button
              key={m.track.trackId}
              onClick={() => setOpenId(m.track.trackId)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-1 text-xs hover:border-[var(--fg)]"
            >
              <span className="max-w-[160px] truncate">{m.track.title ?? "Unknown"}</span>
              <Tempo bpm={m.track.bpm} />
            </button>
          ))}
          {matchResult.length === 0 && <span className="text-xs text-[var(--muted)]">Nothing within ±{matchTol} BPM.</span>}
          {matchResult.length > 0 && viewer.loggedIn && (
            <button
              onClick={() => save(`${match!.label} ±${matchTol} BPM`, matchResult.map((m) => m.track.spotifyId))}
              className="text-xs text-[#1db954] hover:underline"
            >
              Save all {matchResult.length} to Spotify
            </button>
          )}
        </div>
      )}

      <section className="mb-4">
        <Histogram
          counts={histogram}
          lanes={lanes}
          range={range}
          setRange={setRange}
          highlight={matchResult ? new Set(matchResult.map((m) => laneIndex(lanes, axisTempo(m.track, fold, start)))) : null}
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <label className="flex items-center gap-2">
            Energy ≥
            <input type="range" min={0} max={90} step={10} value={energyMin} onChange={(e) => setEnergyMin(Number(e.target.value))} />
            <span className="num w-8">{energyMin ? `${energyMin}%` : "any"}</span>
          </label>
          <label className="flex items-center gap-2">
            Genre
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="rounded border border-[var(--line)] bg-[var(--panel)] px-1.5 py-0.5"
            >
              <option value="">any</option>
              {genres.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fold} onChange={(e) => setFold(e.target.checked)} className="accent-[#1db954]" />
            Fold ½× / 2×
          </label>
          <div className="ml-auto flex gap-1">
            {(["lanes", "map", "list"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 capitalize ${view === v ? "bg-[var(--fg)] text-[var(--bg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </section>

      {data.tracks.length === 0 && !running ? (
        <p className="py-16 text-center text-sm text-[var(--muted)]">This collection is empty.</p>
      ) : view === "lanes" ? (
        <div className="flex gap-2 overflow-x-auto pb-6">
          {lanes.map((lane, i) => (
            <div key={lane.lo} className="w-[176px] shrink-0">
              <div
                className="num sticky top-0 mb-2 border-b-2 pb-1 text-xs font-semibold"
                style={{ borderColor: tempoColor(lane.lo + 2, 1, start), color: tempoColor(lane.lo + 2, 1, start) }}
              >
                {lane.lo}–{lane.hi - 1}
                <span className="float-right font-normal text-[var(--muted)]">{byLane[i]!.length || ""}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {byLane[i]!.map((t) => (
                  <TrackCard
                    key={t.trackId}
                    track={t}
                    energyPct={energyPct.get(t.trackId)}
                    state={{
                      dimmed: dimmed(t),
                      glow: hoverSet.has(t.trackId),
                      selected: selected.has(t.trackId),
                      focused: focusId === t.trackId,
                    }}
                    onOpen={() => {
                      setFocusId(t.trackId);
                      setOpenId(t.trackId);
                    }}
                    onToggleSelect={() => toggleSelect(t.trackId)}
                    onHover={(on) => setHoverId(on ? t.trackId : null)}
                  />
                ))}
              </div>
            </div>
          ))}
          {(analyzing.length > 0 || unavailable.length > 0) && (
            <div className="w-[176px] shrink-0">
              <div className="mb-2 border-b-2 border-dashed border-[var(--line)] pb-1 text-xs font-semibold text-[var(--muted)]">
                {analyzing.length ? "Analyzing…" : "BPM unavailable"}
              </div>
              <div className="flex flex-col gap-1.5">
                {[...analyzing, ...unavailable].map((t) => (
                  <PendingCard key={t.trackId} track={t} unavailable={t.resolved} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : view === "map" ? (
        <MapView tracks={visible} lanes={lanes} fold={fold} start={start} energyPct={energyPct} dimmed={dimmed} onOpen={setOpenId} />
      ) : (
        <ListView
          tracks={[...visible, ...analyzing, ...unavailable]}
          fold={fold}
          energyPct={energyPct}
          dancePct={dancePct}
          selected={selected}
          onToggleSelect={toggleSelect}
          onOpen={(id) => resolved.some((t) => t.trackId === id) && setOpenId(id)}
        />
      )}

      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm shadow-xl">
          <span className="num">{selected.size} selected</span>
          <button className="hover:underline" onClick={() => copy(selectedTracks.map(trackLabel).join("\n"), "list")}>
            Copy as list
          </button>
          <button
            className="hover:underline"
            title="Paste into a Spotify playlist to add them"
            onClick={() => copy(selectedTracks.map((t) => spotifyUrl(t.spotifyId)).join("\n"), "Spotify links")}
          >
            Copy Spotify links
          </button>
          {viewer.loggedIn && (
            <button
              className="font-semibold text-[#1db954] hover:underline"
              onClick={() => save(`${data.title} selection`, selectedTracks.map((t) => t.spotifyId))}
            >
              Save to Spotify (S)
            </button>
          )}
          <button className="text-[var(--muted)]" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            ×
          </button>
        </div>
      )}

      {openTrack && (
        <Drawer
          track={openTrack}
          tracks={resolved}
          fold={fold}
          energyPct={energyPct}
          dancePct={dancePct}
          loggedIn={viewer.loggedIn}
          onClose={() => setOpenId(null)}
          onOpen={setOpenId}
          onSave={save}
          onFlagged={(t: CollectionTrack) =>
            setData((d) => ({ ...d, tracks: d.tracks.map((x) => (x.trackId === t.trackId ? { ...x, ...t, position: x.position } : x)) }))
          }
        />
      )}

      {toast && (
        <div className="fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-full bg-[var(--fg)] px-4 py-2 text-sm text-[var(--bg)] shadow-xl">
          {toast.text}
          {toast.href && (
            <a href={toast.href} target="_blank" rel="noreferrer" className="ml-2 underline">
              Open
            </a>
          )}
          <button className="ml-3 opacity-60" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </main>
    </AxisStart>
  );
}

function Header({
  data,
  viewer,
  onToast,
  setData,
}: {
  data: CollectionView;
  viewer: { isOwner: boolean };
  onToast: (t: { text: string }) => void;
  setData: (fn: (d: CollectionView) => CollectionView) => void;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <a href="/" className="text-sm text-[var(--muted)] hover:text-[var(--fg)]">
        Tempo Atlas
      </a>
      <h1 className="text-xl font-semibold">{data.title}</h1>
      <span className="text-xs text-[var(--muted)]">
        Spotify {data.isLikedSongs ? "Liked Songs" : "playlist"} · <span className="num">{data.tracks.length}</span> tracks
        {data.ownerName ? ` · ${data.ownerName}` : ""}
      </span>
      <div className="ml-auto flex items-center gap-2 text-sm">
        {viewer.isOwner && (
          <select
            value={data.visibility}
            onChange={async (e) => {
              const v = e.target.value as "public" | "unlisted";
              await changeVisibility(data.slug, v);
              setData((d) => ({ ...d, visibility: v }));
              onToast({ text: v === "public" ? "Public: shown on the home page" : "Unlisted: link only" });
            }}
            className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1"
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
          </select>
        )}
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(`${location.origin}/c/${data.slug}`);
            onToast({ text: "Link copied" });
          }}
          className="rounded-full border border-[var(--line)] px-4 py-1 hover:border-[var(--fg)]"
        >
          Share
        </button>
      </div>
    </header>
  );
}

function MatchBox({
  inputRef,
  tracks,
  loggedIn,
  match,
  setMatch,
  tol,
  setTol,
  onToast,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  tracks: ResolvedTrack[];
  loggedIn: boolean;
  match: MatchRef | null;
  setMatch: (m: MatchRef | null) => void;
  tol: number;
  setTol: (n: number) => void;
  onToast: (t: { text: string }) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const q = text.trim().toLowerCase();
  const suggestions =
    q.length >= 2 && !/^\d/.test(q) && !q.includes("spotify")
      ? tracks.filter((t) => trackLabel(t).toLowerCase().includes(q)).slice(0, 6)
      : [];

  const pick = (t: ResolvedTrack) => {
    setMatch({ label: t.title ?? "Track", bpm: t.bpm, energy: t.energy, genres: t.genres, trackId: t.trackId });
    setText(trackLabel(t));
  };

  const submit = async () => {
    const n = Number(q);
    if (n >= 30 && n <= 300) {
      setMatch({ label: `${n} BPM`, bpm: n, energy: null, genres: [] });
      return;
    }
    if (q.includes("spotify")) {
      if (!loggedIn) {
        onToast({ text: "Log in with Spotify to paste track links" });
        return;
      }
      setBusy(true);
      const res = await fetch("/api/match-link", { method: "POST", body: JSON.stringify({ url: text.trim() }) });
      const t = await res.json();
      setBusy(false);
      if (!res.ok) return onToast({ text: t.error });
      if (!t.bpm) return onToast({ text: "Couldn't measure a BPM for that track" });
      setMatch({ label: t.title ?? "Track", bpm: t.bpm, energy: t.energy, genres: t.genres ?? [], trackId: t.trackId });
      setText(`${t.title ?? "Track"} — ${Math.round(t.bpm)} BPM`);
      return;
    }
    if (suggestions[0]) pick(suggestions[0]);
  };

  return (
    <div className="relative mb-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 focus-within:border-[var(--fg)]"
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={loggedIn ? "Paste a Spotify track link, type a BPM, or search this collection…  ( / )" : "Type a BPM or pick a track…  ( / )"}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
        />
        <select
          value={tol}
          onChange={(e) => setTol(Number(e.target.value))}
          className="num rounded border border-[var(--line)] bg-[var(--panel)] px-1 py-0.5 text-xs"
          aria-label="Tolerance"
        >
          {[1, 2, 3, 5, 8].map((t) => (
            <option key={t} value={t}>
              ±{t}
            </option>
          ))}
        </select>
        {match && (
          <button
            type="button"
            onClick={() => {
              setMatch(null);
              setText("");
            }}
            className="text-xs text-[var(--muted)] hover:text-[var(--fg)]"
          >
            Clear
          </button>
        )}
        <button disabled={busy} className="rounded-full border border-[var(--line)] px-3 py-0.5 text-sm hover:border-[var(--fg)] disabled:opacity-50">
          {busy ? "…" : "Go"}
        </button>
      </form>
      {suggestions.length > 0 && !match && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-xl">
          {suggestions.map((t) => (
            <li key={t.trackId}>
              <button onClick={() => pick(t)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--line)]/40">
                <span className="truncate">{trackLabel(t)}</span>
                <Tempo bpm={t.bpm} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Histogram({
  counts,
  lanes,
  range,
  setRange,
  highlight,
}: {
  counts: number[];
  lanes: { lo: number; hi: number }[];
  range: [number, number] | null;
  setRange: (r: [number, number] | null) => void;
  highlight: Set<number> | null;
}) {
  const drag = useRef<number | null>(null);
  const low = useContext(AxisStart);
  const max = Math.max(1, ...counts);
  const inRange = (i: number) => !range || (i >= range[0] && i <= range[1]);
  const at = (i: number) => {
    if (drag.current === null) return;
    setRange([Math.min(drag.current, i), Math.max(drag.current, i)]);
  };
  return (
    <div>
      <div
        className="flex h-14 touch-none select-none items-end gap-px"
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {counts.map((n, i) => (
          <div
            key={i}
            className="flex h-full flex-1 cursor-col-resize items-end"
            onPointerDown={(e) => {
              (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
              drag.current = i;
              setRange([i, i]);
            }}
            onPointerEnter={() => at(i)}
            title={`${lanes[i]!.lo}–${lanes[i]!.hi - 1} BPM: ${n} tracks`}
          >
            <div
              className="w-full rounded-t-sm"
              style={{
                height: `${Math.max(3, (n / max) * 100)}%`,
                background: tempoColor(lanes[i]!.lo + 2, !inRange(i) ? 0.15 : highlight && !highlight.has(i) ? 0.35 : 0.9, low),
              }}
            />
          </div>
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-[var(--muted)]">
        <span>{lanes[0]?.lo} BPM</span>
        {range && (
          <button onClick={() => setRange(null)} className="text-[var(--fg)]">
            {lanes[range[0]]!.lo}–{lanes[range[1]]!.hi - 1} selected ×
          </button>
        )}
        <span>{lanes.at(-1)?.hi} BPM</span>
      </div>
    </div>
  );
}

function PendingCard({ track, unavailable }: { track: CollectionTrack; unavailable: boolean }) {
  return (
    <a
      href={spotifyUrl(track.spotifyId)}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] p-1.5 opacity-60"
    >
      {track.artworkUrl ? (
        <img src={track.artworkUrl.replace("1000x1000", "120x120")} alt="" className="h-9 w-9 rounded" loading="lazy" />
      ) : (
        <div className={`h-9 w-9 rounded bg-[var(--line)] ${unavailable ? "" : "animate-pulse"}`} />
      )}
      <div className="min-w-0">
        <div className="truncate text-xs">{track.title ?? (unavailable ? "Unknown track" : "Analyzing…")}</div>
        <div className="truncate text-[11px] text-[var(--muted)]">{unavailable ? "BPM unavailable" : track.artists.join(", ")}</div>
      </div>
    </a>
  );
}
