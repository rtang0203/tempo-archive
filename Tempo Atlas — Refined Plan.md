# Tempo Atlas — Refined Plan & Spec

Nov 9, 2026 · @Randy Tang · Supersedes `Tempo Atlas — Plan & Spec.md` (refined via grilling session + review)

## Overview

Tempo Atlas (working name) is a website that lays out a music collection by tempo, so you can pick a track and instantly see everything else in your collection that moves at the same speed and feels similar. v1 is Spotify-only and single-player: log in with Spotify, pick playlists or Liked Songs, get a shareable page of your tracks sorted and grouped by BPM.

Primary uses: picking songs for short video edits (CapCut), and building playlists that flow.

**v1 goals**

- Log in with Spotify and import your own playlists and Liked Songs.
- BPM for every track is fully automatic. No manual tapping, ever, as a required step.
- Browse the collection on a tempo axis, filter by BPM range, energy, and genre, and find "tempo neighbors" for any track.
- Treat half and double tempo as equivalent (87 and 174 BPM match).
- Every collection has a shareable URL viewable without login; collections are public or unlisted.
- Save any filtered set or neighbor list back to Spotify as a new playlist.

**Non-goals for v1**

- CSV import (v2, see below).
- SoundCloud (revisit once the BPM engine is proven).
- Follows, feeds, shared crates (v2).
- Live beat detection, DJ mixing tools, intra-track tempo/section analysis (v3).
- Hosting or streaming audio. Playback is always Spotify's own embed.
- Exporting beat markers to CapCut (it does its own beat detection).

## Phases

| Phase | Contents | Gate to start |
| --- | --- | --- |
| v1 · Single-player | Spotify login + import; lanes, map, list views; automatic BPM engine; public/unlisted URLs; save to Spotify | — (build now) |
| v2 · Social | CSV import (growth past 5 importers), profiles, shared crates, follows, taste matches | ≥3 of your 4 allowlisted friends each import a **second** collection unprompted within 3 weeks of their first |
| v3 · Live | Real-time beat tracking, key matching (Camelot) from stored key data, transition suggestions | DJ friends ask for it and v2 retention holds |

Spotify extended quota is not a path: since May 2025 it is only granted to organizations with ≥250k MAU. Growth past the 5-user Development Mode cap happens through CSV import in v2.

## Architecture

One Next.js app serves pages and a JSON API; a pg-boss worker does every outside API call; a Python analyzer (FastAPI + Essentia) measures preview audio; Postgres holds everything, including the shared feature cache that makes repeat imports free.

```
Browser ──HTTP──> Next.js app (pages, JSON API, queues jobs)
   │                    │
   │                    ▼
   │              Postgres (tracks, feature_estimates, track_features,
   │                        collections, bpm_flags, jobs)
   │                    ▲
   │                    │
   │              Import + BPM worker (pg-boss) ──> Essentia analyzer (localhost)
   │                    │
   │                    ├──> Spotify Web API (user playlists + likes; single-track lookup)
   │                    ├──> Deezer API (ISRC → metadata, artwork, bpm, preview, genre)
   │                    ├──> iTunes Search API (preview fallback)
   │                    └──> ReccoBeats (catalog features)
   │
   └── plays tracks in ──> Spotify embed player (no audio stored)
```

The browser never calls Spotify, Deezer, or catalog APIs directly, except to load Spotify's player embed. Keys stay server-side and every lookup is cached.

**Hosting (live since Nov 13, 2026):** `https://tempo.eightfoldpath.xyz` on the existing 2 GB / 1 vCPU `market-data` droplet, alongside the market-data collectors and options screener. Docker Compose (`deploy/docker-compose.droplet.yml`): web, worker, analyzer, each memory-capped; the analyzer gets a low CPU weight. Database `tempo_atlas` lives in the droplet's existing Postgres 15 container (`crypto_db`) to save RAM. Images are built for linux/amd64 on the workstation and shipped by `deploy/deploy.sh`. Details: `~/Documents/projects/DEPLOYMENT-REFERENCE.md`.

## Spotify data and terms

Spotify's Developer Terms forbid storing, aggregating, or creating databases of Spotify Content (metadata, cover art, playlists, user data) beyond what is strictly necessary, forbid storing it indefinitely, and allow only temporary caching of metadata and cover art. The global track cache and cross-user pool must therefore not be built from Spotify Content.

- From Spotify, store only `spotify_id` (needed for the embed and deep links) and use the ISRC as a join key.
- Title, artists, artwork, and genre come from Deezer's ISRC lookup, which the pipeline already makes. Spotify metadata is used transiently during import (e.g. to display the picker) and not persisted.
- Collections store track references, not Spotify metadata. A Spotify-imported collection is deleted when its owner disconnects their account.
- If Deezer has no match for an ISRC, the track shows minimal transient Spotify metadata at import time and is marked for re-lookup; no Spotify metadata is persisted.
- Pre-launch: review Spotify's Developer Terms alongside Deezer's and Apple's.

This is a reading of the terms, not legal advice; at this scale the realistic risk is app revocation.

## Import pipeline (Spotify, v1)

- Picker shows playlists the user **owns** plus Liked Songs. Followed playlists are listed greyed out with: "Spotify only lets us read playlists you own; save a copy first." (Feb 2026 rule: playlist items are returned only for the user's own playlists.)
- Uses `GET /playlists/{id}/items` (the `/tracks` routes were removed in Feb 2026) and Liked Songs.
- Track `external_ids` (ISRC) is available (removal reverted in March 2026).

An import is a background job that walks the track list; the shared cache means already-analyzed songs resolve instantly.

Per track:

1. Each source is asked at most once per (track, source, `source_version`), misses included (`source_lookups`). Already asked everything and `track_features` is at the current `rules_version`? → add to collection, done.
2. Otherwise gather: Deezer (`track/isrc:<ISRC>`: title, artists, artwork, `bpm`, preview URL, album genre) and ReccoBeats (by Spotify ID).
3. **Always** analyze the preview when one exists (Deezer, then iTunes fallback): download into memory, run Essentia, discard audio.
4. Store every value in `feature_estimates`, run the agreement rule, write `track_features`, add to collection.

The job updates `import_jobs.done` after each track; the collection page polls or subscribes so tracks land on their lanes live. A failed lookup marks that one track and moves on; it never fails the whole job. Re-importing refreshes the track list and reuses all cached features.

**Cache and re-analysis:** two version numbers. Bumping `rules_version` (agreement rule changes) recomputes `track_features` from stored `feature_estimates` with zero external calls. Bumping one source's `source_version` (e.g. a new Essentia setup) re-queries only that source. Transient source errors write nothing and are retried on the next import. A "BPM looks wrong" flag re-runs the agreement rule and marks the track low confidence.

## Data model

Tracks are global and shared across every collection; each song is analyzed once per engine version no matter how many people import it.

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `id`, `spotify_user_id`, `display_name`, encrypted refresh token | Deleted with their collections on disconnect. |
| `tracks` | `id`, `spotify_id`, `isrc`, `deezer_id`, `title`, `artists`, `duration_ms`, `artwork_url`, `genres` | One row per song. Metadata, artwork, and genre from Deezer; from Spotify only `spotify_id` and ISRC. |
| `source_lookups` | `track_id`, `source`, `source_version`, `status` (hit / miss), `looked_up_at` | Records that a source was asked, so misses are cached too. |
| `feature_estimates` | `track_id`, `source` (reccobeats / deezer / essentia), `source_version`, `feature` (bpm / bpm_confidence / energy / danceability / key), `value`, `value_text`, `created_at` | Every raw value from every source, kept so rules can be recomputed. No Spotify-sourced values. |
| `track_features` | `track_id`, `bpm`, `bpm_folded`, `bpm_confidence`, `ambiguous_feel`, `bpm_alt` (the 3:2 partner, when ambiguous), `energy`, `danceability`, `key`, `camelot`, `rules_version`, `computed_at` | Resolved values the UI reads. Energy, danceability, key come **only** from Essentia; null when no preview exists. |
| `bpm_flags` | `track_id`, `user_id`, `created_at` | "BPM looks wrong" reports; each re-runs the agreement rule and marks the track low confidence. |
| `collections` | `id`, `slug`, `title`, `owner_id`, `spotify_playlist_id` (null for Liked Songs), `visibility` (public / unlisted), `import_status`, `created_at` | Slug is unguessable. Visibility defaults to public; Liked Songs defaults to unlisted. |
| `collection_tracks` | `collection_id`, `track_id`, `position`, `added_at` | Track references only; keeps original order. |
| `import_jobs` | `id`, `collection_id`, `state`, `total`, `done`, `failed`, `error` | Drives the progress bar. |

v2 adds `follows`, `crates`, `crate_tracks`, `crate_members`, and for CSV: `collections.source`, `collections.edit_token_hash`, nullable `owner_id` / `bpm_flags.user_id`, and `upload_budgets`. Add `track_sources` only if SoundCloud comes back.

## BPM engine (fully automatic)

**Sources**

1. **Essentia on the preview** (primary), run on every uncached track with a preview (Deezer, iTunes fallback). In memory only; audio discarded. Also produces energy, danceability, and key. The only analyzer library: the spike showed librosa and Essentia's alternate `degara` method add no accuracy (see Spike results).
2. **ReccoBeats** (by Spotify ID). Missed ~35% of an underground-leaning library in the spike, but resolved some triplet-feel errors Essentia made. No second catalog provider.
3. **Deezer `bpm` field**: a rare vote (present on ~8% of tracks in the spike). Deezer's real value is metadata, artwork, genre, and previews via `track/isrc:<ISRC>`. No key needed.

**Tempo distance**

All tempo comparisons use one function in the shared module: distance = |log2(a / b)| reduced modulo 1 octave (so 139 and 71 ≈ 142 are close). Tolerances are ratios.

**Picking the final value**

- Fold every BPM estimate into the canonical 70–140 band by halving/doubling; store raw and folded.
- Two or more sources agree within **±1.5%** (≈ ±2 BPM at 135, ±1.1 at 75): median, confidence = high.
- Only one source has a value: use it, confidence = medium.
- Two estimates related by **3:2** (≡ 4:3 after folding; triplet / half-time feel): not agreement. Mark the track `ambiguous_feel`, prefer the value closer to ReccoBeats, keep both. Drawer shows e.g. "148 · feels like 99". Matching uses the chosen value only; 3:2 neighbors are a v3 question.
- Other disagreement: prefer Essentia, confidence = low.
- No preview and no catalog value: "BPM unavailable" (~2% in the spike; accepted).

**Other features**

- Energy, danceability, key: Essentia only. ReccoBeats values are stored in `feature_estimates` but never displayed, kept in case a calibration is fitted later.
- **Energy = mean spectral flux** of the preview. Of the Essentia measures tested against ReccoBeats' Spotify-style energy on 114 spike tracks (Spearman): flux +0.54, flux+loudness+brightness +0.55, brightness +0.46, loudness +0.44, RMS +0.30, onset rate +0.22. Moderate, not a match. Raw scale is arbitrary.
- Energy and danceability are shown as within-collection percentiles ("more danceable than 80% of this playlist"). Danceability appears in the drawer and List view and is not used in filters or ranking in v1.

**Matching**

- Tolerance is shown in BPM (chips ±2 / ±3 / ±5 / ±8; adjustable ±1 to ±8; default ±3) and converted to a ratio against the **reference tempo**: ratio = chip ÷ reference raw BPM. Typing 174 at ±3 means ±1.7%, correct at either octave.
- Fold on (default): matching uses circular distance. No ½× / 2× badge: every row shows both octaves, and since which octave a source reports is arbitrary, the badge appeared on nearly every neighbor (removed Nov 11, 2026).
- **Octave display:** listeners disagree about octave (the spike's ear check heard half-time on 8/20 tracks; tested on the ear data, no fixed band or "slower if ≥ 60" rule beat plain folding: 9/17 for 70–140, 8/17 for slower-if-≥60, at best 10/17). Every BPM shows both octaves: the value in the collection's axis band bold, the other octave dimmed ("**71** / 142").
- **Axis start (Q32):** the folded axis is circular, so tempos at the seam get split across both ends of the screen (mollyrock clustered at 70–80 and 130–140). Each collection's band starts at the 5-BPM step whose seam has the fewest tracks on either side (`src/engine/axis.ts`, ties keep 70). mollyrock → 100–200. Lanes past 140 are 10 BPM wide (the doubled 5-BPM lanes), the map uses a log x-axis, and lanes, cards, histogram, home mini-histograms, and the share image all use the same band. Matching is unaffected.
- Fold off: lanes and histogram switch to raw BPM over the collection's actual min–max in 5-BPM buckets; matching uses non-circular log distance.
- Rank by tempo distance, then energy distance, then shared genre.
- "BPM looks wrong" flag re-runs the agreement rule and marks the track low confidence; never asks the user to tap.

## UX and UI

The product hangs on one screen: a collection laid out left to right by tempo, with a match box answering "what in here fits this track?"

### Screens

| Screen | Purpose | Key elements |
| --- | --- | --- |
| Home | Start an import, browse examples | "Connect Spotify", then the owned-playlist + Liked Songs picker. Below: grid of recent **public** collections with mini BPM histograms. |
| Import | Make the wait fun | Tracks drop onto lanes as they resolve. Counter: "142 / 200 tracks, 58 analyzing." |
| Collection | Core view | Header, match box, histogram filter, tempo lanes. Views: Lanes (default), Map, List. |
| Track drawer | Detail + neighbors | Right panel on desktop, bottom sheet on mobile. Embed player, BPM in both octaves with confidence (and "feels like" for 3:2 tracks), energy, danceability percentile, genre, neighbors, save to Spotify. |
| Flag BPM | Report a miss | Menu item "BPM looks wrong"; marks low confidence. |

### Collection screen, top to bottom

1. **Header.** Title, source icon, track count, visibility toggle (owner only), Share button (always copies the plain collection URL).
2. **Match box.** Accepts a typed BPM or a track picked from the collection for everyone. Pasting a Spotify track link (any track, analyzed on the fly) is available only to the logged-in owner. Logged-out viewers see the placeholder "Type a BPM or pick a track…". Result: lanes outside the match range dim; a strip of the best 5 matches appears.
3. **Histogram filter.** Track count per BPM bucket, doubling as a range slider. Energy slider, genre filter, fold ½×/2× toggle (on by default).
4. **Tempo lanes.** Fold on: one column per 5-BPM bucket 70–74 … 135–139.9; the two ends are adjacent on the octave. Fold off: raw buckets over the collection's range. Cards sorted by energy within a column; card = artwork, title, artist, **both octaves** ("**71** / 142", folded value bold and tempo-colored), energy bar (percentile). Low-confidence BPMs render lighter with a dashed outline; ambiguous-feel tracks show "≈" with the alternate in a tooltip; "Analyzing…" / "BPM unavailable" column at far right.

### Alternate views

- **Map:** BPM (x) vs energy (y), album-art dots.
- **List:** sortable table (title, artist, BPM, energy, danceability percentile, source, confidence).

### Interactions

- Hover a card: neighbors light up across lanes.
- Click a card: drawer. Neighbor list has tolerance chips and scope toggle "This collection" / "All of Tempo Atlas". The global scope searches tracks in **public** collections only (in v1: the ≤5 allowlisted users) and shows tracks, not whose collection they came from.
- Multi-select, then "Copy as list", "Open in Spotify" (deep links), or "Save as Spotify playlist".
- Keyboard: `/` match box, arrows move between cards, `S` saves selection.

### Visual direction

Dark by default, light supported. Tempo is the one meaningful color: cool-to-warm along the collection's axis band (slowest end blue, fastest orange) on lane headers, histogram bars, BPM numbers. Everything else neutral so artwork provides color. Monospaced numerals for BPM.

## v2: CSV import (designed, not built in v1)

Starts only after the v1→v2 gate passes.

- Accepts Exportify CSV; uses its ISRC and Track URI columns, so the BPM engine runs unchanged. Metadata and artwork come from Deezer, as in v1.
- If the CSV carries a Spotify tempo column, it may be used as a transient vote during import but is **never stored** (Spotify Content).
- Each upload creates a **secret edit link** granting owner rights: rename, change visibility, re-upload a newer export, delete, flag BPMs, paste links into the match box (counts against the daily budget). Only its hash is stored.
- Edit-link leak protection: the token lives in the URL fragment (`/c/<slug>#edit=…`), which browsers never send to the server or in referrers. The page exchanges it for an httpOnly cookie and strips the fragment from the address bar. `Referrer-Policy: strict-origin-when-cross-origin` site-wide as a second layer. Share always copies the plain collection URL, never an edit URL.
- Caps: 2,000 rows per file; 3,000 uncached tracks per IP per day. Over-budget tracks queue rather than fail. Cached tracks never count.
- No save-to-Spotify for CSV owners: the button is hidden. "Copy as list" and "Open in Spotify" remain.
- CSV imports default to public.

## Risks and open questions

Since February 2026, a Development Mode app can read item lists only of the logged-in user's own playlists, has a 5-user cap, requires the owner to have Premium, and lost batch endpoints (`GET /tracks`, `GET /artists`). Extended quota requires an organization with ≥250k MAU.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Spotify Developer Terms on storing content | App revocation | Persist only `spotify_id` + ISRC; metadata and artwork from Deezer; delete collections on disconnect; terms review before launch. |
| Only owned playlists are readable | Followed/editorial playlists can't be imported | Picker shows owned + Liked Songs; followed greyed out with "save a copy first". |
| 5-user cap | Only you + 4 friends can import in v1 | Accepted for v1 and the gate test; CSV import in v2. |
| Exportify itself is capped or broken | v2 CSV path unusable for non-technical friends | ✅ Cleared Nov 11, 2026: a non-allowlisted friend exported from exportify.app; the CSV has ISRC, no tempo column. |
| Deezer has no match for an ISRC | No stored metadata or Deezer votes for that track | Transient Spotify metadata at import, re-lookup later. Spike: 97.7% matched. |
| Missing previews | No Essentia; energy/danceability/key unknown; catalog-only BPM | Deezer + iTunes previews. Spike: 97.7% found. |
| Preview analysis vs API terms | Platform pushback | In-memory analysis, audio discarded, only derived numbers stored. Review Deezer and Apple terms before launch. |
| Wrong or octave-flipped BPM | Bad neighbors, lost trust | Octave errors don't affect matching (folding). Triplet-feel (3:2) errors are the known miss class (3/20 in the ear check): flagged as `ambiguous_feel` when ReccoBeats disagrees by 3:2; otherwise caught by the flag button. |
| Spotify changes the API again | Import breaks | Spotify behind one adapter; everything after the ISRC is Spotify-independent. |

**Decisions remaining**

- [ ] Final name and domain.

## Handoff to the coding agent

Build in this order; each step ends with something you can click. Don't start the next step until the current one meets its acceptance check.

1. **BPM engine spike** — ✅ done Nov 11, 2026; accepted. Scripts in `spike/`. See Spike results below.
2. **Schema + track cache** — ✅ done Nov 11, 2026. Drizzle schema + migration in `drizzle/`; adapters in `src/adapters/`; engine module in `src/engine/` (tempo distance, agreement rule with 3:2, display, Camelot, neighbor ranking); cache-through pipeline in `src/tracks/ensure.ts`. Tests (`npm test`, PGlite, no Docker needed): zero external calls on re-import, rules bump recomputes with zero calls, a source bump re-queries only that source, transient errors retried, misses cached. Neighbor ranking compares tempo in 0.5% buckets so energy and genre can break near-ties.
3. **Analyzer service** — ✅ done Nov 11, 2026. `analyzer/` (FastAPI + Essentia 2.1b6.dev1438, Python 3.14, uv). `POST /analyze {preview_url}` → `bpm, bpmConfidence, energy, danceability, key, scale`. Audio is streamed into memory (5 MB cap), decoded through ffmpeg pipes, discarded. Only preview CDN hosts are fetched (no SSRF). Docker image is linux/amd64 because Essentia ships Linux wheels for x86_64 only (droplets are x86_64); on an Apple Silicon Mac it runs under emulation at ~0.5 s analysis + ~0.2–1 s download per clip. Tests: `uv run pytest` (synthetic 90/128 BPM beats, host allowlist).
4. **Spotify login + import pipeline** — ✅ built Nov 11, 2026. PKCE login at `/login` → `/callback` (dev runs on `http://127.0.0.1:8888` so the existing dashboard redirect URI works); signed httpOnly session cookie; refresh and access tokens AES-GCM encrypted in `users`, refreshed under a row lock so web and worker never race on rotation. Picker: owned playlists + Liked Songs, followed greyed out. Import = pg-boss job in `src/worker/main.ts` (`npm run worker`); tracks land in the collection as each resolves; the collection page polls. Disconnect deletes the user and cascades to collections. Verified live: 120-track import in 53 s, 796-track in 320 s, 0 failures, cached re-import in 1 s; tracks Deezer doesn't know have null metadata (no Spotify metadata stored). **Not yet verified by a real browser login:** Liked Songs, save-to-Spotify, disconnect (the test used the spike's read-only token).
5. **Collection page** — ✅ built. `/c/[slug]`: header (visibility toggle for owner, Share), live import progress, match box (BPM, search, pasted link when logged in), histogram range filter, energy ≥ percentile, genre, fold toggle, Lanes / Map / List. Keyboard: `/`, arrows, Enter, X select, S save, Esc. Verified in headless Chrome at desktop and phone sizes.
6. **Track drawer + neighbors + save to Spotify** — ✅ built. Spotify embed, both octaves, confidence, energy/danceability percentiles, genre, key/Camelot, neighbors with ±2/3/5/8 chips and "This collection" / "All of Tempo Atlas" (public collections only), save neighbors / match results / selection as a private Spotify playlist, "BPM looks wrong" flag (logged in). Selection bar: Copy as list, Copy Spotify links (paste into a Spotify playlist to add them), Save.
7. **Polish** — ✅ genre filter, BPM flag, OG share image (histogram) at `/c/[slug]/opengraph-image`, empty/error states, mobile bottom-sheet drawer. Unlisted collections send `noindex`.

**Stack**

- Next.js (App Router) + TypeScript + Tailwind.
- Postgres via Drizzle or Prisma; pg-boss for jobs.
- Python analyzer with Essentia only, own container (linux/amd64).
- Docker Compose on the existing `market-data` DigitalOcean droplet, sharing its Postgres.
- Adapters: `SpotifyLibrary`, `ReccoBeats`, `DeezerLookup`, `PreviewSource` (Deezer, iTunes); `CsvLibrary` in v2. Keys and tokens server-side only.

**Ground rules for the agent**

- Preview audio is analyzed in memory and discarded. No audio stored or served.
- Every external call goes through the cache; every estimate is stored in `feature_estimates` with source and `source_version`.
- Persist no Spotify Content beyond `spotify_id`, ISRC, and the user's collection membership.
- Tempo distance, folding, agreement, and neighbor ranking live in one tested module used by both API and UI; all tolerances are ratios internally.
- No feature may require manual tempo input.
- Energy, danceability, and key shown in the UI come only from Essentia; never blend sources on different scales.

## Spike results (Nov 11, 2026)

Sample: 60 random tracks from each of 3 owned playlists (imcuteimpunkrock, Horsehead, mollyrock), 176 unique. Scripts: `spike/spike.py`, `spike/second_vote.py`; data in `spike/out/` (git-ignored).

| Measure | Result |
| --- | --- |
| Preview found (Deezer 164, iTunes 8) | 97.7% |
| No BPM at all | 2.3% (4 obscure tracks: Deezer match, no preview anywhere) |
| Deezer ISRC match / genre | 97.7% / 94.3% |
| Source coverage | Essentia 97.7%, ReccoBeats 64.8%, Deezer `bpm` 8.5% |
| ReccoBeats ~ Essentia agreement (when both exist) | 100/114 (88%) |
| ≥2 sources agree, all tracks | 59.1% (low because of coverage, not disagreement) |
| Disagreements (13) | 5 exact 3:2, 3 near-misses (1.6–2.9%), 5 other |
| Ear check, 20 tracks, octave-agnostic (±3% for approximate ear estimates) | Essentia 17/20; 3 misses all triplet-feel (4:3) |
| Ear check, exact octave | Listener heard half-time on 8/20; no display rule beats plain folding (9/17) → drawer shows both octaves |
| Second vote: Essentia `degara` | Same as primary on 166/172: not independent |
| Second vote: librosa | 17/20 vs ear, disagrees with Essentia on 39%, misses the same triplet tracks → dropped |
| Server `GET /tracks/{id}` (client credentials) | Works, ISRC present |
| Collaborative playlists | Not tested (none in sample) |

Thresholds were recalibrated after the run: source agreement is judged only on tracks with ≥2 votes, and Essentia-only tracks by ear. Accepted with "BPM unavailable" ≈2% and triplet-feel misses as known limitations.
