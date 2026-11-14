import assert from "node:assert/strict";
import { launchSelected } from "../../scripts/lib/browser.js";
import { startGameCoverage } from "../../scripts/lib/game-browser-coverage.js";
import { openPlayOptions, takeHostSeat } from "../../scripts/lib/main-menu.js";

const origin = process.env.ONLINE_URL ?? "http://localhost:8792/";
const browser = await launchSelected("chrome");
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  const finishCoverage = await startGameCoverage(page, { gameId: "ball-bros" });
  page.on("pageerror", (e) => errors.push(e.message));
  // Radio, Reconnect and Leave sit in the header's game menu.
  const gameMenu = page.getByRole("button", { name: "Open game menu" });
  await page.goto(new URL("ball-bros/?mute", origin).href);
  await openPlayOptions(page);
  await page
    .getByRole("combobox", { name: "Core avatar" })
    .selectOption("dragon");
  await page.screenshot({
    path: "artifacts/ball-bros-avatar-choice.png",
    fullPage: true,
  });
  // Documented asset impairment: abort the optional portrait sheet, never inject game state.
  await page.route("**/avatars/neon-heads.png", (route) => route.abort());
  await openPlayOptions(page, "single");
  await page.getByText("GET READY · 2", { exact: true }).waitFor();
  assert.equal(await page.locator(".scorecard").count(), 5);
  await gameMenu.click();
  await page.getByRole("button", { name: "RADIO OFF", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "artifacts/ball-bros-portrait-fallback.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await gameMenu.click();
  await page.getByRole("button", { name: "LEAVE", exact: true }).click();
  await page.unroute("**/avatars/neon-heads.png");
  await openPlayOptions(page);
  await page.getByRole("button", { name: "Host room", exact: true }).click();
  await page.waitForURL(/room=/);
  await takeHostSeat(page, "Pilot");
  await page.locator(".fui-roster-name", { hasText: "Pilot" }).waitFor();
  await page
    .locator(".fui-room-open-slot")
    .getByRole("button", { name: "Add AI", exact: true })
    .first()
    .click();
  await page.locator(".fui-roster-name", { hasText: "Sparks" }).waitFor();
  await page.screenshot({
    path: "artifacts/ball-bros-phase3-lobby.png",
    fullPage: true,
  });
  await gameMenu.click();
  await page.getByRole("button", { name: "LEAVE", exact: true }).click();
  await page.locator(".fui-main-menu").waitFor();
  console.log(
    "PASS: avatar picker, optional portrait failure, radio remains off and live room lobby; muted screenshots saved.",
  );
  await finishCoverage();
} finally {
  await browser.close();
}
