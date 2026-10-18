/**
 * Screenshots the detailed 3D battlefield against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/detail-shot.mjs http://localhost:PORT/ games/fuse-front/docs/images
 *
 * A 2v2 against bots with all four heroes (Vix and Rivet red, Tally and Brick blue) at `?quality=high`: Vix walks to
 * the front and lays a mine, and `detail-3d.png` catches the fight at the default zoom. Then one short match per hero,
 * zoomed all the way in on it at its fort, makes the four panels of `heroes-3d.png`. Run by hand; muted.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { join } from "node:path";

const [base, dir] = process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? "") || !dir)
  throw new Error("Pass the local service URL and a screenshot directory");
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); // prettier-ignore
const errors = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on("pageerror", (error) => errors.push(error.message));
if (process.env.FPS)
  await page.addInitScript(() => {
    const c = (window.__gl = { draw: 0, compile: 0, tex: 0, buf: 0 });
    const P = WebGL2RenderingContext.prototype;
    for (const [k, names] of [["draw", ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]], ["compile", ["compileShader"]], ["tex", ["texImage2D", "texImage3D", "texStorage2D"]], ["buf", ["bufferData"]]])
      for (const n of names) { const f = P[n]; P[n] = function (...a) { c[k]++; if (k === "draw") { c.big = Math.max(c.big ?? 0, a[1] * (a[4] ?? a[3] ?? 1)); } return f.apply(this, a); }; }
    let last = performance.now();
    const tick = () => { last = performance.now(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    setInterval(() => { console.log("gl", Math.round(performance.now() - last), JSON.stringify(c)); c.big = 0; }, 3000);
  });
if (process.env.FPS) page.on("console", (m) => m.text().startsWith("gl") && console.log(m.text()));

/** A new room: the battle size, then each seat's hero by team and seat, then START; resolves with the board's box. */
async function match(size, heroes) {
  await page.goto(`${base}fuse-front/?mute&quality=${process.env.QUALITY ?? "high"}`);
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  await page.getByRole("button", { name: `${size}V${size}` }).click();
  for (const [team, picks] of heroes.entries())
    for (const [seat, hero] of picks.entries()) {
      const pick = page.locator(`.ff-team-${team} .ff-seat`).nth(seat).locator(`.ff-hero[aria-label='${hero}']`);
      await pick.click({ timeout: 15_000 });
      await pick.and(page.locator(".ff-on")).waitFor({ timeout: 10_000 });
    } // prettier-ignore
  await page.getByRole("button", { name: "START" }).click();
  await page
    .locator(".ff-hud", { hasText: "RED" })
    .waitFor({ timeout: 30_000 });
  const board = page.locator(".ff-stage canvas").first();
  return (await board.boundingBox()) ?? assert.fail("no board");
}

try {
  const box = await match(2, [
    ["vix", "rivet"],
    ["tally", "brick"],
  ]);
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  for (let i = 0; i < 16; i++) {
    await page.mouse.click(...at(0.7, 0.45));
    await page.waitForTimeout(6_000);
    if (process.env.FPS) console.log(i, await page.evaluate(() => new Promise((done) => { let n = 0; const t = performance.now(); const f = () => (performance.now() - t < 2000 ? (n++, requestAnimationFrame(f)) : done([n / 2, JSON.stringify(window.__gl)])); requestAnimationFrame(f); })));
  }
  await page.mouse.move(...at(0.55, 0.5));
  await page.keyboard.press("e");
  await page.mouse.move(...at(0.62, 0.42));
  await page.keyboard.press("q");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, "detail-3d.png") });

  const panels = [];
  for (const hero of ["brick", "vix", "rivet", "tally"]) {
    const b = await match(1, [[hero]]);
    await page.waitForTimeout(2_500);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400), await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); // prettier-ignore
    await page.waitForTimeout(2_000);
    const clip = {
      x: b.x + b.width / 2 - 200,
      y: b.y + b.height / 2 - 230,
      width: 400,
      height: 400,
    };
    panels.push((await page.screenshot({ clip, timeout: 120_000 })).toString("base64"));
  }
  await page.setViewportSize({ width: 1600, height: 400 });
  await page.setContent(`<body style="margin:0;display:flex;background:#000">${panels.map((p) => `<img src="data:image/png;base64,${p}">`).join("")}</body>`); // prettier-ignore
  await page.screenshot({ path: join(dir, "heroes-3d.png") });
  assert.deepEqual(errors, []);
  console.log("ok");
} finally {
  await browser.close();
}
