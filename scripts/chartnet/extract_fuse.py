"""Features + measured beat grid for the Fuse songs, read straight from the Fusemania branch with git show."""
from __future__ import annotations

import io
import json
import re
import subprocess
import os
from pathlib import Path

import numpy as np

from features import features_from_audio
from simfile import parse

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
REPO = Path(__file__).resolve().parents[2]
BRANCH = os.environ.get("CHARTNET_REF", "HEAD")
OUT = ROOT / "cache_fuse"


def show(path: str) -> bytes:
    return subprocess.run(["git", "-C", str(REPO), "show", f"{BRANCH}:{path}"], capture_output=True, check=True).stdout


def main() -> None:
    OUT.mkdir(exist_ok=True)
    src = show("scripts/lib/fusemania/songs.ts").decode()
    specs = []
    for m in re.finditer(r'radio\("([^"]+)"', src):
        specs.append((m.group(1), f"public/music/{m.group(1)}.m4a"))
    for m in re.finditer(r'game\("([^"]+)",\s*"([^"]+)"', src):
        specs.append((m.group(2), f"public/music/{m.group(1)}/{m.group(2)}.mp3"))
    for m in re.finditer(r'killerFuse\("([^"]+)"', src):
        specs.append((m.group(1), f"games/killer-fuse/public/killer-fuse/audio/music/{m.group(1)}.mp3"))
    for sid, path in specs:
        try:
            ssc = show(f"games/fusemania/charts/{sid}.ssc").decode()
        except subprocess.CalledProcessError:
            print("no chart", sid)
            continue
        sim = parse(ssc)
        feats, onset = features_from_audio(io.BytesIO(show(path)), suffix=path.rsplit(".", 1)[-1])
        np.savez(OUT / f"{sid}.npz", feats=feats.astype(np.float16), onset=onset.astype(np.float32))
        meta = {"key": sid, "title": sim.title, "offset": sim.timing.offset, "bpms": sim.timing.bpms,
                "stops": sim.timing.stops, "ssc_head": ssc.split("#NOTEDATA")[0],
                "charts": [{"difficulty": c.difficulty, "meter": c.meter,
                            "rows": [(b, sim.timing.beat_to_time(b), r) for b, r in c.rows]} for c in sim.charts]}
        (OUT / f"{sid}.json").write_text(json.dumps(meta))
        print(sid, feats.shape, [(c.difficulty, len(c.rows)) for c in sim.charts], flush=True)


if __name__ == "__main__":
    main()
