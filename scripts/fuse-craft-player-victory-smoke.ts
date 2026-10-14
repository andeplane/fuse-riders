import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import type { Action } from "../games/fuse-craft/src/engine/types.js";

const output = process.argv[2] ?? "/tmp/fuse-player-victory";
mkdirSync(output, { recursive: true });
/**
 * A fixed Pressure-style build plan (rules 12) for Close Quarters, spawn 1,
 * against the Economy opening with powerups off. It is not an AI reading the
 * browser's game state: every action goes through visible controls, no
 * earlier than its game-clock time and, like a player, only once the control
 * accepts it (an affordable research button, a placement ghost marked valid,
 * a built structure to select). Headless replays of this plan with 0–5 s of
 * extra UI latency per action won every time by elimination in about 2 min.
 */
const plan: { seconds: number; actions: Action[] }[] = [
  {
    seconds: 0,
    actions: [
      { type: "setPriority", cell: 175, weight: 3 },
      { type: "queueConstruction", kind: "neuron", cell: 176 },
    ],
  },
  {
    seconds: 6,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 177 }],
  },
  {
    seconds: 12,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 178 }],
  },
  {
    seconds: 18,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 179 }],
  },
  { seconds: 19, actions: [{ type: "startResearch", research: "excitation" }] },
  {
    seconds: 24,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 180 }],
  },
  {
    seconds: 30,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 181 }],
  },
  {
    seconds: 36,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 206 }],
  },
  { seconds: 40, actions: [{ type: "startResearch", research: "growth" }] },
  {
    seconds: 42,
    actions: [{ type: "queueConstruction", kind: "tower", cell: 230 }],
  },
  {
    seconds: 52,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 229 }],
  },
  { seconds: 61, actions: [{ type: "startResearch", research: "conduction" }] },
  {
    seconds: 64,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 207 }],
  },
  {
    seconds: 65,
    actions: [
      { type: "setPriority", cell: 175, weight: 0 },
      { type: "setPriority", cell: 230, weight: 3 },
    ],
  },
  {
    seconds: 67,
    actions: [{ type: "queueConstruction", kind: "tower", cell: 255 }],
  },
  { seconds: 79, actions: [{ type: "setPriority", cell: 175, weight: 3 }] },
  {
    seconds: 81,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 254 }],
  },
  { seconds: 82, actions: [{ type: "startResearch", research: "ballistics" }] },
  {
    seconds: 91,
    actions: [{ type: "queueConstruction", kind: "neuron", cell: 278 }],
  },
  {
    seconds: 94,
    actions: [
      { type: "setPriority", cell: 175, weight: 0 },
      { type: "setPriority", cell: 230, weight: 0 },
      { type: "setPriority", cell: 255, weight: 3 },
    ],
  },
  {
    seconds: 96,
    actions: [{ type: "queueConstruction", kind: "tower", cell: 256 }],
  },
  { seconds: 103, actions: [{ type: "startResearch", research: "resonance" }] },
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors: string[] = [];
const completed: unknown[] = [];
page.on("pageerror", (error) => errors.push(error.message));
/** Back to the root command card: Escape closes the board's open panel. */
async function root() {
  await page.keyboard.press("Escape");
}
/** Opens a command panel and presses one of its buttons once it is enabled. */
async function pressCommand(panel: string, action: string) {
  await root();
  await page.locator(`[data-action="panel-${panel}"]`).click();
  // Build commands sit on the first page; research may need "More". Each
  // probe is a round trip, and a busy match makes round trips slow.
  if (
    panel !== "build" &&
    !(await page.locator(`[data-action="${action}"]`).count())
  )
    await page.locator('[data-action="next-command-page"]').click();
  await page
    .locator(`[data-action="${action}"][aria-disabled="false"]`)
    .click({ timeout: 90000 });
  // Pressing re-renders the card and drops focus, so Escape would miss it.
  if (panel !== "build")
    await page.locator('[data-action="close-panel"]').click();
}
async function selectCell(page: Page, cell: number) {
  await root();
  const hit = page.locator(`.structure[data-cell="${cell}"] .structure-hit`);
  await hit.click({ timeout: 90000 });
  assert.match(
    await page.locator(".tile-heading").innerText(),
    new RegExp(`HEX ${cell}\\b`),
    `selecting hex ${cell} shows it in the inspector`,
  );
}
async function cellCenter(cell: number) {
  const box = await page
    .locator(`#nd-board .terrain-layer [data-cell="${cell}"] > polygon`)
    .first()
    .boundingBox();
  assert.ok(box, `hex ${cell} is on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
try {
  await page.routeWebSocket("**", (socket) => socket.close());
  await page.goto(
    process.env.FUSE_CRAFT_URL ??
      "http://127.0.0.1:5174/games/fuse-craft/?mute",
  );
  await page.locator('[data-action="new-game"]').click();
  await page.locator('[data-action="mode-skirmish"]').click();
  await page.locator("#map-picker").selectOption("close-quarters");
  await page.locator("#spawn-picker").selectOption("0");
  await page.locator("#strategy-picker").selectOption("economy");
  // Powerups spawn from a random match id; the plan assumes none.
  await page.locator('[data-field="powerups"]').setChecked(false);
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
        await pressCommand("build", `build-${action.kind}`);
        const { x, y } = await cellCenter(action.cell);
        await page.mouse.move(x, y);
        // Like a player, wait for the ghost to accept the hex before clicking.
        await page
          .locator('.placement-preview[data-valid="true"]')
          .waitFor({ timeout: 90000 });
        await page.mouse.click(x, y);
        await page
          .locator(`.queue-mark[data-cell="${action.cell}"]`)
          .waitFor({ timeout: 10000 });
      } else if (action.type === "startResearch") {
        await pressCommand("research", `research-${action.research}`);
      } else if (action.type === "setParticleKind") {
        await pressCommand("particles", `particle-${action.kind}`);
      } else if (action.type === "setPriority") {
        await selectCell(page, action.cell);
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
          { timeout: 90000 },
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
  assert.match(
    victoryText,
    /Victory/,
    `result announces Victory: ${victoryText}`,
  );
  await page.screenshot({ path: `${output}/victory.png` });
  await page.locator('#match-result [data-action="reset"]').click();
  await page.locator("#match-result").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator(".structure-brain").count(),
    2,
    "Play again restores both brains",
  );
  assert.deepEqual(errors, [], "no page errors");
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
