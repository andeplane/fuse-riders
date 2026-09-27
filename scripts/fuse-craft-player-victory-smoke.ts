import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import type { Action } from "../games/neural-defence/src/engine/types.js";

const output = process.argv[2] ?? "/tmp/fuse-player-victory";
mkdirSync(output, { recursive: true });
// A fixed Relay-opening build plan, not an AI reading the browser's game state.
// All actions are sent through visible controls at ordinary game-clock times.
const plan: { seconds: number; actions: Action[] }[] = JSON.parse(
  readFileSync(
    new URL(
      "../docs/neural-defence/verification/player-victory-2026-09-27/player-plan.json",
      import.meta.url,
    ),
    "utf8",
  ),
).plan;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors: string[] = [];
const completed: unknown[] = [];
page.on("pageerror", (error) => errors.push(error.message));
async function root() {
  const close = page.locator('[data-action="close-panel"]');
  if (await close.count()) await close.click();
}
async function panelButton(panel: string, action: string) {
  await root();
  await page.locator(`[data-action="panel-${panel}"]`).click();
  const button = page.locator(`[data-action="${action}"]`);
  if (!(await button.count()))
    await page.locator('[data-action="next-command-page"]').click();
  await page
    .locator(`[data-action="${action}"][aria-disabled="false"]`)
    .waitFor({ timeout: 90000 });
  return button;
}
async function selectCell(page: Page, cell: number) {
  await root();
  const hit = page.locator(`.structure[data-cell="${cell}"] .structure-hit`);
  await hit.click({ timeout: 30000 });
  assert.match(
    await page.locator(".tile-heading").innerText(),
    new RegExp(`HEX ${cell}\\b`),
  );
}
try {
  await page.routeWebSocket("**", (socket) => socket.close());
  await page.goto("http://127.0.0.1:5174/games/neural-defence/?mute");
  await page.locator('[data-action="new-game"]').click();
  await page.locator('[data-action="mode-skirmish"]').click();
  await page.locator("#map-picker").selectOption("close-quarters");
  await page.locator("#strategy-picker").selectOption("pressure");
  await page.locator('[data-action="start"]').click();
  for (const row of plan) {
    await page.waitForFunction(
      (seconds) => {
        const time = document
          .querySelector(".hud-mini")
          ?.textContent?.match(/(\d+):(\d+)/);
        return time && Number(time[1]) * 60 + Number(time[2]) >= seconds;
      },
      row.seconds,
      { timeout: 90000 },
    );
    for (const action of row.actions) {
      if (action.type === "queueConstruction") {
        await (await panelButton("build", `build-${action.kind}`)).click();
        const box = (await page
          .locator(
            `#nd-board .terrain-layer [data-cell="${action.cell}"] > polygon`,
          )
          .first()
          .boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page
          .locator(`.queue-mark[data-cell="${action.cell}"]`)
          .waitFor({ timeout: 10000 });
      } else if (action.type === "startResearch") {
        await (
          await panelButton("research", `research-${action.research}`)
        ).click();
      } else if (action.type === "setParticleKind") {
        await (
          await panelButton("particles", `particle-${action.kind}`)
        ).click();
      } else if (action.type === "setPriority") {
        await selectCell(page, action.cell);
        const charge = page.locator('[data-action="charge"]');
        if (action.weight === 3 && (await charge.count())) await charge.click();
        else
          await page
            .locator("#priority-slider")
            .press(action.weight === 3 ? "End" : "Home");
        await page.waitForFunction(
          (weight) =>
            (
              document.querySelector(
                "#priority-slider",
              ) as HTMLInputElement | null
            )?.value === String(weight),
          action.weight,
        );
      } else throw new Error(`Unsupported player action ${action.type}`);
      completed.push({
        planned: row.seconds,
        clock: await page.locator(".hud-mini").innerText(),
        action,
      });
      console.log(JSON.stringify(completed.at(-1)));
    }
  }
  await page.screenshot({ path: `${output}/battle.png` });
  await page
    .locator("#match-result:not([hidden])")
    .waitFor({ timeout: 300000 });
  const victoryText = await page.locator("#match-result").innerText();
  assert.match(victoryText, /Victory/);
  await page.screenshot({ path: `${output}/victory.png` });
  await page.locator('#match-result [data-action="reset"]').click();
  await page.locator("#match-result").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".structure-brain").count(), 2);
  assert.deepEqual(errors, []);
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify({ completed, errors, victory: true, victoryText }, null, 2),
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  writeFileSync(
    `${output}/failure.json`,
    JSON.stringify({ completed, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
