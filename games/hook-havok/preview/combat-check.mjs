import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || "chrome",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1200 },
  });
  const errors = [],
    music = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/music/")) music.push(r.url());
  });
  await page.goto(base + "?mute");
  await page.getByRole("link", { name: /HOOK HAVOK/ }).click();
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const state = () =>
    page.locator("#scene").evaluate((e) => ({ ...e.dataset }));
  const select = async (mode) => {
    await page.locator("#experiment").selectOption(mode);
    await page.waitForFunction(
      (mode) => document.querySelector("#scene").dataset.experiment === mode,
      mode,
    );
  };
  const aim = async (x, y) => {
    const box = await page.locator("#scene canvas").boundingBox();
    await page.mouse.move(
      box.x + (x / 1600) * box.width,
      box.y + (y / 900) * box.height,
    );
  };
  const advance = async (ticks) => {
    const tick = Number((await state()).tick);
    await page.waitForFunction(
      (t) => Number(document.querySelector("#scene").dataset.tick) >= t,
      tick + ticks,
    );
  };
  await select("target");
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/combat-target-desktop.png",
    fullPage: true,
  });
  await aim(450, 782);
  await page.mouse.down();
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hits === "1",
  );
  await advance(150);
  assert.equal((await state()).hits, "1", "holding never repeats a shot");
  await page.mouse.up();
  assert.match(await page.locator("#counter").innerText(), /FALLS 1/);
  await page.locator("#reset").click();
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hits === "0",
  );
  await select("ball");
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/combat-ball-desktop.png",
    fullPage: true,
  });
  // Aim ordinary shots from the first terrace. Track only visible view data; no state injection.
  for (let shot = 0; shot < 24 && Number((await state()).hits) < 1; shot++) {
    const balls = JSON.parse((await state()).balls);
    await aim(balls[0].x, balls[0].y);
    await page.mouse.down();
    await advance(40);
    await page.mouse.up();
    await advance(8);
  }
  assert.ok(
    Number((await state()).hits) >= 1,
    "ordinary hook splits the first orb",
  );
  assert.equal(JSON.parse((await state()).balls).length, 2);
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/combat-split-desktop.png",
    fullPage: true,
  });
  await page.locator("#reset").click();
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hits === "0",
  );
  assert.equal(JSON.parse((await state()).balls).length, 1);
  await select("movement");
  assert.equal(JSON.parse((await state()).balls).length, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(music, []);
  console.log(
    "PASS actual-room mode changes, target knockback/fall/hold, splitting/reset, movement return, narrow layout, muted media",
  );
} finally {
  await browser.close();
}
