"""Analyzer service: POST a preview URL, get BPM, energy, danceability, key back.

The audio is downloaded into memory, decoded through ffmpeg pipes, analyzed,
and discarded. Only preview CDNs are fetched, so the service can't be used to
reach arbitrary hosts.
"""

import subprocess
import time
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from analysis import decode, features

ALLOWED_HOST_SUFFIXES = (".dzcdn.net", ".itunes.apple.com", ".mzstatic.com")
MAX_BYTES = 5 * 1024 * 1024

app = FastAPI(title="Tempo Atlas analyzer")
client = httpx.Client(timeout=20, follow_redirects=False)


class AnalyzeRequest(BaseModel):
    preview_url: str


def allowed(url: str) -> bool:
    u = urlparse(url)
    host = u.hostname or ""
    return u.scheme == "https" and any(host.endswith(s) for s in ALLOWED_HOST_SUFFIXES)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    if not allowed(req.preview_url):
        raise HTTPException(400, "preview_url host not allowed")
    started = time.perf_counter()
    try:
        with client.stream("GET", req.preview_url) as res:
            if res.status_code != 200:
                raise HTTPException(502, f"preview fetch returned {res.status_code}")
            chunks, size = [], 0
            for chunk in res.iter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "preview too large")
                chunks.append(chunk)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"preview fetch failed: {e}") from e
    fetched = time.perf_counter()
    try:
        result = features(decode(b"".join(chunks)))
    except (subprocess.CalledProcessError, ValueError) as e:
        raise HTTPException(422, f"undecodable preview: {e}") from e
    done = time.perf_counter()
    return {**result, "timingMs": {"fetch": round((fetched - started) * 1000), "analyze": round((done - fetched) * 1000)}}
