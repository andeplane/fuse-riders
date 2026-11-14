// The sword-combat capture set: drives the sandbox headless and saves close-ups of each moment of rules 4.
// Run against the URL printed by serve.mjs:
//   node games/killer-fuse/preview/combat.mjs http://127.0.0.1:PORT/ [out dir] [--boxes] [--maps 1,2,3]
// --boxes draws the engine's movement, hit and weapon boxes over every shot.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const base = process.argv[2];
if (!base?.startsWith("http://127.0.0.1:"))
  throw new Error("Pass the local URL printed by preview/serve.mjs");
const origin = new URL(base).origin;
const named = process.argv[3];
const out =
  named && !named.startsWith("--")
    ? `${resolve(named)}/`
    : fileURLToPath(new URL("./shots/", import.meta.url));
const boxes = process.argv.includes("--boxes");
const mapsFlag = process.argv.indexOf("--maps");
const maps =
  mapsFlag >= 0 ? process.argv[mapsFlag + 1].split(",").map(Number) : [1, 2, 3];
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.goto(
  `${origin}/?mute&clean&seed=1&map=1&level=hard&seat=none${boxes ? "&boxes=1" : ""}`,
);
await page
  .locator('#status[data-state="ready"]')
  .waitFor({ state: "attached" });
// The renderer's clock is turned by hand from here on.
await page.evaluate(() => {
  window.__game.pause();
  window.__game.hold(0);
});

const suffix = boxes ? "-boxes" : "";

/** Shows `steps` more steps, a display frame for each. */
const play = (steps) =>
  page.evaluate((count) => {
    for (let i = 0; i < count; i += 1) {
      window.__game.step(1);
      window.__game.hold(1000 / 60);
    }
  }, steps);

/** Steps hidden until `test` (source of a function of the view) holds, then shows that step. */
const reach = (test, limit = 60 * 150) =>
  page.evaluate(
    ([source, max]) => {
      const holds = new Function("view", `return (${source})(view)`);
      const game = window.__game;
      for (let i = 0; i < max; i += 1) {
        if (holds(game.view())) {
          game.show();
          return true;
        }
        if (game.view().winner) return false;
        game.skip(1);
      }
      return false;
    },
    [test.toString(), limit],
  );

/** The 120 by 80 art pixels round the point `pick` (source of a function of the view) returns. */
async function closeup(name, pick) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const clip = await page.evaluate((source) => {
    const at = new Function("view", `return (${source})(view)`)(
      window.__game.view(),
    );
    if (!at) return null;
    const box = document.querySelector("#arena canvas").getBoundingClientRect();
    const scale = box.width / 480;
    const x = Math.max(0, Math.min(480 - 120, at.x - 60));
    const y = Math.max(0, Math.min(270 - 80, at.y - 50));
    return {
      x: box.left + x * scale,
      y: box.top + y * scale,
      width: 120 * scale,
      height: 80 * scale,
    };
  }, pick.toString());
  if (!clip) return console.log(`no ${name}`);
  await page.screenshot({ path: `${out}${name}${suffix}.png`, clip });
  console.log(`shot ${name}${suffix}`);
}

async function whole(name) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.screenshot({ path: `${out}${name}${suffix}.png` });
  console.log(`shot ${name}${suffix}`);
}

const restart = (map, seed) =>
  page.evaluate(
    ([m, s]) => window.__game.restart({ map: m, seed: s, level: "hard" }),
    [map, seed],
  );

/** Tries seeds on `map` until `test` holds; true when one did. */
async function find(map, test, seeds = [1, 2, 3, 4, 5, 6]) {
  for (const seed of seeds) {
    await restart(map, seed);
    if (await reach(test)) return true;
  }
  return false;
}

const eventPoint = (type) =>
  new Function(
    "view",
    `const e = view.events.find((entry) => entry.type === "${type}");
     return e && (e.x !== undefined ? e : view.units[e.slot ?? e.victim ?? e.a]);`,
  );

try {
  for (const map of maps) {
    const tag = `m${map}`;
    // A Warrior's dash: its first step, the middle and the end of the lethal window, then the cooldown.
    const dash = (kind) =>
      new Function(
        "view",
        `return view.units.find((u) => u.kind === "${kind}" && u.dashing && u.attackStep === 1 && !u.dead)`,
      );
    const dasher = (kind) =>
      new Function(
        "view",
        `return view.units.find((u) => u.kind === "${kind}" && u.attackStep > 0 && !u.dead)`,
      );
    for (const kind of ["warrior", "queen"]) {
      if (!(await find(map, dash(kind)))) continue;
      await play(1);
      await closeup(`${tag}-${kind}-dash-0`, dasher(kind));
      await play(6);
      await closeup(`${tag}-${kind}-dash-1`, dasher(kind));
      await whole(`${tag}-${kind}-dash`);
      await play(9);
      await closeup(`${tag}-${kind}-dash-2`, dasher(kind));
      await play(8);
      await closeup(`${tag}-${kind}-dash-3`, dasher(kind));
    }
    // A dash along the ground: the sprite must stand on the floor, not in it.
    for (const kind of ["warrior", "queen"]) {
      const grounded = new Function(
        "view",
        `return view.units.find((u) => u.kind === "${kind}" && u.dashing && u.grounded && u.attackStep > 4 && !u.dead)`,
      );
      if (!(await find(map, grounded))) continue;
      await play(1);
      await closeup(`${tag}-${kind}-ground-dash`, dasher(kind));
    }
    // Sword on sword.
    if (
      await find(map, (view) => view.events.some((e) => e.type === "glance"))
    ) {
      const at = eventPoint("glance");
      const point = await page.evaluate(
        (source) =>
          new Function("view", `return (${source})(view)`)(
            window.__game.view(),
          ),
        at.toString(),
      );
      const fixed = new Function("view", `return ${JSON.stringify(point)}`);
      for (let i = 0; i < 4; i += 1) {
        await play(i === 0 ? 1 : 4);
        await closeup(`${tag}-glance-${i}`, fixed);
      }
      await whole(`${tag}-glance`);
    }
    // Feet on a head, and bodies bumping.
    for (const type of ["stomped", "bounce"]) {
      if (
        !(await find(
          map,
          new Function(
            "view",
            `return view.events.some((e) => e.type === "${type}")`,
          ),
        ))
      )
        continue;
      const point = await page.evaluate(
        (source) =>
          new Function("view", `return (${source})(view)`)(
            window.__game.view(),
          ),
        eventPoint(type).toString(),
      );
      const fixed = new Function("view", `return ${JSON.stringify(point)}`);
      for (let i = 0; i < 2; i += 1) {
        await play(i === 0 ? 2 : 5);
        await closeup(`${tag}-${type}-${i}`, fixed);
      }
    }
    // A Queen's dive, on its way down.
    const diving = (view) => view.units.find((u) => u.diving && !u.dead);
    if (await find(map, diving)) {
      for (let i = 0; i < 3; i += 1) {
        await play(i === 0 ? 0 : 3);
        await closeup(`${tag}-dive-${i}`, diving);
      }
    }
    const diveKill = (view) =>
      view.events.some(
        (e) =>
          (e.type === "kill" || e.type === "queenKill") &&
          view.units[e.killer]?.diving,
      );
    if (await find(map, diveKill)) {
      const victim = (view) => {
        const e = view.events.find(
          (entry) => entry.type === "kill" || entry.type === "queenKill",
        );
        return e && view.units[e.killer];
      };
      const point = await page.evaluate(
        (source) =>
          new Function("view", `return (${source})(view)`)(
            window.__game.view(),
          ),
        victim.toString(),
      );
      const fixed = new Function("view", `return ${JSON.stringify(point)}`);
      for (let i = 0; i < 3; i += 1) {
        await play(i === 0 ? 1 : 5);
        await closeup(`${tag}-dive-kill-${i}`, fixed);
      }
      await whole(`${tag}-dive-kill`);
    }
    // The gate: offered, locked early and late, and the Warrior stepping out. The lock is found first and the
    // round played again up to a little before it: a Worker that only walks through a gate never locks.
    const locks = (view) => view.events.some((e) => e.type === "gateLock");
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      await restart(map, seed);
      if (!(await reach(locks))) continue;
      const found = await page.evaluate(() => {
        const view = window.__game.view();
        const gate = view.gates.find((entry) => entry.user >= 0);
        return gate && { step: view.step, x: gate.x, y: gate.y - 8 };
      });
      if (!found) continue;
      const fixed = new Function("view", `return ${JSON.stringify(found)}`);
      await restart(map, seed);
      await page.evaluate((step) => {
        const game = window.__game;
        while (game.view().step < step - 14) game.skip(1);
        game.show();
      }, found.step);
      await play(1);
      await closeup(`${tag}-gate-offer`, fixed);
      await play(16);
      await closeup(`${tag}-gate-lock-0`, fixed);
      await play(50);
      await closeup(`${tag}-gate-lock-1`, fixed);
      await whole(`${tag}-gate-lock`);
      await play(62);
      await closeup(`${tag}-gate-lock-2`, fixed);
      await play(9);
      await closeup(`${tag}-gate-out-0`, fixed);
      await play(12);
      await closeup(`${tag}-gate-out-1`, fixed);
      break;
    }
    // A Worker in a hive hole, and the berry counting.
    const sitting = (view) => view.units.find((u) => u.depositing && !u.dead);
    if (
      await find(map, (view) =>
        view.events.some((e) => e.type === "depositStart"),
      )
    ) {
      const point = await page.evaluate(
        (source) =>
          new Function("view", `return (${source})(view)`)(
            window.__game.view(),
          ),
        sitting.toString(),
      );
      const fixed = new Function("view", `return ${JSON.stringify(point)}`);
      await play(3);
      await closeup(`${tag}-deposit-0`, fixed);
      await play(40);
      await closeup(`${tag}-deposit-1`, fixed);
      await whole(`${tag}-deposit`);
      if (
        await reach(
          (view) => view.events.some((e) => e.type === "berryDeposit"),
          120,
        )
      ) {
        await play(3);
        await closeup(`${tag}-deposit-2`, fixed);
        await play(30);
        await closeup(`${tag}-deposit-3`, fixed);
      }
    }
    // The snail's meal.
    if (
      await find(map, (view) =>
        view.events.some((e) => e.type === "snailCatch"),
      )
    ) {
      const snail = (view) => view.snail;
      await play(3);
      await closeup(`${tag}-snail-catch`, snail);
      await play(60);
      await closeup(`${tag}-snail-eat`, snail);
      await whole(`${tag}-snail-eat`);
    }
    // A Queen hatching.
    if (
      await find(map, (view) =>
        view.events.some((e) => e.type === "respawn" && (e.egg ?? -1) >= 0),
      )
    ) {
      const queen = (view) => {
        const e = view.events.find((entry) => entry.type === "respawn");
        return e && view.units[e.slot];
      };
      const point = await page.evaluate(
        (source) =>
          new Function("view", `return (${source})(view)`)(
            window.__game.view(),
          ),
        queen.toString(),
      );
      const fixed = new Function("view", `return ${JSON.stringify(point)}`);
      for (let i = 0; i < 3; i += 1) {
        await play(i === 0 ? 2 : 6);
        await closeup(`${tag}-hatch-${i}`, fixed);
      }
    }
  }
  // The three endings, each on the first map and seed that ends that way: the moment it is won, the hexagon
  // closing and the picture it settles on.
  if (!process.argv.includes("--no-endings")) {
    const found = new Set();
    for (const map of [1, 2, 3])
      for (let seed = 1; seed <= 8 && found.size < 3; seed += 1) {
        const kind = await page.evaluate(
          ([m, s]) => {
            const game = window.__game;
            game.restart({ map: m, seed: s, level: "hard" });
            game.until("victory", 60 * 60 * 8);
            return game.view().winner?.kind ?? null;
          },
          [map, seed],
        );
        if (!kind || found.has(kind)) continue;
        found.add(kind);
        let shown = 0;
        for (const at of [20, 70, 100, 200]) {
          await play(at - shown);
          shown = at;
          await whole(`ending-${kind}-m${map}-${at}`);
        }
      }
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
