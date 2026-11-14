import numpy as np
import pytest

from analysis import SR, features
from app import allowed


def click_track(bpm: float, seconds: float = 30) -> np.ndarray:
    """Kick-like decaying 60 Hz bursts on every beat, plus a hi-hat on the off-beat."""
    audio = np.zeros(int(SR * seconds), dtype=np.float32)
    t = np.arange(int(SR * 0.08)) / SR
    kick = (np.sin(2 * np.pi * 60 * t) * np.exp(-t * 40)).astype(np.float32)
    hat = (np.random.default_rng(0).standard_normal(len(t)) * np.exp(-t * 120) * 0.3).astype(np.float32)
    period = 60 / bpm
    for i in range(int(seconds / period)):
        for offset, sound in ((0, kick), (period / 2, hat)):
            start = int((i * period + offset) * SR)
            end = min(start + len(sound), len(audio))
            audio[start:end] += sound[: end - start]
    return audio


@pytest.mark.parametrize("bpm", [90.0, 128.0])
def test_measures_tempo_of_a_steady_beat(bpm):
    got = features(click_track(bpm))["bpm"]
    folded = lambda b: b * 2 ** round(np.log2(bpm / b))
    assert folded(got) == pytest.approx(bpm, rel=0.015)


def test_rejects_too_short_audio():
    with pytest.raises(ValueError):
        features(np.zeros(SR, dtype=np.float32))


@pytest.mark.parametrize(
    "url,ok",
    [
        ("https://cdnt-preview.dzcdn.net/api/1/1/a.mp3?hdnea=x", True),
        ("https://audio-ssl.itunes.apple.com/itunes-assets/a.m4a", True),
        ("http://cdnt-preview.dzcdn.net/a.mp3", False),
        ("https://evil.example/dzcdn.net", False),
        ("https://dzcdn.net.evil.example/a.mp3", False),
        ("http://169.254.169.254/latest/meta-data", False),
    ],
)
def test_only_fetches_preview_cdns(url, ok):
    assert allowed(url) is ok
