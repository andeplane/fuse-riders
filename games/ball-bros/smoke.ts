import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "../../scripts/lib/browser.js";

/** Real page only: no state injection or accelerated simulation. Run against the built dev server. */
const origin = process.env.ONLINE_URL ?? "http://localhost:8792/";
const browser = await launchSelected("chrome");
await mkdir("artifacts", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("?mute", origin).href);
  await page.getByRole("link", { name: "BALL BROS · SOLO POC ›" }).click();
  // Preserve ephemeral mute when navigating from another game's landing.
  await page.goto(new URL("ball-bros/?mute", origin).href);
  await page.getByRole("button", { name: "PLAY SOLO", exact: true }).click();
  await page.getByText("GET READY · 3", { exact: true }).waitFor();
  assert.equal(await page.locator(".scorecard").count(), 5);
  await page.keyboard.down("KeyD");
  await page.keyboard.down("KeyW");
  await page.getByText("GET READY · 2", { exact: true }).waitFor();
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  await page.getByRole("button", { name: "SOUND OFF", exact: true }).focus();
  await page.keyboard.down("KeyS");
  await page.getByText("GET READY · 1", { exact: true }).waitFor();
  await page.keyboard.up("KeyS");
  await page.getByText("SPACE TO LAUNCH", { exact: true }).waitFor();
  // Space on a focused UI button retains native activation. Return focus to the arena first.
  await page.locator("canvas").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Space");
  await page
    .getByText("SPACE TO LAUNCH", { exact: true })
    .waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".scorecard strong")].some(
        (e) => e.textContent !== "48 / 48",
      ),
    undefined,
    { timeout: 125000 },
  );
  await page.screenshot({
    path: "artifacts/ball-bros-desktop.png",
    fullPage: true,
  });
  const pad = await page.getByRole("button", { name: "RIGHT ↷" }).boundingBox();
  assert.ok(
    pad && pad.y + pad.height <= 1000,
    "game controls fit the desktop viewport",
  );
  await page.getByRole("button", { name: "RESTART ROUND" }).click();
  await page.getByText("GET READY · 3", { exact: true }).waitFor();
  assert.ok(
    (await page.locator(".scorecard strong").allTextContents()).every(
      (t) => t === "48 / 48",
    ),
  );
  await page
    .getByRole("button", { name: "PLAY AGAIN" })
    .waitFor({ timeout: 135000 });
  await page.getByRole("button", { name: "PLAY AGAIN" }).click();
  await page.getByText("GET READY · 3", { exact: true }).waitFor();
  assert.ok(
    (await page.locator(".scorecard strong").allTextContents()).every(
      (t) => t === "48 / 48",
    ),
  );

  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(new URL("ball-bros/?mute", origin).href);
  await phone.getByRole("button", { name: "PLAY SOLO", exact: true }).click();
  await phone.getByText("GET READY · 2", { exact: true }).waitFor();
  await phone.getByRole("button", { name: "RIGHT ↷" }).tap();
  await phone.getByRole("button", { name: "OUT ↑" }).tap();
  await phone.getByRole("button", { name: "IN ↓" }).tap();
  assert.equal(await phone.locator(".pad").count(), 5);
  assert.ok(
    await phone.evaluate(() => document.documentElement.scrollWidth <= 390),
  );
  await phone.screenshot({
    path: "artifacts/ball-bros-phone.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: menu, solo, combined orbit/reach controls, Space launch, damage, restart, full round, rematch, five-button phone layout; muted screenshots saved.",
  );
} finally {
  await browser.close();
}
