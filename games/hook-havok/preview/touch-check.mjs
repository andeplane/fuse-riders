import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage(),
    cdp = await context.newCDPSession(page),
    errors = [],
    music = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/music/")) music.push(r.url());
  });
  await page.goto(base + "hook-havok/?mute");
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await page.locator("#touch-toggle").isChecked(), true);
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  await page.locator("#experiment").selectOption("target");
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.experiment === "target",
  );
  const getPad = async (name) =>
    page.locator(`[data-pad="${name}"]`).boundingBox();
  const point = (id, box, x = 0, y = 0) => ({
    id,
    x: box.x + (box.width / 2) * (1 + x),
    y: box.y + (box.height / 2) * (1 + y),
    radiusX: 5,
    radiusY: 5,
    force: 1,
  });
  const dispatch = (type, touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const deck = () =>
    page.locator("#touch-deck").evaluate((e) => ({ ...e.dataset }));
  const assertNeutral = async () => {
    const d = await deck();
    assert.equal(d.move, "0");
    assert.equal(d.jump, "false");
    assert.equal(d.fire, "false");
  };
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/touch-portrait.png",
    fullPage: true,
  });
  let move = await getPad("move"),
    aim = await getPad("aim");
  const canvas = await page.locator("#scene canvas").boundingBox();
  assert.ok(
    move.y >= canvas.y + canvas.height && aim.y >= canvas.y + canvas.height,
    "portrait pads outside arena",
  );
  // Two simultaneous native contacts: movement/jump plus hook. No injected game state.
  await dispatch("touchStart", [point(1, move)]);
  await dispatch("touchMove", [point(1, move, 0.7, -0.7)]);
  await dispatch("touchStart", [point(1, move, 0.7, -0.7), point(2, aim)]);
  await dispatch("touchMove", [
    point(1, move, 0.7, -0.7),
    point(2, aim, 0, -0.8),
  ]);
  assert.equal((await deck()).move, "1");
  assert.equal((await deck()).jump, "true");
  assert.equal((await deck()).fire, "true");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.feet) < 795,
  );
  await dispatch("touchEnd", [point(2, aim, 0, -0.8)]);
  assert.equal((await deck()).move, "1");
  assert.equal((await deck()).jump, "true");
  assert.equal((await deck()).fire, "false");
  await dispatch("touchCancel", []);
  await assertNeutral();
  await page.locator("#reset").click();
  await page.waitForFunction(
    () =>
      Math.abs(Number(document.querySelector("#scene").dataset.actorX) - 310) <
      1,
  );
  await dispatch("touchStart", [point(3, aim)]);
  await dispatch("touchMove", [point(3, aim, 0.8, 0)]);
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hits === "1",
  );
  await dispatch("touchEnd", []);
  await assertNeutral();
  // A mouse release after a touch takeover must not release the new thumb's hook.
  await page.locator("#reset").click();
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hits === "0",
  );
  await page.waitForFunction(
    () =>
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 810) < 1,
  );
  await page.mouse.move(
    canvas.x + (canvas.width * 310) / 1600,
    canvas.y + (canvas.height * 650) / 900,
  );
  await page.mouse.down();
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "attached",
  );
  await dispatch("touchStart", [point(9, aim)]);
  await dispatch("touchMove", [point(9, aim, 0, -0.8)]);
  await page.mouse.up();
  const releasedAt = await page.locator("#scene").getAttribute("data-tick");
  await page.waitForFunction(
    (tick) =>
      Number(document.querySelector("#scene").dataset.tick) > Number(tick) + 9,
    releasedAt,
  );
  assert.equal((await deck()).fire, "true");
  assert.equal(
    await page.locator("#scene").getAttribute("data-hook"),
    "attached",
  );
  await dispatch("touchCancel", []);
  await page.locator("#reset").click();
  await page.locator("#aim-mode").selectOption("free");
  // Rotation while holding releases both controls; old contacts cannot reactivate them.
  await dispatch("touchStart", [point(4, move), point(5, aim)]);
  await dispatch("touchMove", [
    point(4, move, -1, 0),
    point(5, aim, -0.7, -0.7),
  ]);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(
    () => document.querySelector("#touch-deck").dataset.fire === "false",
  );
  await assertNeutral();
  await dispatch("touchCancel", []);
  await page.locator("#reset").click();
  await page.evaluate(() => window.scrollTo(0, 0));
  move = await getPad("move");
  aim = await getPad("aim");
  const landscape = await page.locator("#scene canvas").boundingBox();
  assert.ok(
    move.x + move.width <= landscape.x &&
      aim.x >= landscape.x + landscape.width,
    "landscape pads beside arena",
  );
  assert.ok(
    move.y + move.height <= 390 && aim.y + aim.height <= 390,
    "pads in viewport",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/touch-landscape.png",
    fullPage: true,
  });
  await dispatch("touchStart", [point(6, move)]);
  await dispatch("touchMove", [point(6, move, 1, 0)]);
  await page.locator("#touch-toggle").uncheck();
  await assertNeutral();
  await dispatch("touchCancel", []);
  assert.equal(await page.locator("#touch-deck").isVisible(), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(music, []);
  console.log(
    "PASS real room with native multi-touch: move/jump/hook, independent release, cancellation, dummy hit, rotation, mode toggle, portrait/landscape layout and mute",
  );
} finally {
  await browser.close();
}
