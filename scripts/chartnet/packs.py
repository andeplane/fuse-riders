"""Download the community packs ChartNet trains on (local only, never committed).

  python packs.py [chunk]   – resolve the names in community-packs.txt on stepmaniaonline.net's pack search and
                              download them into $CHARTNET_WORK/../packs/Community 2005-2016 (resumable).
                              Without `chunk` only the first batch, with `chunk 1` the lines after `## chunk 1` too.
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
DEST = ROOT.parent / "packs" / "Community 2005-2016"
SITE = "https://stepmaniaonline.net"
UA = {"User-Agent": "Mozilla/5.0"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def names(chunks: int) -> list[str]:
    out, chunk = [], 0
    for line in (Path(__file__).parent / "community-packs.txt").read_text().splitlines():
        if line.startswith("## chunk"):
            chunk += 1
        elif line.strip() and not line.startswith("#") and chunk <= chunks:
            out.append(line.strip())
    return out


def resolve(name: str) -> dict | None:
    """The pack's id on the site: an exact name match, else the shortest name that starts with it."""
    q = urllib.parse.urlencode({"draw": 1, "start": 0, "length": 25, "search[value]": name})
    req = urllib.request.Request(f"{SITE}/api/packs/datatables?{q}", headers=UA)
    rows = json.load(urllib.request.urlopen(req, timeout=60))["data"]
    cands = []
    for r in rows:
        m = re.search(r'href="/pack/(\d+)">(.*?)</a>', r[1])
        if m:
            cands.append((html.unescape(m.group(2)), int(m.group(1))))
    hits = [c for c in cands if norm(c[0]) == norm(name)] or [c for c in cands if norm(c[0]).startswith(norm(name))]
    if not hits:
        return None
    best = min(hits, key=lambda c: len(c[0]))
    return {"name": best[0], "id": best[1]}


def download(pack: dict) -> str:
    target = DEST / (pack["name"].replace("/", "-") + ".zip")
    if target.exists() and target.stat().st_size > 0:
        return f"have {pack['name']}"
    part = target.with_suffix(".zip.part")
    done = subprocess.run(["curl", "-sfL", "-C", "-", "--retry", "3", "-A", UA["User-Agent"],
                           f"{SITE}/download/pack/{pack['id']}/", "-o", str(part)])
    if done.returncode == 0 and part.stat().st_size > 1000:
        part.rename(target)
        return f"ok {pack['name']}"
    return f"FAIL({done.returncode}) {pack['name']}"


def main() -> None:
    chunks = int(sys.argv[2]) if sys.argv[1:2] == ["chunk"] else 0
    DEST.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(6) as ex:
        found = list(ex.map(resolve, names(chunks)))
    packs = [p for p in found if p]
    print(len(packs), "of", len(found), "packs found", flush=True)
    with ThreadPoolExecutor(10) as ex:
        for msg in ex.map(download, packs):
            print(msg, flush=True)


if __name__ == "__main__":
    main()
