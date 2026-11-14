"""Spike follow-up: is a second beat tracker worth it? (Q25)

Re-fetches previews for tracks in out/spike.csv and computes two candidate
second votes: librosa beat_track and Essentia's 'degara' method (same library
as the primary vote, so no new dependency). Scores everything against the
ear check, octave-agnostic, and reports 3:2 (4:3 when folded) relations.
"""

import csv
import math
import re
import subprocess

import numpy as np

import spike as s

SR = 22050
TOL = s.AGREE_OCT


def pcm(url):
    data = s.session.get(url, timeout=30).content
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1",
                          "-ar", str(s.SR), "pipe:1"], input=data, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def relation(a, b):
    """'same' (octave-agnostic), '3:2' (incl. 4:3 after folding), or 'other'."""
    d = s.tempo_distance(a, b)
    if d <= TOL:
        return "same"
    if abs(d - math.log2(4 / 3)) <= TOL * 1.5:  # 3:2 ≡ 4:3 modulo an octave
        return "3:2"
    return "other"


def main():
    import essentia.standard as es
    import librosa

    degara = es.RhythmExtractor2013(method="degara")
    rows = list(csv.DictReader(open(s.OUT / "spike.csv")))
    ear = {}
    for r in csv.DictReader(open(s.OUT / "ear_check.csv")):
        ans = r["correct? (y/n/octave)"].strip().lower()
        m = re.search(r"~\s*(\d+)", ans)
        ear[r["title"]] = float(m.group(1)) if m else float(r["final_bpm"])

    results = []
    for i, r in enumerate(rows, 1):
        if not r["bpm_essentia"]:
            continue
        dz = s.deezer(r["isrc"])
        url = (dz or {}).get("preview") or s.itunes_preview(r["title"], r["artists"])
        if not url:
            continue
        audio = pcm(url)
        y = librosa.resample(audio, orig_sr=s.SR, target_sr=SR)
        lib = float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=SR)[0])[0])
        deg = float(degara(audio)[0])
        results.append({**r, "bpm_librosa": lib, "bpm_degara": deg})
        print(f"[{i}/{len(rows)}] {r['title'][:36]:36} es={float(r['bpm_essentia']):6.1f} "
              f"degara={deg:6.1f} librosa={lib:6.1f}")

    with open(s.OUT / "second_vote.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0]))
        w.writeheader()
        w.writerows(results)

    print("\n== vs ear check (octave-agnostic) ==")
    for src in ("essentia", "degara", "librosa", "reccobeats"):
        scored = [(r, ear[r["title"]]) for r in results if r["title"] in ear and r[f"bpm_{src}"] != ""]
        rel = [relation(float(r[f"bpm_{src}"]), truth) for r, truth in scored]
        print(f"{src:10} same {rel.count('same')}/{len(rel)}  3:2 {rel.count('3:2')}  other {rel.count('other')}")

    print("\n== essentia vs candidate second votes, all tracks ==")
    for src in ("degara", "librosa", "reccobeats"):
        rel = [relation(float(r["bpm_essentia"]), float(r[f"bpm_{src}"])) for r in results if r[f"bpm_{src}"] != ""]
        print(f"es~{src:10} same {rel.count('same')}/{len(rel)}  3:2 {rel.count('3:2')}  other {rel.count('other')}")

    print("\n== ear-check misses: would a second vote have flagged them? ==")
    for r in results:
        if r["title"] in ear and relation(float(r["bpm_essentia"]), ear[r["title"]]) != "same":
            truth = ear[r["title"]]
            print(f"{r['title'][:30]:30} ear~{truth:.0f} es={float(r['bpm_essentia']):.1f} "
                  f"degara={r['bpm_degara']:.1f} ({relation(r['bpm_degara'], truth)}) "
                  f"librosa={r['bpm_librosa']:.1f} ({relation(r['bpm_librosa'], truth)}) "
                  f"rb={r['bpm_reccobeats'] or '-'}")


if __name__ == "__main__":
    main()
