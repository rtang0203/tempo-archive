"""Essentia feature extraction on decoded PCM. No I/O beyond the ffmpeg pipe."""

import subprocess
import threading

import numpy as np

SR = 44100

# Essentia algorithm instances are not thread-safe; FastAPI runs sync handlers in a pool.
_lock = threading.Lock()
_algos = None


def _get_algos():
    global _algos
    if _algos is None:
        import essentia.standard as es

        _algos = {
            "rhythm": es.RhythmExtractor2013(method="multifeature"),
            "dance": es.Danceability(sampleRate=SR),
            "key": es.KeyExtractor(sampleRate=SR),
            "window": es.Windowing(type="hann"),
            "spectrum": es.Spectrum(),
            "flux": es.Flux(),
            "frames": es.FrameGenerator,
        }
    return _algos


def decode(audio_bytes: bytes) -> np.ndarray:
    """mp3/m4a bytes → mono float32 PCM at 44.1 kHz, via ffmpeg pipes (never touches disk)."""
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", str(SR), "pipe:1"],
        input=audio_bytes,
        capture_output=True,
        check=True,
        timeout=30,
    ).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def features(audio: np.ndarray) -> dict:
    """
    Energy is mean spectral flux: of the Essentia measures tried in the spike it
    tracked ReccoBeats' Spotify-style energy best (Spearman +0.54). Its raw scale
    is arbitrary; the UI shows it as a within-collection percentile.
    """
    if audio.size < SR * 5:
        raise ValueError("audio shorter than 5 seconds")
    with _lock:
        a = _get_algos()
        bpm, _, confidence, _, _ = a["rhythm"](audio)
        danceability, _ = a["dance"](audio)
        key, scale, _ = a["key"](audio)
        flux = [a["flux"](a["spectrum"](a["window"](f))) for f in a["frames"](audio, frameSize=2048, hopSize=1024)]
    return {
        "bpm": float(bpm),
        "bpmConfidence": float(confidence),
        "energy": float(np.mean(flux)),
        "danceability": float(danceability),
        "key": key,
        "scale": scale,
    }
