// Drives the arena sandbox headless and saves screenshots to preview/shots/ for a person (or an agent) to look at.
// Run against the URL printed by serve.mjs:  node games/killer-fuse/preview/check.mjs http://127.0.0.1:PORT/
// Options: --small also saves 960 by 540 copies named keep-*.png (the ones kept in git); --seeds N tries that many
// seeds per map when looking for each kind of victory (default 6).
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const base = process.argv[2];
if (!base?.startsWith("http://127.0.0.1:"))
  throw new Error("Pass the local URL printed by preview/serve.mjs");
const origin = new URL(base).origin;
const small = process.argv.includes("--small");
const seedsFlag = process.argv.indexOf("--seeds");
const seeds = seedsFlag >= 0 ? Number(process.argv[seedsFlag + 1]) : 6;
const shots = fileURLToPath(new URL("./shots/", import.meta.url));
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_CHANNEL
    ? { channel: process.env.BROWSER_CHANNEL }
    : {}),
});
const errors = [];
const report = {};

async function open(context, query) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${origin}/?mute&clean&seat=none&${query}`);
  await page.locator('#status[data-state="ready"]').waitFor({
    state: "attached",
  });
  return page;
}

/** Lets the page draw `count` display frames. */
const frames = (page, count = 2) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise(requestAnimationFrame);
  }, count);

async function shoot(page, name) {
  await frames(page);
  await page.screenshot({ path: `${shots}${name}.png` });
  console.log(
    `shot ${name}: ${(await page.evaluate(() => window.__game.text())).split("\n")[0]}`,
  );
}

/** Steps hidden until `test` (a function of the view, given as source) holds; true when it did. */
const reach = (page, test, limit = 60 * 240) =>
  page.evaluate(
    ([source, max]) => {
      const holds = new Function("view", `return (${source})(view)`);
      const game = window.__game;
      for (let i = 0; i < max; i += 1) {
        if (holds(game.view())) return true;
        if (game.view().winner) return false;
        game.skip(1);
      }
      return false;
    },
    [test.toString(), limit],
  );

async function tour(context, prefix) {
  const page = await open(context, "seed=1&map=1&level=hard");
  const size = await page.evaluate(() => {
    const canvas = document.querySelector("#arena canvas");
    return { width: canvas.width, height: canvas.height };
  });
  assert.equal(
    size.width % 480,
    0,
    "the canvas is a whole multiple of 480 wide",
  );
  assert.equal(size.height, (size.width / 480) * 270, "and keeps 16:9");
  report[`${prefix}scale`] = size.width / 480;

  await page.evaluate(() => {
    window.__game.pause();
    window.__game.step(40);
  });
  await shoot(page, `${prefix}opening`);

  if (await reach(page, (view) => view.gates.some((gate) => gate.user >= 0))) {
    await page.evaluate(() => window.__game.step(70));
    await frames(page, 12);
    await shoot(page, `${prefix}gate-transform`);
    if (await page.evaluate(() => window.__game.until("gateUse", 600))) {
      await frames(page, 5);
      await shoot(page, `${prefix}gate-use`);
    }
  }
  if (await page.evaluate(() => window.__game.until("kill"))) {
    await page.evaluate(() => window.__game.step(2));
    await frames(page, 4);
    await shoot(page, `${prefix}kill`);
  }
  // A hive with several holes filled, at the moment another berry goes in.
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    await page.evaluate((s) => window.__game.restart({ seed: s }), seed);
    if (!(await reach(page, (view) => Math.max(...view.berries) >= 5)))
      continue;
    if (!(await page.evaluate(() => window.__game.until("berryDeposit"))))
      continue;
    await frames(page, 4);
    await shoot(page, `${prefix}deposit`);
    break;
  }
  // A speed unit, to judge whether it still reads as its team.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    await page.evaluate((s) => window.__game.restart({ seed: s }), seed);
    if (
      !(await reach(page, (view) =>
        view.units.some((unit) => unit.speed && !unit.dead),
      ))
    )
      continue;
    await page.evaluate(() => window.__game.step(45));
    await shoot(page, `${prefix}speed-units`);
    break;
  }
  // A Warrior dropping at full speed with its wings still: the dive frame.
  for (const seed of [1, 2, 3, 4]) {
    await page.evaluate((s) => window.__game.restart({ seed: s }), seed);
    const plunging = await reach(page, (view) => {
      const warrior = view.units.find(
        (unit) => unit.kind === "warrior" && !unit.dead && !unit.grounded,
      );
      const before = window.__warriorY;
      window.__warriorY = warrior ? [warrior.slot, warrior.y] : undefined;
      window.__falls =
        warrior &&
        before &&
        before[0] === warrior.slot &&
        warrior.y - before[1] >= 2 &&
        !warrior.flapped
          ? (window.__falls ?? 0) + 1
          : 0;
      return window.__falls >= 3;
    });
    if (!plunging) continue;
    await page.evaluate(() => window.__game.step(2));
    await shoot(page, `${prefix}warrior-dive`);
    break;
  }
  // The big moment: a Queen dies. The frame after it is held by the hit-stop, then the burst plays out, so a run
  // of shots is taken straight away: the effect is over in two thirds of a second.
  await page.evaluate(() => window.__game.restart({ seed: 1 }));
  if (await page.evaluate(() => window.__game.until("queenKill"))) {
    for (let i = 0; i < 5; i += 1)
      await page.screenshot({ path: `${shots}${prefix}queen-kill-${i}.png` });
    console.log(`shot ${prefix}queen-kill-0..4`);
    // While she is dead: her ghost and count on the hive's roof.
    await page.evaluate(() => window.__game.step(50));
    await shoot(page, `${prefix}queen-wait`);
  }
  // A Worker riding the snail home, in the last quarter before a goal.
  for (const seed of [5, 4, 6, 2, 3, 1, 7, 8]) {
    await page.evaluate((s) => window.__game.restart({ seed: s }), seed);
    const near = await reach(page, (view) => {
      const { start, goals } = view.map.snail;
      const done = Math.max(
        ...goals.map((goal) => (view.snail.x - start) / (goal - start)),
      );
      return view.snail.rider >= 0 && done >= 0.8;
    });
    if (!near) continue;
    await page.evaluate(() => window.__game.step(6));
    await shoot(page, `${prefix}snail-ride`);
    break;
  }
  // A busy moment a while into a round, running live.
  await page.evaluate(() => {
    window.__game.restart({ seed: 3 });
    window.__game.skip(60 * 14);
    window.__game.resume();
  });
  await page.waitForTimeout(1500);
  await shoot(page, `${prefix}mid-fight`);
  await page.close();
}

async function victories(context, prefix) {
  const page = await open(context, "seed=1&map=1&level=hard");
  await page.evaluate(() => window.__game.pause());
  const found = {};
  for (const map of [1, 2, 3]) {
    for (let seed = 1; seed <= seeds; seed += 1) {
      if (Object.keys(found).length === 3) break;
      const kind = await page.evaluate(
        ([m, s]) => {
          const game = window.__game;
          game.restart({ map: m, seed: s, level: "hard" });
          game.until("victory", 60 * 60 * 8);
          return game.view().winner?.kind ?? null;
        },
        [map, seed],
      );
      if (!kind || found[kind]) continue;
      found[kind] = { map, seed };
      await page.waitForTimeout(1300);
      await shoot(page, `${prefix}victory-${kind}`);
    }
  }
  report.victories = found;
  await page.close();
}

async function timing(context) {
  const page = await open(context, "seed=2&map=1&level=hard");
  await page.evaluate(() => window.__game.skip(60 * 30));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__game.resetStats());
  await page.waitForTimeout(6000);
  report.timing = await page.evaluate(() => window.__game.stats());
  await page.close();
}

try {
  const large = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await tour(large, "");
  await victories(large, "");
  await timing(large);
  if (small) {
    const compact = await browser.newContext({
      viewport: { width: 960, height: 540 },
    });
    await tour(compact, "keep-");
  }
  assert.deepEqual(errors, [], "the page logged no errors");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
