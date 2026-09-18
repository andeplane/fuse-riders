import { readyRoom } from "./lib/ready-room.js";
import type { Browser, Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { smokeTimeout } from "./smoke-timeout.js";

// The second way into a room: JOIN AS SPECTATOR. A host and a rider take seats, a third page watches, and the browser
// is asked what a watcher actually gets — a place in the WATCHING list on every page, no join card, no controls, and
// the same arena the riders are in once the race starts.
interface Snapshot {
  kind: "snapshot";
  phase: string;
  tick: number;
}
const base = process.env.ONLINE_URL ?? "http://127.0.0.1:8787/";
await mkdir("artifacts", { recursive: true });

const recording = (page: Page) =>
  page.addInitScript(() => {
    const list: unknown[] = [];
    Reflect.set(window, "__snapshots", list);
    window.addEventListener("fuse-benchmark", (event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.kind === "snapshot") {
        list.push(detail);
        if (list.length > 200) list.shift();
      }
    });
  });
const latest = (page: Page) =>
  page.evaluate(() =>
    (Reflect.get(window, "__snapshots") as Snapshot[] | undefined)?.at(-1),
  );
const waitPhase = (page: Page, phases: string[], timeout = 40000) =>
  page.waitForFunction(
    (wanted) => {
      const state = (
        Reflect.get(window, "__snapshots") as Snapshot[] | undefined
      )?.at(-1);
      return !!state && wanted.includes(state.phase);
    },
    phases,
    { timeout: smokeTimeout(timeout) },
  );

const errors: string[] = [];
let browser: Browser | undefined;
try {
  browser = await launchSelected("chromium", { headless: true });
  const open = async (label: string, url: string) => {
    const page = await browser!.newContext().then((c) => c.newPage());
    page.setDefaultTimeout(smokeTimeout(30000));
    page.on("pageerror", (error) =>
      errors.push(`${label}: ${error.stack ?? error.message}`),
    );
    await recording(page);
    await page.goto(url);
    return page;
  };

  // The host creates the room and takes a seat.
  const host = await open("host", `${base}?mute=1&benchmark=1`);
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  const code = new URL(host.url()).searchParams.get("room")!;
  const roomUrl = `${base}?room=${code}&mute=1&benchmark=1`;
  await host.getByPlaceholder("Your name").fill("Hosty");
  await host
    .getByRole("button", { name: "JOIN AS PLAYER", exact: true })
    .click();

  const rider = await open("rider", roomUrl);
  await rider.getByPlaceholder("Your name").fill("Rider");
  await rider
    .getByRole("button", { name: "JOIN AS PLAYER", exact: true })
    .click();

  // The third page takes the ghost button under it instead.
  const watcher = await open("watcher", roomUrl);
  const watchButton = watcher.getByRole("button", {
    name: "JOIN AS SPECTATOR",
    exact: true,
  });
  await watchButton.waitFor({ state: "visible" });
  await watcher.getByPlaceholder("Your name").fill("Watcher");
  await watchButton.click();

  // Every page lists the watcher, under the riders and outside them.
  for (const [label, page] of [
    ["host", host],
    ["rider", rider],
    ["watcher", watcher],
  ] as const) {
    await page.locator(".room-watchers .room-watcher").waitFor();
    assert.equal(
      (await page.locator(".room-watcher strong").innerText()).toLowerCase(),
      "watcher",
      `${label} lists the watcher by name`,
    );
    assert.equal(
      await page
        .locator(".room-riders > .room-rider:not(.room-watcher)")
        .count(),
      2,
      `${label} still shows two riders`,
    );
  }
  assert.match(
    await host.locator(".room-lobby-footer span").innerText(),
    /2 riders · 1 watching/,
    "the lobby footer counts the riders and the watchers apart",
  );
  assert.match(
    await watcher.locator(".room-watcher small").innerText(),
    /YOU · WATCHING/,
    "the watcher's own row says so",
  );
  assert.equal(
    await watcher.locator(".online-join").isVisible(),
    false,
    "a watcher is in the room, so the join card is gone",
  );
  assert.equal(
    await watcher.locator(".online-controls").isVisible(),
    false,
    "and it steers nothing",
  );
  await host.screenshot({ path: "artifacts/spectator-lobby.png" });
  await watcher.screenshot({ path: "artifacts/spectator-lobby-watcher.png" });

  // The race runs, and the watcher is in it as an audience: same phase, same tick, still no controls.
  await readyRoom(host);
  await waitPhase(watcher, ["countdown", "playing"]);
  await waitPhase(rider, ["playing"]);
  await waitPhase(watcher, ["playing"]);
  const [riderState, watcherState] = [
    await latest(rider),
    await latest(watcher),
  ];
  assert.ok(riderState && watcherState);
  assert.ok(
    Math.abs(riderState.tick - watcherState.tick) < 40,
    `the watcher folds the same world within a rollback window (rider ${riderState.tick}, watcher ${watcherState.tick})`,
  );
  assert.equal(
    await watcher.locator(".online-controls").isVisible(),
    false,
    "a watcher never gets the controls, not even mid-race",
  );
  assert.equal(
    await watcher.locator("canvas").isVisible(),
    true,
    "but it does get the arena",
  );
  assert.equal(
    await watcher.locator(".mobile-hud").isVisible(),
    false,
    "and no rider HUD, because it has no rider",
  );
  assert.equal(
    await watcher.locator(".online-score-card").count(),
    2,
    "it does get the standings: both riders",
  );
  await watcher.screenshot({ path: "artifacts/spectator-playing.png" });

  assert.deepEqual(errors, [], "no page errors");
  await writeFile(
    "artifacts/spectator-smoke.json",
    JSON.stringify(
      { code, riderTick: riderState.tick, watcherTick: watcherState.tick },
      null,
      2,
    ),
  );
  console.log(
    `spectator smoke: room ${code}, rider tick ${riderState.tick}, watcher tick ${watcherState.tick}`,
  );
} finally {
  await browser?.close();
}
