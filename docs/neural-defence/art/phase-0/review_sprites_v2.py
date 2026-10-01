"""Concatenate generated sprites for visual review; never alter source assets."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[4]
ASSETS = ROOT / "games/neural-defence/src/assets"
HERE = Path(__file__).resolve().parent
TEAMS = ["blue", "coral", "green", "gold"]
NAMES = [f"brain-{team}" for team in TEAMS] + [f"neuron-{team}" for team in TEAMS] + ["tower-experimental", "particle-builder", "particle-attack"]

def paste(canvas, path, xy, size):
    sprite = Image.open(path).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    canvas.paste(sprite, xy, sprite)

sheet = Image.new("RGB", (1200, 1020), (12, 23, 43))
draw = ImageDraw.Draw(sheet)
for i, name in enumerate(NAMES):
    x, y = (i % 4) * 300, (i // 4) * 340
    path = ASSETS / f"{name}-v2.png"
    sprite = Image.open(path)
    alpha = sprite.getchannel("A")
    print(path.name, sprite.mode, sprite.size, "alpha", alpha.getextrema(), "bounds", alpha.getbbox())
    draw.text((x + 15, y + 12), name, fill=(186, 225, 255))
    paste(sheet, path, (x + 30, y + 37), 240)
    small = 14 if name.startswith("particle") else 50
    paste(sheet, path, (x + 80, y + 285), small)
    draw.text((x + 140, y + 303), f"{small}px", fill=(186, 225, 255))
sheet.save(HERE / "sprites-v2-review.png")

pair = Image.new("RGB", (800, 490), (12, 23, 43))
draw = ImageDraw.Draw(pair)
for i, name in enumerate(["neuron-blue", "brain-blue"]):
    path = ASSETS / f"{name}-v2.png"
    draw.text((30 + i * 400, 15), name.upper(), fill=(186, 225, 255))
    paste(pair, path, (30 + i * 400, 35), 340)
    paste(pair, path, (110 + i * 400, 403), 50)
    draw.text((180 + i * 400, 420), "50px", fill=(186, 225, 255))
pair.save(HERE / "blue-pair-v2-review.png")
