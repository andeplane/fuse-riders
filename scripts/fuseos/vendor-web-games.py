#!/usr/bin/env python3
"""Vendors the browser games in Programs > Games that are open source web apps.

- SkiFree: https://github.com/basicallydan/skifree.js (MIT). The prebuilt
  dist/skifree.js, sprites and stylesheets are copied; index.html is rewritten
  without the analytics snippet and the GitHub banners (no inline scripts, so
  the page runs under a strict content security policy too).
- Micropolis: https://github.com/graememcc/micropolisJS (GPL-3.0 with the
  Micropolis Public Name License). The repo has no prebuilt output, so it is
  built with its own webpack toolchain in a temporary folder (needs node, npm
  and network access) and the dist folder is copied. The inline scripts are
  moved to hasscript.js and the Twitter widget is dropped.

- Solitaire: the game itself is native (src/games/solitaire); only the card
  faces are vendored, from https://github.com/notpeter/Vector-Playing-Cards
  (Byron Knoll's vector playing cards, public domain). The court card SVGs
  are up to 1 MB each, so the 52 faces are rasterised with rsvg-convert
  (librsvg, `brew install librsvg`) into one sprite sheet, cards.png, 13
  columns (A..K) by 4 rows (clubs, diamonds, hearts, spades) of 142x192 px
  (twice the 71x96 Windows card size).

All land under public/fuseos/retro/<game>/, their licence files under
docs/fuseos/licenses/<game>/, and are committed so `pnpm build` needs neither
network nor a second toolchain.

Usage: python3 scripts/fuseos/vendor-web-games.py [--only skifree|micropolis|solitaire]
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
GAMES_DIR = ROOT / 'public' / 'fuseos' / 'retro'


# Licence and readme texts go next to the credits, not into public/: they are
# documentation, not assets the game pages load.
DOCS_DIR = ROOT / 'docs' / 'fuseos' / 'licenses'


def move_docs(target: Path, docs: Path, names: tuple[str, ...]) -> None:
    docs.mkdir(parents=True, exist_ok=True)
    for name in names:
        source = target / name
        if source.exists():
            shutil.move(str(source), str(docs / Path(name).name))

SKIFREE_URL = 'https://codeload.github.com/basicallydan/skifree.js/zip/refs/heads/master'
MICROPOLIS_URL = 'https://codeload.github.com/graememcc/micropolisJS/zip/refs/heads/main'
CARDS_URL = 'https://codeload.github.com/notpeter/Vector-Playing-Cards/zip/refs/heads/master'

# Sprite sheet layout, mirrored by src/games/solitaire/cardArt.tsx.
CARD_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
CARD_SUITS = ['C', 'D', 'H', 'S']
CARD_SPRITE_WIDTH = 142
CARD_SPRITE_HEIGHT = 192

SKIFREE_INDEX = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>SkiFree.js</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=0" />
    <link rel="stylesheet" href="css/normalize.css" />
    <link rel="stylesheet" href="css/main.css" />
    <link rel="stylesheet" href="css/skifree.css" />
  </head>
  <body>
    <canvas id="skifree-canvas" tabindex="0"></canvas>
    <script src="skifree.js"></script>
  </body>
</html>
"""

HASSCRIPT_JS = """// Marks the page as script capable (was an inline script upstream; inline scripts are blocked by CSP).
[].forEach.call(document.querySelectorAll('[data-hasscript]'), function (elem) {
  elem.setAttribute('data-hasscript', 'true');
});
"""


def download(url: str) -> Path:
    print(f'Downloading {url}')
    target = Path(tempfile.mkdtemp()) / 'source.zip'
    with urllib.request.urlopen(url) as response:
        target.write_bytes(response.read())
    return target


def extract(archive: Path) -> Path:
    folder = archive.parent / 'src'
    with zipfile.ZipFile(archive) as source:
        source.extractall(folder)
    return next(child for child in folder.iterdir() if child.is_dir())


def replace_tree(source: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source, target)


def vendor_skifree() -> None:
    repo = extract(download(SKIFREE_URL))
    target = GAMES_DIR / 'skifree'
    if target.exists():
        shutil.rmtree(target)
    (DOCS_DIR / 'skifree').mkdir(parents=True, exist_ok=True)
    target.mkdir(parents=True)
    (target / 'css').mkdir()
    # Not under dist/: .gitignore ignores every dist folder, which is how skifree.js once went missing.
    shutil.copy(repo / 'dist' / 'skifree.js', target / 'skifree.js')
    for stylesheet in ('normalize.css', 'main.css', 'skifree.css'):
        shutil.copy(repo / 'css' / stylesheet, target / 'css' / stylesheet)
    for sprite in ('sprite-characters.png', 'skifree-objects.png'):
        shutil.copy(repo / sprite, target / sprite)
    shutil.copy(repo / 'license.md', DOCS_DIR / 'skifree' / 'LICENSE.md')
    shutil.copy(repo / 'README.md', DOCS_DIR / 'skifree' / 'README.md')
    (target / 'index.html').write_text(SKIFREE_INDEX)
    print(f'Vendored SkiFree into {target.relative_to(ROOT)}')


def build_micropolis(repo: Path) -> Path:
    config = repo / 'webpack.config.js'
    text = config.read_text()
    # The build id comes from `git log` on the main branch; a zip download has no git history.
    text = re.sub(r'function getBuildId\(\) \{.*?\n\}', 'function getBuildId() {\n  return "vendored";\n}', text, count=1, flags=re.S)
    config.write_text(text)
    subprocess.run(['npm', 'ci', '--no-audit', '--no-fund'], cwd=repo, check=True)
    subprocess.run(['npx', 'webpack', '--mode', 'production'], cwd=repo, check=True)
    return repo / 'dist'


def patch_micropolis_html(target: Path) -> None:
    index = target / 'index.html'
    html = index.read_text()
    html = re.sub(r'<div id="tw".*?</div>', '', html, count=1, flags=re.S)
    html = re.sub(r'<script>// If we got here.*?</script>', '<script src="hasscript.js"></script>', html, count=1, flags=re.S)
    html = re.sub(r'(src="src/micropolis\.js)\?[0-9a-f]+"', r'\1"', html)
    if '<script>' in html:
        raise SystemExit('micropolis index.html still has an inline script')
    index.write_text(html)
    (target / 'hasscript.js').write_text(HASSCRIPT_JS)


def vendor_micropolis() -> None:
    repo = extract(download(MICROPOLIS_URL))
    dist = build_micropolis(repo)
    target = GAMES_DIR / 'micropolis'
    replace_tree(dist, target)
    move_docs(target, DOCS_DIR / 'micropolis', ('LICENSE', 'COPYING', 'README.md', 'css/FONT_LICENSE.markdown', 'src/micropolis.js.LICENSE.txt'))
    shutil.copy(repo / 'MicropolisPublicNameLicense.md', DOCS_DIR / 'micropolis' / 'MicropolisPublicNameLicense.md')
    shutil.copy(repo / 'README.md', DOCS_DIR / 'micropolis' / 'README.md')
    patch_micropolis_html(target)
    print(f'Vendored Micropolis into {target.relative_to(ROOT)}')


def card_sheet_svg(cards: Path) -> str:
    """One SVG placing the 52 card files on a grid; librsvg resolves the references next to it."""
    width, height = CARD_SPRITE_WIDTH, CARD_SPRITE_HEIGHT
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width * len(CARD_RANKS)}" height="{height * len(CARD_SUITS)}">']
    for row, suit in enumerate(CARD_SUITS):
        for column, rank in enumerate(CARD_RANKS):
            if not (cards / f'{rank}{suit}.svg').exists():
                raise SystemExit(f'Vector-Playing-Cards has no {rank}{suit}.svg')
            lines.append(f'<image x="{column * width}" y="{row * height}" width="{width}" height="{height}" xlink:href="{rank}{suit}.svg"/>')
    lines.append('</svg>')
    return '\n'.join(lines)


def vendor_solitaire() -> None:
    if shutil.which('rsvg-convert') is None:
        raise SystemExit('rsvg-convert is needed to rasterise the cards (brew install librsvg)')
    repo = extract(download(CARDS_URL))
    cards = repo / 'cards-svg'
    sheet = cards / 'sheet.svg'
    sheet.write_text(card_sheet_svg(cards))
    target = GAMES_DIR / 'solitaire'
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    subprocess.run(['rsvg-convert', str(sheet), '-o', str(target / 'cards.png')], check=True)
    docs = DOCS_DIR / 'solitaire'
    docs.mkdir(parents=True, exist_ok=True)
    shutil.copy(repo / 'README.md', docs / 'VECTOR-PLAYING-CARDS-README.md')
    print(f'Vendored the Solitaire card faces into {target.relative_to(ROOT)}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--only', choices=['skifree', 'micropolis', 'solitaire'])
    args = parser.parse_args()
    GAMES_DIR.mkdir(parents=True, exist_ok=True)
    if args.only in (None, 'skifree'):
        vendor_skifree()
    if args.only in (None, 'micropolis'):
        vendor_micropolis()
    if args.only in (None, 'solitaire'):
        vendor_solitaire()
    return 0


if __name__ == '__main__':
    sys.exit(main())
