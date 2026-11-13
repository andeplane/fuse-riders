---
name: game-engine-choice
description: Pick the engine/renderer for a new game (three.js, custom WebGPU, Godot, Unity, Unreal, Phaser, C++/SDL) and set up the agent loop for it, including Godot without MCP, Unity/Unreal MCPs and when to outgrow three.js. Load at the start of a project, when porting, or when the current engine is fighting you.
---

# Engine choice for agent-built games

## Decision table

| Pick | When | Notes from practice | Agent loop |
|---|---|---|---|
| **three.js (WebGL/WebGPU + TSL)** | Default. Browser, instant share links, the fastest iteration, and the model knows it best | Most of the strongest browser demos in [docs/showcase.md](../../docs/showcase.md). Scales to city-sized worlds (tens of thousands of procedural buildings on WebGPU + TSL) | Vite dev server + Playwright MCP screenshots + `window.__game` hooks |
| **Custom WebGPU renderer** (keep three.js for prototyping) | You know exactly what you render and three.js costs load time, frame spikes or flexibility | [dgreenheck/tidewater](https://github.com/dgreenheck/tidewater) (custom WebGPU/WGSL, no framework). An agent can write a drop-in renderer for an existing three.js scene that removes frame spikes and cuts load time, and then it can change anything in it | Same as three.js. Compare frame-time percentiles before and after, not average FPS |
| **Godot 4.x, without MCP** | Desktop/Steam targets, 2D or 3D, an open-source engine, a real editor for humans | Editing scene files directly means fewer tool calls, a faster loop and a cleaner result than driving the editor | Agent edits `.tscn`/`.tres`/`.gd` text directly and runs the game via the CLI (recipe below) |
| **Godot with MCP/editor plugin** | You want the agent to drive the editor (signals, inspectors, animation editor) | Coding-Solo/godot-mcp (~6k★), hi-godot/godot-ai (in-editor AI) | Limit tool calls; prefer headless tests over screenshot runs |
| **Unity 6** | The team knows Unity; mobile/console; Asset Store | Works well as Tripo → blender-mcp → Unity 6, one tool per job. A deterministic JS sim can be ported to C# when the prototype proves itself | CoplayDev/unity-mcp (MIT, ~16k★) or Unity's official MCP (pre-release, Unity 6+) |
| **Unreal Engine 5** | High-end 3D, souls-likes, realistic humans, MetaHumans | A frontier model plus UE5 can scaffold a souls-like from a one-line prompt; quality then depends on iteration | Epic's official Claude Code plugin `EpicGames/unreal-engine-skills-for-claude-code-plugin` (Blueprints, materials, FX, animation, UI, testing); verify access |
| **Phaser 4 / PixiJS v8** | 2D web games, party games, jams | Phaser 4 + TypeScript with a deterministic engine module works well with issue → implement → review agent loops | See `game-2d` |
| **C++/SDL, Rust/Bevy, WASM** | Simulation-heavy (falling sand), "every pixel simulated", max control | Falling-sand pixel sims in C++/SDL; WASM for hot inner loops in the browser | Native build + headless test harness |

**Pattern: prototype in the browser, port later.** Prototype in JS/three.js, where the loop is fastest. Keep the simulation deterministic and engine-free so it can move to C#/Unity or GDScript when the game proves fun.

## Godot without MCP: recipe

1. Keep everything as text: `.tscn` (scenes), `.tres` (resources) and `.gd`. Use `uid://` references consistently. Godot 4.4+ generates `.uid` files, so commit them.
2. The CLI loop. Check flags against your version with `godot --help`:
   ```bash
   godot --headless --path . --import                  # reimport assets (4.3+; else open editor once)
   godot --headless --path . --script res://tests/run_tests.gd   # SceneTree test script, exit code = failures
   godot --path . --write-movie artifacts/cap.png --fixed-fps 30 --quit-after 300 res://scenes/main.tscn  # PNG frames
   godot --headless --path . --export-release "Web" build/web/index.html
   ```
   Headless uses a dummy renderer, so it can't take screenshots. For visual capture use Movie Maker mode with a display (xvfb-run on Linux), or export to Web and use Playwright.
3. Use **built-in Jolt** physics (Godot 4.4+, Project Settings → Physics → 3D → Physics Engine) instead of the GodotPhysics default for 3D.
4. Install a Godot skill pack: `jame581/GodotPrompter` (56 skills) or the Godot skills in `gamedev-skills/awesome-gamedev-agent-skills`. They prevent invented GDScript APIs.
5. Sandbox quirks: point `XDG_DATA_HOME`/`XDG_CONFIG_HOME` at project-local dirs if Godot can't write its user dir. Install export templates once.

## three.js setup checklist

- Pin the version (`three@0.18x`) and tell the agent to check `node_modules/three/package.json`; APIs move fast (`three/tsl`, `WebGPURenderer`, `Timer`). Install `CloudAI-X/threejs-skills` for version-correct APIs.
- WebGPU + TSL for new projects (`import * as THREE from 'three/webgpu'`), with WebGL2 fallback handled by the renderer. Check `renderer.backend.isWebGPUBackend` and log it.
- Expose debug hooks and show FPS from day one (`game-debug-tools`, `game-performance-optimization`).

## When to switch engines (signals)

- The browser can't hit the frame budget after the steps in `game-performance-optimization` → custom WebGPU renderer, or Godot/Unity.
- You need console/Steam features, controller rumble, or native file I/O → Godot/Unity (port the deterministic sim).
- Realistic humans, cinematic animation and MetaHumans → Unreal.
- Switching to UE5 or Unity is worth it only once the game has proved fun. Prove the fun first in the fastest loop.
