/**
 * Command-queue shot for the 3D battlefield against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/queue-shot.mjs http://localhost:PORT/ [out.png]
 *
 * In a solo match the hero walks east until an enemy is on screen; then a right-click sends it off and Shift +
 * right-clicks queue two more moves and an attack on that enemy (found by hovering until the cursor turns hostile).
 * The shot of the drawn route goes to `out.png` (default games/fuse-front/docs/images/command-queue.png). Muted, one
 * headless Chromium; run by hand, not in CI. The docs shot used ZOOM_OUT=1 (X presses before the walk) and the Mesa
 * BROWSER_ARGS below; STEPS=<dir> saves a shot after each click. An enemy that wanders off can fail a run: run it again.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
const out = process.argv[3] ?? "games/fuse-front/docs/images/command-queue.png";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: true,
  // BROWSER_ARGS="--enable-gpu --ignore-gpu-blocklist --use-gl=angle --use-angle=gl-egl" renders several times faster
  // than the default SwiftShader where Mesa is installed.
  args: (process.env.BROWSER_ARGS ?? "").split(" ").filter(Boolean),
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}fuse-front/?solo=1&mute`);
  const board = page.locator("canvas.ff-board-3d");
  await board.waitFor({ timeout: 20_000 });
  const t0 = Date.now();
  const log = (what) =>
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${what}`);
  await page.waitForTimeout(3_000);
  for (let i = 0; i < Number(process.env.ZOOM_OUT ?? 3); i++)
    await page.keyboard.press("x");
  await page.waitForTimeout(500);
  const box = (await board.boundingBox()) ?? assert.fail("no board");
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  const hostile = () =>
    board.evaluate((canvas) => canvas.classList.contains("ff-hostile"));
  // Spots around the centre, nearest first; the first whose cursor reads hostile is an enemy.
  const spots = [];
  for (let i = 1; i < 8; i++)
    for (let j = 1; j < 5; j++) spots.push([i / 8, j / 5]);
  spots.sort(
    (a, b) =>
      Math.hypot(a[0] - 0.5, a[1] - 0.5) - Math.hypot(b[0] - 0.5, b[1] - 0.5),
  );
  const scan = async () => {
    for (const [fx, fy] of spots) {
      await page.mouse.move(...at(fx, fy));
      if (await hostile()) return [fx, fy];
    }
  };
  // Seat 0 starts in the west: walk east (the camera follows) until an enemy is on screen.
  let enemy = await scan();
  for (let tries = 0; !enemy && tries < 40; tries++) {
    await page.mouse.click(...at(0.95, 0.5), { button: "right" });
    await page.waitForTimeout(2_500);
    enemy = await scan();
    log(`walking east, try ${tries}: ${enemy ?? "none yet"}`);
  }
  log(`enemy on screen at ${enemy}`);
  if (process.env.STEPS)
    await page.screenshot({ path: `${process.env.STEPS}/found.png` });
  assert.ok(enemy, "an enemy on screen to queue an attack on");
  const click = async (fx, fy, shift) => {
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(...at(fx, fy), { button: "right" });
    if (shift) await page.keyboard.up("Shift");
    await page.waitForTimeout(250);
    if (process.env.STEPS)
      await page.screenshot({ path: `${process.env.STEPS}/${fx},${fy}.png` });
  };
  // A drag there and back pans the camera by nothing, but stops it following the hero, so the route and the enemy
  // stay put on screen.
  const [dx, dy] = at(0.5, 0.95);
  await page.mouse.move(dx, dy);
  await page.mouse.down();
  await page.mouse.move(dx + 12, dy, { steps: 2 });
  await page.mouse.move(dx, dy, { steps: 2 });
  await page.mouse.up();
  await page.mouse.move(...at(...enemy));
  assert.ok(await hostile(), "the enemy is still there after the pan");
  const target = enemy;
  // A plain move, two queued moves, then a queued attack on that enemy.
  await click(0.3, 0.75, false);
  await click(0.18, 0.4, true);
  await click(0.4, 0.25, true);
  await click(...target, true);
  // Off the board, so the cursor neither hovers anything nor pans the camera.
  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  await page.waitForTimeout(150);
  log("queued");
  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
  assert.deepEqual(errors, []);
  console.log("queue shot: ok");
} finally {
  await browser.close();
}
