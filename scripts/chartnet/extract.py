"""Read every pack zip, parse its dance-single charts and compute audio features. Everything stays in ./cache (local only)."""
from __future__ import annotations

import io
import json
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor
import os
from pathlib import Path

import numpy as np

from features import FPS, features_from_audio
from simfile import DIFFS, parse

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
PACKS = ROOT.parent / "packs"
CACHE = ROOT / "cache"
AUDIO_EXT = (".ogg", ".mp3", ".wav")
MAX_SECONDS = 420  # marathons are skipped


def songs_in_zip(zpath: Path) -> list[tuple[str, str, str]]:
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
    by_dir: dict[str, list[str]] = {}
    for n in names:
        by_dir.setdefault(n.rsplit("/", 1)[0] if "/" in n else "", []).append(n)
    out = []
    for d, files in by_dir.items():
        charts = [f for f in files if f.lower().endswith(".ssc")] or [f for f in files if f.lower().endswith(".sm")]
        audio = [f for f in files if f.lower().endswith(AUDIO_EXT)]
        if charts and audio:
            out.append((d, charts[0], ""))
    return out


def process(args: tuple[str, str, str, str]) -> str:
    zpath, d, chart_name, key = args
    out = CACHE / f"{key}.npz"
    if out.exists():
        return f"skip {key}"
    try:
        with zipfile.ZipFile(zpath) as z:
            text = z.read(chart_name).decode("utf-8", "replace")
            sim = parse(text)
            files = [n for n in z.namelist() if n.startswith(d + "/") and n.lower().endswith(AUDIO_EXT)]
            want = [f for f in files if f.rsplit("/", 1)[-1].lower() == sim.music.lower()]
            audio_name = (want or sorted(files, key=lambda f: -z.getinfo(f).file_size))[0]
            audio_bytes = z.read(audio_name)
        if any(b <= 0 for _, b in sim.timing.bpms) or any(s < 0 for _, s in sim.timing.stops):
            return f"badtiming {key}"
        charts = [c for c in sim.charts if len(c.rows) > 20 and c.difficulty in DIFFS]
        if not charts:
            return f"nocharts {key}"
        feats, onset = features_from_audio(io.BytesIO(audio_bytes), suffix=audio_name.rsplit(".", 1)[-1])
        if len(feats) > MAX_SECONDS * FPS:
            return f"toolong {key}"
        last = max(sim.timing.beat_to_time(c.rows[-1][0]) for c in charts)
        if last > len(feats) / FPS + 2:
            return f"badsync {key}"
        meta = {
            "key": key, "title": sim.title, "zip": Path(zpath).name,
            "offset": sim.timing.offset, "bpms": sim.timing.bpms, "stops": sim.timing.stops,
            "charts": [
                {"difficulty": c.difficulty, "meter": c.meter,
                 "rows": [(b, sim.timing.beat_to_time(b), r) for b, r in c.rows]}
                for c in charts
            ],
        }
        np.savez(out, feats=feats.astype(np.float16), onset=onset.astype(np.float32))
        (CACHE / f"{key}.json").write_text(json.dumps(meta))
        return f"ok {key} {feats.shape[0]} frames, {len(charts)} charts"
    except Exception as e:  # noqa: BLE001
        return f"fail {key}: {type(e).__name__}: {e}"


def main() -> None:
    CACHE.mkdir(exist_ok=True)
    jobs = []
    for zpath in sorted(PACKS.rglob("*.zip")):
        for d, chart, _ in songs_in_zip(zpath):
            key = f"{zpath.stem}__{d.rsplit('/', 1)[-1]}".replace(" ", "_").replace("/", "_")
            jobs.append((str(zpath), d, chart, key))
    print(len(jobs), "songs", flush=True)
    workers = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    with ProcessPoolExecutor(workers) as ex:
        for i, msg in enumerate(ex.map(process, jobs)):
            if not msg.startswith("ok") or i % 25 == 0:
                print(i, msg, flush=True)


def dump_test_audio() -> None:
    """Write the held-out songs' audio to ROOT/rulegen/audio and a job list for rule-baseline.ts (all local)."""
    import random
    keys = sorted(p.stem for p in CACHE.glob("*.json"))
    random.Random(0).shuffle(keys)
    test = set(keys[: len(keys) // 10])  # the same split as data.split
    out = ROOT / "rulegen" / "audio"
    out.mkdir(parents=True, exist_ok=True)
    jobs = []
    for zpath in sorted(PACKS.rglob("*.zip")):
        for d, _, _ in songs_in_zip(zpath):
            key = f"{zpath.stem}__{d.rsplit('/', 1)[-1]}".replace(" ", "_").replace("/", "_")
            if key not in test:
                continue
            with zipfile.ZipFile(zpath) as z:
                files = [n for n in z.namelist() if n.startswith(d + "/") and n.lower().endswith(AUDIO_EXT)]
                a = sorted(files, key=lambda f: -z.getinfo(f).file_size)[0]
                p = out / f"{len(jobs):02d}.{a.rsplit('.', 1)[-1]}"
                p.write_bytes(z.read(a))
            jobs.append({"key": key, "file": str(p)})
    (ROOT / "rulegen" / "jobs.json").write_text(json.dumps(jobs))


if __name__ == "__main__":
    dump_test_audio() if sys.argv[1:] == ["test-audio"] else main()
