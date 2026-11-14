import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "../../scripts/lib/browser.js";
import { startGameCoverage } from "../../scripts/lib/game-browser-coverage.js";
import { openPlayOptions } from "../../scripts/lib/main-menu.js";

/** Real page only: no state injection or accelerated simulation. Run against the built dev server. */
const origin = process.env.ONLINE_URL ?? "http://localhost:8792/";
const browser = await launchSelected("chrome");
await mkdir("artifacts", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  const finishCoverage = await startGameCoverage(page, { gameId: "ball-bros" });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("fuse-riders/?mute", origin).href);
  await page.getByRole("button", { name: "Fuse games", exact: true }).click();
  await page.getByRole("link", { name: /Ball Bros/ }).click();
  // Preserve ephemeral mute when navigating from another game's landing.
  await page.goto(new URL("ball-bros/?mute", origin).href);
  // The arena lives under Settings, the avatar beside the hosting options of the Play menu.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "ARENA" }).selectOption("ricochet");
  await page.keyboard.press("Escape");
  await openPlayOptions(page);
  await page
    .getByRole("combobox", { name: "Core avatar" })
    .selectOption("dragon");
  await openPlayOptions(page, "single");
  await page.getByText("GET READY · 3", { exact: true }).waitFor();
  await page.getByText("RICOCHET REACTOR", { exact: true }).waitFor();
  assert.equal(await page.locator(".scorecard").count(), 5);
  // The radio sits in the header's game menu.
  const gameMenu = page.getByRole("button", { name: "Open game menu" });
  await gameMenu.click();
  await page.getByRole("button", { name: "Next radio track" }).click();
  await page.getByRole("button", { name: "RADIO OFF", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.down("KeyD");
  await page.keyboard.down("KeyW");
  await page.getByText("GET READY · 2", { exact: true }).waitFor();
  await page.keyboard.up("KeyD");
  await page.keyboard.up("KeyW");
  // ?mute disables the Sound button, so the focused header control is the game menu's.
  await gameMenu.focus();
  await page.keyboard.down("KeyS");
  await page.getByText("GET READY · 1", { exact: true }).waitFor();
  await page.keyboard.up("KeyS");
  await page.getByText("SPACE TO LAUNCH", { exact: true }).waitFor();
  // Space on a focused UI button retains native activation. Return focus to the arena first.
  await page.locator(".canvas-host").click({ position: { x: 20, y: 20 } });
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
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".card-label")].some((e) =>
        /SHRINK|STICKY|THIEF|BOMB/.test(e.textContent ?? ""),
      ),
    undefined,
    { timeout: 120000 },
  );
  await page.screenshot({
    path: "artifacts/ball-bros-desktop.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "artifacts/ball-bros-ricochet.png",
    fullPage: true,
  });
  const pad = await page.getByRole("button", { name: "RIGHT ↷" }).boundingBox();
  assert.ok(
    pad && pad.y + pad.height <= 1000,
    "game controls fit the desktop viewport",
  );
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const bounds = await page.evaluate(() => {
      const arena = document
        .querySelector(".arena-wrap")!
        .getBoundingClientRect();
      return {
        controlsFit: [...document.querySelectorAll(".pad")].every((node) => {
          const box = node.getBoundingClientRect();
          return (
            box.top >= 0 &&
            box.left >= 0 &&
            box.right <= innerWidth &&
            box.bottom <= innerHeight
          );
        }),
        arenaWidth: arena.width,
        arenaHeight: arena.height,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(
      bounds.controlsFit,
      `all controls fit ${viewport.width}×${viewport.height}`,
    );
    assert.ok(
      bounds.arenaWidth > 200,
      "arena stays playable on a short desktop",
    );
    assert.ok(
      Math.abs(bounds.arenaWidth - bounds.arenaHeight) < 1,
      "arena stays square",
    );
    assert.ok(
      bounds.pageWidth <= viewport.width,
      "desktop has no horizontal overflow",
    );
    if (viewport.height === 720)
      await page.screenshot({ path: "artifacts/ball-bros-short-desktop.png" });
  }
  await page.getByRole("button", { name: "RESTART ROUND" }).click();
  await page.getByText("GET READY · 3", { exact: true }).waitFor();
  assert.ok(
    (await page.locator(".scorecard strong").allTextContents()).every(
      (t) => t === "48 / 48",
    ),
  );
  await page
    .locator(".power-status")
    .filter({ hasText: "FUSE FRENZY" })
    .waitFor({ timeout: 70000 });
  await page.screenshot({
    path: "artifacts/ball-bros-frenzy.png",
    fullPage: true,
  });
  assert.match(
    (await page.locator(".power-status").textContent()) ?? "",
    /FUSE FRENZY · \d+ BALLS/,
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
  await openPlayOptions(phone, "single");
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
    "PASS: menu, Ricochet map, solo controls, Space launch, damage, restart, Frenzy, full round, rematch and phone layout; muted screenshots saved.",
  );
  await finishCoverage();
} finally {
  await browser.close();
}
