import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const make = async (url) => {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    return p;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const guest = await make(await host.locator("#invite-url").inputValue());
  await guest.locator('#status[data-state="playing"]').waitFor();
  if (!(await host.locator("#room-lounge").evaluate((e) => e.open)))
    await host.locator("#room-lounge > summary").click();
  await host.locator("#power-ups").selectOption("on");
  await guest.waitForFunction(
    () => document.querySelector("#power-ups").value === "on",
  );
  assert.equal(await guest.locator("#power-ups").isDisabled(), true);
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.pickups).length === 2,
  );
  await host.locator("#scene").focus();
  await host.keyboard.down("a");
  await host.waitForFunction(() =>
    JSON.parse(document.querySelector("#scene").dataset.keepers).some(
      (k) => k.slot === 0 && k.ward > 0,
    ),
  );
  await host.keyboard.up("a");
  await guest.waitForFunction(() =>
    JSON.parse(document.querySelector("#scene").dataset.keepers).some(
      (k) => k.slot === 0 && k.ward > 0,
    ),
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/powers-ward.png",
    fullPage: true,
  });
  await host.keyboard.down("d");
  await host.waitForFunction(() =>
    JSON.parse(document.querySelector("#scene").dataset.pickupEvents).some(
      (e) => e.kind === "lift",
    ),
  );
  await host.keyboard.up("d");
  await host.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.feet) < 730,
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/powers-lift.png",
    fullPage: true,
  });
  await guest.reload();
  await guest.locator('#status[data-state="playing"]').waitFor();
  await guest.waitForFunction(() =>
    JSON.parse(document.querySelector("#scene").dataset.pickups).some(
      (p) => p.cooldown > 0,
    ),
  );
  await host.locator("#power-ups").selectOption("off");
  await guest.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.pickups).length === 0,
  );
  await host.locator("#map").selectOption("crossroads");
  await host.locator("#power-ups").selectOption("on");
  await guest.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.pickups)[0]?.x ===
      460,
  );
  await guest.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await guest.screenshot({
    path: "games/hook-havok/docs/evidence/powers-phone.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: shared Ward, Lift launch, guest authority, refresh recovery, off/on, both maps, narrow viewport; no page errors",
  );
} finally {
  await browser.close();
}
