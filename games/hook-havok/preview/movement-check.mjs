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
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "?mute");
  await page.getByRole("link", { name: /HOOK HAVOK/ }).click();
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.getByRole("button", { name: "Enter the belfry" }).click();
  await page
    .locator('#status[data-state="playing"]')
    .waitFor({ timeout: 15000 });
  const state = () =>
    page.locator("#scene").evaluate((e) => ({ ...e.dataset }));
  const before = await state();
  await page.keyboard.down("d");
  await page.waitForFunction(
    (x) => Number(document.querySelector("#scene").dataset.actorX) > x + 40,
    Number(before.actorX),
  );
  await page.keyboard.up("d");
  await page.keyboard.down("Space");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.feet) < 790,
  );
  await page.keyboard.up("Space");
  await page.getByRole("button", { name: "Return to first ledge" }).click();
  await page.waitForFunction(
    () =>
      Math.abs(Number(document.querySelector("#scene").dataset.actorX) - 310) <
      1,
  );
  const box = await page.locator("#scene canvas").boundingBox();
  await page.mouse.move(
    box.x + (310 / 1600) * box.width,
    box.y + (650 / 900) * box.height,
  );
  await page.mouse.down();
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "attached",
  );
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "ready",
  );
  await page.keyboard.down("d");
  await page.locator("#debug").focus();
  await page.keyboard.up("d");
  await page.getByRole("button", { name: "Return to first ledge" }).click();
  await page.waitForFunction(
    () =>
      Math.abs(Number(document.querySelector("#scene").dataset.actorX) - 310) <
      1,
  );
  await page.keyboard.down("d");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.actorX) > 340,
  );
  await page.locator("#debug").focus();
  const blurred = await state();
  await page.waitForFunction(
    (t) => Number(document.querySelector("#scene").dataset.tick) > t + 35,
    Number(blurred.tick),
  );
  assert.ok(
    Number((await state()).actorX) - Number(blurred.actorX) < 45,
    "focus loss releases movement",
  );
  await page.keyboard.up("d");
  await page.getByRole("button", { name: "Return to first ledge" }).click();
  await page.keyboard.down("d");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.deaths) > 0,
  );
  await page.keyboard.up("d");
  await page.waitForFunction(
    () =>
      Math.abs(Number(document.querySelector("#scene").dataset.actorX) - 310) <
      1,
  );
  await page.getByText("Movement workshop", { exact: true }).click();
  await page.locator('[name="speed"]').fill("420");
  await page.getByRole("button", { name: "Apply and restart" }).click();
  await page.locator("#debug").check();
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/movement-playground-desktop.png",
    fullPage: true,
  });
  await page.locator("#debug").uncheck();
  assert.deepEqual(errors, []);
  const failed = await browser.newPage();
  await failed.route("**/api/rooms?*", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await failed.goto(base + "hook-havok/?mute");
  await failed.locator('#status[data-state="ready"]').waitFor();
  await failed.locator("#start").click();
  await failed.locator('#status[data-state="error"]').waitFor();
  assert.equal(await failed.locator("#start").isEnabled(), true);
  await failed.unroute("**/api/rooms?*");
  await failed.locator("#start").click();
  await failed.locator('#status[data-state="playing"]').waitFor();
  await failed.close();
  console.log(
    "Movement browser smoke passed: real room, run/jump, hook/release, reset, tuning, service failure/retry.",
  );
} finally {
  await browser.close();
}
