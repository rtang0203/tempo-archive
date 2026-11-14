"""Tempo Atlas BPM engine spike (throwaway).

Pulls owned Spotify playlists, gathers BPM votes from ReccoBeats, Deezer, and
Essentia (on 30s previews decoded in memory), applies the agreement rule, and
reports the spike's pass/fail numbers. See "Handoff to the coding agent" step 1
in ../Tempo Atlas — Refined Plan.md.

Usage: .venv/bin/python spike.py PLAYLIST_URL_OR_ID [...]
"""

import base64
import csv
import hashlib
import http.server
import json
import math
import os
import random
import secrets
import statistics
import subprocess
import sys
import time
import urllib.parse
import webbrowser
from pathlib import Path

import numpy as np
import requests

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
TOKEN_FILE = HERE / ".token.json"
REDIRECT_URI = "http://127.0.0.1:8888/callback"
SCOPES = "playlist-read-private playlist-read-collaborative"
AGREE_RATIO = 0.015  # ±1.5%
SR = 44100

session = requests.Session()


def load_env():
    env = {}
    for line in (HERE.parent / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
CLIENT_ID = ENV["CLIENT_ID"]
CLIENT_SECRET = ENV.get("CLIENT_SECRET")


# ---------------------------------------------------------------- HTTP helpers


def get_json(url, headers=None, params=None, tries=5):
    for attempt in range(tries):
        r = session.get(url, headers=headers, params=params, timeout=30)
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 2 ** attempt))
            print(f"  429 from {urllib.parse.urlparse(url).netloc}, waiting {wait}s")
            time.sleep(wait)
            continue
        if r.status_code >= 500:
            time.sleep(2 ** attempt)
            continue
        return r
    return r


# ---------------------------------------------------------------- Spotify auth


def pkce_login():
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "scope": SCOPES,
        "state": state,
    })
    result = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            result.update({k: v[0] for k, v in q.items()})
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Logged in. You can close this tab.")

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 8888), Handler)
    print("Opening browser for Spotify login...\n  " + url)
    webbrowser.open(url)
    while "code" not in result and "error" not in result:
        server.handle_request()
    server.server_close()
    if result.get("state") != state or "error" in result:
        sys.exit(f"Login failed: {result}")
    r = session.post("https://accounts.spotify.com/api/token", data={
        "grant_type": "authorization_code",
        "code": result["code"],
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "code_verifier": verifier,
    })
    r.raise_for_status()
    return r.json()


def user_token():
    if TOKEN_FILE.exists():
        tok = json.loads(TOKEN_FILE.read_text())
        if tok["expires_at"] > time.time() + 60:
            return tok["access_token"]
        r = session.post("https://accounts.spotify.com/api/token", data={
            "grant_type": "refresh_token",
            "refresh_token": tok["refresh_token"],
            "client_id": CLIENT_ID,
        })
        if r.ok:
            new = r.json()
            new.setdefault("refresh_token", tok["refresh_token"])
            return save_token(new)
    return save_token(pkce_login())


def save_token(tok):
    tok["expires_at"] = time.time() + tok["expires_in"]
    TOKEN_FILE.write_text(json.dumps(tok))
    TOKEN_FILE.chmod(0o600)
    return tok["access_token"]


# ---------------------------------------------------------------- Spotify data


def playlist_id(arg):
    if "playlist/" in arg:
        return arg.split("playlist/")[1].split("?")[0]
    return arg


def fetch_playlist(pid, token):
    h = {"Authorization": f"Bearer {token}"}
    meta = get_json(f"https://api.spotify.com/v1/playlists/{pid}", h,
                    {"fields": "name,collaborative,owner(id,display_name)"})
    meta.raise_for_status()
    meta = meta.json()
    tracks, url = [], f"https://api.spotify.com/v1/playlists/{pid}/items"
    params = {"limit": 50}
    while url:
        r = get_json(url, h, params)
        if not r.ok:
            print(f"  items fetch failed for {meta['name']}: {r.status_code} {r.text[:200]}")
            break
        page = r.json()
        for it in page.get("items", []):
            t = it.get("item") or it.get("track")
            if not t or t.get("type") != "track" or not t.get("id"):
                continue
            tracks.append({
                "playlist": meta["name"],
                "spotify_id": t["id"],
                "isrc": (t.get("external_ids") or {}).get("isrc"),
                "title": t["name"],
                "artists": ", ".join(a["name"] for a in t["artists"]),
            })
        url, params = page.get("next"), None
    return meta, tracks


def check_server_track_lookup(spotify_id):
    """Does GET /tracks/{id} work with client-credentials (server) auth?"""
    if not CLIENT_SECRET:
        return "skipped (no CLIENT_SECRET)"
    r = session.post("https://accounts.spotify.com/api/token",
                     data={"grant_type": "client_credentials"},
                     auth=(CLIENT_ID, CLIENT_SECRET))
    if not r.ok:
        return f"token failed {r.status_code}"
    t = get_json(f"https://api.spotify.com/v1/tracks/{spotify_id}",
                 {"Authorization": f"Bearer {r.json()['access_token']}"})
    if not t.ok:
        return f"FAIL {t.status_code}"
    has_isrc = bool((t.json().get("external_ids") or {}).get("isrc"))
    return f"OK (isrc present: {has_isrc})"


# ---------------------------------------------------------------- Other sources


def reccobeats(spotify_ids):
    out = {}
    for i in range(0, len(spotify_ids), 40):
        chunk = spotify_ids[i:i + 40]
        r = get_json("https://api.reccobeats.com/v1/audio-features", params={"ids": ",".join(chunk)})
        if not r.ok:
            print(f"  reccobeats {r.status_code}")
            continue
        for f in r.json().get("content", []):
            sid = f["href"].rsplit("/", 1)[-1]
            out[sid] = f
    return out


album_genre_cache = {}


def deezer(isrc):
    if not isrc:
        return None
    r = get_json(f"https://api.deezer.com/track/isrc:{isrc}")
    d = r.json() if r.ok else {}
    if "error" in d or not d.get("id"):
        return None
    alb = (d.get("album") or {}).get("id")
    if alb and alb not in album_genre_cache:
        a = get_json(f"https://api.deezer.com/album/{alb}")
        genres = (a.json().get("genres") or {}).get("data", []) if a.ok else []
        album_genre_cache[alb] = "|".join(g["name"] for g in genres)
    return {
        "bpm": d.get("bpm") or None,
        "preview": d.get("preview") or None,
        "artwork": (d.get("album") or {}).get("cover_xl"),
        "genre": album_genre_cache.get(alb, ""),
    }


def itunes_preview(title, artists):
    term = f"{artists.split(',')[0]} {title}"
    r = get_json("https://itunes.apple.com/search", params={"term": term, "entity": "song", "limit": 5})
    if not r.ok:
        return None
    for res in r.json().get("results", []):
        if res.get("previewUrl"):
            return res["previewUrl"]
    return None


# ---------------------------------------------------------------- Essentia


_es = None


def essentia_features(preview_url):
    global _es
    if _es is None:
        import essentia.standard as es
        _es = {
            "rhythm": es.RhythmExtractor2013(method="multifeature"),
            "dance": es.Danceability(),
            "key": es.KeyExtractor(),
        }
    audio_bytes = session.get(preview_url, timeout=30).content
    # Decode in memory: mp3/m4a bytes -> ffmpeg stdin -> f32 mono PCM on stdout.
    pcm = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(SR), "pipe:1"],
        input=audio_bytes, capture_output=True, check=True,
    ).stdout
    audio = np.frombuffer(pcm, dtype=np.float32).copy()
    bpm, _, conf, _, _ = _es["rhythm"](audio)
    dance, _ = _es["dance"](audio)
    key, scale, _ = _es["key"](audio)
    return {"bpm": float(bpm), "conf": float(conf), "dance": float(dance), "key": f"{key} {scale}"}


# ---------------------------------------------------------------- Engine rules


def fold(bpm):
    while bpm < 70:
        bpm *= 2
    while bpm >= 140:
        bpm /= 2
    return bpm


def tempo_distance(a, b):
    """Circular log2 distance (in octaves), so 139 and 71 are close."""
    d = abs(math.log2(a / b)) % 1.0
    return min(d, 1.0 - d)


AGREE_OCT = math.log2(1 + AGREE_RATIO)


def resolve(votes):
    """votes: {source: raw_bpm}. Returns (final_raw, confidence, agreeing_sources)."""
    votes = {s: v for s, v in votes.items() if v and v > 0}
    if not votes:
        return None, "unavailable", []
    srcs = list(votes)
    best = []
    for s in srcs:
        group = [t for t in srcs if tempo_distance(votes[s], votes[t]) <= AGREE_OCT]
        if len(group) > len(best):
            best = group
    if len(best) >= 2:
        # Median on the folded scale, reported at the octave of the Essentia vote if present.
        anchor = votes.get("essentia", votes[best[0]])
        folded = statistics.median(fold(votes[s]) for s in best)
        return rescale(folded, anchor), "high", best
    if len(votes) == 1:
        return next(iter(votes.values())), "medium", srcs
    if "essentia" in votes:
        return votes["essentia"], "low", ["essentia"]
    return votes[srcs[0]], "low", [srcs[0]]


def rescale(folded, anchor):
    """Move a folded value to the octave closest to anchor."""
    best = folded
    for k in (-2, -1, 0, 1, 2):
        cand = folded * (2 ** k)
        if abs(math.log2(cand / anchor)) < abs(math.log2(best / anchor)):
            best = cand
    return best


# ---------------------------------------------------------------- Main


def main(args):
    sample_n = None
    if args and args[0].startswith("--sample="):
        sample_n = int(args.pop(0).split("=", 1)[1])
    if not args:
        sys.exit(__doc__)
    OUT.mkdir(exist_ok=True)
    token = user_token()

    tracks, playlist_report = [], []
    for a in args:
        meta, ts = fetch_playlist(playlist_id(a), token)
        line = (f"{meta['name']}: {len(ts)} tracks, owner={meta['owner']['display_name']}, "
                f"collaborative={meta['collaborative']}")
        if sample_n and len(ts) > sample_n:
            ts = random.Random(meta["name"]).sample(ts, sample_n)
            line += f" (sampled {sample_n})"
        playlist_report.append(line)
        tracks.extend(ts)
    print("\n".join(playlist_report))

    # De-dupe across playlists (global cache semantics), keep playlist list per track.
    by_id = {}
    for t in tracks:
        if t["spotify_id"] in by_id:
            by_id[t["spotify_id"]]["playlist"] += f" | {t['playlist']}"
        else:
            by_id[t["spotify_id"]] = t
    uniq = list(by_id.values())
    print(f"{len(uniq)} unique tracks\n")

    rb = reccobeats([t["spotify_id"] for t in uniq])

    rows = []
    for i, t in enumerate(uniq, 1):
        dz = deezer(t["isrc"])
        preview, preview_src = (dz or {}).get("preview"), "deezer"
        if not preview:
            preview, preview_src = itunes_preview(t["title"], t["artists"]), "itunes"
        ess = None
        if preview:
            try:
                ess = essentia_features(preview)
            except Exception as e:  # spike: record and move on
                print(f"  essentia failed on {t['title']}: {e}")
        rbf = rb.get(t["spotify_id"], {})
        votes = {
            "reccobeats": rbf.get("tempo"),
            "deezer": (dz or {}).get("bpm"),
            "essentia": ess and ess["bpm"],
        }
        final, conf, agreeing = resolve(votes)
        rows.append({
            **t,
            "deezer_match": bool(dz),
            "deezer_genre": (dz or {}).get("genre", ""),
            "preview_src": preview_src if preview else "",
            "bpm_reccobeats": votes["reccobeats"] or "",
            "bpm_deezer": votes["deezer"] or "",
            "bpm_essentia": round(ess["bpm"], 2) if ess else "",
            "essentia_conf": round(ess["conf"], 2) if ess else "",
            "danceability_essentia": round(ess["dance"], 3) if ess else "",
            "danceability_reccobeats": rbf.get("danceability", ""),
            "key_essentia": ess["key"] if ess else "",
            "final_bpm": round(final, 1) if final else "",
            "final_folded": round(fold(final), 1) if final else "",
            "confidence": conf,
            "agreeing": "+".join(agreeing) if conf == "high" else "",
            "spotify_url": f"https://open.spotify.com/track/{t['spotify_id']}",
        })
        print(f"[{i}/{len(uniq)}] {t['title'][:40]:40} rb={votes['reccobeats']} dz={votes['deezer']} "
              f"es={ess and round(ess['bpm'], 1)} -> {rows[-1]['final_bpm']} ({conf})")

    with open(OUT / "spike.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    n = len(rows)
    pct = lambda k: f"{100 * k / n:.1f}%"
    preview_n = sum(1 for r in rows if r["preview_src"])
    agree_n = sum(1 for r in rows if r["confidence"] == "high")
    none_n = sum(1 for r in rows if r["confidence"] == "unavailable")
    dz_n = sum(1 for r in rows if r["deezer_match"])
    genre_n = sum(1 for r in rows if r["deezer_genre"])
    src_cov = {s: sum(1 for r in rows if r[f"bpm_{s}"] != "") for s in ("reccobeats", "deezer", "essentia")}

    def pair(a, b):
        both = [r for r in rows if r[f"bpm_{a}"] != "" and r[f"bpm_{b}"] != ""]
        ok = sum(1 for r in both if tempo_distance(float(r[f"bpm_{a}"]), float(r[f"bpm_{b}"])) <= AGREE_OCT)
        return f"{ok}/{len(both)}"

    sample = random.Random(0).sample(rows, min(20, n))
    with open(OUT / "ear_check.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["title", "artists", "final_bpm", "confidence", "spotify_url", "correct? (y/n/octave)"])
        for r in sample:
            w.writerow([r["title"], r["artists"], r["final_bpm"], r["confidence"], r["spotify_url"], ""])

    server_check = check_server_track_lookup(rows[0]["spotify_id"])
    verdict = lambda ok: "PASS" if ok else "FAIL"
    report = f"""
Tempo Atlas spike — {n} unique tracks
{chr(10).join(playlist_report)}

Preview found (Deezer or iTunes): {pct(preview_n)}  [{verdict(preview_n / n >= 0.90)} ≥90%]
  Deezer {sum(1 for r in rows if r['preview_src'] == 'deezer')}, iTunes fallback {sum(1 for r in rows if r['preview_src'] == 'itunes')}
≥2 of 3 sources agree (±1.5%):    {pct(agree_n)}  [{verdict(agree_n / n >= 0.75)} ≥75%]
No BPM at all:                    {pct(none_n)}  [{verdict(none_n / n <= 0.02)} ≤2%]
Deezer ISRC match:                {pct(dz_n)}
Deezer genre hit:                 {pct(genre_n)}
Source coverage: {', '.join(f'{s} {pct(c)}' for s, c in src_cov.items())}
Pairwise agreement: rb~dz {pair('reccobeats', 'deezer')}, rb~es {pair('reccobeats', 'essentia')}, dz~es {pair('deezer', 'essentia')}
Confidence: high {agree_n}, medium {sum(1 for r in rows if r['confidence'] == 'medium')}, low {sum(1 for r in rows if r['confidence'] == 'low')}
Server GET /tracks/{{id}} (client credentials): {server_check}

Manual checks remaining:
  - Ear check: fill in out/ear_check.csv (pass: ≤2 of 20 wrong)
  - Exportify: non-allowlisted friend exports from exportify.app; ISRC column? tempo column?
"""
    (OUT / "report.txt").write_text(report)
    print(report)


if __name__ == "__main__":
    main(sys.argv[1:])
