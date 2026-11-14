---
name: game-art-review
description: Visual quality loop for games. Covers collecting references, capturing the running game from fixed views, and running a critic agent that never edits code and returns concrete defects. Load when judging or improving how a game looks (lighting, materials, terrain, UI, VFX), before calling a visual feature done, or when the user says it "looks AI-made", "looks cheap" or "isn't AAA".
---

# Game art review

The agent can't make a game look good if it can't see it. Every high-quality agent-built game has a **look → compare → fix** loop:
- Critic agents that never touch the build check the renders against real photos.
- When the first pass is mediocre, say so, and have the model pull real reference photos and fix against them.
- Ask it to capture additional views from wherever it needs to verify the quality bar, and to refine against the references until they match.
- Run the game and take screenshots; steer environments and VFX with a single reference image where words fail.

## 1. References first

Make the folder `art/refs/<system>/`, with 3–8 images per system: terrain, water, sky, foliage, characters, UI, VFX.
- **Realism:** real photos. The model can web-search and download them; keep the URLs and licence in `art/refs/SOURCES.md`, and use them only as reference, never shipped.
- **Stylised:** screenshots of the reference games, or concept art from an image model (nano-banana MCP, Meshy text-to-image, GPT Image).
- Write `art/STYLE.md`: 5 adjectives, a palette (hex values), a lighting mood per time of day, silhouette rules, UI tone. Example UI rule: "game UI, not a SaaS dashboard: no Tailwind cards".

## 2. Deterministic capture

Captures must be comparable run to run:
- The game exposes the hooks from `game-debug-tools`: `window.__game.ready`, `window.__game.step(dt)`, `setCamera(name)`, `setTime(hours)` and a seeded RNG.
- Keep named camera bookmarks in a `cameras.json` per scene: `hero-closeup`, `vista`, `ground-level`, `top-down`, `night`, `ui-overlay`.
- A Playwright script loads `?seed=42&capture=1`, waits for ready, steps N frames, then for each bookmark sets the camera, steps 30 frames and screenshots to `artifacts/capture/<date>/<bookmark>.png`.
- Check the GPU in headless Chrome. If `renderer` reports SwiftShader or llvmpipe, warn: the screenshots won't match real hardware.
- For trailers, render frame by frame out of the game with fixed dt, then `ffmpeg -framerate 30 -i f_%05d.png -c:v libx264 -pix_fmt yuv420p out.mp4`. This gives smooth footage even when the game runs below 30 fps.
- Godot: Movie Maker mode `godot --path . --write-movie artifacts/cap.png --fixed-fps 30 --quit-after 300` writes a PNG sequence. It needs a display; on Linux use xvfb.

## 3. Critic agent protocol

Spawn a subagent with **read-only intent**. It must not edit code; it gets the captures, the refs and STYLE.md. Prompt:
```
You are the art director. Compare each capture in artifacts/capture/<date>/ with art/refs/ and
art/STYLE.md. For each capture list up to 5 concrete defects, ordered by visual impact, each with:
where (region/object), what's wrong, which reference shows how it should look, and a suggested
technique. No scores, no praise. Flag "placeholder look" (box buildings, flat untextured ground,
default lighting, plain grey sky, tiling textures, UI that looks like a web app).
```
Builders fix the top defects, recapture, and the critic reviews **once more**; then move on.

## 4. Common AI-game visual defects

| Defect | Usual fix |
|---|---|
| Flat, grey, "default three.js" lighting | HDRI environment + directional sun with soft shadows + AO (GTAO/N8AO) + ACES/AgX tonemapping + light fog/aerial perspective |
| Visible texture tiling | Triplanar or stochastic/hex tiling, macro variation noise, detail normals, decals |
| Untextured procedural geometry | PBR sets from Poly Haven/ambientCG, vertex colour variation, curvature/AO masks |
| Uniform vegetation | Scale/rotation/hue jitter, clustering by noise, wind shader, impostors at distance |
| Shiny plastic look | Roughness variation maps; metalness 0 for non-metals; tone down specular |
| Floaty objects | Contact shadows, AO, decals at the base, ground blending |
| SaaS-looking UI | Diegetic or themed UI, game fonts, 9-slice frames, icons; nothing that looks like a web dashboard |
| Bad audio feel (a common giveaway of AI-made games) | See `game-audio`: real recordings/CC0, layering, ducking |
| Lifeless scene | Ambient motion: birds, particles, cloth/sign sway in wind, water motion, NPC routines |

## 5. Definition of done for a visual feature

- Captures from every bookmark exist and are linked in the PR or PROGRESS.md.
- The critic's top-3 defects are fixed or explicitly deferred.
- Frame time is within budget at the heaviest bookmark (see `game-performance-optimization`).
