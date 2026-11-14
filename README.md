# Tempo Atlas

Lay out a Spotify collection by tempo, pick a track, and see everything else that moves at the same speed. Built for picking songs for short video edits and for building playlists that flow.

Live at **https://tempo.eightfoldpath.xyz**. The product spec and every design decision are recorded in `Tempo Atlas — Refined Plan.md`.

## What it does

- **Import** your own Spotify playlists or Liked Songs. Followed playlists can't be imported (Spotify only returns tracks for playlists you own).
- **BPM is fully automatic.** Each track gets votes from Essentia (run on a 30-second preview), ReccoBeats, and Deezer. Votes are compared octave-agnostically: 71 and 142 agree, and 3:2 "triplet feel" disagreements are flagged.
- **Collection page** (`/c/<slug>`): tempo lanes, Map (BPM × energy), and List views; a match box (type a BPM, search the collection, or paste a Spotify link when logged in); a histogram range filter; energy and genre filters; and a fold ½×/2× toggle.
- **Track drawer:** Spotify player, BPM in both octaves, confidence, energy and danceability percentiles, key and Camelot, and tempo neighbors within ±2/3/5/8 BPM, either in this collection or across all public collections.
- **Save to Spotify:** neighbor lists, match results, or a selection become a new private playlist.
- **Sharing:** a collection is public (listed on the home page) or unlisted (link only). Viewing never requires login.

## Architecture

```mermaid
flowchart LR
  B[Browser] --> W[Next.js web]
  W --> DB[(Postgres)]
  W -- enqueue import --> Q[pg-boss queue in Postgres]
  Q --> K[Import worker]
  K --> DB
  K --> S[Spotify API]
  K --> D[Deezer API]
  K --> R[ReccoBeats]
  K --> I[iTunes search]
  K --> A[Analyzer: FastAPI + Essentia]
```

- Every outside call goes through a cache: each (track, source, source version) is asked once, and misses are cached too. Re-importing a playlist makes zero outside calls.
- From Spotify, only the track ID and ISRC are stored (Spotify Developer Terms). Titles, artists, artwork, and genres come from Deezer.
- Preview audio is decoded in memory and discarded; only the numbers derived from it are stored.

| Path | What |
|---|---|
| `src/engine/` | Pure, tested tempo math: octave-circular distance, agreement rule, octave display, axis start, Camelot, neighbor ranking |
| `src/adapters/` | Spotify, Deezer, ReccoBeats, iTunes, analyzer clients |
| `src/tracks/ensure.ts` | Cache-through track pipeline |
| `src/server/` | DB/queue context, sessions, token encryption, imports, collection queries |
| `src/worker/main.ts` | pg-boss import worker |
| `src/app/`, `src/components/` | Next.js pages, API routes, UI |
| `src/db/schema.ts`, `drizzle/` | Drizzle schema and migrations |
| `analyzer/` | Python analyzer service (Essentia, Python 3.14, uv) |
| `deploy/` | Droplet compose file and deploy script |
| `spike/` | The BPM-engine spike and experiments (historical) |

## Local development

Requirements: Node 24, Docker, and a Spotify developer app whose redirect URIs include `http://127.0.0.1:8888/callback` (Spotify rejects `localhost`).

`.env` at the repo root:

```bash
CLIENT_ID=...              # Spotify app
CLIENT_SECRET=...
DATABASE_URL=postgres://tempo:tempo@127.0.0.1:5433/tempo_atlas
ANALYZER_URL=http://127.0.0.1:8000
APP_URL=http://127.0.0.1:8888
SESSION_SECRET=...         # openssl rand -base64 32
TOKEN_KEY=...              # openssl rand -base64 32 (encrypts Spotify tokens at rest)
```

```bash
npm install
docker compose up -d       # Postgres on 5433, analyzer on 8000
npm run db:migrate
npm run dev                # http://127.0.0.1:8888
npm run worker             # second terminal; runs imports
```

On Apple Silicon the analyzer image runs under emulation (Essentia only ships x86_64 Linux wheels), which is fine for development.

## Tests

```bash
npm test                   # engine + cache pipeline (PGlite, no Docker needed)
npm run typecheck
cd analyzer && uv run pytest
```

Schema change: edit `src/db/schema.ts`, then `npm run db:generate` and commit the new file in `drizzle/`.

## Deployment

Production runs on the `market-data` DigitalOcean droplet (2 GB, 1 vCPU) next to other services, sharing its Postgres container. Deploy from this machine:

```bash
deploy/deploy.sh           # builds linux/amd64 images, ships them, migrates, restarts
```

Droplet layout, secrets, logs, and troubleshooting are in `~/Documents/projects/DEPLOYMENT-REFERENCE.md` (Tempo Atlas section).

## Limits

- **Spotify Development Mode:** at most 5 users can log in and import, and each must be added under User Management in the Spotify dashboard. Extended quota requires an organization with 250k+ monthly active users. Growth past that is planned via Exportify CSV import (v2).
- **BPM unavailable:** about 2–6% of tracks, those with no preview on Deezer or iTunes (common for underground releases).
- **Known miss class:** triplet-feel tracks can be read at 4:3 of the felt tempo; use "BPM looks wrong" on them.
- **Speed:** new tracks take about 1.3 s each on the production droplet; cached tracks are instant.
