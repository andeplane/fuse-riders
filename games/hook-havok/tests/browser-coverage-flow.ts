import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Page } from "playwright";
import { launchSelected } from "../../../scripts/lib/browser.js";
import { startGameCoverage } from "../../../scripts/lib/game-browser-coverage.js";

interface HookKeeper {
  id: string;
  connected: boolean;
  respawn: number;
  charge: number;
  cooldown: number;
  deaths: number;
  tally: { thrown: number };
}

// Observe public browser events without changing input handling or game state.
// Keep identifiers, names, room codes and URLs out of uploaded diagnostics.
async function observeControls(page: Page) {
  const events: unknown[] = [];
  await page.exposeFunction("recordHookControlEvent", (event: unknown) => {
    events.push(event);
    if (events.length > 64) events.shift();
  });
  await page.evaluate(() => {
    const report = (
      window as unknown as {
        recordHookControlEvent(event: unknown): Promise<void>;
      }
    ).recordHookControlEvent;
    for (const type of [
      "keydown",
      "keyup",
      "focus",
      "blur",
      "visibilitychange",
    ])
      window.addEventListener(
        type,
        (event) => {
          const key = event instanceof KeyboardEvent ? event : undefined;
          // Only the two keys exercised here; never record text entry.
          if (key && !["KeyK", "Escape"].includes(key.code)) return;
          const host = document.querySelector<HTMLElement>("#scene");
          void report({
            type,
            code: key?.code,
            repeat: key?.repeat,
            target:
              event.target === host
                ? "arena"
                : event.target === window
                  ? "window"
                  : "other",
            arenaFocused: document.activeElement === host,
            windowFocused: document.hasFocus(),
            hidden: document.hidden,
            tick: host?.dataset.tick,
            charge: host?.dataset.charge,
            phase:
              document.querySelector<HTMLElement>("#match-overlay")?.dataset
                .phase,
            menuOpen: document
              .querySelector(".fui-game-menu-trigger")
              ?.getAttribute("aria-expanded"),
            dialogOpen: !!document.querySelector("dialog[open]"),
          });
        },
        true,
      );
  });
  return events;
}

async function saveFailure(
  page: Page,
  stage: string,
  events: unknown[],
  initialTick: string | undefined,
) {
  const snapshot = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#scene"),
      data = host?.dataset;
    const keeper = (JSON.parse(data?.keepers ?? "[]") as HookKeeper[]).find(
      (k) => k.id === data?.playerId,
    );
    return {
      tick: data?.tick,
      logTick: data?.logTick,
      inputTick: data?.inputTick,
      inputBomb: data?.inputBomb,
      inputCancelled: data?.inputCancelled,
      map: data?.map,
      controls: data?.controls,
      charge: data?.charge,
      bombMode: data?.bombMode,
      rules: document.querySelector<HTMLSelectElement>("#rules")?.value,
      phase:
        document.querySelector<HTMLElement>("#match-overlay")?.dataset.phase,
      touchActive:
        document.querySelector<HTMLElement>("#touch-deck")?.dataset.active,
      status: document.querySelector<HTMLElement>("#status")?.dataset.state,
      arenaFocused: document.activeElement === host,
      windowFocused: document.hasFocus(),
      hidden: document.hidden,
      menuOpen: document
        .querySelector(".fui-game-menu-trigger")
        ?.getAttribute("aria-expanded"),
      dialogOpen: !!document.querySelector("dialog[open]"),
      keeper: keeper
        ? {
            connected: keeper.connected,
            respawn: keeper.respawn,
            charge: keeper.charge,
            cooldown: keeper.cooldown,
            deaths: keeper.deaths,
            thrown: keeper.tally.thrown,
          }
        : null,
    };
  });
  const directory = process.env.FUSE_GAME_COVERAGE_DIR
    ? dirname(resolve(process.env.FUSE_GAME_COVERAGE_DIR))
    : resolve("artifacts");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "hook-havok-coverage-failure.json"),
    JSON.stringify({ stage, initialTick, ...snapshot, events }, null, 2),
  );
  console.error(
    "Hook control failure diagnostics:",
    JSON.stringify({ stage, initialTick, ...snapshot, events }),
  );
  // Arena only: room invitations and social/account UI are outside this image.
  await page.locator("#scene").screenshot({
    path: resolve(directory, "hook-havok-coverage-failure.png"),
    timeout: 5000,
  });
}

// Ordinary room controls and rendered outcomes only. Native coverage is
// collected by the shared harness when FUSE_GAME_COVERAGE_DIR is supplied.
const origin = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const browser = await launchSelected("chrome", { args: ["--mute-audio"] });
await mkdir("artifacts", { recursive: true });
let page: Page | undefined;
let events: unknown[] = [];
let stage = "navigation";
let initialTick: string | undefined;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const finishCoverage = await startGameCoverage(page, {
    gameId: "hook-havok",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("hook-havok/?mute&play", origin).href);
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  // Room status can precede the first local rendered frame. Initial round and
  // phase transitions cancel held input, so wait for the playable keeper before
  // exercising a single key press through the menu.
  await page.waitForFunction(() => {
    const data = document.querySelector<HTMLElement>("#scene")?.dataset;
    return (
      !!data?.playerId &&
      (JSON.parse(data.keepers ?? "[]") as HookKeeper[]).some(
        (keeper) => keeper.id === data.playerId,
      )
    );
  });
  events = await observeControls(page);
  initialTick =
    (await page.locator("#scene").getAttribute("data-tick")) ?? undefined;
  stage = "menu controls and focus restoration";
  // Arena switching is quarantined under flaky-test epic #250: the unchanged
  // Spire transition timed out on main while passing locally, including CPU
  // throttling. Keep menu and input coverage in the room's default arena until
  // that race is reproduced and fixed, then restore the arena-switch case.
  await page.getByRole("button", { name: "MENU", exact: true }).click();
  await page.getByRole("button", { name: "CONTROLS", exact: true }).click();
  const menu = page.locator(".fui-game-menu-panel");
  await menu.getByText("WASD / ARROWS + K", { exact: true }).waitFor();
  await menu.getByText("MOUSE + RIGHT CLICK", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("#scene")
      .evaluate((element) => element === document.activeElement),
    true,
    "resuming the menu restores arena keyboard focus",
  );
  stage = "K starts charge after Escape resumes the menu";
  await page.keyboard.down("k");
  await page.waitForFunction(
    () =>
      Number(document.querySelector<HTMLElement>("#scene")?.dataset.charge) > 0,
  );
  const before = await page.locator("#scene").evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    const keeper = (JSON.parse(data.keepers ?? "[]") as HookKeeper[]).find(
      (candidate) => candidate.id === data.playerId,
    );
    if (!keeper) throw new Error("The local Hook keeper is missing");
    return keeper.tally.thrown;
  });
  stage = "menu cancels charge without throwing";
  await page.getByRole("button", { name: "MENU", exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(document.querySelector<HTMLElement>("#scene")?.dataset.charge) ===
      0,
  );
  const cancelled = await page.locator("#scene").evaluate((element) => {
    const data = (element as HTMLElement).dataset;
    return (JSON.parse(data.keepers ?? "[]") as HookKeeper[]).find(
      (candidate) => candidate.id === data.playerId,
    )?.tally.thrown;
  });
  assert.equal(
    cancelled,
    before,
    "opening the menu cancels instead of throwing",
  );
  await page.keyboard.up("k");
  stage = "fresh K starts charge after Back to Game";
  await page.getByRole("button", { name: "BACK TO GAME", exact: true }).click();
  await page.keyboard.down("k");
  await page.waitForFunction(
    () =>
      Number(document.querySelector<HTMLElement>("#scene")?.dataset.charge) > 0,
  );
  await page.keyboard.up("k");
  stage = "ordinary K release increments persistent throw tally";
  // The bomb can finish between rendered frames; its throw tally persists.
  await page.waitForFunction((count) => {
    const data = document.querySelector<HTMLElement>("#scene")?.dataset;
    if (!data) return false;
    const keeper = (JSON.parse(data.keepers ?? "[]") as HookKeeper[]).find(
      (candidate) => candidate.id === data.playerId,
    );
    return keeper?.tally.thrown === count + 1;
  }, before);
  await page.screenshot({ path: "artifacts/hook-havok-coverage-flow.png" });
  assert.deepEqual(errors, []);
  await finishCoverage();
  console.log(
    "PASS Hook: real room, current bomb guide, menu focus restoration, menu cancels charge, ordinary K release increments persistent throw tally; no page errors",
  );
} catch (error) {
  if (page) {
    try {
      await saveFailure(page, stage, events, initialTick);
    } catch {
      console.error("Hook failure evidence could not be completed");
    }
  }
  throw error;
} finally {
  await browser.close();
}
