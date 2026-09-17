/**
 * Pixel parity of the arena across revisions. Replays the pinned golden recording in Node, takes the view at a fixed
 * set of moments (one per thing worth seeing: pickups, bombs in flight, shells, blasts, portals, black holes, scenery,
 * the wrapping map, a charging rider, ink, a shield, a countdown), draws each on both Phaser backends at a fixed
 * clock, and prints a SHA-256 of the pixels. Two revisions that print the same hashes draw the same picture.
 *
 *   npx tsx scripts/render-parity.ts            # hashes as JSON on stdout
 *   PARITY_PNG=1 npx tsx scripts/render-parity.ts   # also writes artifacts/render-parity/*.png
 *
 * Paths are resolved at run time so the file can be copied onto an older revision (the renderer lived in
 * `src/client/` and the view was built by `toSnapshot` before issue #254). One frame after `reset()` per moment, so
 * nothing random is drawn (sparks and debris need a previous frame). Same machine and browser only: hashes are not
 * portable across GPUs or Chrome versions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const engine = (await import(
  String("../src/engine/game.ts")
)) as typeof import("../src/engine/game.js") & {
  toSnapshot?: (typeof import("../src/engine/game.js"))["toView"];
};
const { applyTick, createRoomState } =
  await import("../src/engine/apply-tick.js");
const { BotController } = await import("../src/engine/bot-controller.js");
const { defaultRoomSettings } = await import("../src/engine/room-settings.js");
const { streamReader } = await import("../tests/fixtures/replay-log.js");
type View = ReturnType<(typeof engine)["toView"]>;
const toView = engine.toView ?? engine.toSnapshot!;

const recording = JSON.parse(
  readFileSync(
    new URL("../tests/fixtures/mechanics-recording.json", import.meta.url),
    "utf8",
  ),
);
const wanted: [string, (view: View) => boolean][] = [
  ["countdown", (v) => v.phase === "countdown"],
  ["pickups", (v) => v.phase === "playing" && v.pickups.length >= 3],
  [
    "bomb-in-flight",
    (v) => v.bombs.some((b) => !b.shell && v.tick < b.landsAtTick),
  ],
  [
    "bomb-fused",
    (v) => v.bombs.some((b) => !b.shell && v.tick > b.landsAtTick),
  ],
  ["shell", (v) => v.bombs.some((b) => b.shell && !b.shell.gun)],
  ["gun-tracer", (v) => v.bombs.some((b) => b.shell?.gun)],
  ["blast", (v) => v.blasts.length > 0],
  ["portals", (v) => v.portalPairs.length > 0],
  ["black-hole", (v) => v.gravityFields.length > 0],
  ["scenery", (v) => v.phase === "playing" && v.obstacles.length > 3],
  [
    "wrap-map",
    (v) => v.phase === "playing" && v.map === "wrap" && v.boundaryInset <= 0,
  ],
  ["cross-map", (v) => v.phase === "playing" && v.map === "cross"],
  [
    "charging",
    (v) =>
      v.players.some(
        (p) =>
          p.alive &&
          p.bombChargeStartedTick !== undefined &&
          !p.gunArmed &&
          !p.shellArmed &&
          !p.targetBombArmed,
      ),
  ],
  [
    "volley",
    (v) =>
      v.players.some(
        (p) =>
          p.alive &&
          p.bombChargeStartedTick !== undefined &&
          p.extraBombs +
            (p.tripleShotArmed ? 2 : 0) +
            (p.fiveShotArmed ? 4 : 0) >
            0,
      ),
  ],
  [
    "target-bomb",
    (v) =>
      v.players.some(
        (p) => p.alive && p.targetBombArmed && p.bombTarget !== undefined,
      ),
  ],
  ["ink", (v) => v.players.some((p) => p.alive && p.inkUntilTick > v.tick)],
  ["shield", (v) => v.players.some((p) => p.alive && p.shielded)],
  [
    "star",
    (v) => v.players.some((p) => p.alive && p.invulnerableUntilTick > v.tick),
  ],
  ["dizzy", (v) => v.players.some((p) => p.alive && p.drunkUntilTick > v.tick)],
  [
    "reloading",
    (v) => v.players.some((p) => p.alive && p.bombReadyAtTick > v.tick + 20),
  ],
  ["debris", (v) => v.players.some((p) => p.trail.some((s) => s.detached))],
  [
    "overtime",
    (v) => v.phase === "playing" && v.map !== "wrap" && v.boundaryInset > 60,
  ],
  ["round-over", (v) => v.phase === "roundOver"],
];
const moments: { name: string; view: View }[] = [];
{
  const state = createRoomState(recording.matchId, defaultRoomSettings()),
    bots = new BotController(),
    streams = streamReader(recording.entries);
  const pending = new Map(wanted);
  for (let tick = 1; tick <= recording.ticks; tick++) {
    applyTick(state, recording.creator, streams(tick), bots);
    const view = {
      ...toView(state.game),
      tick: state.game.tick,
      round: state.game.round,
    };
    for (const [name, found] of pending)
      if (found(view)) {
        moments.push({ name, view: structuredClone(view) });
        pending.delete(name);
      }
    if (tick % 1500 === 0)
      moments.push({ name: `tick-${tick}`, view: structuredClone(view) });
  }
  assert.deepEqual(
    [...pending.keys()],
    [],
    "the recording reaches every moment",
  );
}

const arenaPath = existsSync("src/render/phaser/arena.ts")
  ? "/src/render/phaser/arena.ts"
  : "/src/client/phaser/arena.ts";
const themesPath = existsSync("src/render/themes.ts")
  ? "/src/render/themes.ts"
  : "/src/client/themes.ts";
const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--mute-audio"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript("window.__name = value => value");
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  const frames: {
    name: string;
    tick: number;
    backend: string;
    theme: string;
    sha256: string;
  }[] = [];
  for (const backend of ["auto", "canvas"] as const) {
    const pictures = await page.evaluate(
      async ({ arenaPath, themesPath, backend, moments }) => {
        const { createPhaserArena } = (await import(
          arenaPath
        )) as typeof import("../src/render/phaser/arena.js");
        const { themes } = (await import(
          themesPath
        )) as typeof import("../src/render/themes.js");
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 900;
        canvas.style.cssText = "width:1600px;height:900px";
        document.body.append(canvas);
        const arena = createPhaserArena(canvas, {
          renderer: backend,
          resolution: "world",
        });
        await arena.ready;
        const pictures: { name: string; theme: string; data: string }[] = [];
        for (const theme of Object.values(themes))
          for (const [index, moment] of moments.entries()) {
            arena.reset();
            // A fixed clock per moment: pulses, dashes and rings are functions of `now`.
            const now = 100_000 + index * 137;
            // The second rider's own screen, so the self ring and (in a countdown) the locator are drawn too.
            const view = moment.view as Parameters<typeof arena.render>[0];
            arena.render(view, now, theme, "parity", view.players[1]?.id);
            pictures.push({
              name: moment.name,
              theme: theme.id,
              data: canvas.toDataURL("image/png"),
            });
          }
        const renderer = arena.metrics().renderer;
        arena.destroy();
        canvas.remove();
        return { renderer, pictures };
      },
      {
        arenaPath,
        themesPath,
        backend,
        // Plain data either way; the page gives it back its type.
        moments: JSON.parse(JSON.stringify(moments)) as {
          name: string;
          view: object;
        }[],
      },
    );
    assert.equal(pictures.renderer, backend === "auto" ? "webgl" : "canvas");
    for (const picture of pictures.pictures) {
      const bytes = Buffer.from(picture.data.split(",")[1]!, "base64");
      frames.push({
        name: picture.name,
        tick: moments.find((moment) => moment.name === picture.name)!.view.tick,
        backend: pictures.renderer,
        theme: picture.theme,
        sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
      });
      if (process.env.PARITY_PNG) {
        await mkdir("artifacts/render-parity", { recursive: true });
        await writeFile(
          `artifacts/render-parity/${pictures.renderer}-${picture.theme}-${picture.name}.png`,
          bytes,
        );
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        recording: "tests/fixtures/mechanics-recording.json",
        frames,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
