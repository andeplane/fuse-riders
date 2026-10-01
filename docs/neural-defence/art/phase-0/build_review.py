"""Build exact reusable overlays and concatenate individual sprite candidates.

This is an art-review utility, not game code. Pillow is required. Generated world
sprites are read without modifying their source files. Run --overlays-only while
image generation is in progress; the complete sheet refuses missing core assets.
"""

from pathlib import Path
import argparse
import json
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SPRITES = ROOT / "sprites"
OVERLAYS = ROOT / "overlays"
WORLD = [
    "terrain-open", "terrain-blocked", "deposit-biomass", "deposit-insight",
    "brain", "brain-active", "brain-damaged", "neuron", "neuron-active",
    "neuron-damaged", "neuron-disconnected", "construction-site",
    "construction-site-damaged",
]
PARTICLES = [
    "particle-assault", "particle-assault-researched", "particle-guard",
    "particle-guard-researched", "axon-link", "axon-link-broken",
    "research-growth-efficiency", "research-excitation", "research-insulation",
    "effect-pulse", "effect-destruction",
]
OVERLAY_NAMES = [
    "overlay-selection", "overlay-hover", "overlay-build-valid",
    "overlay-build-invalid", "overlay-queued", "overlay-priority",
    "icon-refit", "icon-recovery",
]
HEX = [(256, 32), (450, 144), (450, 368), (256, 480), (62, 368), (62, 144)]


def font(size):
    for name in ("/System/Library/Fonts/Supplemental/Arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def make_overlays():
    OVERLAYS.mkdir(parents=True, exist_ok=True)
    for name in OVERLAY_NAMES:
        canvas = Image.new("RGBA", (512, 512))
        draw = ImageDraw.Draw(canvas)
        elements = []

        def line(points, color, width=8):
            draw.line(points, fill=color, width=width, joint="curve")
            pts = " ".join(f"{x},{y}" for x, y in points)
            elements.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round"/>')

        def circle(box, color, width=8):
            draw.ellipse(box, outline=color, width=width)
            x0, y0, x1, y1 = box
            elements.append(f'<ellipse cx="{(x0+x1)/2}" cy="{(y0+y1)/2}" rx="{(x1-x0)/2}" ry="{(y1-y0)/2}" fill="none" stroke="{color}" stroke-width="{width}"/>')

        if name.startswith("overlay-"):
            color = {
                "overlay-selection": "#fff0a6", "overlay-hover": "#eef9ff",
                "overlay-build-valid": "#4edaa0", "overlay-build-invalid": "#ff797f",
                "overlay-queued": "#9fb9e8", "overlay-priority": "#ffd173",
            }[name]
            if name == "overlay-selection":
                line(HEX + [HEX[0]], "#27374d", 17)
                line(HEX + [HEX[0]], color, 8)
            elif name == "overlay-queued":
                for a, b in zip(HEX, HEX[1:] + HEX[:1]):
                    for j in range(0, 8, 2):
                        p = tuple(round(a[k] + (b[k] - a[k]) * j / 8) for k in (0, 1))
                        q = tuple(round(a[k] + (b[k] - a[k]) * (j + 1) / 8) for k in (0, 1))
                        line([p, q], color, 7)
            else:
                line(HEX + [HEX[0]], color, 5 if name == "overlay-hover" else 8)
            if name == "overlay-build-valid":
                line([(218, 256), (246, 284), (299, 225)], color, 13)
            elif name == "overlay-build-invalid":
                line([(224, 224), (288, 288)], color, 13)
                line([(288, 224), (224, 288)], color, 13)
            elif name == "overlay-priority":
                line([(212, 305), (256, 263), (300, 305)], color, 10)
                line([(212, 259), (256, 217), (300, 259)], color, 10)
        elif name == "icon-refit":
            for start, end in ((-140, 25), (40, 205)):
                pts = [(round(256 + 136 * math.cos(math.radians(a))), round(256 + 136 * math.sin(math.radians(a)))) for a in range(start, end + 1, 3)]
                line(pts, "#d6e8f7", 16)
                x, y = pts[-1]
                line([(x - 34, y - 22), (x, y), (x + 2, y - 40)], "#d6e8f7", 16)
        else:
            circle((112, 112, 400, 400), "#d6e8f7", 15)
            line([(256, 154), (256, 256), (327, 295)], "#d6e8f7", 16)
        canvas.save(OVERLAYS / f"{name}.png")
        (OVERLAYS / f"{name}.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' + "".join(elements) + '</svg>\n')


def paint_asset(board, asset_path, box, overlay=False):
    image = Image.open(asset_path).convert("RGBA")
    image.thumbnail((box[2] - box[0], box[3] - box[1]), Image.Resampling.LANCZOS)
    board.alpha_composite(image, (box[0] + (box[2]-box[0]-image.width)//2, box[1] + (box[3]-box[1]-image.height)//2))
    if overlay:
        ring = Image.open(OVERLAYS / "overlay-selection.png").convert("RGBA")
        ring.thumbnail((box[2]-box[0], box[3]-box[1]), Image.Resampling.LANCZOS)
        board.alpha_composite(ring, (box[0]+(box[2]-box[0]-ring.width)//2, box[1]+(box[3]-box[1]-ring.height)//2))


def sheet(items, filename, title, columns=5):
    cell_w, cell_h, gutter, header = 286, 316, 18, 115
    rows = math.ceil(len(items) / columns)
    width = gutter + columns * (cell_w + gutter)
    height = header + rows * (cell_h + gutter)
    board = Image.new("RGBA", (width, height), "#dbe4ed")
    draw = ImageDraw.Draw(board)
    draw.text((22, 18), title, fill="#162636", font=font(30))
    draw.text((22, 61), "Individual saved files | candidate art, not a production atlas | selected states use a shared overlay", fill="#41556b", font=font(17))
    for index, (label, path, selected) in enumerate(items):
        x = gutter + (index % columns) * (cell_w + gutter)
        y = header + (index // columns) * (cell_h + gutter)
        draw.rounded_rectangle((x, y, x + cell_w, y + cell_h), radius=12, fill="#b6c5d3", outline="#8a9bab", width=2)
        paint_asset(board, path, (x + 12, y + 8, x + cell_w - 12, y + 265), selected)
        pieces = label.split("-")
        lines, current = [], ""
        for piece in pieces:
            candidate = f"{current} {piece}".strip()
            if len(candidate) > 27:
                lines.append(current)
                current = piece
            else:
                current = candidate
        lines.append(current)
        for row, line_text in enumerate(lines[:2]):
            draw.text((x + 10, y + 269 + 19 * row), line_text, font=font(16), fill="#162636")
    board.convert("RGB").save(ROOT / filename)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--overlays-only", action="store_true")
    args = parser.parse_args()
    make_overlays()
    if args.overlays_only:
        print("Created eight reusable overlays as individual SVG and PNG files.")
        return
    required = WORLD + PARTICLES
    missing = [name for name in required if not (SPRITES / f"{name}.png").exists()]
    if missing:
        raise SystemExit("Missing required sprite files: " + ", ".join(missing))
    metadata = []
    for name in required:
        path = SPRITES / f"{name}.png"
        with Image.open(path) as im:
            alpha = im.convert("RGBA").getchannel("A")
            metadata.append({"asset": name, "size": list(im.size), "mode": im.mode, "alpha_extrema": list(alpha.getextrema()), "has_transparent_pixels": alpha.getextrema()[0] < 255})
    (ROOT / "asset-inspection.json").write_text(json.dumps(metadata, indent=2) + "\n")
    world = [(name, SPRITES / f"{name}.png", False) for name in WORLD]
    particles = [(name, SPRITES / f"{name}.png", False) for name in PARTICLES]
    if (SPRITES / "builder-proposed.png").exists():
        particles.append(("builder-PROPOSED-not-approved", SPRITES / "builder-proposed.png", False))
    overlays = [(name, OVERLAYS / f"{name}.png", False) for name in OVERLAY_NAMES]
    selections = [(f"selected-{name}", SPRITES / f"{name}.png", True) for name in ("brain", "neuron", "deposit-biomass", "construction-site")]
    sheet(world, "individual-world-review.png", "Neural Defence / individual world sprites", 4)
    sheet(particles, "individual-particles-review.png", "Neural Defence / particles, research and effects", 4)
    sheet(world + particles + overlays + selections, "individual-sprite-review.png", "Neural Defence / Phase 0 individual asset review", 5)
    sheet(selections, "selection-overlay-review.png", "One reusable selection overlay / four object kinds", 4)
    print(f"Inspected {len(required)} required sprites; built contact sheets from those individual files.")


if __name__ == "__main__":
    main()
