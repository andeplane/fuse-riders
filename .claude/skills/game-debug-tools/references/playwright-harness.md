# Scripted harness: play, capture, regress, prove determinism

All scripts assume the `window.__game` contract from SKILL.md (`state()`, `step(n)`, `press/release`, `hash()`), and URL flags `?test` (manual time), `?seed=N` and `?debug`.

## 1. `scripts/play.mjs`: one command the agent runs after every change
```js
// node scripts/play.mjs --seed 42 --steps 600 --shots 0,120,600 --keys "ArrowRight@0-120,Space@60" [--headed] [--webgpu]
import { chromium } from "playwright";          // npm i -D playwright && npx playwright install chromium
import fs from "node:fs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const flag = (k) => argv.includes(`--${k}`);
const base = opt("url", "http://localhost:5173"), seed = opt("seed", "42"), steps = +opt("steps", "600");
const shots = opt("shots", `0,${steps}`).split(",").map(Number);
const keys = opt("keys", "").split(",").filter(Boolean).map((s) => {
  const [code, range] = s.split("@"); const [a, b = a] = range.split("-").map(Number); return { code, a, b };
});
// timeline of events: press at a, release at b+1, screenshot at each shot step
const ev = [];
for (const k of keys) { ev.push({ s: k.a, t: "press", code: k.code }); ev.push({ s: k.b + 1, t: "release", code: k.code }); }
for (const s of shots) ev.push({ s, t: "shot" });
ev.sort((x, y) => x.s - y.s || (x.t === "shot") - (y.t === "shot"));

const args = ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
if (flag("webgpu")) args.push("--enable-unsafe-webgpu", "--enable-features=Vulkan"); // Linux may also need SwiftShader-Vulkan flags
const browser = await chromium.launch({ headless: !flag("headed"), args });     // WebGPU screenshots: use --headed (xvfb-run on Linux)
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

await page.goto(`${base}/?test&debug&seed=${seed}`);
await page.waitForFunction(() => window.__game?.state?.().mode !== undefined, null, { timeout: 20000 });
fs.mkdirSync("shots", { recursive: true });

let cur = 0;
for (const e of ev) {
  if (e.s > steps) continue;
  if (e.s > cur) { await page.evaluate((n) => window.__game.step(n), e.s - cur); cur = e.s; }
  if (e.t === "press") await page.evaluate((c) => window.__game.press(c), e.code);
  if (e.t === "release") await page.evaluate((c) => window.__game.release(c), e.code);
  if (e.t === "shot") {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: `shots/step-${e.s}.png` });
    fs.writeFileSync(`shots/state-${e.s}.json`, JSON.stringify(await page.evaluate(() => window.__game.state()), null, 1));
  }
}
if (cur < steps) await page.evaluate((n) => window.__game.step(n), steps - cur);
const hash = await page.evaluate(() => window.__game.hash());
fs.writeFileSync("shots/summary.json", JSON.stringify({ seed, steps, hash, logs }, null, 1));
console.log(JSON.stringify({ hash, errors: logs.length, shots: shots.map((s) => `shots/step-${s}.png`) }));
await browser.close();
process.exit(logs.some((l) => l.startsWith("pageerror") || l.startsWith("error")) ? 1 : 0);
```
The agent reads `summary.json` first, opens only the PNGs it needs, and diffs `state-*.json` between runs.

## 2. Visual regression with `@playwright/test`
```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  webServer: { command: "npm run dev -- --port 5173 --strictPort", url: "http://localhost:5173", reuseExistingServer: true },
  use: { baseURL: "http://localhost:5173", viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
         launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
});
```
```ts
// tests/e2e/visual.spec.ts
import { test, expect } from "@playwright/test";
for (const seed of [1, 42, 1337]) {
  test(`level start, seed ${seed}`, async ({ page }) => {
    await page.goto(`/?test&seed=${seed}`);
    await page.waitForFunction(() => (window as any).__game?.state().mode === "playing");
    await page.evaluate(() => (window as any).__game.step(120));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(page.locator("canvas").first()).toHaveScreenshot(`start-${seed}.png`, {
      mask: [page.locator("#fps"), page.locator("#clock")],
    });
  });
}
```
- First run: `npx playwright test --update-snapshots` creates baselines. **Commit baselines generated on the CI image** (fonts and GPU differ locally). A local Docker run with `mcr.microsoft.com/playwright` matches CI.
- Review diffs in `test-results/**-diff.png`. Re-baseline only when the change is intended, and say so in the commit message.

## 3. Determinism tests
```ts
// tests/e2e/determinism.spec.ts — same seed + same inputs ⇒ same hash, in the real browser build
import { test, expect } from "@playwright/test";
test("deterministic replay", async ({ browser }) => {
  const run = async () => {
    const page = await browser.newPage();
    await page.goto("/?test&seed=7");
    await page.waitForFunction(() => (window as any).__game?.state().mode === "playing");
    const h = await page.evaluate(() => { const g = (window as any).__game;
      g.press("ArrowRight"); g.step(90); g.press("Space"); g.step(1); g.release("Space"); g.step(500); return g.hash(); });
    await page.close(); return h;
  };
  expect(await run()).toBe(await run());
});
```
```ts
// tests/sim.test.ts (Vitest, plain Node: proves the sim has no DOM/renderer dependency)
import { test, expect } from "vitest";
import { createSim } from "../src/sim";
import { fnv1a } from "../src/debug/rng";
test("sim is deterministic and headless", () => {
  const a = createSim({ seed: 7 }), b = createSim({ seed: 7 });
  for (let i = 0; i < 10_000; i++) { const inp = { right: i % 200 < 120, jump: i % 97 === 0 };
    a.step(1 / 60, inp); b.step(1 / 60, inp); }
  expect(fnv1a(JSON.stringify(a.serialize()))).toBe(fnv1a(JSON.stringify(b.serialize())));
});
```
**Seed sweep for procedural content** (e.g. 256 seeds through a solver):
```ts
test.each(Array.from({ length: 256 }, (_, i) => i + 1))("worldgen seed %i is valid", (seed) => {
  const w = generateWorld(seed);
  expect(isReachable(w, w.spawn, w.goal)).toBe(true);
  expect(w.rooms.length).toBeGreaterThanOrEqual(6);
});
```

## 4. keiko (no browser, milliseconds per test)
```ts
// tests/movement.test.ts — npx keiko   (npm i -D keiko; `npx keiko init` writes a smoke test + hook stub)
import { expect, play, test } from "keiko";
test("reaches top speed within 0.25 s", async () => {
  const game = await play({ seed: 1 });
  game.press("ArrowRight");
  expect(game.until((s) => s.player.vx >= 140)).toBeAtMost(15);
});
```
keiko fakes rAF, timers, `performance.now`, `Date` and seeds `Math.random`. It reads state via `window.__KEIKO__` (alias installed in the SKILL.md contract). Its compat table covers Phaser 4.2/3.90, PixiJS 8.22, KAPLAY 3001, Excalibur 0.32 and three.js r186. Alpha (0.7), so pin it.

## 5. Godot equivalents
```bash
godot --headless -s addons/gut/gut_cmdln.gd -gdir=res://test -gexit          # logic tests (GUT)
godot --path . --write-movie /tmp/cap/frame.png --fixed-fps 60 --quit-after 600 -- --seed=42   # PNG sequence
```
Read user args in GDScript with `OS.get_cmdline_user_args()`. Screenshot on demand: `get_viewport().get_texture().get_image().save_png("user://shot.png")`. Not in `--headless` (dummy renderer).
