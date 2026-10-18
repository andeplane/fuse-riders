/**
 * Screenshots the detailed 3D battlefield against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/detail-shot.mjs http://localhost:PORT/ games/fuse-front/docs/images
 *
 * A 2v2 against bots with all four heroes (Vix and Rivet red, Tally and Brick blue) at `?quality=high`: Vix walks
 * toward the front (`WALK` six-second legs, default 5), lays a mine and snipes, and `detail-3d.png` catches it at the
 * default zoom. Then one short match per hero, zoomed in on it at its fort, makes the four panels of `heroes-3d.png`.
 * Run by hand; muted. Under SwiftShader the page stalls a minute or so into a match (it did before G4 too), so keep
 * the walk short there.
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
const shot = (options) => page.screenshot({ timeout: 120_000, ...options });

/** A new room: the battle size, then each seat's hero by team and seat, then START; resolves with the board's box. */
async function match(size, heroes) {
  await page.goto(`${base}fuse-front/?mute&quality=high`);
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
  const box = await match(2, [["vix", "rivet"], ["tally", "brick"]]); // prettier-ignore
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  for (let i = 0; i < Number(process.env.WALK ?? 5); i++) {
    await page.mouse.click(...at(0.7, 0.45));
    await page.waitForTimeout(6_000);
  }
  await page.mouse.move(...at(0.55, 0.5));
  await page.keyboard.press("e");
  await page.mouse.move(...at(0.62, 0.42));
  await page.keyboard.press("q");
  await page.waitForTimeout(400);
  await shot({ path: join(dir, "detail-3d.png") });

  const panels = [];
  // Each hero casts one spell beside itself first: RALLY CRY, a STICKY MINE, a TURRET DROP, a FLARE.
  const spells = { brick: "w", vix: "e", rivet: "w", tally: "w" };
  const slots = { w: 1, e: 2 };
  for (const hero of ["brick", "vix", "rivet", "tally"]) {
    const b = await match(1, [[hero]]);
    const centre = [b.x + b.width / 2, b.y + b.height / 2];
    await page.waitForTimeout(2_500);
    await page.mouse.move(...centre);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
    // Once the hero has the energy for it.
    const ready = page.locator(".ff-spell").nth(slots[spells[hero]]);
    await ready.and(page.locator(":enabled")).waitFor({ timeout: 90_000 });
    await page.mouse.move(centre[0] + 70, centre[1] + 10);
    await page.keyboard.press(spells[hero]);
    await ready
      .locator(".ff-secs", { hasText: /\d/ })
      .waitFor({ timeout: 60_000 });
    await page.waitForTimeout(250);
    // The camera's nearest zoom, cropped round the hero and its spell and shown at 1.25×.
    const clip = { x: centre[0] - 130, y: centre[1] - 170, width: 320, height: 280 }; // prettier-ignore
    panels.push((await shot({ clip })).toString("base64"));
  }
  await page.setViewportSize({ width: 1600, height: 350 });
  await page.setContent(`<body style="margin:0;display:flex">${panels.map((p) => `<img width="400" src="data:image/png;base64,${p}">`).join("")}</body>`); // prettier-ignore
  await shot({ path: join(dir, "heroes-3d.png") });
  assert.deepEqual(errors, []);
  console.log("ok");
} finally {
  await browser.close();
}
