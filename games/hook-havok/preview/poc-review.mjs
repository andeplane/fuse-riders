import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || "chrome",
});
const marks = [];
await mkdir("artifacts", { recursive: true });
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "hook-havok/?mute");
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const state = () =>
    page.locator("#scene").evaluate((e) => ({ ...e.dataset }));
  const until = async (fn) => {
    await page.waitForFunction(fn, undefined, { timeout: 6000 });
  };
  const mark = async (name) => {
    const value = { name, ...(await state()) };
    marks.push(value);
    console.log(name, value.actorX, value.feet, value.hook);
  };
  await page.keyboard.down("d");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) > 475,
  );
  await page.keyboard.up("d");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) > 490,
  );
  const stoppedAt = Number((await state()).tick);
  await page.waitForFunction(
    (t) => Number(document.querySelector("#scene").dataset.tick) > t + 18,
    stoppedAt,
  );
  await page.keyboard.down("Space");
  await until(
    () => Number(document.querySelector("#scene").dataset.feet) < 710,
  );
  await page.keyboard.down("a");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) < 445,
  );
  await page.keyboard.up("a");
  await page.keyboard.up("Space");
  await until(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 670) < 1,
  );
  await mark("low ledge");
  await page.keyboard.down("d");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) > 439,
  );
  await page.keyboard.down("Space");
  await until(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 610) < 1,
  );
  await page.keyboard.up("Space");
  await mark("central gap");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) > 735,
  );
  await page.keyboard.up("d");
  const aim = async (x, y) => {
    const b = await page.locator("#scene canvas").boundingBox();
    await page.mouse.move(
      b.x + (x / 1600) * b.width,
      b.y + (y / 900) * b.height,
    );
  };
  await aim(1180, 285);
  await page.mouse.down();
  await until(
    () => document.querySelector("#scene").dataset.hook === "attached",
  );
  await mark("high anchor");
  await page.keyboard.down("d");
  await page.keyboard.down("Space");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) > 960,
  );
  await page.keyboard.up("d");
  await page.keyboard.up("Space");
  await page.mouse.up();
  await page.keyboard.down("a");
  await until(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 480) < 1,
  );
  await page.keyboard.up("a");
  await mark("release and land");
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/poc-route-desktop.png",
    fullPage: true,
  });
  await page.keyboard.down("d");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) > 1230,
  );
  await page.keyboard.up("d");
  await aim(1240, 290);
  await page.mouse.down();
  await until(
    () =>
      document.querySelector("#scene").dataset.hook === "attached" &&
      Number(document.querySelector("#scene").dataset.feet) < 410,
  );
  await mark("recovery pull");
  await page.mouse.up();
  await page.keyboard.down("a");
  await until(
    () => Number(document.querySelector("#scene").dataset.actorX) < 1110,
  );
  await page.keyboard.up("a");
  await page.keyboard.down("d");
  await until(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 480) < 1,
  );
  await page.keyboard.up("d");
  await mark("recovery landing");
  await page.locator("#reset").click();
  await until(
    () =>
      Math.abs(Number(document.querySelector("#scene").dataset.actorX) - 310) <
      1,
  );
  await page.setViewportSize({ width: 960, height: 800 });
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/poc-960.png",
    fullPage: true,
  });
  await page
    .locator("#scene")
    .evaluate((e) => (e.style.filter = "grayscale(1)"));
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/poc-grayscale.png",
    fullPage: true,
  });
  await page.locator("#scene").evaluate((e) => (e.style.filter = ""));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.ok(
    await page.evaluate(
      () =>
        document.querySelector(".stage-caption").getBoundingClientRect().top >=
        document.querySelector("#scene").getBoundingClientRect().bottom - 1,
    ),
    "caption must not cover the low ledge",
  );
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/poc-390.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/hook-havok-phase5-browser.json",
    JSON.stringify(
      {
        browser: browser.version(),
        viewport: [1440, 1100],
        deviceScaleFactor: 1,
        headless: true,
        marks,
        limits:
          "Real browser keyboard/pointer inputs in solo room. Narrow layout is not a phone playability claim.",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: browser route, recovery, small viewport and grayscale captures",
  );
} catch (error) {
  console.error(
    "Last successful marks",
    marks,
    await page?.locator("#scene").evaluate((e) => ({ ...e.dataset })),
  );
  await page?.screenshot({
    path: "artifacts/hook-route-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
