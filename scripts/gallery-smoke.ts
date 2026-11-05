import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { launchBrowser } from "./lib/browser.js";
import { startRoomService, startViteServer } from "./lib/server.js";

const server = process.env.GALLERY_SOURCE
  ? await startViteServer()
  : await startRoomService();
const browser = await launchBrowser(
  process.env.BROWSER === "webkit" ? "webkit" : "chrome",
);
const root = process.env.GALLERY_URL ?? server.url;
const gamesRoot = new URL("../games/", import.meta.url);
const expectedGames = readdirSync(gamesRoot)
  .filter((id) => existsSync(new URL(`${id}/portal.json`, gamesRoot)))
  .sort();
const errors: string[] = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("artifacts/gallery", { recursive: true });
  await page.goto(`${root}?mute`);
  await page.getByRole("heading", { name: "What are we playing?" }).waitFor();
  const cards = page.locator(".arcade-game");
  assert.equal(await cards.count(), expectedGames.length);
  await page.locator(".arcade-footer").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLImageElement>(".arcade-media img")].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  assert.equal(await page.locator("canvas").count(), 0);
  await page.screenshot({
    path: "artifacts/gallery/desktop.png",
    fullPage: true,
  });
  const hrefs = await cards.evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).href),
  );
  assert.deepEqual(
    hrefs.map((href) => new URL(href).pathname.split("/").at(-2)).sort(),
    expectedGames,
  );
  for (const href of hrefs) {
    console.log(`Gallery navigation: ${new URL(href).pathname}`);
    const response = await page.goto(href);
    assert.equal(response?.status(), 200, href);
    if (new URL(href).pathname.endsWith("/fuse-riders/"))
      await page.locator('canvas[data-renderer^="phaser-"]').first().waitFor();
    await page
      .getByRole("button", { name: "Fuse games", exact: true })
      .first()
      .waitFor();
    const toggle = page
      .getByRole("button", { name: "Fuse games", exact: true })
      .first();
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await toggle.click();
      const panel = page.locator(".fui-portal-panel:visible").first();
      const bounds = await panel.boundingBox();
      assert.ok(bounds, `${href}: launcher visible`);
      assert.ok(bounds.x >= 0 && bounds.y >= 0, `${href}: launcher origin`);
      assert.ok(
        bounds.x + bounds.width <= viewport.width + 1 &&
          bounds.y + bounds.height <= viewport.height + 1,
        `${href}: launcher fits ${viewport.width}x${viewport.height}`,
      );
      const lastGame = panel.locator(".fui-portal-game").last();
      await panel.locator(".fui-portal-heading").focus();
      await lastGame.focus();
      const lastBounds = await lastGame.boundingBox();
      assert.ok(lastBounds, `${href}: final game reachable`);
      assert.ok(
        lastBounds.y >= bounds.y &&
          lastBounds.y + lastBounds.height <= bounds.y + bounds.height + 1,
        `${href}: final game scrolls inside launcher at ${viewport.width}x${viewport.height}: ${JSON.stringify({ bounds, lastBounds })}`,
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await toggle.evaluate((node) => node === document.activeElement),
        true,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await toggle.click();
    await page
      .getByRole("link", { name: "ALL GAMES ↗", exact: true })
      .first()
      .click();
    await page.getByRole("heading", { name: "What are we playing?" }).waitFor();
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${root}?mute`);
    await page.getByRole("heading", { name: "What are we playing?" }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.locator(".arcade-footer").scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll<HTMLImageElement>(".arcade-media img"),
      ].every((image) => image.complete && image.naturalWidth > 0),
    );
    await page.screenshot({
      path: `artifacts/gallery/mobile-${width}.png`,
      fullPage: true,
    });
  }
  await page.goto(`${root}?room=INVALID&display=1&mute`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  await page.goto(`${root}?solo=1&mute`);
  await page.locator('canvas[data-renderer^="phaser-"]').first().waitFor();
  await page.goto(`${root}fuse-riders/?solo=1&mute`);
  await page.locator('canvas[data-renderer^="phaser-"]').first().waitFor();
  assert.deepEqual(errors, []);
  console.log(
    `Gallery: ${expectedGames.length} games, screenshots and return links, bounded launchers at desktop/320/390/landscape, keyboard recovery, legacy room/display/solo and dedicated Riders solo passed.`,
  );
} finally {
  await browser.close();
  await server.stop();
}
