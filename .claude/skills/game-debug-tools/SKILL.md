---
name: game-debug-tools
description: Load at the start of any game project, and whenever the agent cannot tell if a change worked. Covers in-game debug/tuning panels (lil-gui, Tweakpane, leva, three.js Inspector, Dear ImGui via jsimgui/imgui-godot), window.__game state hooks with render_game_to_text and advanceTime, fixed-step and seeded-RNG determinism, and Playwright MCP / Chrome DevTools MCP / scripted screenshot and visual-regression loops.
---

# Debug tools: make the game legible to the agent

> "Agents get a lot more useful when they can see the state they're changing."

An agent that edits a game blind ends up guessing. Give it three channels, set up before the first feature:
1. **Text:** a compact JSON state snapshot (`window.__game.state()` / `render_game_to_text()`).
2. **Control:** deterministic stepping, seeded RNG, scripted input, warp/spawn commands.
3. **Pixels and numbers:** screenshots at fixed seeds and frames, plus perf stats (frame time, draw calls).

Panels (lil-gui/ImGui) serve the **human**. Hooks serve the **agent**. Build both from the same `TUNING` object.

## 1. When to use what

| Need | three.js (WebGL / WebGPU) | Phaser / Pixi / 2D web | Godot 4 | Unity 6 | Notes / when NOT |
|---|---|---|---|---|---|
| Tuning sliders (human) | **lil-gui 0.21** (three's examples use it). WebGPU r181+: **`renderer.inspector.createParameters()`** | lil-gui or **Tweakpane 4** | Inspector + `@export` vars. **imgui-godot** (MIT, ~880★) | Inspector. ImGui.NET wrappers (check) | Tweakpane has graphs/FPS blades. **leva** only for React/R3F |
| Dear ImGui look in the browser | **jsimgui** (`@mori2003/jsimgui`, MIT, WebGL/WebGL2/WebGPU, three/Pixi examples) | same | imgui-godot | ImGui.NET | Small project (75★). Immediate-mode is great for live inspectors of entity lists |
| FPS / GPU timing | WebGL: `stats-gl`. **WebGPU r181+: three `Inspector`** (stats-gl is incompatible) | Tweakpane `fpsgraph`. **myaku** (frame profiler with verdicts, MIT) | Debugger → Monitors, `Performance.get_monitor()` | Profiler, Frame Debugger | myaku is young (part of debuff) |
| Agent-readable state | **`window.__game`** contract (recipe A) | same. Phaser/Pixi: keiko reads scenes automatically | autoload `DebugState.gd` that prints JSON. godot-mcp `get_debug_output` | unity-mcp console/tests | Must be compact (<2 KB). Never dump scene graphs |
| Deterministic replay/tests | fixed step + seeded RNG + **keiko** (Node, no browser, tested with three r186) | keiko (Phaser 4.2, Pixi 8.22, KAPLAY, Excalibur) | `--headless` + GUT/gdUnit4, `--fixed-fps` | Test Framework PlayMode | Headless Godot has no renderer, so no screenshots |
| Drive the real browser | **Playwright MCP** (inputs, screenshots, evaluate) | same | Movie Maker `--write-movie` for capture | unity-mcp | Playwright MCP for play-testing |
| Perf traces, leaks, console with source maps | **Chrome DevTools MCP** (`performance_start_trace`, `take_heapsnapshot`, `list_console_messages`, `evaluate_script`) | same | Godot profiler | Unity Profiler | DevTools MCP for "why is it slow / leaking" |
| CI visual regression | `@playwright/test` `toHaveScreenshot` at fixed seed/frame | same | Movie Maker frames + image diff | Graphics Test Framework | Scripted beats MCP for CI (cheaper, repeatable) |
| All-in-one for 2D web | **debuff** dev panel + MCP (`game_state`, `game_step`, `game_capture`, `run_scenarios`) | | | | Early (0.9), tiny community |

## 2. Recipes

### A. The `window.__game` contract (one object, three popular aliases)
```ts
// src/debug/hooks.ts — dev/test builds only
import { sim, input, TUNING, renderNow } from "../game";
const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has("debug");

export function installHooks() {
  if (!DEV) return;
  const hooks = {
    version: 1,
    state: () => ({
      coords: "x right, y up, metres; origin = level start",     // tell the agent the convention
      mode: sim.mode, tick: sim.tick, seed: sim.seed,
      player: round(sim.player, ["x", "y", "z", "vx", "vy", "hp", "grounded"]),
      nearby: sim.entities.filter((e) => dist(e, sim.player) < 30).slice(0, 12)
        .map((e) => ({ id: e.id, type: e.type, x: r(e.x), y: r(e.y), hp: e.hp, state: e.ai })),
      score: sim.score, timers: sim.timers, flags: sim.flags,
      events: sim.events.slice(-10),          // "coin", "hit", "died": what just happened
      errors: errors.slice(-5),
      perf: { fps: perf.fps, ms: perf.frameMs, drawCalls: perf.drawCalls },
    }),
    step: (n = 1) => { for (let i = 0; i < n; i++) sim.step(1 / 60, input.sample()); renderNow(); },
    pause: (p = true) => { sim.manual = p; },
    press: (code: string) => input.down(code), release: (code: string) => input.up(code),
    params: () => TUNING, set: (path: string, v: unknown) => setPath(TUNING, path, v),
    command: (name: string, ...args: unknown[]) => commands[name]?.(...args), // warp, spawn, god, giveItem
    hash: () => fnv1a(JSON.stringify(sim.serialize())),
  };
  const w = window as any;
  w.__game = hooks;
  w.render_game_to_text = () => JSON.stringify(hooks.state());              // OpenAI develop-web-game
  w.advanceTime = (ms: number) => { sim.manual = true; hooks.step(Math.max(1, Math.round(ms / (1000 / 60)))); };
  w.__KEIKO__ = { state: hooks.state, scene: () => sim.mode, step: hooks.step, stepSeconds: 1 / 60,
                  params: () => TUNING, setParam: (g: string, k: string, v: unknown) => setPath(TUNING, `${g}.${k}`, v),
                  command: hooks.command };                                  // keiko
}
const errors: string[] = [];
addEventListener("error", (e) => errors.push(String(e.message)));
addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
const r = (n: number) => Math.round(n * 100) / 100;
```
Rules: rounded numbers, top-N lists, recent events. Include **why** values are what they are (AI state, cooldowns), not only positions. Large maps get a tiny ASCII minimap (`"#..@..E"`) instead of arrays.

### B. Fixed step + manual stepping + interpolation
```ts
const DT = 1 / 60; let acc = 0, last = performance.now();
sim.manual = new URLSearchParams(location.search).has("test");   // ?test → time moves only via step()
function frame(now: number) {
  if (!sim.manual) {
    acc += Math.min(0.25, (now - last) / 1000);                    // clamp: tab switches, breakpoints
    while (acc >= DT) { sim.step(DT, input.sample()); acc -= DT; }
  }
  last = now;
  render(sim, sim.manual ? 1 : acc / DT);                          // alpha for interpolated visuals
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

### C. Seeded RNG streams + state hash
```ts
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function fnv1a(s: string) { let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); }

const seed = Number(new URLSearchParams(location.search).get("seed") ?? Date.now() % 1e9);
export const rng = { world: mulberry32(seed), ai: mulberry32(seed ^ 0x9e3779b9),
                     loot: mulberry32(seed ^ 0x85ebca6b), fx: mulberry32(seed ^ 0xc2b2ae35) };
```
Use separate streams, so adding a particle (fx) doesn't change loot or worldgen. Cosmetic-only code may use `Math.random()`. Simulation code may not.

**Enforce the split.** The sim must not import the renderer or read wall-clock time:
```js
// eslint.config.js (flat config)
export default [{ files: ["src/sim/**/*.ts"], rules: {
  "no-restricted-properties": ["error",
    { object: "Math", property: "random", message: "use rng.* streams" },
    { object: "Date", property: "now", message: "use sim.time" },
    { object: "performance", property: "now", message: "use sim.time" }],
  "no-restricted-imports": ["error", { patterns: ["three", "three/*", "phaser", "pixi.js", "*/render/*"] }],
}}];
```
Add a Vitest test that imports `src/sim` in plain Node (no DOM) and runs 10,000 steps. If someone adds a renderer import, the test fails.

### D. Tuning panel (human) wired to the same TUNING object
```ts
import GUI from "lil-gui";
export function installPanel() {
  const gui = new GUI({ title: "Tuning (` to hide)" });
  const p = gui.addFolder("Player");
  p.add(TUNING.player, "speed", 0, 400, 1);
  p.add(TUNING.player, "jumpVelocity", 100, 900, 10);
  gui.add(TUNING.world, "timeScale", 0, 2, 0.05);
  gui.add(TUNING.debug, "colliders");                      // toggles debug draw
  try { const s = localStorage.getItem("tuning"); if (s) gui.load(JSON.parse(s)); } catch {}
  gui.onFinishChange(() => { try { localStorage.setItem("tuning", JSON.stringify(gui.save())); } catch {} });
  gui.add({ copy: () => navigator.clipboard.writeText(JSON.stringify(TUNING, null, 2)) }, "copy").name("copy as code");
  let shown = true;
  addEventListener("keydown", (e) => { if (e.key === "`") gui.show((shown = !shown)); });
}
```
- **three.js WebGPU (r181+):** `import { Inspector } from "three/addons/inspector/Inspector.js"; renderer.inspector = new Inspector(); const gui = renderer.inspector.createParameters("Tuning"); gui.add(params, "exposure", 0, 2);`. It gives GPU timings, and `someNode.toInspector("Depth")` previews TSL passes.
- **Tweakpane 4:** `pane.addBinding(obj, "speed", { min: 0, max: 400 })`, plus readonly graphs `{ readonly: true, view: "graph" }`. With `@tweakpane/plugin-essentials`: `pane.registerPlugin(Essentials); const fps = pane.addBlade({ view: "fpsgraph" })` and `fps.begin()/fps.end()` around the frame. (v3's `addInput`/`addMonitor` are gone in v4.)
- **ImGui feel (jsimgui):** `await ImGuiImplWeb.Init({ canvas })`, then per frame `ImGuiImplWeb.BeginRender(); ImGui.Begin("Debug"); …; ImGui.End(); ImGuiImplWeb.EndRender();`. Use a separate overlay canvas. Value refs are passed as 1-element arrays (check the README).
- When the agent tunes a value, it calls `__game.set("player.speed", 220)` and writes the winner back to `src/tuning.ts`. The panel is for the human to feel it.

### E. Debug draw (visible to screenshots)
- three.js + Rapier: `const { vertices, colors } = world.debugRender();` → a `LineSegments` with those buffers, updated each frame when `TUNING.debug.colliders`.
- three helpers: `Box3Helper`, `ArrowHelper` (velocities), `CameraHelper` (shadow frusta), `AxesHelper`. Nav paths: `Line` through waypoints.
- Phaser: `physics: { arcade: { debug: true } }`. Godot: Debug → Visible Collision Shapes (`get_tree().debug_collisions_hint`). Debug Draw 3D addon for lines/boxes.
- Label entities with their AI state in text sprites. A screenshot then explains behaviour without a state dump.

### F. Agent loops (choose one per task)
```bash
claude mcp add playwright npx @playwright/mcp@latest            # add --headless, --caps vision, --isolated as needed
claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest
```
**Play-test loop (Playwright MCP):** `browser_navigate` to `http://localhost:5173/?test&seed=42&debug`, then `browser_evaluate("__game.state()")`. Then `__game.press('ArrowRight'); __game.step(60)`, then `browser_take_screenshot` (filename under `shots/`), then `browser_console_messages`. Compare text state with the screenshot, fix the first discrepancy, and repeat. Reset with a reload between scenarios.

**Perf loop (Chrome DevTools MCP):** `navigate_page`, `emulate` (CPU throttle; check params), `performance_start_trace` → play 5 s → `performance_stop_trace` → `performance_analyze_insight`. For leaks: `take_heapsnapshot` before and after 3 level reloads → `compare_heapsnapshots`. Look for undisposed geometries, textures and listeners.

**Scripted loop (cheapest, CI):** `node scripts/play.mjs --seed 42 --steps 600 --shots 0,120,600` (full script in `references/playwright-harness.md`). It writes `shots/*.png` and `shots/state-*.json`. The agent then reads only the PNGs and JSON it needs.

Godot: `godot --path . --write-movie /tmp/run.png --fixed-fps 60 --quit-after 600` writes deterministic frames (PNG sequence). Unit logic runs with `godot --headless -s addons/gut/gut_cmdln.gd`. `--headless` uses a dummy renderer (no images), so use Movie Maker or xvfb for pixels. godot-mcp (Coding-Solo, MIT, ~6.3k★) gives `run_project` + `get_debug_output`. Unity: unity-mcp (CoplayDev, MIT, ~15.5k★). Unreal: see `game-engine-choice`.

## 3. Pitfalls

- **Debug code shipped:** guard with `import.meta.env.DEV` or `?debug`. Vite tree-shakes `if (import.meta.env.DEV)` blocks. Never expose `command("god")` in prod multiplayer.
- **Non-determinism leaks:** `Math.random`, `Date.now`, `performance.now`, `setTimeout`, iteration over `Set`/`Map` built in a non-deterministic order, and physics with variable dt. Also async asset loads that change spawn order.
- **rAF stops in background/headless tabs.** Use manual `step()` in tests rather than waiting on wall-clock time.
- **Screenshots:** WebGPU canvases come out **black in headless** Chrome. Run headed under xvfb, or use `new WebGPURenderer({ forceWebGL: true })` for screenshot tests. Wait two frames after `step()` before capturing. `canvas.toDataURL()` needs `preserveDrawingBuffer: true` (WebGL) or a capture right after render. `page.screenshot` doesn't.
- **Flaky baselines:** different GPU, DPR, fonts or window size. Pin the viewport and DPR 1, and use SwiftShader in CI (`--use-angle=swiftshader --enable-unsafe-swiftshader`). Mask the HUD clock and FPS counter. Disable random cosmetic FX in test mode.
- **stats-gl + WebGPURenderer (r181+)** is incompatible. Use `renderer.inspector`. The old `renderAsync()` is gone (`await renderer.init()` then `render()`).
- **State dumps that eat context:** never `JSON.stringify(scene)` (circular, megabytes). Expose curated fields and cap arrays.
- **MCP screenshots for everything** wastes tokens. Use text state for logic and screenshots for visuals. Take one screenshot per meaningful change, not per step.
- **Tweakpane v3 API** (`addInput`, `addMonitor`) in v4 projects. **lil-gui ≠ dat.gui** (dat.gui is dead).

## 4. Verification: definition of done for any feature

1. `__game.state()` shows the new feature's state (e.g. `player.dashCooldown`).
2. A scripted scenario (keiko test, Playwright step script, or Godot GUT) asserts the behaviour numerically at a fixed seed.
3. `__game.hash()` after N steps is identical across two runs with the same seed and inputs (determinism test).
4. Screenshot at a fixed seed and frame, viewed by the agent (and by the art critic for visual features, see `game-art-review`).
5. No new console errors (`state().errors` empty, and `list_console_messages`/`browser_console_messages` clean).
6. Perf: frame time within budget at 2× the expected entity count on a 4× CPU throttle.

## 5. Install instead of reinventing

- **OpenAI `develop-web-game` skill** (`openai/skills`, `skills/.curated/develop-web-game`): Playwright client + `render_game_to_text` + `advanceTime` loop. The contract above is compatible.
- **keiko** (`npm i -D keiko`, MIT, 0.7): deterministic Node tests for any web game (`until`, `during`, `trace`, `test.sweep`, `test.deterministic`). **myaku** (`import "myaku/auto"`): frame-hitch verdicts. Both come from debuff (`debuffjp/debuff`). Alpha, so pin versions.
- `ChromeDevTools/chrome-devtools-mcp` (Apache-2.0, ~53k★), with a Claude Code plugin that adds skills: `/plugin marketplace add ChromeDevTools/chrome-devtools-mcp`.
- `microsoft/playwright-mcp` (Apache-2.0, ~39k★).
- Engine MCPs: `Coding-Solo/godot-mcp`, `CoplayDev/unity-mcp`, `ChiR24/Unreal_mcp`.
- `gamedev-skills/awesome-gamedev-agent-skills`: `godot-gdscript-headless-testing`, `performance-optimization`.
- `htdt/godogen` (MIT, ~7.2k★): a full generate → run → judge-from-running-game loop for Godot/Bevy/three/Babylon. Steal its proof-recording step.
