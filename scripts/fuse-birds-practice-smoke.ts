import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:8893";
const output = process.argv[3] ?? "/tmp/fuse-birds-practice";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors: string[] = [],
    roomRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/rooms"))
      roomRequests.push(request.url());
  });
  await page.goto(`${base}/fuse-birds/?mute`);
  await page
    .getByRole("button", { name: "1 PLAYER PRACTICE", exact: true })
    .click();
  await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 60_000 });
  assert.ok(page.url().includes("practice=1"));
  assert.equal(await page.locator(".birds-player").count(), 1);
  assert.equal(await page.locator(".birds-lobby").isHidden(), true);
  assert.match(await page.locator(".birds-turn").innerText(), /SOLO PRACTICE/);
  const canvas = page.locator("canvas");
  for (const [weapon, turn] of [
    ["Pebble, unlimited ammunition", 2],
    ["Scatter Bomb, 3 shots remaining", 3],
  ] as const) {
    await page.getByRole("button", { name: weapon, exact: true }).click();
    await canvas.focus();
    await page.keyboard.press("i");
    await page.keyboard.down("Shift");
    for (let i = 0; i < 16; i++) await page.keyboard.press("k");
    await page.keyboard.up("Shift");
    await page.keyboard.press("Enter");
    await page
      .locator(`.birds-room[data-turn="${turn}"][data-phase="aiming"]`)
      .waitFor({ timeout: 30_000 });
    await page.locator('canvas[data-ready="true"]').waitFor();
  }
  await page
    .getByRole("button", {
      name: "Scatter Bomb, 2 shots remaining",
      exact: true,
    })
    .waitFor();
  await page.screenshot({ path: `${output}/solo-practice.png` });
  await page.getByRole("button", { name: "NEW MAP", exact: true }).click();
  await page
    .locator('.birds-room[data-turn="1"][data-phase="aiming"]')
    .waitFor();
  await page
    .getByRole("button", {
      name: "Scatter Bomb, 3 shots remaining",
      exact: true,
    })
    .waitFor();
  await page.reload();
  await page.locator('canvas[data-ready="true"]').waitFor();
  assert.equal(await page.locator(".birds-player").count(), 1);
  assert.deepEqual(roomRequests, [], "practice must not create or join a room");
  assert.deepEqual(errors, []);
  console.log(
    `Solo practice: one bird, Pebble and Scatter shots, next shot, new map/refill and direct-link reload pass. ${output}`,
  );
} finally {
  await browser.close();
}
