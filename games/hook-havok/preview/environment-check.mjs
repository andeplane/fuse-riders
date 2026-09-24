import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = () =>
    page.locator("#scene").evaluate((host) => ({
      time: Number(host.dataset.time),
      geometry: host.dataset.terrain,
      backdrop: host.dataset.backdrop,
      platforms: Number(host.dataset.shrinePlatforms),
      groups: Number(host.dataset.terrainGroups),
      environment: JSON.parse(host.dataset.environment),
    }));
  const later = async (before) => {
    await page.waitForFunction(
      (time) =>
        Number(document.querySelector("#scene").dataset.time) > time + 350,
      before.time,
    );
    return state();
  };
  await page.goto(base + "hook-havok/?mute");
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const belfry = await state();
  assert.equal(belfry.backdrop, "background");
  assert.equal(belfry.platforms, 0);
  await page.locator("#map").selectOption("crossroads");
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.backdrop === "cathedral",
  );
  const active = await state();
  assert.equal(active.platforms, 14);
  assert.equal(active.environment.banners.length, 7);
  assert.equal(active.environment.candles.length, 14);
  assert.equal(active.environment.moving, true);
  const moving = await later(active);
  assert.notDeepEqual(active.environment.banners, moving.environment.banners);
  assert.notDeepEqual(active.environment.candles, moving.environment.candles);
  assert.notDeepEqual(active.environment.fog, moving.environment.fog);

  await page.locator("#atmosphere").uncheck();
  await page.waitForFunction(
    () =>
      !JSON.parse(document.querySelector("#scene").dataset.environment).moving,
  );
  const off = await state();
  assert.deepEqual((await later(off)).environment, off.environment);
  assert.equal(off.geometry, active.geometry);
  await page.locator("#atmosphere").check();
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.environment).moving,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () =>
      !JSON.parse(document.querySelector("#scene").dataset.environment).moving,
  );
  const reduced = await state();
  assert.deepEqual((await later(reduced)).environment, reduced.environment);
  assert.ok(reduced.environment.banners.every((angle) => angle === 0));
  assert.equal(reduced.geometry, active.geometry);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.environment).moving,
  );

  const resumed = await state();
  const advanced = await later(resumed);
  assert.notDeepEqual(
    resumed.environment.banners,
    advanced.environment.banners,
  );
  assert.notDeepEqual(
    resumed.environment.candles,
    advanced.environment.candles,
  );

  for (const map of ["belfry", "crossroads", "belfry", "crossroads"]) {
    await page.locator("#map").selectOption(map);
    await page.waitForFunction(
      (id) => document.querySelector("#scene").dataset.map === id,
      map,
    );
    const current = await state();
    assert.equal(current.groups, 1);
    assert.equal(current.platforms, map === "crossroads" ? 14 : 0);
    assert.equal(
      current.backdrop,
      map === "crossroads" ? "cathedral" : "background",
    );
    assert.equal(
      current.environment.banners.length,
      map === "crossroads" ? 7 : 0,
    );
    assert.equal(
      current.geometry,
      map === "crossroads" ? active.geometry : belfry.geometry,
    );
  }
  await page.locator("#arena-focus").click();
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/cathedral-solo.png",
    fullPage: true,
  });
  await page.route("**/crossroads-cathedral-source-*.png", (route) =>
    route.abort(),
  );
  await page.goto(base + "hook-havok/?showcase=1&mute");
  await page.locator('#status[data-state="error"]').waitFor();
  await page.unroute("**/crossroads-cathedral-source-*.png");
  await page.locator("#retry").click();
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await page.locator("#scene canvas").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS fourteen surfaces, backdrop/geometry, banner/candle/fog motion, atmosphere off, live reduced motion, map cleanup and source retry",
  );
} finally {
  await browser.close();
}
