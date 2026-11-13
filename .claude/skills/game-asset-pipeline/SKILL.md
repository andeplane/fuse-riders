---
name: game-asset-pipeline
description: Decide where every 3D model, texture, animation, sprite and sound comes from (procedural code, CC0 library, AI generation, Blender scripts) and how it gets cleaned and imported. Load when a game needs props, characters, buildings or textures, when setting up Blender/Tripo/Meshy, or when assets look bad or tank performance.
---

# Game asset pipeline

Two rules: **give every tool one job**, and **reach for procedural code and CC0 before AI generation.** Many of the best-looking browser games contain no AI-generated meshes at all.

## Decision order (per asset)

1. **Procedural in code.** Use it for terrain, rocks, trees and plants (L-systems or space colonisation + photoscanned bark), buildings from grammars or templates, voxels, water, sky, simple props, and VFX. It's fast to iterate, has no licence issues, and supports infinite variation. Works best for nature, architecture, stylised low-poly and voxels.
2. **CC0/permissive libraries.** Check these before generating anything:
   - **Quaternius** and **KayKit**: CC0 low-poly characters, animated, plus modular kits. Lightly modified, they make a convincing stylised game.
   - **Kenney**: CC0, 2D + 3D + audio. Download the packs and keep a manifest; there's no API.
   - **Poly Haven**: CC0 photoscanned models, textures and HDRIs. Its API is free but requires visible credit.
   - **ambientCG**: CC0 PBR materials.
   - **Microsoft Rocketbox**: MIT, rigged realistic humans
   - **Poly Pizza**: has an API; mostly CC-BY, so credit required.
   - **Freesound**: CC0/CC-BY recordings, so check each one.
3. **Blender Python scripts (headless, versioned).** A whole game's rooms, people and vehicles can come from Python scripts in Blender. Put them in `tools/blender/*.py` and run `blender -b -P tools/blender/make_room.py -- --seed 3 --out public/models/room_3.glb`. The output is deterministic, diffable and re-runnable by the agent; no MCP needed.
4. **AI 3D generation.** Use it for hero props and characters the libraries don't have:
   - **Tripo Smart Mesh P2:** clean low-poly quad meshes (≤25k faces) for props and characters. It can be driven by hand or automated by the agent. Tripo also ships a CLI skill, `npx @tripo3d/cli`; its MCP is alpha.
   - **Meshy** (official MCP, Pro plan): text/image→3D, retexture, remesh, **auto-rig + animate**. Use it when you need an animated character.
   - **TRELLIS.2** (MIT, self-host, 24GB GPU): free bulk generation.
   - **Hunyuan3D:** check the licence first. It excludes the EU/UK/South Korea; verify Norway/EEA before use.
   - **Higgsfield MCP:** image→3D, multi-image→3D, rigging. It's an all-in-one platform.
   - **Atlas 3D:** claims text→rigged IK-ready character. Unverified.
5. **Blender cleanup via blender-mcp** (ahujasid/blender-mcp). The agent sets up each model's scale (metres), pivots (feet/base at origin), forward axis, materials (PBR, no 8K textures), fixes normals, decimates, applies transforms and exports glTF. It can also animate: walk, cast, boat bob. Keep the socket on localhost, set `DISABLE_TELEMETRY=true`, and split long jobs.
6. **Engine import + optimisation:** `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2`; see `game-performance-optimization`.

## Animations

- **Mixamo:** free auto-rig + animation library (Adobe account). Most character work still mixes Tripo, Mixamo, mocap and manual keyframes. Retarget in Blender, or let the agent do it.
- **Meshy animate / text_to_motion** for generated characters; Quaternius/KayKit packs ship with animations.
- **Video→mocap:** see `game-characters-animation`.
- **2D:** `aldegad/sprite-gen` (a Claude/Codex skill) turns one character image into animation states, transparent frames and an atlas with a review UI. Aseprite CLI exports sheets.

## Gotchas

- **AI meshes are heavy and flat-shaded.** Generated meshes usually have far too many triangles for mobile or even desktop. Always decimate, bake normals and atlas the textures.
- **Scale and orientation drift.** Enforce metres, +Y up, −Z forward (three.js) or +Z (Godot), and the pivot at the base. Add a CI check that reads GLB bounding boxes.
- **Inconsistent style** across generated assets: use the same reference image style, the same palette, and retexture in one pass.
- **Licences:** keep `CREDITS.md` from day one, with source, author, licence and URL per asset. Poly Haven API credit, CC-BY attributions and commercial terms of Meshy/Tripo plans all go there.
- **Don't commit 100MB source files.** Keep raw generations in `art/source/` (git-lfs or gitignored) and ship optimised GLBs only.

## Folder convention

```
art/refs/        reference images (not shipped)
art/source/      raw AI/Blender outputs (lfs or ignored)
tools/blender/   headless bpy generators and cleanup scripts
public/models/   optimised .glb (meshopt + KTX2)
public/textures/ KTX2 / webp
public/audio/    ogg/m4a
CREDITS.md
assets.manifest.json   id, file, tris, texture MB, licence, source
```

## Verification

- `node tools/check-assets.mjs` prints tris, texture MB, bounding-box size and licence per manifest entry, and fails on budget or licence gaps.
- Render a turntable contact sheet for every new asset, e.g. `blender -b -P tools/blender/turntable.py`, and attach it for the critic (`game-art-review`).
