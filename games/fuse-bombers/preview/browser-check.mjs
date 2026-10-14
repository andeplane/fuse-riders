// Loads the running dev server in Chromium, screenshots bots-only rounds (one per round; the theme follows the seed),
// collects console errors and measures the frame rate and the scene's own update time (engine steps + drawing).
// Usage, with `pnpm dev` running (`pnpm exec playwright install chromium` once), from the repo root:
//   node games/fuse-bombers/preview/browser-check.mjs [url] [out-dir] [seconds]
//   node games/fuse-bombers/preview/browser-check.mjs "http://localhost:8787/fuse-bombers/?mute" artifacts/check 20
// HEADED=1 opens a real window. Without a GPU Chromium renders WebGL in software, which caps the frame rate
// well below what players see; the update time shows our own share of each frame.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const url = argv[0] ?? "http://localhost:8787/fuse-bombers/?mute";
const out = argv[1] ?? "artifacts/check";
const total = Number(argv[2] ?? 20);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.HEADED !== "1",
  args: [
    "--ignore-gpu-blocklist",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${url}${url.includes("?") ? "&" : "?"}debug`);
await page.waitForFunction(() =>
  window.fuseBombers?.game.scene.getScene("round")?.sys.isActive(),
);
await page.evaluate(() => {
  const sys = window.fuseBombers.game.scene.getScene("round").sys;
  const update = sys.sceneUpdate;
  window.updateMs = [];
  sys.sceneUpdate = function (time, delta) {
    const start = performance.now();
    update.call(this, time, delta);
    window.updateMs.push(performance.now() - start);
  };
});
/** Frames painted in one second, the live rocket count and the slowest scene update in that second. */
const sample = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const frame = () => {
          frames++;
          if (performance.now() - start < 1000)
            return requestAnimationFrame(frame);
          const view = window.fuseBombers.runner.view;
          const times = window.updateMs.splice(0);
          resolve({
            fps: frames,
            rockets: view.rockets.length,
            tick: view.tick,
            seed: view.config.seed,
            updateMs: Number(Math.max(0, ...times).toFixed(1)),
          });
        };
        requestAnimationFrame(frame);
      }),
  );

let busiest = { rockets: -1 };
let seed;
let rounds = 0;
for (let s = 1; s <= total; s++) {
  const now = await sample();
  console.log(`t=${s}s ${JSON.stringify(now)}`);
  // One screenshot a few seconds into each round (crates are out by then); the theme follows the round seed.
  if (now.seed !== seed && now.tick >= 300) {
    seed = now.seed;
    await page.screenshot({ path: `${out}/round${++rounds}.png` });
  }
  if (now.rockets > busiest.rockets) {
    busiest = now;
    await page.screenshot({ path: `${out}/busiest.png` });
  }
  if ([3, Math.round(total / 2), total].includes(s))
    await page.screenshot({
      path: `${out}/t${String(s).padStart(2, "0")}.png`,
    });
}
console.log(`busiest: ${JSON.stringify(busiest)}`);
console.log(
  errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors",
);
await browser.close();
process.exitCode = errors.length ? 1 : 0;
