# Tempo Atlas — Plan & Spec

Nov 9, 2026 · @Randy Tang

## Overview

Tempo Atlas (working name) is a website that lays out a music collection by tempo, so you can pick a track and instantly see everything else in your collection that moves at the same speed and feels similar. v1 is Spotify-only and single-player: log in with Spotify, pick playlists or Liked Songs, get a shareable page of your tracks sorted and grouped by BPM.

Primary uses: picking songs and sections for short video edits (CapCut), and building playlists that flow.

**v1 goals**

- Log in with Spotify and import your own playlists and Liked Songs.
- BPM for every track is fully automatic. No manual tapping, ever, as a required step.
- Browse the collection on a tempo axis, filter by BPM range, energy, and genre, and find "tempo neighbors" for any track.
- Treat half and double tempo as equivalent (87 and 174 BPM match).
- Every collection gets a public, shareable URL. No login required to view.
- Save any filtered set or neighbor list back to Spotify as a new playlist.

**Non-goals for v1**

- SoundCloud (revisit once the BPM engine is proven).
- Follows, feeds, shared crates (v2).
- Live beat detection or DJ mixing tools (v3).
- Hosting or streaming audio. Playback is always Spotify's own embed.
- Exporting beat markers to CapCut (it does its own beat detection).

## Phases

Build v1 alone and put it in front of friends before writing any social code. Each later phase starts only when its gate is met.

&#91;embedded content: phases · 3 releases, 2 gates\]

The gates are behavioral on purpose: v2 is worth building only if people import their own collections unprompted.

## Architecture

One Next.js app serves pages and a JSON API; a background worker does every outside API call; Postgres holds everything, including the cache that makes repeat imports free.

&#91;embedded content: system architecture · app, worker, database, outside APIs\]

The browser never calls Spotify, Deezer, or the catalog APIs directly, except to load the platforms' own player embeds. That keeps API keys server-side and guarantees every lookup is cached. Users log in with Spotify only so the app can read their own playlists and Liked Songs; viewers never need to log in.

## Import pipeline

An import is a background job that walks the playlist track by track; the shared cache means popular songs resolve instantly and only new tracks cost an API call.

&#91;embedded content: import pipeline · per track, 2 decisions\]

The job updates `import_jobs.done` after each track, and the collection page polls (or subscribes) so tracks appear on their lanes as they land. A failed lookup marks that one track and moves on; it never fails the whole job. Re-importing the same link refreshes the track list but reuses all cached features.

## Data model

Tracks are global and shared across every collection, so each song is analyzed once no matter how many people import it. Collections point at tracks; they never copy track data.

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | `id`, `spotify_user_id`, `display_name`, encrypted refresh token | Needed in v1 because import requires Spotify login. |
| `tracks` | `id`, `spotify_id`, `isrc`, `title`, `artists`, `duration_ms`, `artwork_url`, `genres` | One row per song. `isrc` is the key for every BPM source. |
| `bpm_estimates` | `track_id`, `source` (reccobeats / deezer / essentia / librosa …), `bpm_raw`, `bpm_folded`, `created_at` | Every estimate kept, so the final value can be recomputed when rules change. |
| `track_features` | `track_id`, `bpm`, `bpm_folded`, `bpm_confidence`, `energy`, `danceability`, `key`, `camelot`, `computed_at` | The resolved values the UI reads. Key stored now for v3. |
| `bpm_flags` | `track_id`, `user_id`, `created_at` | "BPM looks wrong" reports. Each one queues a re-analysis. |
| `collections` | `id`, `slug`, `title`, `owner_id`, `spotify_playlist_id` (null for Liked Songs), `import_status`, `created_at` | One per imported playlist or likes list. `slug` drives the public URL. |
| `collection_tracks` | `collection_id`, `track_id`, `position`, `added_at` | Keeps original order for the "original order" view. |
| `import_jobs` | `id`, `collection_id`, `state`, `total`, `done`, `failed`, `error` | Drives the progress bar during import. |

v2 adds `follows`, `crates`, `crate_tracks`, and `crate_members`. Add a `track_sources` table only if a second platform (SoundCloud) comes back.

## BPM engine (fully automatic)

Every track gets a BPM without a human in the loop: the worker gathers estimates from several sources, folds them onto one scale, and keeps the value they agree on. Spotify still returns each track's ISRC, which is the key that unlocks every other source.

**Sources, all looked up by ISRC**

1. **Catalog APIs.** ReccoBeats (by Spotify ID) plus a second provider. Fast and cheap, but coverage and accuracy vary.
2. **Deezer public API.** `track/isrc:<ISRC>` returns a `bpm` field (sometimes 0 or empty), a 30-second preview MP3, and album genres. No key needed.
3. **Audio analysis on the preview.** Download the 30-second preview (Deezer, or Apple's iTunes Search API as a fallback) into memory, run Essentia's rhythm extractor, then discard the audio. This is the step that guarantees coverage: it works on any track that has a preview, whether or not a catalog knows it.

**Picking the final value**

- Fold every estimate into a canonical 70–140 band by halving or doubling. Store raw and folded values.
- If two or more sources agree within ±2 BPM (folded), take their median. Confidence = high.
- If only one source has a value, use it. Confidence = medium. Always run preview analysis in this case to get a second opinion.
- If sources disagree, prefer preview analysis (it measured the actual audio), mark confidence = low, and queue a re-analysis with a second algorithm (librosa's beat tracker) as the tiebreaker.
- No preview anywhere and no catalog value: the track shows "BPM unavailable". Expect this to be rare; measure the rate in the spike.

**Octave and matching**

- Matching and "tempo neighbors" use the folded value. Display shows the raw value, with a small ½× / 2× badge when a neighbor matched only after folding.
- Default tolerance ±3 BPM, user-adjustable ±1 to ±8. Rank by BPM distance, then energy distance, then shared genre.
- A "BPM looks wrong" flag button exists for the rare miss. A flag triggers the second-algorithm re-analysis; it never asks the user to tap.

**Genre**

Spotify's album genres now come back empty, and artist genres may be sparse. Take genre from Deezer's album record first and Spotify's artist record second, and verify both in the spike. Use genre as a filter and a tiebreaker, not as the primary grouping.

## UX and UI

The whole product hangs on one screen: a collection laid out left to right by tempo, with a match box on top that answers "what in here fits this track?" Everything else is a way into or out of that screen.

### Screens

| Screen | Purpose | Key elements |
| --- | --- | --- |
| Home | Start an import, browse examples | One big button: "Connect Spotify," then a picker of your playlists and Liked Songs. Below it, a grid of recently imported public collections as cards with a mini BPM histogram on each. |
| Import | Make the wait fun | Tracks drop onto their tempo lanes as they resolve, so the collection visibly assembles itself. Counter: "142 / 200 tracks, 58 analyzing." |
| Collection | The core view | Header, match box, histogram filter, tempo lanes. Three view toggles: Lanes (default), Map, List. |
| Track drawer | Detail + neighbors | Slides in from the right on desktop, bottom sheet on mobile. Embed player, BPM with confidence, energy, genre, neighbor list, save to Spotify. |
| Flag BPM | Report a rare miss | Not a screen, just a menu item: "BPM looks wrong." Queues a re-analysis with a second algorithm. No tapping. |

### Collection screen, top to bottom

1. **Header.** Collection title, source icon, track count, "Share" button (copies URL; link preview shows the histogram).
2. **Match box.** One input that accepts three things: a pasted Spotify track link (any track, even one not in the collection, which gets analyzed on the fly), a typed BPM number, or a track picked from the collection. Result: the lanes dim everything outside the match range and a strip of the best 5 matches appears under the box. This is the main job for edits.
3. **Histogram filter.** A thin bar chart of track count per BPM bucket across the full width, doubling as a range slider (drag to select 118–128). Energy slider, genre filter, and a "fold ½×/2×" toggle sit beside it, fold on by default.
4. **Tempo lanes.** One column per 5-BPM bucket on the folded scale (70–74, 75–79 … 135–140). Each column stacks compact track cards, sorted by energy within the column. Card = artwork thumb, title, artist, raw BPM, thin energy bar. Low-confidence BPMs render lighter with a dotted outline; tracks still being analyzed sit in an "Analyzing…" column at the far right and slide into their lane when done.

&#91;embedded content: collection page wireframe · desktop, match active\]

Shown with a match active: lanes outside 118–128 dim, the matching histogram bars light up, and Track C makes the list at 62 BPM because it folds to 124.

### Alternate views

- **Map:** a scatter of BPM (x) against energy (y), each dot is album art. Good for spotting clusters and for the shareable screenshot.
- **List:** a plain sortable table (title, artist, BPM, energy, source, confidence) for people who just want to sort and copy.

### Interactions that matter

- Hover a card: its neighbors light up across the lanes.
- Click a card: open the drawer. The drawer's neighbor list has a tolerance chip row (±2 / ±3 / ±5 / ±8) and a scope toggle: "This collection" or "All of Tempo Atlas" (the global track cache makes the second free, and it previews the v2 social layer).
- Select multiple cards, then "Copy as list" or "Open in Spotify" (deep links). "Save as Spotify playlist" works in v1, since importers are already logged in.
- Keyboard: `/` focuses the match box, arrow keys move between cards, `S` saves the current selection to Spotify.

&#91;embedded content: track drawer wireframe · desktop\]

On mobile the same drawer becomes a bottom sheet: player and BPM visible at half height, neighbors when pulled up.

### Visual direction

Dark by default (music-app native), light theme supported. Tempo is the one color that carries meaning: a cool-to-warm gradient from slow to fast, used on lane headers, histogram bars, and BPM badges. Everything else stays neutral so artwork provides the color. Monospaced numerals for BPM so columns of numbers line up.

## Risks and open questions

The biggest risk is Spotify's API policy, not code. Since February 2026, an app in Development Mode can read the item list only of a logged-in user's own playlists, has a 5-user cap, and requires the app owner to have Premium. ([Spotify changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026))

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Can't read other people's playlists by link | "Paste any playlist link" is impossible | v1 imports only the logged-in user's own playlists and Liked Songs. Public collection pages are fine, because they're served from our database, not Spotify. |
| 5-user cap in Development Mode | Only you + 4 friends can import (anyone can still view) | Fine for v1 and the v2 gate test. Before v2, either apply for extended access or add a CSV import path (e.g. a playlist export file) so non-authorized users can contribute. |
| Preview clips missing for some tracks | Those tracks fall back to catalog-only BPM | Two preview sources (Deezer, iTunes). Measure the miss rate in the spike. |
| Preview-based analysis and API terms | Platform pushback | Audio is analyzed in memory and discarded; only derived numbers are stored. Review Deezer's and Apple's API terms before launch. |
| Wrong or octave-flipped BPM | Bad neighbors, lost trust | Multi-source agreement, octave folding, confidence display, automatic re-analysis on flags. |
| Spotify changes the API again | Import breaks | Keep Spotify behind one adapter; everything after the ISRC lookup doesn't depend on Spotify. |

**Decisions to make**

- [ ] Final name and domain.
- [ ] Run the spike on 3 of your real playlists and look at the agreement rate between sources before committing to a primary catalog API.
- [ ] Whether v2's social layer needs extended access or a CSV import.
- [ ] Hosting: Vercel + managed Postgres (Neon/Supabase) vs your own box. The analyzer is a Python service either way.

## Handoff to the coding agent

Build in this order; each step ends with something you can click. Don't start the next step until the current one meets its acceptance check.

1. **BPM engine spike** (throwaway script, the most important step). Log in with your Spotify account, pull 3 of your playlists, and for every track collect estimates from each catalog API, Deezer's `bpm` field, and Essentia on the Deezer/iTunes preview. *Done when:* a CSV of track / ISRC / every estimate / final value, plus three numbers: share of tracks with a preview, share where 2+ sources agree, share with no BPM at all. Spot-check 20 tracks by ear.
2. **Schema + track cache.** Postgres tables from the Data model section, source adapters, octave folding and the agreement rule as pure functions with unit tests. *Done when:* importing the same playlist twice makes zero new external calls.
3. **Analyzer service.** A small Python service (FastAPI + Essentia) that takes a preview URL and returns BPM, energy, and key. The import worker calls it; audio never touches disk. *Done when:* it handles a 30s clip in under a few seconds and runs in Docker.
4. **Spotify login + import pipeline.** OAuth (Authorization Code with PKCE), playlist and Liked Songs picker, job queue, live progress. *Done when:* a 200-track playlist imports with a live progress bar and partial failures don't kill the job.
5. **Collection page: tempo lane view.** The main screen from the UX section. *Done when:* shareable by URL, viewable logged out, fast on a phone.
6. **Track drawer + neighbors + save to Spotify.** *Done when:* neighbors respect folding, show ½× / 2× badges, and a neighbor list saves as a new Spotify playlist.
7. **Polish:** genre filter, "BPM looks wrong" flag, OG share images, empty and error states, mobile layout.

**Stack (suggested, not sacred)**

- Next.js (App Router) + TypeScript + Tailwind on the front end.
- Postgres via Drizzle or Prisma; pg-boss for jobs so there's no separate Redis.
- Python analyzer service with Essentia (librosa as the second-opinion algorithm), deployed as its own container.
- Adapters: `SpotifyLibrary`, `CatalogProvider` (ReccoBeats, fallback), `DeezerLookup`, `PreviewSource` (Deezer, iTunes). Keys and tokens server-side only.

**Ground rules for the agent**

- Preview audio is analyzed in memory and discarded. No audio is stored or served.
- Every external call goes through the cache; every BPM estimate is stored with its source.
- Folding, agreement, and neighbor ranking live in one tested module used by both the API and the UI.
- No feature may require manual tempo input.
