/**
 * Browser smoke for Fuse Choppers against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-choppers/preview/smoke.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * 1. Solo: `?solo=1&autopilot` flies a round against three bots; the timer runs and the cave is drawn.
 * 2. Online: one page creates a room, a second joins by its code, the host adds a bot and takes off; both pages
 *    fly on autopilot, see the same pilots and agree on the round's winner.
 * Screenshots go to the directory given, and nowhere else. Every page opens muted.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const snap = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
const open = async (path, viewport = { width: 1280, height: 800 }) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource/.test(message.text())
    )
      errors.push(message.text());
  });
  // The browser's own favicon probe is the one request allowed to miss.
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(base + path);
  return page;
};
const timer = (page) => page.locator(".fc-time b").textContent();
/** How varied the canvas is: a blank or single-colour canvas scores near zero. */
const variety = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector(".fc-canvas"),
      g = canvas.getContext("2d"),
      { data } = g.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97)
      seen.add(
        (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4),
      );
    return seen.size;
  });

try {
  // ---- solo ----
  const solo = await open("fuse-choppers/?solo=1&mute&autopilot");
  await solo.locator('main[data-phase="play"]').waitFor({ timeout: 15_000 });
  await solo.waitForTimeout(6_000);
  const early = await timer(solo);
  await solo.waitForTimeout(3_000);
  const later = await timer(solo);
  assert.notEqual(early, later, "the solo timer runs");
  assert.ok((await variety(solo)) > 40, "the cave is drawn");
  assert.equal(await solo.locator(".fc-card").count(), 4, "you and three bots");
  await snap(solo, "solo-play");
  console.log(`solo: timer ${early} → ${later}, 4 pilots`);
  await solo.context().close();

  // ---- online: create, join by code, add a bot, take off ----
  const host = await open("fuse-choppers/?mute&autopilot");
  await host.getByRole("button", { name: "CREATE ROOM" }).click();
  await host.waitForURL(/room=[A-Z0-9]+/);
  const code = new URL(host.url()).searchParams.get("room");
  const join = async (page, name) => {
    const input = page.locator(".fui-name-input").first();
    await input.waitFor({ timeout: 15_000 });
    await input.fill(name);
    await page.getByRole("button", { name: "JOIN", exact: true }).click();
  };
  await join(host, "Host");
  const guest = await open(`fuse-choppers/?room=${code}&mute&autopilot`);
  await join(guest, "Guest");
  await host.locator(".fui-roster-row").nth(1).waitFor({ timeout: 20_000 });
  await host.getByRole("button", { name: "+ ADD BOT" }).click();
  await host.locator(".fui-roster-row").nth(2).waitFor({ timeout: 10_000 });
  await snap(host, "online-lobby");
  await host.getByRole("button", { name: "TAKE OFF" }).click();
  for (const page of [host, guest])
    await page.locator('main[data-phase="play"]').waitFor({ timeout: 20_000 });
  await host.waitForTimeout(5_000);
  const pilots = await Promise.all(
    [host, guest].map((page) => page.locator(".fc-card").count()),
  );
  assert.deepEqual(pilots, [3, 3], "both pages show three pilots");
  await snap(host, "online-host");
  await snap(guest, "online-guest");
  // Both replicas agree on how the round ends.
  const banner = async (page) => {
    await page
      .locator('main[data-phase="outro"]')
      .waitFor({ timeout: 120_000 });
    return page.locator(".fc-banner strong").textContent();
  };
  const [hostEnd, guestEnd] = await Promise.all([banner(host), banner(guest)]);
  assert.equal(hostEnd, guestEnd, "host and guest agree on the round");
  await snap(host, "online-outro");
  console.log(`online ${code}: 3 pilots, round ended "${hostEnd}" on both`);
  await host.context().close();
  await guest.context().close();

  // ---- a shared TV with a phone as the controller ----
  const phoneView = { width: 390, height: 844 };
  const phoneContext = { viewport: phoneView, hasTouch: true, isMobile: true };
  const sharedHost = await open("fuse-choppers/?mute&autopilot");
  await sharedHost.locator(".fc-shared input").check();
  await sharedHost.getByRole("button", { name: "CREATE ROOM" }).click();
  await sharedHost.waitForURL(/room=[A-Z0-9]+/);
  const sharedCode = new URL(sharedHost.url()).searchParams.get("room");
  await join(sharedHost, "Host");
  const tv = await open(`fuse-choppers/?room=${sharedCode}&display=1&mute`);
  const phoneBrowser = await browser.newContext(phoneContext);
  const phone = await phoneBrowser.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(`${base}fuse-choppers/?room=${sharedCode}&mute`);
  await join(phone, "Phone");
  await sharedHost
    .locator(".fui-roster-row")
    .nth(1)
    .waitFor({ timeout: 20_000 });
  await sharedHost.getByRole("button", { name: "TAKE OFF" }).click();
  await phone
    .locator('main[data-screen="controller"]')
    .waitFor({ timeout: 20_000 });
  await tv.locator('main[data-screen="play"]').waitFor({ timeout: 20_000 });
  const lift = phone.locator(".fc-controller .fc-pad-lift");
  assert.equal(await lift.textContent(), "HOLD TO CLIMB");
  const box = await lift.boundingBox();
  assert.ok(box && box.height > 80, "a thumb-sized lift pad");
  await lift.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
  });
  await phone.waitForTimeout(400);
  assert.ok(await lift.evaluate((node) => node.classList.contains("held")));
  await lift.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch" });
  await tv.waitForTimeout(3_000);
  await snap(tv, "shared-tv");
  await snap(phone, "shared-phone");
  console.log(
    `shared ${sharedCode}: the TV shows the cave, the phone is a controller`,
  );
  await sharedHost.context().close();
  await tv.context().close();
  await phoneBrowser.close();

  // ---- a phone flying on its own screen ----
  const pocket = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const handheld = await pocket.newPage();
  handheld.on("pageerror", (error) => errors.push(error.message));
  await handheld.goto(`${base}fuse-choppers/?solo=1&mute&autopilot`);
  await handheld
    .locator('main[data-phase="play"]')
    .waitFor({ timeout: 15_000 });
  await handheld.waitForTimeout(1_500);
  assert.ok(
    await handheld.locator(".fc-touch").isVisible(),
    "touch pads over the cave",
  );
  await snap(handheld, "phone-solo");
  await pocket.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("fuse-choppers smoke: ok");
} finally {
  await browser.close();
}
