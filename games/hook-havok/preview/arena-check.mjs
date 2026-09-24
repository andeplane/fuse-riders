import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
const evidence =
  process.argv[3] ?? "games/hook-havok/docs/evidence/arena-crossroads";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
try {
  const make = async (url, phone = false) => {
    const page = await browser.newPage(
      phone
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1440, height: 1000 } },
    );
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    return page;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const invite = await host.locator("#invite-url").inputValue();
  const guests = [];
  for (let i = 0; i < 4; i++) {
    const page = await make(invite, i === 3);
    await page.locator('#status[data-state="playing"]').waitFor();
    guests.push(page);
  }
  const tv = await make(
    await host.locator("#display-link").getAttribute("href"),
  );
  await tv.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await guests[0].locator("#map").isDisabled(), true);
  assert.equal(await tv.locator("#map").isDisabled(), true);
  const all = [host, ...guests, tv];
  async function mapIs(page, id, count) {
    await page.waitForFunction(
      ({ id, count }) => {
        const scene = document.querySelector("#scene");
        return (
          scene.dataset.map === id &&
          JSON.parse(scene.dataset.terrain).length === count
        );
      },
      { id, count },
    );
    const terrain = await page.locator("#scene").evaluate((e) => ({
      groups: Number(e.dataset.terrainGroups),
      shapes: JSON.parse(e.dataset.terrain),
    }));
    assert.equal(terrain.groups, 1, "old platform container is destroyed");
    assert.equal(await page.locator("#scene canvas").count(), 1);
    assert.equal(await page.locator("#map").inputValue(), id);
    return terrain.shapes;
  }
  const original = await mapIs(host, "belfry", 8);
  await guests[0].locator("#scene").focus();
  await guests[0].keyboard.down("d");
  await host.locator("#map").selectOption("crossroads");
  let selected;
  for (const page of all) {
    const shapes = await mapIs(page, "crossroads", 14);
    selected ??= shapes;
    assert.deepEqual(shapes, selected);
  }
  await guests[0].keyboard.up("d");
  await host.waitForFunction(() => {
    const keepers = JSON.parse(
      document.querySelector("#scene").dataset.keepers,
    );
    return (
      keepers.length === 5 &&
      keepers.every(
        (k) =>
          Math.abs(k.x - [180, 1420, 800, 490, 1110][k.slot]) < 1 &&
          k.hook === "ready",
      )
    );
  });
  assert.deepEqual(selected[0].slice(0, 3), [80, 810, 200]);
  await host.locator("#arena-focus").click();
  await host.screenshot({
    path: `${evidence}-desktop.png`,
    fullPage: true,
  });
  const center = guests[1];
  await center.locator("#scene").focus();
  await center.keyboard.down("Space");
  await center.waitForFunction(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 660) < 1,
  );
  await center.keyboard.up("Space");
  await center.keyboard.down("ArrowDown");
  await center.waitForFunction(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 810) < 1,
  );
  await center.keyboard.up("ArrowDown");
  const phone = guests[3];
  await phone.locator("#arena-focus").click();
  await phone.screenshot({
    path: `${evidence}-phone.png`,
    fullPage: true,
  });
  await phone.setViewportSize({ width: 844, height: 390 });
  const canvas = await phone.locator("#scene canvas").boundingBox();
  assert.ok(canvas.y + canvas.height <= 390);
  await phone.screenshot({
    path: `${evidence}-landscape.png`,
    fullPage: true,
  });
  await guests[0].reload();
  await guests[0].locator('#status[data-state="playing"]').waitFor();
  await mapIs(guests[0], "crossroads", 14);
  await host.locator("#arena-focus").click();
  await host.locator("#rules").selectOption("score");
  await host.waitForFunction(() => {
    const contest = JSON.parse(
      document.querySelector("#scene").dataset.contest,
    );
    return contest.rules === "score" && contest.phase === "active";
  });
  await host.locator("#map").selectOption("belfry");
  await host.waitForFunction(() => {
    const scene = document.querySelector("#scene");
    return (
      scene.dataset.map === "belfry" &&
      JSON.parse(scene.dataset.contest).phase === "countdown"
    );
  });
  for (const page of all)
    assert.deepEqual(await mapIs(page, "belfry", 8), original);
  for (const id of ["crossroads", "belfry", "crossroads"]) {
    await host.locator("#map").selectOption(id);
    await mapIs(host, id, id === "belfry" ? 8 : 14);
  }
  await host.locator("#restart-room").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  await mapIs(host, "crossroads", 14);
  assert.deepEqual(errors, []);
  console.log(
    "PASS five-player + display map geometry, manager controls, input cancellation, jump/drop, phone layouts, refresh, round restart and repeated switches",
  );
} finally {
  await browser.close();
}
