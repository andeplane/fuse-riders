import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import type { BombersRuntime } from "../games/fuse-bombers/src/online/runtime.js";
import { launchSelected } from "./lib/browser.js";
import { smokeTimeout } from "./smoke-timeout.js";

/** Real, isolated play paths. Run against the built local room service with ONLINE_URL.
 * Screenshots are actual play, and phone emulation is not physical-device evidence.
 * BROWSER=webkit selects WebKit; SMOKE_SHOTS selects the ignored evidence directory.
 * SMOKE_GAMES is an optional comma-separated game list for a focused follow-up.
 * SMOKE_EVIDENCE can explicitly save representative screenshots for a pull request.
 */
const base = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const shots = process.env.SMOKE_SHOTS ?? "artifacts/shared-menu-controls";
const evidence = process.env.SMOKE_EVIDENCE ?? shots;
await Promise.all([
  mkdir(shots, { recursive: true }),
  mkdir(evidence, { recursive: true }),
]);
const browser = await launchSelected("chrome", {
  headless: true,
  ...(process.env.BROWSER === "webkit" ? {} : { args: ["--mute-audio"] }),
});
const results: object[] = [];
const failures: string[] = [];

interface GameFlow {
  id: string;
  route: string;
  start: string;
  solo?: boolean;
}
const games: readonly GameFlow[] = [
  { id: "fuse-riders", route: "", start: "", solo: true },
  { id: "fuse-bombers", route: "fuse-bombers/", start: "START", solo: true },
  {
    id: "fuse-choppers",
    route: "fuse-choppers/",
    start: "TAKE OFF",
    solo: true,
  },
  {
    id: "fuse-freight",
    route: "fuse-freight/",
    start: "START THE TRAINS ▶",
    solo: true,
  },
  { id: "fuse-axe", route: "fuse-axe/", start: "START", solo: true },
  { id: "dice", route: "dice/", start: "START MATCH", solo: true },
  { id: "fuse-craft", route: "fuse-craft/", start: "" },
  { id: "fuse-lane", route: "fuse-lane/", start: "START" },
  { id: "hook-havok", route: "hook-havok/", start: "" },
];
const selected = process.env.SMOKE_GAMES?.split(",");
assert.ok(
  !selected || selected.every((id) => games.some((game) => game.id === id)),
  "SMOKE_GAMES names current games",
);

async function start(page: Page, game: GameFlow): Promise<void> {
  const url = new URL(game.route, base);
  url.searchParams.set("mute", "");
  if (game.solo) url.searchParams.set("solo", "1");
  if (game.id === "fuse-bombers") url.searchParams.set("debug", "");
  await page.goto(url.href);
  if (game.id === "fuse-craft") {
    await page.locator('[data-action="new-game"]').click();
    await page.locator('[data-action="mode-sandbox"]').click();
    await page.locator('[data-action="start"]').click();
  } else if (game.id === "hook-havok") {
    await page.locator("#start").click();
  } else if (game.start) {
    const button = page.getByRole("button", { name: game.start, exact: true });
    const guide = page.locator(".fui-round-controls:visible");
    await guide.or(button).first().waitFor({ state: "visible" });
    if (!(await guide.count())) await button.click();
  }
  if (game.id === "fuse-lane") await page.locator(".fl-tour-skip").click();
}

async function checkSharedMenu(page: Page): Promise<void> {
  const menu = page.locator(".fui-game-menu");
  const trigger = menu.locator(".fui-game-menu-trigger");
  await trigger.click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "true");
  const panel = menu.locator(".fui-game-menu-panel");
  await panel
    .getByRole("button", { name: "BACK TO GAME", exact: true })
    .waitFor();
  await panel.getByRole("button", { name: "CONTROLS", exact: true }).click();
  const controls = panel.locator(".fui-game-menu-controls");
  assert.ok(
    (await controls.locator(".fui-controls-row").count()) > 0,
    "controls list is populated",
  );
  await controls.getByRole("button", { name: "← BACK", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  await trigger.click();
  await panel
    .getByRole("button", { name: "BACK TO GAME", exact: true })
    .click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  // Read the normal navigation through the same menu; it is absent where no lobby exists.
  await trigger.click();
  const lobby = panel.getByRole("button", {
    name: "BACK TO LOBBY",
    exact: true,
  });
  if (await lobby.isVisible()) {
    await lobby.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLElement>(".fui-round-controls")].every(
        (guide) => guide.hidden,
      ),
    );
  } else {
    await panel
      .getByRole("button", { name: "BACK TO GAME", exact: true })
      .click();
  }
}

async function checkRidersMenu(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Keyboard controls", exact: true })
    .click();
  const help = page.getByRole("dialog");
  await help.getByText("Driving", { exact: true }).waitFor();
  await help.getByRole("button", { name: "CLOSE", exact: true }).click();
  await page
    .getByRole("button", { name: "BACK TO LOBBY", exact: true })
    .click();
  await page.locator(".fui-round-controls").waitFor({ state: "hidden" });
}

async function checkBombersArrows(page: Page): Promise<void> {
  // Existing read-only ?debug surface: observe ordinary authoritative inputs and motion,
  // without injecting controls, mutating state or treating a queued send as applied input.
  await page.waitForFunction(() => {
    const runtime = (
      window as Window & { fuseBombers?: { runtime: BombersRuntime } }
    ).fuseBombers?.runtime;
    const room = runtime?.roomState();
    return room?.stage === "running" && room.tick >= room.startAt;
  });
  const before = await page.evaluate(() => {
    const runtime = (
      window as Window & { fuseBombers?: { runtime: BombersRuntime } }
    ).fuseBombers!.runtime;
    const room = runtime.roomState()!;
    return room.world!.castles[room.ships.indexOf(runtime.self)]!.x;
  });
  await page.locator("canvas").click();
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction((x) => {
    const runtime = (
      window as Window & { fuseBombers?: { runtime: BombersRuntime } }
    ).fuseBombers!.runtime;
    const room = runtime.roomState()!;
    return room.world!.castles[room.ships.indexOf(runtime.self)]!.x > x + 10;
  }, before);
  await page.keyboard.up("ArrowRight");
  for (const [key, bit] of [
    ["ArrowUp", 1],
    ["ArrowDown", 2],
    ["ArrowLeft", 4],
    ["ArrowRight", 8],
  ] as const) {
    await page.keyboard.down(key);
    await page.waitForFunction((held) => {
      const runtime = (
        window as Window & { fuseBombers?: { runtime: BombersRuntime } }
      ).fuseBombers!.runtime;
      return runtime.roomState()?.held[runtime.self] === held;
    }, bit);
    await page.keyboard.up(key);
    await page.waitForFunction(() => {
      const runtime = (
        window as Window & { fuseBombers?: { runtime: BombersRuntime } }
      ).fuseBombers!.runtime;
      return !runtime.roomState()?.held[runtime.self];
    });
  }
  const after = await page.evaluate(() => {
    const runtime = (
      window as Window & { fuseBombers?: { runtime: BombersRuntime } }
    ).fuseBombers!.runtime;
    const room = runtime.roomState()!;
    return room.world!.castles[room.ships.indexOf(runtime.self)]!.x;
  });
  results.push({ game: "fuse-bombers", arrowRight: { before, after } });
}

async function checkBombersDisplay(): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const host = await context.newPage();
  host.setDefaultTimeout(smokeTimeout(20_000));
  try {
    await host.goto(new URL("fuse-bombers/?mute", base).href);
    await host.locator(".fb-shared input").check();
    await host
      .getByRole("button", { name: "CREATE ROOM", exact: true })
      .click();
    await host.getByPlaceholder("Your name").fill("Menu smoke");
    await host.getByRole("button", { name: "JOIN", exact: true }).click();
    await host.getByRole("button", { name: "+ ADD BOT", exact: true }).click();
    const display = await context.newPage();
    display.setDefaultTimeout(smokeTimeout(20_000));
    const url = new URL(host.url());
    url.searchParams.set("display", "1");
    url.searchParams.set("mute", "");
    await display.goto(url.href);
    await display.locator(".fb-online[data-screen='lobby']").waitFor();
    await host.getByRole("button", { name: "START", exact: true }).click();
    const guide = display.locator(".fui-round-controls:visible");
    await guide.waitFor();
    assert.match(await guide.innerText(), /PHONE CONTROLS/);
    assert.match(await guide.innerText(), /FIRE/);
    assert.doesNotMatch(await guide.innerText(), /Join a seat|Space|WASD/);
    await display.screenshot({ path: `${shots}/bombers-tv-startup.png` });
    results.push({ game: "fuse-bombers", sharedTvPhoneInstructions: true });
  } finally {
    await context.close();
  }
}

try {
  for (const game of games.filter(
    (game) => !selected || selected.includes(game.id),
  )) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(smokeTimeout(20_000));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await start(page, game);
      const guide = page.locator(".fui-round-controls:visible").first();
      await guide.waitFor({ state: "visible" });
      assert.ok(
        (await guide.locator(".fui-controls-row").count()) > 0,
        `${game.id}: startup controls are populated`,
      );
      assert.ok(
        await guide.getAttribute("data-round"),
        `${game.id}: startup controls identify this round`,
      );
      await page.screenshot({ path: `${shots}/${game.id}-startup.png` });
      if (game.id === "fuse-bombers")
        await page.screenshot({
          path: `${evidence}/bombers-round-controls.png`,
        });
      await guide.waitFor({ state: "hidden", timeout: smokeTimeout(30_000) });
      if (game.id === "fuse-bombers") await checkBombersArrows(page);
      if (game.id === "fuse-riders") await checkRidersMenu(page);
      else await checkSharedMenu(page);
      assert.deepEqual(errors, [], `${game.id}: browser errors`);
      results.push({
        game: game.id,
        startupControls: true,
        menu: true,
        errors,
      });
    } catch (error) {
      failures.push(
        `${game.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(failures.at(-1));
      await page
        .screenshot({ path: `${shots}/${game.id}-failure.png` })
        .catch(() => {});
    } finally {
      await context.close();
    }
  }

  // A narrow, touch-enabled browser exercises the actual phone control wording and menu geometry.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await context.newPage();
  phone.setDefaultTimeout(smokeTimeout(20_000));
  try {
    await start(
      phone,
      games.find((game) => game.id === "fuse-bombers")!,
    );
    await phone.locator(".fui-round-controls").waitFor({ state: "visible" });
    assert.match(
      await phone.locator(".fui-round-controls").innerText(),
      /FIRE/,
    );
    await phone.locator(".fui-game-menu-trigger").click();
    const panel = phone.locator(".fui-game-menu-panel");
    const box = await panel.boundingBox();
    assert.ok(
      box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 391 &&
        box.y + box.height <= 845,
      "phone menu fits the viewport",
    );
    await phone.screenshot({ path: `${evidence}/bombers-phone-menu.png` });
    await panel.getByRole("button", { name: "CONTROLS", exact: true }).click();
    assert.match(
      await panel.locator(".fui-game-menu-controls").innerText(),
      /FIRE/,
    );
    results.push({
      game: "fuse-bombers",
      phoneMenu: true,
      phoneTouchHelp: true,
    });
  } catch (error) {
    failures.push(
      `phone: ${error instanceof Error ? error.message : String(error)}`,
    );
    await phone
      .screenshot({ path: `${shots}/phone-failure.png` })
      .catch(() => {});
  } finally {
    await context.close();
  }
  try {
    await checkBombersDisplay();
  } catch (error) {
    failures.push(
      `shared TV: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
} finally {
  await browser.close();
}
const report = {
  base,
  browser: process.env.BROWSER ?? "chrome",
  results,
  failures,
};
await writeFile(`${shots}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
assert.deepEqual(
  failures,
  [],
  "all shared menu and startup control flows pass",
);
