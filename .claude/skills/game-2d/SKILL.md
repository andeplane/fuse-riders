---
name: game-2d
description: Load when building a 2D or 2.5D game (platformer, top-down, roguelike, puzzle, bullet hell, isometric, card/board) in the browser, Godot or Unity, or when deciding whether a game idea should be 2D at all. Covers picking Phaser 4 / PixiJS v8 / KAPLAY / Excalibur / spryte / three.js-orthographic, Tiled and LDtk tilemaps, a pixel-art pipeline (Aseprite CLI, palettes, PixelLab / Retro Diffusion) and 2D physics.
---

# 2D games: engine, tilemaps, pixel art, physics

Agents ship 2D games faster than 3D ones. Assets are cheap, state fits in a few numbers, a screenshot shows everything, and there is no camera to fight. Start in 2D unless the idea needs depth.

## 1. Should this game be 2D? (decide first)

| Signal | Go 2D | Go 3D |
|---|---|---|
| Core verb | jump, dodge, aim on a plane, match, place tiles | look around, climb, traverse a big space, vehicle physics |
| Art you can actually produce | pixel art / vector / AI sprites with one palette | photoscans, procedural meshes, Tripo/Meshy + Blender cleanup |
| Scope | jam, mobile, portal (Poki/CrazyGames), Discord activity | open world, sim, "AAA look" |
| Readability | many units, bullets, UI-heavy, tactics | atmosphere, lighting, scale |
| Agent verification | `render_game_to_text` holds the whole state | needs multiple camera views and art review |

**2.5D middle path:** for a 3D look with 2D gameplay, keep the sim in 2D (x/y grid) and render it with three.js (orthographic or low-FOV perspective camera, billboards, or low-poly meshes). The sim stays testable and the look stays 3D.

## 2. When to use what

| Need | Pick | Why | Don't use when |
|---|---|---|---|
| Full 2D game, batteries included | **Phaser 4.2** (`phaser@4.2.1`, MIT, ~40k★) | Scenes, loader, Arcade + Matter physics, tilemaps, tweens, particles, cameras. New WebGL renderer, Filters, `SpriteGPULayer` (1M sprites), `TilemapGPULayer` (4096² tiles in one quad). Ships its own agent skills. | You want WebGPU (Phaser 4 is WebGL; Canvas is deprecated), or you only need a renderer |
| Renderer only, own architecture | **PixiJS 8.22** (`pixi.js`, MIT, ~48k★) | WebGPU or WebGL, scene graph, filters, text, ParticleContainer. Official `pixijs/pixijs-skills`. | You want physics, tilemaps and scenes out of the box (add them yourself) |
| 1-hour prototype, game jam, kids-friendly | **KAPLAY 3001** (`kaplay`, MIT, ~1.8k★) | Kaboom successor: `add([sprite(), pos(), area(), body()])`. Very short code. | Big games, heavy perf (v4000 is still alpha) |
| TypeScript-first engine with built-in Tiled/LDtk plugins | **Excalibur 0.32** (`excalibur`, BSD-2, ~2.4k★) | Typed ECS-ish actors, collision, `@excaliburjs/plugin-tiled` / `plugin-ldtk` | You need the biggest ecosystem/tutorial base (Phaser) |
| Max sprites, tiny bundle, immediate-mode | **spryte 0.11** (`spryte`, MIT, part of `debuffjp/debuff`) | ~11 kB WebGL2 renderer with Canvas2D fallback. 2dbench claims 2-4x PixiJS sprite throughput. Has Phaser and PixiJS adapters. | You need stability: alpha, repo ~2★, API changes before 1.0 |
| Whole toolkit built for agents | **debuff 0.9** (`npm create debuff@latest`) | spryte + fixed step + seeded RNG + Tiled/LDtk + dev panel + MCP server so the agent plays the game | Production games today (early, tiny community); learn from its ideas instead |
| 2D inside an existing three.js game (HUD minigame, 2.5D) | **three.js** `OrthographicCamera` + `Sprite`/instanced quads | One renderer, one asset pipeline | A pure 2D game (Phaser/Pixi give you far more 2D tooling) |
| Native/desktop/console 2D | **Godot 4** (`TileMapLayer`, `CharacterBody2D`, `AnimatedSprite2D`) | Best free 2D editor; exports to web too | You need a tiny web bundle (Godot web export is MBs) |
| Unity team | **Unity 6 2D** (Tilemap, Rule Tiles, 2D Animation, URP 2D lights) | Existing team skills | Web-first jams (WebGL builds are heavy) |

## 3. Recipes (default: Vite + TS)

### Phaser 4: pixel-art platformer skeleton with Tiled map + Arcade physics
```bash
npm create @phaserjs/game@latest   # official templates (Vite/React/Vue/...); or: npm i phaser@4.2.1
```
```ts
import Phaser from "phaser";

class Level extends Phaser.Scene {
  player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  preload() {
    this.load.tilemapTiledJSON("map", "maps/level1.json");    // Tiled: export JSON, embed tilesets
    this.load.image("tiles", "tiles/tileset.png");
    this.load.aseprite("hero", "sprites/hero.png", "sprites/hero.json"); // see pixel-art reference
  }
  create() {
    const map = this.make.tilemap({ key: "map" });
    const tiles = map.addTilesetImage("tileset", "tiles")!;      // first arg = tileset name inside Tiled
    const ground = map.createLayer("Ground", tiles, 0, 0)!;
    ground.setCollisionByProperty({ collides: true });         // custom bool property set in Tiled
    this.anims.createFromAseprite("hero");                      // one anim per Aseprite tag
    this.player = this.physics.add.sprite(32, 32, "hero").play({ key: "idle", repeat: -1 });
    this.physics.add.collider(this.player, ground);
    this.cameras.main.startFollow(this.player, true).setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,            // WebGL; Canvas fallback is deprecated in v4
  width: 320, height: 180,      // low internal res, scaled up
  pixelArt: true,               // nearest filtering
  roundPixels: true,            // v4 default is false (was true in v3)
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: "arcade", arcade: { gravity: { x: 0, y: 900 }, debug: false } },
  scene: [Level],
});
```
- Huge static backgrounds: `map.createLayer(name, tiles, 0, 0, true)` (the `gpu` flag) returns a `TilemapGPULayer`. Orthographic only, one tileset image. Call `generateLayerDataTexture()` after edits. Check the docs for the exact signature.
- Phaser 4 effects are **Filters** on any object or camera: `obj.filters.internal.add…()` / `.external.add…()` (e.g. `addMask`, `addBlend`). Check each filter's method name in the docs. `preFX`/`postFX`, `BitmapMask`, `setTintFill`, `Geom.Point`, `Mesh`/`Plane` and `setPipeline('Light2D')` are gone (use `setTint().setTintMode(Phaser.TintModes.FILL)`, `Vector2`, `setLighting(true)`).
- Migrating a v3 game: point the agent at Phaser's bundled `skills/v3-to-v4-migration/SKILL.md`.

### PixiJS v8: pixel-perfect setup
```ts
import { Application, Assets, Sprite, TextureSource } from "pixi.js";

TextureSource.defaultOptions.scaleMode = "nearest";      // before loading textures
const app = new Application();
await app.init({ width: 320, height: 180, background: "#111", antialias: false,
                 roundPixels: true, preference: "webgpu" }); // falls back to WebGL
document.body.appendChild(app.canvas);                    // v8: app.canvas (not app.view)
app.canvas.style.imageRendering = "pixelated";
const tex = await Assets.load("sprites/hero.png");
const hero = new Sprite(tex);
app.stage.addChild(hero);
app.ticker.add((t) => { hero.x += 1 * t.deltaTime; });   // deltaTime is frame-scaled, not ms
```
- v8 init is **async** (`await app.init`). The v7 constructor options and `PIXI.` globals in old tutorials are wrong.
- Tilemaps: `@pixi/tilemap@5` (v8-compatible) or draw chunks into `RenderTexture`s. Thousands of moving sprites: `ParticleContainer` + `Particle`.
- Aseprite JSON loads as a Pixi `Spritesheet` (`--format json-hash`), but Pixi reads `meta.animations`, not Aseprite `frameTags`. Build `AnimatedSprite` frame lists from `frameTags` yourself (see reference).

### KAPLAY: fastest prototype
```ts
import kaplay from "kaplay";
kaplay({ width: 320, height: 180, letterbox: true, crisp: true });
loadSprite("bean", "sprites/bean.png");
setGravity(1600);
const p = add([sprite("bean"), pos(40, 40), area(), body()]);
add([rect(320, 16), pos(0, 164), area(), body({ isStatic: true })]);
onKeyPress("space", () => p.isGrounded() && p.jump(500));
```
Prototype in KAPLAY, then port to Phaser if the game grows past ~10 scenes or needs tilemap tooling.

### three.js: pixel-perfect orthographic 2D/2.5D
```ts
const VIEW_W = 320, VIEW_H = 180;
const camera = new THREE.OrthographicCamera(0, VIEW_W, VIEW_H, 0, -100, 100); // 1 unit = 1 px
renderer.setPixelRatio(1);
renderer.setSize(VIEW_W, VIEW_H, false);           // render at native res...
renderer.domElement.style.cssText = "width:100%;height:100%;image-rendering:pixelated;object-fit:contain";
tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
// snap: mesh.position.set(Math.round(x), Math.round(y), z) for sprites that should not shimmer
```
For thousands of sprites use one `InstancedMesh` of quads with a per-instance UV offset attribute. Don't create thousands of `THREE.Sprite`s (one draw call each).

## 4. Tilemaps: Tiled vs LDtk

| | **Tiled** (mapeditor/tiled, GPL-2 app, ~13k★) | **LDtk** (deepnight/ldtk, MIT, ~4.3k★) |
|---|---|---|
| Best for | Any engine. Isometric/hex maps, object layers, tile animations | Side-view/top-down levels with **entities**, IntGrid collision, rule-based auto-tiling, multi-level "worlds" |
| Phaser | Native: `load.tilemapTiledJSON` | Not native. Parse the `.ldtk` JSON (or use "Super simple export": PNG per layer + CSV IntGrid) |
| PixiJS | `@pixi/tilemap` + your parser | Same, parse JSON |
| Excalibur | `@excaliburjs/plugin-tiled` | `@excaliburjs/plugin-ldtk` |
| debuff | built-in importer | built-in importer |
| Godot 4 | **YATI** (Kiamo2/YATI) importer | **heygleeson/godot-ldtk-importer** (MIT) |
| Unity | SuperTiled2Unity (check maintenance) | LDtkToUnity (check maintenance) |

Rules: one tileset image per layer where possible. Embed tilesets in Tiled JSON (external `.tsx` breaks Phaser). Put collision in a custom property (`collides`) or a separate IntGrid layer, never in art layers. For procedural levels, generate the same JSON shape your loader eats, so hand-made and generated levels share one code path. Full loader code: `references/tilemaps.md`.

## 5. Pixel-art pipeline (summary; details in `references/pixel-art-pipeline.md`)

1. **Fix the canvas and palette first.** Choose an internal resolution (320×180 or 480×270, which scale cleanly to 1080p) and one palette (Lospec, 16-32 colours). Write it to `art/palette.hex`.
2. **Source sprites:** hand-drawn in Aseprite or Pixelorama (MIT, Godot-based), or AI:
   - **PixelLab** (pixellab.ai): hosted MCP at `https://api.pixellab.ai/mcp` (Bearer token) with `create_character` (4/8 directions), `animate_character`, `create_tileset` (Wang), `create_isometric_tile`.
   - **Retro Diffusion** (retrodiffusion.ai): REST `POST https://api.retrodiffusion.ai/v2/inferences` (header `X-RD-Token`, async task polling), `input_palette` to force your palette, `remove_bg`, `tile_x/tile_y`. Hosted MCP at `https://mcp.retrodiffusion.ai/mcp`. Paid per image.
   - Generic image models (GPT-image, Gemini, Flux) give "pixel-ish" art with off-grid pixels and stray colours. Always run them through grid-snap + palette quantize.
3. **Export with the Aseprite CLI** (`aseprite -b`): sheet + JSON with tags. Aseprite is a paid EULA product (source-available), so CI needs a licensed binary. LibreSprite (GPL fork) and Pixelorama export sheets too.
4. **Enforce:** run `scripts/check-palette.mjs` (reference) in CI. It fails on off-palette pixels and partial alpha.
5. **Import:** Phaser `load.aseprite` + `anims.createFromAseprite`. Godot: Aseprite Wizard (viniciusgerevini/godot-aseprite-wizard, MIT). Pixi: build frames from `frameTags`.

## 6. Physics hooks

| Need | Web pick | Godot | Notes |
|---|---|---|---|
| Platformer/top-down, AABB | **Phaser Arcade** or hand-rolled tile collision | `CharacterBody2D.move_and_slide()` | Fastest, most predictable. Use for 90% of 2D games |
| Rigid bodies, ragdolls, joints, stacking | **Matter.js** (in Phaser: `physics: { default: "matter" }`) or **Box2D v3** (`phaser-box2d`, or `box2d3-wasm` 66★, unverified licence) | GodotPhysics2D or **Rapier 2D** addon (appsinacup/godot-rapier-physics, MIT, ~1k★) | Matter is slower and jittery when stacking. Box2D v3 is the quality pick |
| Deterministic (replays, rollback netcode) | **`@dimforge/rapier2d-deterministic-compat`** 0.21 | Rapier addon (enhanced-determinism builds) | Matter/Arcade are not cross-machine deterministic. Fixed step required |
| Lightweight Box2D-like | `planck` 1.5 (MIT) | n/a | Box2D v2.x port, pure JS |

Godot's built-in **Jolt is 3D only**. 2D still uses GodotPhysics2D unless you add Rapier.

Always step physics on a **fixed timestep** (accumulator, 60 Hz) and render with interpolation. Variable-dt physics tunnels and breaks replays (see `game-debug-tools`).

## 7. Pitfalls agents hit

- **Phaser 3 code in a Phaser 4 project.** `preFX`/`postFX`, `setPipeline`, `BitmapMask`, `Geom.Point`, `setTintFill` and `Mesh` are gone. Check `package.json` before writing code.
- **PixiJS v7 patterns** (`new Application({...})` with sync init, `app.view`, `PIXI.Loader`, `BaseTexture`) break in v8.
- **Blurry pixels:** forgot nearest filtering, non-integer scale, `devicePixelRatio` scaling the canvas, or sub-pixel camera positions. Use integer zoom, `image-rendering: pixelated`, `roundPixels`, and snapped camera scroll.
- **Tile seams/bleeding:** extrude tileset edges by 1-2 px (Tiled can't do it; use the Aseprite/TexturePacker extrude option or `tile-extruder`) and set margin/spacing to match. Phaser's `TilemapGPULayer` avoids seams.
- **Animation names drift** between Aseprite tags and code. Generate a `animations.ts` enum from the exported JSON.
- **Physics in `update(dt)` with variable dt:** jumps differ by frame rate. Use a fixed step and gravity in px/s².
- **AI sprite inconsistency:** each generation changes proportions. Use reference images (PixelLab characters, Retro Diffusion reference images) and keep a frozen "model sheet".
- **Licensing:** Aseprite binary is not redistributable. Tiled app is GPL, but maps you make are yours. Check PixelLab and Retro Diffusion terms for commercial use on your plan. Kenney 2D packs are CC0.

## 8. Verification (prove it works)

1. Expose `window.__game` with `state()` returning player x/y/vx/vy, grounded, scene, score, and `step(n)` (contract in `game-debug-tools`).
2. **Physics numeric check:** step 120 frames holding Right, assert `vx` reaches max speed and the player never overlaps a solid tile (`during` invariant). Jump apex height within ±2 px of the design value.
3. **Tilemap check:** the count of collidable tiles loaded equals the count in the JSON. Spawn and goal entities exist.
4. **Pixel check:** a Playwright screenshot at 1× internal res, with integer-scaled output compared to a baseline (`toHaveScreenshot`, fixed seed). `check-palette.mjs` passes on all sprites.
5. **Perf:** 2× the expected enemy/bullet count holds 60 fps on a throttled CPU (Chrome DevTools MCP trace).

## 9. Install instead of reinventing

- Phaser's own skills: the `skills/` folder in `phaserjs/phaser` (subsystems + v3→v4 migration). Listed on claudemarketplaces as `phaserjs/phaser`.
- `npx skills add https://github.com/pixijs/pixijs-skills` (25 PixiJS v8 skills, MIT).
- `npx skills add gamedev-skills/awesome-gamedev-agent-skills` (Apache-2.0, ~5.3k★): `phaser-core`, `phaser-arcade-physics`, `pixijs-rendering`, `godot-2d-movement`, `godot-tilemap`, `unity-tilemap-2d`, `game-feel`.
- `thedivergentai/gd-agentic-skills`: `godot-tilemap-mastery`, `godot-2d-animation`.
- `npx skills add playableintelligence/game-creator` (Phaser 3 + three.js game skills, includes `retrodiffusion`).
- `npx skills add debuffjp/debuff --skill debuff` (if you adopt debuff).
- Related skills in this set: `game-debug-tools` (state hooks, deterministic step), `game-audio`, `game-asset-pipeline` (sprite sources), `game-design-fun` (juice).
