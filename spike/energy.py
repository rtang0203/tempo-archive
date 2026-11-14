"""Spike follow-up: which Essentia measure best tracks perceived energy?

Compares candidate measures against ReccoBeats energy (a Spotify-style 0–1
score) on spike tracks that have both, using Spearman rank correlation, since
the UI only uses energy for ordering and relative bars.
"""

import csv

import numpy as np

import spike as s
from second_vote import pcm


def spearman(a, b):
    ra, rb = np.argsort(np.argsort(a)), np.argsort(np.argsort(b))
    return float(np.corrcoef(ra, rb)[0, 1])


def main():
    import essentia.standard as es

    loud = es.LoudnessEBUR128(sampleRate=s.SR)
    rows = [r for r in csv.DictReader(open(s.OUT / "spike.csv")) if r["bpm_essentia"]]
    recco = s.reccobeats([r["spotify_id"] for r in rows])
    feats = {k: [] for k in ("lufs", "rms", "onset_rate", "centroid", "flux", "combo")}
    target = []
    for i, r in enumerate(rows, 1):
        e = recco.get(r["spotify_id"], {}).get("energy")
        if e is None:
            continue
        dz = s.deezer(r["isrc"])
        url = (dz or {}).get("preview") or s.itunes_preview(r["title"], r["artists"])
        if not url:
            continue
        audio = pcm(url)
        stereo = np.stack([audio, audio], axis=1)
        lufs = float(loud(stereo)[2])
        frames = es.FrameGenerator(audio, frameSize=2048, hopSize=1024)
        w, spec, cen, flux = es.Windowing(type="hann"), es.Spectrum(), es.Centroid(range=s.SR / 2), es.Flux()
        rms_v, cen_v, flux_v = [], [], []
        for fr in frames:
            sp = spec(w(fr))
            rms_v.append(float(np.sqrt(np.mean(fr ** 2))))
            cen_v.append(cen(sp))
            flux_v.append(flux(sp))
        onset_rate = float(es.OnsetRate()(audio)[1])
        target.append(e)
        feats["lufs"].append(lufs)
        feats["rms"].append(float(np.mean(rms_v)))
        feats["onset_rate"].append(onset_rate)
        feats["centroid"].append(float(np.mean(cen_v)))
        feats["flux"].append(float(np.mean(flux_v)))
        print(f"[{i}/{len(rows)}] {r['title'][:34]:34} recco={e:.2f} lufs={lufs:6.1f} onset={onset_rate:.2f}")

    z = lambda x: (np.array(x) - np.mean(x)) / np.std(x)
    feats["combo"] = list(z(feats["lufs"]) + z(feats["onset_rate"]) + z(feats["centroid"]))
    print(f"\nn={len(target)} tracks with ReccoBeats energy")
    for k, v in feats.items():
        print(f"  spearman(recco_energy, {k:10}) = {spearman(target, v):+.2f}")


if __name__ == "__main__":
    main()
