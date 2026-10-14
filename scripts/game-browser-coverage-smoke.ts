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
    gameId: "fuse-birds",
    async play(page) {
      await page
        .getByRole("button", { name: "1 PLAYER PRACTICE", exact: true })
        .click();
      const canvas = page.locator('canvas[data-ready="true"]');
      await canvas.waitFor();
      const turn = Number(
        await page.locator(".birds-room").getAttribute("data-turn"),
      );
      await canvas.focus();
      await page.keyboard.press("i");
      await page.keyboard.down("Shift");
      for (let i = 0; i < 16; i++) await page.keyboard.press("k");
      await page.keyboard.up("Shift");
      await page.locator('canvas[data-gesture="keyboard-aim"]').waitFor();
      await page.keyboard.press("Enter");
      await page
        .locator(`.birds-room[data-turn="${turn + 1}"][data-phase="aiming"]`)
        .waitFor();
    },
  },
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
      const tick = Number(
        await page
          .locator('main[data-phase="running"]')
          .getAttribute("data-tick"),
      );
      await page.keyboard.down("w");
      await page.keyboard.down("j");
      await page.waitForFunction(
        (before) =>
          Number(
            document.querySelector<HTMLElement>('main[data-phase="running"]')
              ?.dataset.tick,
          ) >
          before + 5,
        tick,
      );
      await page.keyboard.up("w");
      await page.keyboard.up("j");
      await page.keyboard.press("Space");
    },
  },
  {
    gameId: "hook-havok",
    async play(page) {
      await page.locator('#status[data-state="ready"]').waitFor();
      await page.locator("#start").click();
      await page.locator('#status[data-state="playing"]').waitFor();
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
  for (const flow of flows.filter(
    (candidate) =>
      !process.env.GAME_COVERAGE_ONLY ||
      candidate.gameId === process.env.GAME_COVERAGE_ONLY,
  )) {
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
      console.error(failures.at(-1));
      if (flow.gameId === "hook-havok")
        console.error(
          await page.locator("#scene").evaluate((element) => ({
            map: (element as HTMLElement).dataset.map,
            charge: (element as HTMLElement).dataset.charge,
            bombs: (element as HTMLElement).dataset.bombs,
            tick: (element as HTMLElement).dataset.tick,
            bombMode: (element as HTMLElement).dataset.bombMode,
            focus: document.activeElement?.id,
          })),
        );
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
