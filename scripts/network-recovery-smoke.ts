import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { launchSelected } from "./lib/browser.js";
import { ridersPageUrl } from "./lib/riders-url.js";
import { readyRoom } from "./lib/ready-room.js";
import { instrument } from "./p2p-measure.js";

interface Pose {
  x: number;
  y: number;
  angle: number;
}
interface Render {
  epochAt: number;
  phase: string;
  players: Array<{ id: string; alive: boolean; canonical: Pose; shown: Pose }>;
}
interface Trace {
  snapshots: Array<{
    phase: string;
    playerId: string;
    players: Array<{
      id: string;
      alive: boolean;
      heldMotion?: { left: boolean; right: boolean };
    }>;
    metrics: { rollbacks: number; mismatches: number };
  }>;
  renders: Render[];
  dropFastUntil: number;
}
const browser = await launchSelected("chromium", { headless: true });
const errors: string[] = [];
const pages = await Promise.all(
  [0, 1].map(async () => {
    const page = await (
      await browser.newContext({ viewport: { width: 1100, height: 760 } })
    ).newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await instrument(page, false);
    return page;
  }),
);
const [host, guest] = pages;
assert.ok(host && guest);
try {
  const entrance = new URL(
    ridersPageUrl(process.env.ONLINE_URL ?? "http://localhost:8787/"),
  );
  entrance.searchParams.set("mute", "");
  entrance.searchParams.set("benchmark", "1");
  entrance.searchParams.set("renderer", "phaser-canvas");
  await host.addInitScript(() =>
    localStorage.setItem("fuse-riders-player-name", "Anchor"),
  );
  await guest.addInitScript(() =>
    localStorage.setItem("fuse-riders-player-name", "Pilot"),
  );
  await host.goto(entrance.href);
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  // Admission awaits ICE configuration. Let it finish before a parameter-normalizing navigation,
  // otherwise WebKit reports the cancelled fetch as a page error from the departing document.
  await host
    .locator(".room-rider strong")
    .filter({ hasText: "Anchor" })
    .waitFor();
  const invite = new URL(host.url());
  for (const [key, value] of entrance.searchParams)
    invite.searchParams.set(key, value);
  if (host.url() !== invite.href) await host.goto(invite.href);
  await guest.goto(invite.href);
  await host
    .locator(".room-rider strong")
    .filter({ hasText: "Pilot" })
    .waitFor();
  await readyRoom(host);
  for (const page of pages) {
    await page.waitForFunction(
      () =>
        (Reflect.get(window, "__trace") as Trace).snapshots.at(-1)?.phase ===
        "playing",
    );
    await page.locator('.online-arena[data-renderer-status="ready"]').waitFor();
  }
  const peerId = await guest.evaluate(
    () => (Reflect.get(window, "__trace") as Trace).snapshots.at(-1)!.playerId,
  );
  await guest.keyboard.down("ArrowLeft");
  await host.waitForFunction(
    (id) =>
      (Reflect.get(window, "__trace") as Trace).snapshots
        .at(-1)
        ?.players.find((p) => p.id === id)?.heldMotion?.left === true,
    peerId,
  );
  await guest.waitForTimeout(100);
  const start = await host.evaluate(
    () => performance.timeOrigin + performance.now(),
  );
  await guest.evaluate(() => {
    (Reflect.get(window, "__trace") as Trace).dropFastUntil =
      performance.timeOrigin + performance.now() + 500;
  });
  await guest.keyboard.up("ArrowLeft");
  await host.waitForFunction((id) => {
    const latest = (Reflect.get(window, "__trace") as Trace).snapshots.at(-1);
    return (
      latest &&
      latest.metrics.rollbacks > 0 &&
      latest.players.find((p) => p.id === id)?.heldMotion?.left === false
    );
  }, peerId);
  await host.waitForTimeout(250);
  // A short foreground main-thread stall is application impairment, not IP packet loss.
  await guest.keyboard.down("ArrowRight");
  await host.waitForFunction(
    (id) =>
      (Reflect.get(window, "__trace") as Trace).snapshots
        .at(-1)
        ?.players.find((p) => p.id === id)?.heldMotion?.right === true,
    peerId,
  );
  await Promise.all([
    host.evaluate(() => {
      const end = performance.now() + 100;
      while (performance.now() < end) {
        /* deliberate 100 ms browser workload */
      }
    }),
    guest.keyboard.up("ArrowRight"),
  ]);
  await host.waitForFunction((id) => {
    const motion = (Reflect.get(window, "__trace") as Trace).snapshots
      .at(-1)
      ?.players.find((p) => p.id === id)?.heldMotion;
    return motion && !motion.left && !motion.right;
  }, peerId);
  await host.waitForTimeout(250);
  const trace = await host.evaluate(
    () => Reflect.get(window, "__trace") as Trace,
  );
  const renders = trace.renders.filter(
    (render) => render.epochAt >= start && render.phase === "playing",
  );
  let rawDegrees = 0,
    shownDegrees = 0,
    sampled = 0;
  const delta = (a: number, b: number) =>
    (Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180) / Math.PI;
  for (let i = 1; i < renders.length; i++) {
    const prior = renders[i - 1]!,
      current = renders[i]!;
    if (current.epochAt - prior.epochAt > 50) continue;
    const a = prior.players.find((p) => p.id === peerId),
      b = current.players.find((p) => p.id === peerId);
    if (!a?.alive || !b?.alive) continue;
    sampled++;
    rawDegrees = Math.max(
      rawDegrees,
      delta(a.canonical.angle, b.canonical.angle),
    );
    shownDegrees = Math.max(shownDegrees, delta(a.shown.angle, b.shown.angle));
  }
  assert.ok(sampled > 10, "real rendered frames recorded");
  assert.ok(rawDegrees > 30, `blackout exercised a correction: ${rawDegrees}`);
  assert.ok(
    shownDegrees < 30 && shownDegrees < rawDegrees,
    `portrait correction was bounded: raw ${rawDegrees}, shown ${shownDegrees}`,
  );
  assert.equal(trace.snapshots.at(-1)!.metrics.mismatches, 0);
  assert.deepEqual(errors, []);
  const name = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
  await mkdir("artifacts", { recursive: true });
  await host.screenshot({ path: `artifacts/network-recovery-${name}.png` });
  const report = {
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    browser: name,
    scenario:
      "two browser contexts, 500 ms sender-side input-channel blackout on steering release",
    foregroundStallMs: 100,
    sampled,
    rawDegrees,
    shownDegrees,
    mismatches: trace.snapshots.at(-1)!.metrics.mismatches,
    errors,
  };
  await writeFile(
    `artifacts/network-recovery-${name}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
