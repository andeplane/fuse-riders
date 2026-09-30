/**
 * Browser smoke for Fuse Freight against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-freight/preview/smoke.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * 1. The splash: the title, the live depot behind the menu and the four illustrated rules.
 * 2. Solo: `?solo=1&autopilot` drives a round against three bots; the clock runs down and this train banks cargo.
 * 3. Online: one page creates a room (its `?autopilot` carries over), a second joins by its code, the host adds a
 *    bot, picks one-minute rounds and one round win, and starts; both pages drive on autopilot, the guest reloads
 *    mid-round and is back in its seat, both agree on how the round ended, then REMATCH and LOBBY work.
 * 4. A shared TV with a phone as the controller: two thumb-sized buttons that hold while pressed.
 * 5. A phone driving solo on its own screen, with the touch buttons, and a room that does not exist.
 * Run by hand; not in CI. Screenshots go to the directory given, and nowhere else. Every page opens muted.
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
const watch = (page) => {
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
};
const open = async (path, options = {}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...options,
  });
  const page = await context.newPage();
  watch(page);
  await page.goto(base + path);
  return page;
};
const clock = (page) => page.locator(".ff-clock b").textContent();
/** How varied a canvas is: a blank or single-colour canvas scores near zero. */
const variety = (page, selector) =>
  page.evaluate((selector) => {
    const canvas = document.querySelector(selector),
      g = canvas.getContext("2d"),
      { data } = g.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97)
      seen.add(
        (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4),
      );
    return seen.size;
  }, selector);
const myScore = (page) =>
  page
    .locator(".ff-card.you .ff-card-score")
    .textContent()
    .then((text) => Number(text));

try {
  // ---- the splash ----
  const splash = await open("fuse-freight/?mute");
  await splash.locator(".ff-title").waitFor();
  await splash.waitForTimeout(2_000);
  assert.ok(
    (await variety(splash, ".ff-attract")) > 40,
    "the depot runs behind the menu",
  );
  assert.equal(
    await splash.locator(".ff-rule").count(),
    4,
    "four illustrated rules",
  );
  assert.ok(
    (await variety(splash, ".ff-rule-canvas")) > 10,
    "the rules are drawn",
  );
  assert.equal(
    await splash.locator(".ff-sound-chip").textContent(),
    "🔇 MUTED",
  );
  await snap(splash, "splash");
  await splash.locator(".ff-howto").scrollIntoViewIfNeeded();
  await snap(splash, "how-to-play");
  console.log("splash: title, live depot, four rules");
  await splash.context().close();

  // ---- solo ----
  const solo = await open("fuse-freight/?solo=1&mute&autopilot");
  await solo.locator('main[data-phase="play"]').waitFor({ timeout: 15_000 });
  const early = await clock(solo);
  await solo.waitForTimeout(3_000);
  const later = await clock(solo);
  assert.notEqual(early, later, "the clock runs down");
  assert.ok((await variety(solo, ".ff-canvas")) > 40, "the depot is drawn");
  assert.equal(await solo.locator(".ff-card").count(), 4, "you and three bots");
  let banked = 0;
  for (let i = 0; i < 40 && banked === 0; i++) {
    await solo.waitForTimeout(1_000);
    banked = await myScore(solo);
  }
  assert.ok(banked > 0, "the autopilot banked cargo");
  await snap(solo, "solo-play");
  console.log(`solo: clock ${early} → ${later}, banked ${banked}`);
  await solo.context().close();

  // ---- online: create, join by code, add a bot, start ----
  const host = await open("fuse-freight/?mute&autopilot");
  await host.getByRole("button", { name: "CREATE ROOM" }).click();
  await host.waitForURL(/room=[A-Z0-9]+/);
  const code = new URL(host.url()).searchParams.get("room");
  assert.ok(
    new URL(host.url()).searchParams.has("autopilot"),
    "the flags carry into the room",
  );
  const seat = async (page, name) => {
    const input = page.locator(".fui-name-input").first();
    await input.waitFor({ timeout: 15_000 });
    await input.fill(name);
    await page.getByRole("button", { name: "JOIN", exact: true }).click();
  };
  await seat(host, "Host");
  const guest = await open(`fuse-freight/?room=${code}&mute&autopilot`);
  await seat(guest, "Guest");
  await host.locator(".fui-roster-row").nth(1).waitFor({ timeout: 20_000 });
  await host.getByRole("button", { name: "+ ADD BOT" }).click();
  await host.locator(".fui-roster-row").nth(2).waitFor({ timeout: 10_000 });
  await host.locator('select[name="seconds"]').selectOption("60");
  await host.locator('select[name="wins"]').selectOption("1");
  let rules = "";
  for (let i = 0; i < 50 && rules !== "60"; i++) {
    await guest.waitForTimeout(200);
    rules = await guest.locator('select[name="seconds"]').inputValue();
  }
  assert.equal(rules, "60", "the guest sees the host's rules");
  assert.ok(
    await guest.locator('select[name="seconds"]').isDisabled(),
    "and cannot change them",
  );
  assert.ok(
    (await variety(host, ".ff-bays")) > 10,
    "the loading bays are drawn",
  );
  await snap(host, "online-lobby");
  await host.getByRole("button", { name: "START THE TRAINS ▶" }).click();
  for (const page of [host, guest])
    await page.locator('main[data-phase="play"]').waitFor({ timeout: 20_000 });
  await host.waitForTimeout(8_000);
  const drivers = await Promise.all(
    [host, guest].map((page) => page.locator(".ff-card").count()),
  );
  assert.deepEqual(drivers, [3, 3], "both pages show three trains");
  await snap(host, "online-host");
  await snap(guest, "online-guest");
  // The guest reloads mid-round: same member, back in its seat and its train.
  await guest.reload();
  await guest.locator('main[data-phase="play"]').waitFor({ timeout: 25_000 });
  await guest.locator(".ff-card.you").waitFor({ timeout: 10_000 });
  assert.equal(
    await guest.locator(".ff-card").count(),
    3,
    "no extra seat after the reload",
  );
  console.log(`online ${code}: guest reloaded and drives on`);
  // Both replicas agree on how the round ended.
  const banner = async (page) => {
    await page.locator('main[data-phase="outro"]').waitFor({ timeout: 90_000 });
    return page.locator(".ff-banner strong").textContent();
  };
  const [hostEnd, guestEnd] = await Promise.all([banner(host), banner(guest)]);
  assert.equal(hostEnd, guestEnd, "host and guest agree on the round");
  await snap(host, "online-outro");
  // One round win takes the match: the result card, then a rematch and back to the lobby.
  await host.locator(".ff-result").waitFor({ timeout: 20_000 });
  await guest.locator(".ff-result").waitFor({ timeout: 20_000 });
  const [hostResult, guestResult] = await Promise.all(
    [host, guest].map((page) => page.locator(".ff-result h2").textContent()),
  );
  assert.equal(hostResult, guestResult, "one result on both pages");
  assert.ok(
    await guest
      .locator(".ff-result")
      .getByText("Waiting for the host to start a rematch")
      .isVisible(),
  );
  await snap(host, "online-result");
  await host.getByRole("button", { name: "REMATCH" }).click();
  for (const page of [host, guest])
    await page
      .locator('main[data-phase="countdown"]')
      .waitFor({ timeout: 20_000 });
  // LOBBY mid-match asks twice.
  await host.locator(".ff-to-lobby").click();
  assert.equal(
    await host.locator(".ff-to-lobby").textContent(),
    "END MATCH? TAP AGAIN",
  );
  await host.locator(".ff-to-lobby").click();
  for (const page of [host, guest])
    await page
      .locator('main[data-screen="lobby"]')
      .waitFor({ timeout: 20_000 });
  console.log(
    `online ${code}: round ended "${hostEnd}", result "${hostResult}", rematch and lobby work`,
  );
  await host.context().close();
  await guest.context().close();

  // ---- a shared TV with a phone as the controller ----
  const phoneContext = {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  };
  const sharedHost = await open("fuse-freight/?mute&autopilot");
  await sharedHost.locator(".ff-shared input").check();
  await sharedHost.getByRole("button", { name: "CREATE ROOM" }).click();
  await sharedHost.waitForURL(/room=[A-Z0-9]+/);
  const sharedCode = new URL(sharedHost.url()).searchParams.get("room");
  await seat(sharedHost, "Host");
  assert.ok(
    await sharedHost
      .getByRole("button", { name: "OPEN TV SCREEN" })
      .isVisible(),
  );
  const tv = await open(`fuse-freight/?room=${sharedCode}&display=1&mute`, {
    viewport: { width: 1600, height: 900 },
  });
  const phone = await open(
    `fuse-freight/?room=${sharedCode}&mute`,
    phoneContext,
  );
  await seat(phone, "Phone");
  await sharedHost
    .locator(".fui-roster-row")
    .nth(1)
    .waitFor({ timeout: 20_000 });
  await sharedHost.locator('select[name="seconds"]').selectOption("60");
  await sharedHost.locator('select[name="wins"]').selectOption("1");
  await sharedHost.getByRole("button", { name: "START THE TRAINS ▶" }).click();
  await phone
    .locator('main[data-screen="controller"]')
    .waitFor({ timeout: 20_000 });
  // The phone fits its screen: the header and both buttons, nothing to scroll.
  const height = await phone.evaluate(
    () => document.documentElement.scrollHeight,
  );
  assert.ok(height <= 844, `the controller fits the phone (${height} px)`);
  await tv.locator('main[data-screen="play"]').waitFor({ timeout: 20_000 });
  const left = phone.locator(".ff-controller .ff-pad-left");
  assert.equal(await left.textContent(), "◀ LEFT");
  const box = await left.boundingBox();
  assert.ok(box && box.height > 150 && box.width > 150, "a thumb-sized button");
  await left.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
  });
  await phone.waitForTimeout(400);
  assert.ok(await left.evaluate((node) => node.classList.contains("held")));
  await tv.waitForTimeout(4_000);
  await snap(phone, "shared-phone");
  await left.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch" });
  await tv.waitForTimeout(2_000);
  await snap(tv, "shared-tv");
  // The match ends: the host's controller offers REMATCH, the other phone shows the result and waits.
  await sharedHost
    .locator(".ff-controller-result")
    .waitFor({ timeout: 90_000 });
  await phone.locator(".ff-controller-result").waitFor({ timeout: 20_000 });
  assert.ok(
    await phone
      .locator(".ff-controller-result")
      .getByText("Waiting for the host to start a rematch")
      .isVisible(),
  );
  assert.equal(
    await phone.getByRole("button", { name: "REMATCH" }).isVisible(),
    false,
  );
  await snap(phone, "shared-phone-result");
  await sharedHost
    .locator(".ff-controller-result")
    .getByRole("button", { name: "REMATCH" })
    .click();
  await tv.locator('main[data-phase="countdown"]').waitFor({ timeout: 20_000 });
  console.log(
    `shared ${sharedCode}: the TV shows the depot, the phone is a controller, the host's phone starts the rematch`,
  );
  await sharedHost.context().close();
  await tv.context().close();
  await phone.context().close();

  // ---- a phone driving on its own screen ----
  const handheld = await open("fuse-freight/?solo=1&mute&autopilot", {
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  await handheld
    .locator('main[data-phase="play"]')
    .waitFor({ timeout: 15_000 });
  await handheld.waitForTimeout(3_000);
  assert.ok(
    await handheld.locator(".ff-touch").isVisible(),
    "touch buttons over the depot",
  );
  await snap(handheld, "phone-solo");
  await handheld.context().close();

  // ---- a room that does not exist ----
  const nowhere = await open("fuse-freight/?room=ZZ99&mute");
  await nowhere.locator(".ff-closed").waitFor({ timeout: 20_000 });
  assert.equal(
    await nowhere
      .getByRole("button", { name: "START THE TRAINS ▶" })
      .isVisible(),
    false,
  );
  await snap(nowhere, "room-closed");
  console.log("a missing room shows the closed-room card");
  await nowhere.context().close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("fuse-freight smoke: ok");
} finally {
  await browser.close();
}
