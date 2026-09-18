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
    /2 riders ready · 1 watching/,
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

  // Who runs the room says so on one row, on every page, and it is not the watcher's.
  for (const [label, page] of [
    ["host", host],
    ["rider", rider],
    ["watcher", watcher],
  ] as const) {
    // The watching list is nested inside `.room-riders`, so say "a seat's row" rather than "anything in the list".
    const badges = page.locator(
      ".room-riders > .room-rider:not(.room-watcher) .host-badge:visible",
    );
    await badges.first().waitFor();
    assert.equal(await badges.count(), 1, `${label} names one host`);
    assert.equal(
      await page.locator(".room-watcher .host-badge:visible").count(),
      0,
      `${label} does not put the badge on the watcher`,
    );
  }
  assert.equal(
    await watcher.locator(".room-watcher > button").isVisible(),
    false,
    "a watcher holds no remove button",
  );
  // The host sends the watcher home. A person's row asks twice, so one tap only arms the button — and the armed state
  // lapses after two seconds, so a loaded machine that misses the window arms it again rather than failing the smoke.
  const removeWatcher = host.locator(".room-watcher > button");
  const watching = () => host.locator(".room-watcher").count();
  await removeWatcher.click();
  await host.locator(".room-watcher > button.arming").waitFor();
  assert.equal(await watching(), 1, "one tap asks; it does not remove anyone");
  // The armed state lapses after two seconds. On a loaded machine a tap can land after that, in which case it arms the
  // button again rather than confirming, so the tap is repeated until the row goes.
  for (let attempt = 0; attempt < 6 && (await watching()); attempt++) {
    await removeWatcher.click({ timeout: smokeTimeout(5000) }).catch(() => {});
    for (let waited = 0; waited < 3000 && (await watching()); waited += 250)
      await host.waitForTimeout(250);
  }
  assert.equal(await watching(), 0, "the confirming tap removes the watcher");
  await watcher.locator(".join-kicked").waitFor({ state: "visible" });
  for (const [label, page] of [
    ["host", host],
    ["rider", rider],
  ] as const)
    assert.equal(
      await page.locator(".room-watcher").count(),
      0,
      `${label} sees the watching list empty again`,
    );
  // A kick is not a ban: the same page walks back in.
  await watchButton.waitFor({ state: "visible" });
  await watcher.getByPlaceholder("Your name").fill("Watcher");
  await watchButton.click();
  await host.locator(".room-watchers .room-watcher").waitFor();
  await watcher.locator(".join-kicked").waitFor({ state: "hidden" });

  // The race runs, and the watcher is in it as an audience: same phase, same tick, still no controls.
  await host.getByRole("button", { name: "START RACE", exact: true }).click();
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

  // The host's tab closes for good. The room keeps running (#262), and the rider in the next seat picks it up: the
  // badge moves to its row and it holds the controls that were the host's, so the match can be ended and restarted.
  await host.context().close();
  await rider
    .locator(".online-host:visible")
    .waitFor({ timeout: smokeTimeout(30000) });
  await rider
    .getByRole("button", { name: "BACK TO LOBBY", exact: true })
    .click();
  await waitPhase(rider, ["lobby"]);
  await rider.screenshot({ path: "artifacts/spectator-handover.png" });
  const riderBadges = rider.locator(
    ".room-riders > .room-rider:not(.room-watcher) .host-badge:visible",
  );
  await riderBadges.first().waitFor();
  assert.equal(
    await riderBadges.count(),
    1,
    "exactly one row wears the badge after the handover",
  );
  assert.equal(
    await rider
      .locator(".room-rider")
      .filter({ has: rider.locator(".host-badge:visible") })
      .locator("strong")
      .innerText(),
    "RIDER",
    "and it is the rider that is still here",
  );
  assert.equal(
    await watcher.locator(".online-host").isVisible(),
    false,
    "a watcher does not inherit the room while a rider is in it",
  );

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
