# 2D paper-doll sprites: keeping equipment in every animation

**The question:** "When I equip armour, how do I keep it in the animation?"

**The answer:** equipment is not an overlay you draw once. Each item is a **separate sprite layer animated frame-for-frame with the body**, on the same canvas size, frame grid, frame count and tags. The runtime then either stacks the layers in lock-step or bakes them into one sheet when the loadout changes.

Art cost scales as `items × frames`. Keep it down three ways:
- Reuse body frames for skin-tight gear by recolouring (palette swap), not redrawing.
- Limit the directions (4, or 2 + flip).
- Draw only the frames where an item is visible.

## 1. Authoring rules (Aseprite)

- **One `.aseprite` per character archetype.** Layers per slot: `body`, `legs_*`, `torso_*`, `helmet_*`, `cape_back`, `weapon_back`, `weapon_front`, `shield_back`, `shield_front`, plus a hidden `socket`.
- **Tags** (`idle`, `walk`, `attack`, `hurt`) are shared by every layer. Item variants are separate layers, or separate files with an identical canvas and timeline.
- **Z-order that changes with direction** (a shield behind the body when facing away): split the item into `_back` and `_front` layers and leave the unused one empty in those frames. Never re-order layers per frame at runtime.
- **Socket layer:** one marker pixel per frame at the hand or weapon pivot. It is used for items that rotate or vary (guns, torches) instead of being hand-drawn per frame.
- **Recolour-friendly:** draw items with a small indexed palette so tints or palette swaps work (iron/gold/cursed variants).

## 2. Export with an identical layout

`--layer` must come **before** the input file. Never use `--trim`, `--merge-duplicates` or `--sheet-pack` here, because each layer would get a different layout.

```bash
#!/usr/bin/env bash
set -euo pipefail
SRC=art/hero.aseprite; OUT=public/sprites/hero; mkdir -p "$OUT"
aseprite -b --list-layers "$SRC"                     # sanity: prints layer names (keep them space-free)
for L in $(aseprite -b --list-layers "$SRC"); do
  aseprite -b --layer "$L" "$SRC" \
    --sheet "$OUT/$L.png" --sheet-type rows --sheet-columns 8 \
    --data "$OUT/$L.json" --format json-array --list-tags
done
python3 -I tools/sockets.py "$OUT/socket.png" 64 64 > "$OUT/sockets.json"
```

- **One-atlas variant:** fewer textures, better batching. Use `aseprite -b --split-layers "$SRC" --sheet atlas.png --data atlas.json --format json-hash --filename-format '{layer}/{frame}'`, then look frames up as `${layer}/${i}` (check the docs for the token list).
- **Socket extractor** (`tools/sockets.py`, tested with Pillow 12): it outputs `[[x,y] | null, …]` per frame.

```python
import json, sys
from PIL import Image
path, fw, fh = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
img = Image.open(path).convert("RGBA"); W, H = img.size; px = img.load()
cols, rows, out = W // fw, H // fh, []
for i in range(cols * rows):
    ox, oy = (i % cols) * fw, (i // cols) * fh
    out.append(next(([x, y] for y in range(fh) for x in range(fw) if px[ox + x, oy + y][3] > 0), None))
json.dump(out, sys.stdout)
```

## 3a. Runtime: stacked layers (Phaser 4)

This suits few characters and frequent equipment changes. Every layer is a spritesheet with the same frame indices. The body plays the animation, and every other layer copies its frame each tick. For Phaser loader basics see `game-2d`.

```ts
const FW = 64, FH = 64;
type Tag = { name: string; from: number; to: number };
export function preloadDoll(scene: Phaser.Scene, layers: string[]) {
  for (const L of layers) scene.load.spritesheet(L, `sprites/hero/${L}.png`, { frameWidth: FW, frameHeight: FH });
  scene.load.json('hero-tags', 'sprites/hero/body.json');
}
export class PaperDoll extends Phaser.GameObjects.Container {
  body: Phaser.GameObjects.Sprite; gear = new Map<string, Phaser.GameObjects.Sprite>();   // slot → sprite
  constructor(scene: Phaser.Scene, x: number, y: number, order: string[] /* back→front, incl. 'body' */) {
    super(scene, x, y);
    const tags: Tag[] = scene.cache.json.get('hero-tags').meta.frameTags;
    for (const t of tags) if (!scene.anims.exists(t.name))
      scene.anims.create({ key: t.name, frames: scene.anims.generateFrameNumbers('body', { start: t.from, end: t.to }), frameRate: 10, repeat: -1 });
    for (const slot of order) {
      const s = scene.add.sprite(0, 0, slot === 'body' ? 'body' : '__MISSING').setVisible(slot === 'body');
      this.add(s); if (slot === 'body') this.body = s; else this.gear.set(slot, s);
    }
    const sync = (_a: unknown, frame: Phaser.Animations.AnimationFrame) =>
      this.gear.forEach((s) => s.visible && s.setFrame(frame.textureFrame));   // same index on every layer
    this.body.on(Phaser.Animations.Events.ANIMATION_START, sync).on(Phaser.Animations.Events.ANIMATION_UPDATE, sync);
    scene.add.existing(this);
  }
  equip(slot: string, textureKey: string | null) {          // e.g. equip('torso', 'torso_iron')
    const s = this.gear.get(slot)!; s.setVisible(!!textureKey);
    if (textureKey) s.setTexture(textureKey, this.body.frame.name);
  }
  play(tag: string) { this.body.play(tag, true); }
}
```

## 3b. Runtime: bake a composite on equip (any engine)

This suits crowds, MMOs and three.js sprite games: one texture and one draw call per character.

```ts
/** Composite equipped layers (back→front) into one sheet. Optional per-layer tint via 'source-atop'. */
const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h }); // OffscreenCanvas in a worker
export async function bakeDoll(urls: string[], tints: (string | null)[] = []): Promise<HTMLCanvasElement> {
  const imgs = await Promise.all(urls.map(async (u) => createImageBitmap(await (await fetch(u)).blob())));
  const cv = canvas(imgs[0].width, imgs[0].height), ctx = cv.getContext('2d')!;
  const tmp = canvas(cv.width, cv.height), tctx = tmp.getContext('2d')!;
  imgs.forEach((img, i) => {
    tctx.clearRect(0, 0, tmp.width, tmp.height); tctx.globalCompositeOperation = 'source-over'; tctx.drawImage(img, 0, 0);
    if (tints[i]) { tctx.globalCompositeOperation = 'source-atop'; tctx.fillStyle = tints[i]!; tctx.globalAlpha = 0.5; tctx.fillRect(0, 0, tmp.width, tmp.height); tctx.globalAlpha = 1; }
    ctx.drawImage(tmp, 0, 0);
  });
  return cv;
}
```

- **Phaser:** `const tex = scene.textures.addCanvas(key, cv)!`. Then add the frames: `for (i…) tex.add(i, 0, (i % cols) * FW, Math.floor(i / cols) * FH, FW, FH)`. Create anims from `key` with `generateFrameNumbers`. Re-bake only on equip and give each loadout a key (`hero:iron:leather`) so identical loadouts share a texture.
- **three.js:**

```ts
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
const cols = cv.width / 64, rows = cv.height / 64; tex.repeat.set(1 / cols, 1 / rows);
const setFrame = (i: number) => tex.offset.set((i % cols) / cols, 1 - (Math.floor(i / cols) + 1) / rows);
const sprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5 }));
```

  `offset` is per texture. For many characters sharing one baked sheet, use an `InstancedMesh` with a per-instance frame attribute (or `@three.ez/instanced-mesh` per-instance uniforms).

## 4. Godot 4

Use one `AnimationPlayer` that keys a single `doll_frame` property, plus one `Sprite2D` child per slot, all with the same `hframes`/`vframes`. Swapping equipment means swapping `texture`.

```gdscript
extends Node2D
@export var doll_frame := 0:
	set(v):
		doll_frame = v
		for s in get_children():
			if s is Sprite2D: s.frame = v
func equip(slot: String, tex: Texture2D) -> void:
	var s := get_node(slot) as Sprite2D
	s.texture = tex
	s.visible = tex != null
```

Godot imports `.aseprite` via community importers (e.g. "Aseprite Wizard"; check that it's maintained). Otherwise use the CLI export above with `hframes = 8`.

## 5. Weapons via sockets

1. Load `sockets.json`. Each frame, place the weapon sprite at `doll.position + socket[frame] - [FW/2, FH/2]`.
2. Hide the weapon when the entry is `null`.
3. Rotation can come from a second marker pixel (the direction vector between two colours).

Hitboxes come from the same data (see the hitbox section in `three-animation-recipes.md`).

## Verification

- **Layout check:** for every layer JSON, `frames.length === body.frames.length`, `meta.frameTags` are deep-equal, and every `frame` rect equals the body's rect. Fail the build otherwise.
- **Bake check:** pixel-diff one frame per tag of the baked sheet against a stored golden (per loadout). An empty layer (all alpha 0) in a slot that should be visible is an error.
- **Visual:** a Playwright screenshot of a debug scene that shows every loadout × every tag in a grid. Review it once and keep it as the golden.
