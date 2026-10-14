import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchSelected } from "../../../scripts/lib/browser.js";
import { startGameCoverage } from "../../../scripts/lib/game-browser-coverage.js";

interface HookKeeper {
  id: string;
  tally: { thrown: number };
}

// Ordinary room controls and rendered outcomes only. Native coverage is
// collected by the shared harness when FUSE_GAME_COVERAGE_DIR is supplied.
const origin = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
const browser = await launchSelected("chrome", { args: ["--mute-audio"] });
await mkdir("artifacts", { recursive: true });
try {
  const page = await browser.newPage({
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
  await page.locator("#map").selectOption("spire");
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLElement>("#scene")?.dataset.map === "spire",
  );
  await page.getByRole("button", { name: "MENU", exact: true }).click();
  await page.getByRole("button", { name: "CONTROLS", exact: true }).click();
  await page.getByText("WASD / ARROWS + K", { exact: true }).waitFor();
  await page.getByText("MOUSE + RIGHT CLICK", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .locator("#scene")
      .evaluate((element) => element === document.activeElement),
    true,
    "resuming the menu restores arena keyboard focus",
  );
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
  await page.keyboard.up("k");
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
    "PASS Hook: real Spire room, current bomb guide, menu focus restoration, charged K release increments persistent throw tally; no page errors",
  );
} finally {
  await browser.close();
}
