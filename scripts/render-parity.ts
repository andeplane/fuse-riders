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
 * `src/client/` and the view was built by `toSnapshot` before issue #254). Most moments are one frame after `reset()`.
 * The "after-*" moments draw the tick before and then the tick itself, so what needs two frames is drawn too: gun
 * impacts, death sparks, rubble and trail debris. `Math.random` is replaced by one seeded stream for the page (not
 * reseeded per moment: Phaser names textures with it), so those cosmetics are the same on every run. Every moment is
 * drawn once before any is hashed, so no frame races a texture or font still loading. Same machine and browser only:
 * hashes are not portable across
 * GPUs or Chrome versions.
 *
 *   PARITY_REFERENCE=<ref> npx tsx scripts/render-parity.ts   # compare with <ref> in a throwaway worktree
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const reference = process.env.PARITY_REFERENCE;
if (reference) {
  // Hash this checkout, then <reference> in a throwaway worktree running this same file, and compare frame by frame.
  const run = (cwd: string) =>
    JSON.parse(
      execFileSync("npx", ["tsx", "scripts/render-parity.ts"], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PARITY_REFERENCE: "" },
        maxBuffer: 1 << 26,
      }),
    ) as {
      revision: string;
      frames: {
        name: string;
        tick: number;
        backend: string;
        theme: string;
        sha256: string;
      }[];
    };
  const here = run(process.cwd());
  const dir = join(mkdtempSync(join(tmpdir(), "render-parity-")), "ref");
  execFileSync("git", ["worktree", "add", "--detach", dir, reference], {
    stdio: "ignore",
  });
  try {
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"));
    copyFileSync(
      "scripts/render-parity.ts",
      join(dir, "scripts/render-parity.ts"),
    );
    const there = run(dir);
    const key = (f: (typeof here.frames)[number]) =>
      `${f.backend}/${f.theme}/${f.name}@${f.tick}`;
    const theirs = new Map(there.frames.map((f) => [key(f), f.sha256]));
    const differing = here.frames.filter(
      (f) => theirs.get(key(f)) !== f.sha256,
    );
    console.log(
      JSON.stringify(
        {
          candidate: here.revision,
          reference: there.revision,
          compared: here.frames.length,
          referenceFrames: there.frames.length,
          identical: here.frames.length - differing.length,
          differing: differing.map(key),
        },
        null,
        2,
      ),
    );
    if (differing.length || here.frames.length !== there.frames.length)
      process.exitCode = 1;
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", dir]);
  }
  process.exit();
}

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
    (v) => v.phase === "playing" && v.map !== "wrap" && v.boundaryInset > 40,
  ],
  ["round-over", (v) => v.phase === "roundOver"],
];
const moments: { name: string; view: View; previous?: View }[] = [];
/** Transitions a single frame cannot show: the first few of each, drawn over the tick before. */
const transitions: [string, number, (view: View, previous: View) => boolean][] =
  [
    [
      "after-gun",
      4,
      (v, p) =>
        v.bombs.some(
          (b) => b.shell?.gun && !p.bombs.some((old) => old.id === b.id),
        ),
    ],
    [
      "after-death",
      2,
      (v, p) =>
        v.players.some(
          (r) => !r.alive && p.players.some((o) => o.id === r.id && o.alive),
        ),
    ],
    [
      "after-blast",
      2,
      (v, p) =>
        v.blasts.some((b) => !p.blasts.some((old) => old.bombId === b.bombId)),
    ],
  ];
{
  const state = createRoomState(recording.matchId, defaultRoomSettings()),
    bots = new BotController(),
    streams = streamReader(recording.entries);
  const pending = new Map(wanted);
  const remaining = new Map(transitions.map(([name, count]) => [name, count]));
  let previous: View | undefined;
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
    if (previous && previous.round === view.round)
      for (const [name, , found] of transitions) {
        const left = remaining.get(name)!;
        if (left > 0 && found(view, previous)) {
          moments.push({
            name: `${name}-${left}`,
            view: structuredClone(view),
            previous,
          });
          remaining.set(name, left - 1);
        }
      }
    previous = structuredClone(view);
  }
  assert.deepEqual(
    [...remaining.values()].every((left) => left === 0),
    true,
    "the recording reaches every transition",
  );
  assert.deepEqual(
    [...pending.keys()],
    [],
    "the recording reaches every moment",
  );
  // Range (rules 36) lengthens the aim guide. The recording's riders may never hold a Range pickup while charging, so
  // the charging and target moments are drawn again with every rider at the top Range level.
  for (const name of ["charging", "volley"]) {
    const base = moments.find((moment) => moment.name === name)!;
    const view = structuredClone(base.view) as View;
    moments.push({
      name: `${name}-range3`,
      view: {
        ...view,
        players: view.players.map((player) => ({ ...player, rangeLevel: 3 })),
      },
    });
  }
}

const arenaPath = existsSync("src/render/phaser/arena.ts")
  ? "/src/render/phaser/arena.ts"
  : "/src/client/phaser/arena.ts";
const themesPath = existsSync("src/render/themes.ts")
  ? "/src/render/themes.ts"
  : "/src/client/themes.ts";
const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
  logLevel: "error",
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const browser = await chromium.launch({
  channel: "chrome",
  // Chrome's GPU-rasterised 2D canvas is not bit-stable from run to run; the software one is.
  args: ["--mute-audio", "--disable-accelerated-2d-canvas"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(`
    window.__name = value => value;
    let seed = 1;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  `);
  await page.goto(`http://127.0.0.1:${address.port}/?mute&room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  const frames: {
    name: string;
    tick: number;
    backend: string;
    theme: string;
    sha256: string;
  }[] = [];
  // "portrait" is WebGL on a tall 450x800 box with rotateToFit, as a phone held upright sees the arena (#326).
  for (const backend of ["auto", "canvas", "portrait"] as const) {
    const pictures = await page.evaluate(
      async ({ arenaPath, themesPath, backend, moments }) => {
        const portrait = backend === "portrait";
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
        const box = document.createElement("div");
        box.style.cssText = "width:450px;height:800px";
        if (portrait) box.append(canvas);
        document.body.append(portrait ? box : canvas);
        const arena = createPhaserArena(
          canvas,
          portrait
            ? { renderer: "auto", rotateToFit: true }
            : { renderer: backend, resolution: "world" },
        );
        await arena.ready;
        const pictures: {
          name: string;
          theme: string;
          data: string;
          orientation: string;
        }[] = [];
        // Warm-up: a theme's sprites and fonts load on first use, so draw everything once before hashing anything.
        for (const theme of Object.values(themes))
          for (const moment of moments) {
            arena.reset();
            const view = moment.view as Parameters<typeof arena.render>[0];
            arena.render(view, 100_000, theme, "parity", view.players[1]?.id);
          }
        await document.fonts.ready;
        await new Promise((done) => setTimeout(done, 500));
        for (const theme of Object.values(themes))
          for (const [index, moment] of moments.entries()) {
            arena.reset();
            // A fixed clock per moment: pulses, dashes and rings are functions of `now`.
            const now = 100_000 + index * 137;
            // The second rider's own screen, so the self ring and (in a countdown) the locator are drawn too.
            const view = moment.view as Parameters<typeof arena.render>[0];
            if (moment.previous)
              arena.render(
                moment.previous as typeof view,
                now - 50,
                theme,
                "parity",
                view.players[1]?.id,
              );
            arena.render(view, now, theme, "parity", view.players[1]?.id);
            pictures.push({
              name: moment.name,
              theme: theme.id,
              data: canvas.toDataURL("image/png"),
              orientation: canvas.dataset.arenaOrientation ?? "",
            });
          }
        const renderer = arena.metrics().renderer;
        arena.destroy();
        canvas.remove();
        box.remove();
        return {
          renderer: portrait ? `${renderer}-portrait` : renderer,
          pictures,
        };
      },
      {
        arenaPath,
        themesPath,
        backend,
        // Plain data either way; the page gives it back its type.
        moments: JSON.parse(JSON.stringify(moments)) as {
          name: string;
          view: object;
          previous?: object;
        }[],
      },
    );
    assert.equal(
      pictures.renderer,
      backend === "auto"
        ? "webgl"
        : backend === "canvas"
          ? "canvas"
          : "webgl-portrait",
    );
    if (backend === "portrait")
      assert.ok(
        pictures.pictures.some((picture) => picture.orientation === "portrait"),
        "the tall box turns the arena",
      );
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
