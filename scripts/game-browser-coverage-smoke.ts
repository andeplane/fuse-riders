import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { startGameCoverage } from "./lib/game-browser-coverage.js";

const base = process.argv[2];
if (!base || !process.env.FUSE_GAME_COVERAGE_DIR)
  throw new Error("Pass the Vite source origin and FUSE_GAME_COVERAGE_DIR");

interface Flow {
  gameId: string;
  play(page: Page): Promise<void>;
}
const flows: Flow[] = [
  {
    gameId: "ball-bros",
    async play(page) {
      await page
        .getByRole("button", { name: "PLAY SOLO", exact: true })
        .click();
      await page.locator('#app[data-phase="running"]').waitFor();
      await page.keyboard.down("d");
      await page.keyboard.down("Space");
      await page.keyboard.up("Space");
      await page.keyboard.up("d");
      await page.locator("canvas").waitFor();
    },
  },
  {
    gameId: "graveyard-shift",
    async play(page) {
      await page
        .getByRole("button", { name: "START SOLO SHIFT", exact: true })
        .click();
      await page.locator('main[data-phase="running"]').waitFor();
      const player = page.locator(".personal");
      await page.waitForFunction(
        () => !!document.querySelector<HTMLElement>(".personal")?.dataset.x,
      );
      const x = await player.getAttribute("data-x");
      await page.keyboard.down("d");
      await page.waitForFunction(
        (before) =>
          document.querySelector<HTMLElement>(".personal")?.dataset.x !==
          before,
        x,
      );
      await page.keyboard.up("d");
      await page.keyboard.press("j");
      await page.keyboard.press("Space");
    },
  },
  {
    gameId: "hook-havok",
    async play(page) {
      await page.locator('#status[data-state="ready"]').waitFor();
      await page.locator("#start").click();
      await page.locator('#status[data-state="playing"]').waitFor();
      await page
        .locator("details")
        .filter({ has: page.getByText("Movement workshop", { exact: true }) })
        .locator("summary")
        .click();
      await page.locator("#map").selectOption("spire");
      await page
        .getByRole("button", { name: "Apply and restart", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLElement>("#scene")?.dataset.map ===
          "spire",
      );
      await page.locator("#scene").focus();
      await page.keyboard.down("k");
      await page.waitForFunction(
        () =>
          Number(
            document.querySelector<HTMLElement>("#scene")?.dataset.charge ?? 0,
          ) > 0,
      );
      await page.keyboard.up("k");
      await page.waitForFunction(
        () =>
          JSON.parse(
            document.querySelector<HTMLElement>("#scene")?.dataset.bombs ??
              "[]",
          ).length > 0,
      );
    },
  },
  {
    gameId: "fuse-craft",
    async play(page) {
      await page.locator('[data-action="new-game"]').click();
      await page.locator('[data-action="start"]:enabled').waitFor();
      await page.locator('[data-action="start"]').click();
      await page.locator("#nd-board .structure").first().waitFor();
      await page.locator("#nd-board").focus();
      await page.keyboard.press("ArrowRight");
      await page.locator('[data-action="help"]').click();
      await page.locator('[data-action="close-help"]').click();
    },
  },
];

const browser = await chromium.launch({ headless: true });
const failures: string[] = [];
try {
  for (const flow of flows) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let finish: (() => Promise<void>) | undefined;
    try {
      finish = await startGameCoverage(page, { gameId: flow.gameId });
      await page.goto(`${base.replace(/\/$/, "")}/${flow.gameId}/?mute`);
      await flow.play(page);
      assert.deepEqual(errors, [], `${flow.gameId}: browser errors`);
      console.log(`${flow.gameId}: real menu and play flow executed`);
    } catch (error) {
      failures.push(`${flow.gameId}: ${String(error)}`);
    } finally {
      try {
        await finish?.();
      } catch (error) {
        failures.push(`${flow.gameId} coverage: ${String(error)}`);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
if (failures.length) throw new Error(failures.join("\n"));
