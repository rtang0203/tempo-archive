# Tempo Atlas — Progress

Last updated: 2026-11-14. Spec and decision record: `Tempo Atlas — Refined Plan.md`.

## Status

**v1 is built and live** at https://tempo.eightfoldpath.xyz. Next phase: the v1→v2 gate, which means getting friends to use it.

| Step | Status | Date |
|---|---|---|
| 0. Plan grilled and refined (Q1–Q34) | ✅ | Nov 9–13 |
| 1. BPM engine spike | ✅ accepted | Nov 11 |
| 2. Schema + track cache | ✅ | Nov 11 |
| 3. Analyzer service (Essentia) | ✅ | Nov 11 |
| 4. Spotify login + import pipeline | ✅ verified with real login | Nov 11–13 |
| 5. Collection page | ✅ | Nov 11 |
| 6. Track drawer, neighbors, save to Spotify | ✅ verified with real login | Nov 11–13 |
| 7. Polish (share image, mobile, flags, filters) | ✅ | Nov 11 |
| Deploy to `market-data` droplet | ✅ | Nov 13 |

## What we did

**Planning**
- Grilled the original plan into `Tempo Atlas — Refined Plan.md`. Main changes: CSV import moved to v2; two visibility levels (public / unlisted, Liked Songs unlisted by default); Deezer is the metadata source, because Spotify's terms forbid storing Spotify content; tolerances are ratios, not absolute BPM.
- Spotify's Feb 2026 rules shaped v1: only playlists you own are importable, there's a 5-user Development Mode cap, and extended quota is out of reach (it requires 250k monthly active users).

**BPM engine spike** (`spike/`, 176 tracks from 3 playlists)
- Previews found for 97.7% of tracks. Essentia was correct on 17/20 tracks by ear, ignoring octave; all 3 misses were triplet-feel (4:3) readings.
- Deezer's BPM field is almost always empty (8.5%), so it's only a rare vote. ReccoBeats missed 35% of this underground-leaning library, but agrees with Essentia 88% of the time when it has a value.
- A second beat tracker added nothing (librosa and Essentia's `degara` were tested), so Essentia is the only analyzer.
- No octave display rule matched what you hear, so every BPM shows both octaves ("71 / 142").
- Energy = spectral flux (best match to ReccoBeats' energy, +0.54), shown as a percentile within the collection.

**Build**
- Engine (`src/engine/`): octave-circular tempo distance, the agreement rule with 3:2 detection, neighbor ranking, and a per-collection axis start (so clusters near 70/140 stay together), all unit-tested.
- Cache-through pipeline: each source is asked once per track and source version, misses cached. Re-importing makes zero outside calls; a rules change recomputes from stored data.
- Next.js app, pg-boss worker, FastAPI + Essentia analyzer. Spotify tokens are encrypted at rest.
- Measured locally: 796-track import in 5m20s with 0 failures; cached re-import in 1 s.

**Calls made along the way**
- Removed the ½×/2× badges (the octave a source reports is arbitrary, so they appeared on almost every row).
- Kept the Spotify embed even though its ⊕ button can unlike a song by accident; we can't change it from our side.
- The axis start is chosen per collection (e.g. mollyrock runs 100–200).

**Deploy**
- Docker Compose on the 2 GB / 1 vCPU `market-data` droplet, sharing its Postgres (`crypto_db`). Memory-capped containers; the analyzer has a low CPU priority so it can't starve the market-data collectors.
- Idle footprint ~255 MB; analyzer peaks at 240 MB; ~1.3 s per new track there.
- Ops details and troubleshooting: `~/Documents/projects/DEPLOYMENT-REFERENCE.md`.

## What's next

**Now: run the v1 → v2 gate**
- [ ] Add friends under User Management in the Spotify dashboard (5-user cap, including you).
- [ ] Gate: at least 3 of 4 friends each import a *second* collection, without being asked, within 3 weeks of their first.
- [ ] Watch for "BPM looks wrong" flags and "BPM unavailable" rates on their libraries.

**Housekeeping**
- [x] First git commits (`tempo atlas v1`, `readme`).
- [ ] Run `deploy/deploy.sh` end to end once (each step was run by hand on Nov 13).
- [ ] Optional: copy the local analysis cache (track features only) to production so already-analyzed tracks import instantly.
- [ ] Before any wider launch: review the Spotify, Deezer, and Apple API terms.
- [ ] Decide the final name and domain (moving is one Caddy line plus one Spotify redirect URI).

**Known gaps (accepted for v1)**
- Collaborative playlists: untested whether Spotify treats them as "owned".
- Deezer misses are cached; they're only re-checked when the Deezer source version is bumped.
- Caddy advertises HTTP/3 but the firewall only allows TCP 443; browsers fall back to HTTP/2.

## Later phases

**v2 · Social** (starts only when the gate passes)
- **Exportify CSV import**, the way past the 5-user cap. Designed in the plan: secret edit links stored hashed and kept in the URL fragment, per-file and per-IP caps, no save-to-Spotify for CSV owners. Verified: Exportify works for non-allowlisted users and its CSV includes ISRCs.
- Profiles, shared crates, follows, taste matches.

**v3 · Live** (when DJ friends ask and v2 retention holds)
- Real-time beat tracking, key matching (Camelot, already stored), transition suggestions, tempo changes within a track.
