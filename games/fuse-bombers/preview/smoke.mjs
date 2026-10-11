/**
 * Browser smoke for Fuse Bombers' online rooms against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-bombers/preview/smoke.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * 1. Online: one page creates a room, a second types its code on the landing page and joins, the host adds a bot
 *    and starts; both fly (A or D held) and fire (Space), and the round ends with the same winner on both.
 * 2. A shared TV: the creator ticks "Shared TV", the TV page (`&display=1`) shows the lobby's QR code and takes no
 *    seat, a phone joins, and once the host starts the TV draws the round while the phone is a controller (its game
 *    asleep, no way out of the room but LEAVE) whose D-pad steers and whose FIRE fires, that lets go of the D-pad when
 *    the page loses focus and keeps its header clear of the pads when turned on its side.
 * Run by hand; not in CI. Screenshots go to the directory given, and nowhere else. Every page opens muted. Headless
 * Chrome's software GL draws these pages at a few frames a second: `--enable-gpu --use-angle=gl` makes them usable.
 * Waits are for conditions with a timeout, never for a fixed time, so a slow machine fails only by timing out.
 */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join as path } from "node:path";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const snap = async (page, name) => {
  if (shots) await page.screenshot({ path: path(shots, `${name}.png`) });
};

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
  args: ["--enable-gpu", "--use-angle=gl"],
});
const errors = [];
const open = async (path, options = {}) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ...options,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource/.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto(base + path);
  return page;
};
const join = async (page, name) => {
  const input = page.locator(".fui-name-entry input").first();
  await input.waitFor({ timeout: 20_000 });
  await input.fill(name);
  await page.getByRole("button", { name: "JOIN", exact: true }).click();
};
const create = async (page) => {
  await page.getByRole("button", { name: "CREATE ROOM" }).click();
  await page.waitForURL(/room=[A-Z0-9]+/);
  return new URL(page.url()).searchParams.get("room");
};
/** The round's result title, once the page shows the scoreboard between rounds (or the match's end). */
const result = async (page) => {
  const title = page.locator("#screen .panel :is(h1, h2)").first();
  await title.waitFor({ timeout: 240_000 });
  return title.textContent();
};
/** Flies `page` about with the keys until `done` settles: A or D held in turn, Space tapped. */
const fly = async (page, done) => {
  let over = false;
  const stop = () => (over = true);
  done.then(stop, stop);
  for (let i = 0; !over; i++) {
    const key = i % 4 < 2 ? "KeyA" : "KeyD";
    await page.keyboard.down(key);
    await page.keyboard.press("Space");
    await page.waitForTimeout(400);
    await page.keyboard.up(key);
  }
};

try {
  // ---- online: create, join by code, add a bot, start, fly and fire ----
  const host = await open("fuse-bombers/?mute");
  const code = await create(host);
  await join(host, "Host");
  const guest = await open("fuse-bombers/?mute");
  await guest.getByPlaceholder("Room code").fill(code);
  await guest.getByPlaceholder("Room code").press("Enter");
  await guest.waitForURL(new RegExp(`room=${code}`));
  await join(guest, "Guest");
  await host.locator(".fui-roster-row").nth(1).waitFor({ timeout: 30_000 });
  await host.getByRole("button", { name: "+ ADD BOT" }).click();
  await guest.locator(".fui-roster-row").nth(2).waitFor({ timeout: 10_000 });
  await snap(host, "online-lobby");
  await host.getByRole("button", { name: "START" }).click();
  for (const page of [host, guest])
    await page
      .locator('#screen[data-screen="playing"]')
      .waitFor({ timeout: 20_000 });
  const ends = [host, guest].map(result);
  const both = Promise.all(ends);
  await Promise.all([fly(host, both), fly(guest, both)]);
  const [hostEnd, guestEnd] = await both;
  assert.equal(hostEnd, guestEnd, "host and guest agree on the round");
  await snap(guest, "online-result");
  console.log(`online ${code}: the round ended "${hostEnd}" on both`);
  await host.context().close();
  await guest.context().close();

  // ---- a shared TV with a phone as the controller ----
  const creator = await open("fuse-bombers/?mute");
  await creator.locator(".fb-shared input").check();
  const sharedCode = await create(creator);
  await join(creator, "Host");
  assert.ok(await creator.getByText("OPEN TV SCREEN").isVisible());
  // `?debug` hands the page's room and game to this script: the TV's replica of the room, and whether a game draws.
  const tv = await open(
    `fuse-bombers/?room=${sharedCode}&display=1&mute&debug`,
    { viewport: { width: 1600, height: 900 } },
  );
  await tv.locator(".fui-invite-qr").waitFor({ timeout: 20_000 });
  assert.equal(await tv.locator(".fui-name-entry").isVisible(), false);
  const phone = await open(`fuse-bombers/?room=${sharedCode}&mute&debug`, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await join(phone, "Phone");
  await tv.locator(".fui-roster-row").nth(1).waitFor({ timeout: 30_000 });
  assert.equal(await tv.locator(".fui-roster-row").count(), 2, "no TV seat");
  await snap(tv, "shared-tv-lobby");
  await creator.getByRole("button", { name: "START" }).click();
  await phone
    .locator('.fb-online[data-screen="controller"]')
    .waitFor({ timeout: 20_000 });
  await tv
    .locator('#screen[data-screen="playing"]')
    .waitFor({ timeout: 20_000 });
  // The phone draws no arena: its game's loop sleeps while the TV's runs, and the only ways off its page are LEAVE.
  const drawing = (page) =>
    page.evaluate(() => window.fuseBombers.game.loop.running);
  await phone.waitForFunction(
    () => !window.fuseBombers.game.loop.running,
    null,
    {
      timeout: 10_000,
    },
  );
  assert.equal(await drawing(tv), true, "the TV draws the round");
  assert.equal(await phone.locator(".fui-portal").isVisible(), false);
  // The phone's D-pad and FIRE: the input layer's, big. A thumb on ▶ and FIRE.
  const pads = () =>
    phone.evaluate(() =>
      [...document.querySelectorAll('[data-input="touch-pads"] > div')]
        .filter((e) => e.style.display !== "none")
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
    );
  const [dpad, fire] = await pads();
  assert.ok(dpad && fire && dpad.width > 200, "a big D-pad and FIRE");
  const ship = () =>
    phone.evaluate(() => document.querySelector(".fb-pad-state")?.textContent);
  const touch = async (rect, fx, fy, type, pointerId) =>
    phone.locator('[data-input="touch-pads"]').dispatchEvent(type, {
      pointerId,
      pointerType: "touch",
      clientX: rect.x + rect.width * fx,
      clientY: rect.y + rect.height * fy,
    });
  await phone.waitForFunction(
    () => /LOADED/.test(document.querySelector(".fb-pad-state")?.textContent),
    null,
    { timeout: 15_000 },
  );
  /** The phone's gunship on the TV's replica of the room (`?debug`). */
  const where = () =>
    tv.evaluate(() => {
      const room = window.fuseBombers.runtime.roomState();
      const seat = [...room.seats.values()].find((s) => s.name === "Phone");
      const c = room.world.castles[room.ships.indexOf(seat.id)];
      return { x: c.x, y: c.y };
    });
  const lit = (glyph) =>
    phone.evaluate(
      (glyph) =>
        [...document.querySelectorAll('[data-input="touch-pads"] span')].find(
          (cell) => cell.textContent === glyph,
        )?.style.opacity === "1",
      glyph,
    );
  const before = await ship(),
    from = await where();
  // A thumb on ◀ (the phone's gunship starts on the right) until the TV sees it move, then slid up to the ◤ diagonal;
  // FIRE with another thumb, until the launcher reloads.
  await touch(dpad, 0.05, 0.5, "pointerdown", 3);
  assert.ok((await lit("◀")) && !(await lit("▲")), "a thumb on ◀ holds LEFT");
  await tv.waitForFunction(
    (x) => {
      const room = window.fuseBombers.runtime.roomState();
      const seat = [...room.seats.values()].find((s) => s.name === "Phone");
      return room.world.castles[room.ships.indexOf(seat.id)].x < x - 20;
    },
    from.x,
    { timeout: 30_000 },
  );
  await touch(dpad, 0.05, 0.05, "pointermove", 3);
  assert.ok((await lit("◀")) && (await lit("▲")), "slid to ◤: LEFT and UP");
  await touch(fire, 0.5, 0.5, "pointerdown", 4);
  await phone.waitForFunction(
    () =>
      /RELOADING/.test(document.querySelector(".fb-pad-state")?.textContent),
    null,
    { polling: 50, timeout: 10_000 },
  );
  await touch(fire, 0.5, 0.5, "pointerup", 4);
  const to = await where();
  assert.match(before ?? "", /LAUNCHER LOADED/);
  assert.ok(to.x < from.x - 20, `steered left: ${from.x} → ${to.x}`);
  await snap(tv, "shared-tv");
  await snap(phone, "shared-phone");
  // A page that loses focus lets go of the D-pad, however the thumb sits.
  await phone.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.ok(!(await lit("◀")) && !(await lit("▲")), "blur lets go");
  await touch(dpad, 0.05, 0.05, "pointerup", 3);
  // Turned on its side, the pads move with the phone and the header stays clear of them.
  await phone.setViewportSize({ width: 667, height: 375 });
  await phone.waitForFunction(
    () => {
      const first = document.querySelector('[data-input="touch-pads"] > div');
      return innerWidth === 667 && first?.getBoundingClientRect().left < 20;
    },
    null,
    { timeout: 10_000 },
  );
  const clear = await phone.evaluate(() => {
    const header = document.querySelector(".fb-pad").getBoundingClientRect();
    const tops = [
      ...document.querySelectorAll('[data-input="touch-pads"] > div'),
    ]
      .filter((e) => e.style.display !== "none")
      .map((e) => e.getBoundingClientRect().top);
    return { bottom: header.bottom, tops };
  });
  assert.equal(clear.tops.length, 2, "both pads shown");
  assert.ok(
    clear.tops.every((top) => top >= clear.bottom - 1),
    `the header ends at ${clear.bottom}, the pads start at ${clear.tops}`,
  );
  await snap(phone, "shared-phone-landscape");
  console.log(
    `shared ${sharedCode}: the TV draws the round, the phone's game sleeps, it steers (x ${Math.round(from.x)} → ${Math.round(to.x)}) and fires`,
  );
  for (const page of [creator, tv, phone]) await page.context().close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("fuse-bombers smoke: ok");
} finally {
  await browser.close();
}
