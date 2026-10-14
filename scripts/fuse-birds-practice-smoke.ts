import { launchSelected } from "./lib/browser.js";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { startGameCoverage } from "./lib/game-browser-coverage.js";

const base =
  process.argv[2] ??
  process.env.ONLINE_URL?.replace(/\/$/, "") ??
  "http://localhost:8893";
const output = process.argv[3] ?? "/tmp/fuse-birds-practice";
await mkdir(output, { recursive: true });
const browser = await launchSelected("chrome", { headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
  });
  const errors: string[] = [],
    roomRequests: string[] = [];
  const finishCoverage = await startGameCoverage(page, {
    gameId: "fuse-birds",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/rooms"))
      roomRequests.push(request.url());
  });
  await page.goto(`${base}/fuse-birds/?mute`);
  assert.equal(
    await page.locator(".birds-top > :first-child").getAttribute("class"),
    "fui-portal",
  );
  await page.getByRole("button", { name: "Fuse games", exact: true }).click();
  const birdsLink = page.getByRole("link", { name: "Fuse Birds", exact: true });
  assert.equal(await birdsLink.getAttribute("aria-current"), "page");
  assert.match(
    (await birdsLink.getAttribute("href")) ?? "",
    /fuse-birds\/\?mute$/,
  );
  assert.ok((await page.locator(".fui-portal-game").count()) > 1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "FRIENDS", exact: true }).click();
  const friends = page.locator("dialog[open]");
  await friends.getByRole("button", { name: "SIGN IN", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "1 PLAYER PRACTICE", exact: true })
    .click();
  await page.locator('canvas[data-ready="true"]').waitFor({ timeout: 60_000 });
  assert.ok(page.url().includes("practice=1"));
  assert.equal(
    await page.locator(".birds-top > :first-child").getAttribute("class"),
    "fui-portal",
  );
  assert.equal(await page.locator(".birds-player").count(), 1);
  assert.equal(await page.locator(".birds-lobby").isHidden(), true);
  assert.match(await page.locator(".birds-turn").innerText(), /SOLO PRACTICE/);
  const canvas = page.locator("canvas");
  // An ordinary modal must own keyboard input even when the battlefield has an aim queued.
  for (const name of ["FRIENDS", "SIGN IN"]) {
    await page.locator(".birds-menu summary").click();
    await canvas.focus();
    await page.keyboard.press("i");
    await page.getByRole("button", { name, exact: true }).click();
    const modal = page.locator("dialog[open]");
    await modal.waitFor();
    if (name === "SIGN IN")
      await modal.getByRole("button", { name: "MATCHES", exact: true }).click();
    await modal.evaluate((dialog) => {
      if (dialog instanceof HTMLDialogElement) {
        dialog.tabIndex = -1;
        dialog.focus();
      }
    });
    for (const key of ["i", "j", "k", "l", "Enter"])
      await page.keyboard.press(key);
    assert.equal(
      await page.locator(".birds-room").getAttribute("data-turn"),
      "1",
    );
    await page.screenshot({
      path: `${output}/${name === "FRIENDS" ? "friends" : "account"}-in-practice.png`,
    });
    await page.keyboard.press("Escape");
    const tick = Number(
      await page.locator(".birds-room").getAttribute("data-tick"),
    );
    await canvas.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (before) =>
        Number(
          document.querySelector<HTMLElement>(".birds-room")?.dataset.tick,
        ) >
        before + 5,
      tick,
    );
    assert.equal(
      await page.locator(".birds-room").getAttribute("data-turn"),
      "1",
      "opening a modal clears queued aim rather than firing it after close",
    );
    await page.locator(".birds-menu summary").click();
  }
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
  await finishCoverage();
} finally {
  await browser.close();
}
