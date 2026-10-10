/**
 * Browser smoke for Fuse Axe against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-axe/preview/smoke.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * 1. The landing page: the portal button first in the header, the keys on screen.
 * 2. Solo: the hero picker comes first; Rhea is picked, START sets out, and the hero walks right and jumps.
 * 3. Online: one page creates a room, a second joins by its code and picks Gorm; both rosters show it, the host
 *    starts, the guest walks and both pages draw its hero in the same place.
 * 4. A well-formed code for a room that does not exist shows the closed-room card.
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
const open = async (path) => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
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
  // The browser's own favicon probe is the one request allowed to miss.
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(base + path);
  return page;
};
const P1 = [0x2d, 0xe2, 0xff],
  P2 = [0xff, 0x4f, 0xa3];
/** Where a seat's box is on the native 320 × 180 screen, read back from the scaled canvas; null if not drawn. */
const hero = (page, rgb) =>
  page.evaluate((rgb) => {
    const canvas = document.querySelector(".fa-canvas"),
      scale = canvas.width / 320,
      { data, width, height } = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height);
    let left = Infinity,
      top = Infinity;
    for (let y = 0; y < height; y += scale)
      for (let x = 0; x < width; x += scale) {
        const i = (y * width + x) * 4;
        if (
          data[i] === rgb[0] &&
          data[i + 1] === rgb[1] &&
          data[i + 2] === rgb[2]
        ) {
          left = Math.min(left, x / scale);
          top = Math.min(top, y / scale);
        }
      }
    return left === Infinity ? null : { x: left, y: top, scale };
  }, rgb);
const hold = async (page, key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

try {
  // ---- the landing page ----
  const landing = await open("fuse-axe/?mute");
  await landing.locator(".fui-landing").waitFor({ timeout: 15_000 });
  assert.equal(
    await landing.locator(".fa-top > .fui-portal:first-child").count(),
    1,
    "the portal leads the header",
  );
  // The portal lists Fuse Axe as the current game.
  await landing.locator(".fui-portal-toggle").click();
  assert.ok(
    await landing
      .locator(".fui-portal-game", { hasText: "Fuse Axe" })
      .isVisible(),
  );
  await snap(landing, "portal");
  await landing.keyboard.press("Escape");
  assert.match(await landing.locator(".fa-keys").textContent(), /J \/ Z/);
  await snap(landing, "landing");

  // ---- solo: pick a hero, set out, walk and jump ----
  await landing.getByRole("button", { name: "PLAY SOLO" }).click();
  await landing.waitForURL(/solo=1/);
  assert.ok(new URL(landing.url()).searchParams.has("mute"), "mute carries");
  await landing
    .locator('main[data-screen="lobby"]')
    .waitFor({ timeout: 15_000 });
  await landing.locator('[data-hero="rhea"]').click();
  await landing.locator('main[data-hero="rhea"]').waitFor({ timeout: 5_000 });
  await landing.getByRole("button", { name: "START" }).click();
  await landing.locator('main[data-screen="play"]').waitFor({ timeout: 5_000 });
  await landing.waitForTimeout(500);
  const before = await hero(landing, P1);
  assert.ok(before, "P1 is drawn");
  assert.ok(before.scale >= 2 && Number.isInteger(before.scale), "whole scale");
  await hold(landing, "ArrowRight", 800);
  const walked = await hero(landing, P1);
  assert.ok(
    walked.x > before.x + 20,
    `walked right: ${before.x} → ${walked.x}`,
  );
  await landing.keyboard.down("KeyK");
  await landing.waitForTimeout(250);
  const jumped = await hero(landing, P1);
  await landing.keyboard.up("KeyK");
  assert.ok(jumped.y < walked.y - 10, `jumped: ${walked.y} → ${jumped.y}`);
  await landing.waitForTimeout(800);
  await snap(landing, "solo-play");
  console.log(
    `solo: Rhea walked ${walked.x - before.x}px and jumped ${walked.y - jumped.y}px at ${before.scale}×`,
  );
  await landing.context().close();

  // ---- online: create, join by code, pick, start, play ----
  const host = await open("fuse-axe/?mute");
  await host.getByRole("button", { name: "CREATE ROOM" }).click();
  await host.waitForURL(/room=[A-Z0-9]+/);
  const code = new URL(host.url()).searchParams.get("room");
  const enter = async (page, name) => {
    const input = page.locator(".fui-name-input").first();
    await input.waitFor({ timeout: 15_000 });
    await input.fill(name);
    await page.getByRole("button", { name: "JOIN", exact: true }).click();
  };
  await enter(host, "Host");
  const guest = await open(`fuse-axe/?room=${code}&mute`);
  await enter(guest, "Guest");
  await host.locator(".fui-roster-row").nth(1).waitFor({ timeout: 20_000 });
  await guest.locator('main[data-hero="brakka"]').waitFor({ timeout: 10_000 });
  await guest.locator('[data-hero="gorm"]').click();
  for (const page of [host, guest])
    await page
      .locator(".fui-roster-row", { hasText: "P2 · GORM" })
      .waitFor({ timeout: 10_000 });
  await snap(host, "online-lobby");
  await host.getByRole("button", { name: "START" }).click();
  for (const page of [host, guest])
    await page.locator('main[data-screen="play"]').waitFor({ timeout: 20_000 });
  await guest.waitForTimeout(500);
  await hold(guest, "KeyD", 700);
  await guest.waitForTimeout(1_000);
  const [onHost, onGuest] = await Promise.all(
    [host, guest].map((page) => hero(page, P2)),
  );
  assert.ok(onHost && onGuest, "both pages draw P2");
  assert.deepEqual(
    [onHost.x, onHost.y],
    [onGuest.x, onGuest.y],
    "both pages put P2 in the same place",
  );
  assert.ok(onGuest.x > 50, `P2 walked: ${onGuest.x}`);
  await snap(host, "online-host");
  await snap(guest, "online-guest");
  console.log(`online ${code}: Gorm picked, walked to x ${onGuest.x} on both`);
  await host.context().close();
  await guest.context().close();

  // ---- a room that does not exist ----
  const nowhere = await open("fuse-axe/?room=ZZ99&mute");
  await nowhere.locator(".fa-closed").waitFor({ timeout: 20_000 });
  assert.equal(
    await nowhere.getByRole("button", { name: "START" }).isVisible(),
    false,
  );
  console.log("a missing room shows the closed-room card");
  await nowhere.context().close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("fuse-axe smoke: ok");
} finally {
  await browser.close();
}
