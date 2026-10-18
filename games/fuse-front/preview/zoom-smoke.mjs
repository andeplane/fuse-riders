/**
 * Zoom-to-cursor smoke for the 3D battlefield against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/zoom-smoke.mjs http://localhost:PORT/
 *
 * In a solo match, the mouse rests near each screen corner and the wheel zooms in and then out there: the tile under
 * the cursor (the canvas's `data-tile`) stays the same, the camera stops following the hero, and Z still zooms about
 * the centre. Muted, one headless Chromium; run by hand, not in CI.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: true,
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
  await page.waitForTimeout(3_000);
  const box = (await board.boundingBox()) ?? assert.fail("no board");
  // The tile under the mouse after a nudge away and back, so the page re-picks it with the current camera.
  const tileAt = async (x, y) => {
    await page.mouse.move(x + 3, y + 3);
    await page.mouse.move(x, y);
    await page.waitForTimeout(150);
    return board.getAttribute("data-tile");
  };
  let checked = 0;
  for (const [fx, fy] of [
    [0.12, 0.15],
    [0.88, 0.85],
    [0.85, 0.2],
    [0.15, 0.8],
  ]) {
    const [x, y] = [box.x + box.width * fx, box.y + box.height * fy];
    const before = await tileAt(x, y);
    // The view may show past the map's north edge; a corner there has no tile to hold.
    if (!before) {
      console.log(`${fx},${fy}: off the map`);
      continue;
    }
    checked++;
    for (const deltaY of [-240, 240]) {
      await page.mouse.wheel(0, deltaY);
      await page.waitForTimeout(400);
      const after = await tileAt(x, y);
      console.log(`${fx},${fy} wheel ${deltaY}: ${before} -> ${after}`);
      assert.equal(after, before, `the tile under ${fx},${fy} holds`);
    }
  }
  assert.ok(checked >= 2, "corners over the map");
  // Z zooms about the centre: the tile under a corner changes.
  const [cx, cy] = [box.x + box.width * 0.1, box.y + box.height * 0.1];
  const corner = await tileAt(cx, cy);
  await page.keyboard.press("z");
  await page.keyboard.press("z");
  assert.notEqual(await tileAt(cx, cy), corner, "Z zooms about the centre");
  assert.deepEqual(errors, []);
  console.log("zoom smoke: ok");
} finally {
  await browser.close();
}
