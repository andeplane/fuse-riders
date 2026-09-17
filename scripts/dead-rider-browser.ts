import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

// Isolated visual regression: real renderers, synthetic snapshots, no occupied rooms.
const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const browserName = process.env.BROWSER ?? "chrome";
const browser =
  browserName === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("artifacts", { recursive: true });
  await page.addInitScript("window.__name = value => value");
  await page.goto(`http://127.0.0.1:${address.port}/?room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  for (const mode of ["webgl", "phaser-canvas"] as const) {
    const results = await page.evaluate(async (mode) => {
      const { createPhaserArena } = (await import(
        String("/src/client/phaser/arena.ts")
      )) as typeof import("../src/client/phaser/arena.js");
      const { visualFixture } = (await import(
        String("/src/client/phaser/benchmark-fixture.ts")
      )) as typeof import("../src/client/phaser/benchmark-fixture.js");
      const { themes } = (await import(
        String("/src/client/themes.ts")
      )) as typeof import("../src/client/themes.js");
      const { advanceTrail } = (await import(
        String("/src/shared/trail-lifecycle.ts")
      )) as typeof import("../src/shared/trail-lifecycle.js");
      const { createGame, addPlayer, startMatch, eliminatePlayer } =
        (await import(
          String("/src/shared/game.ts")
        )) as typeof import("../src/shared/game.js");
      document.body.replaceChildren();
      document.body.style.cssText = "margin:0;background:#020715";
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      document.body.append(canvas);
      const arena = createPhaserArena(canvas, {
        renderer: mode === "webgl" ? "auto" : "canvas",
        resolution: "world",
      });
      await arena.ready;
      if (mode === "webgl" && arena.metrics().renderer !== "webgl")
        throw Error("WebGL did not start");
      const fixture = visualFixture(100);
      const base = {
        ...fixture,
        players: [],
        bombs: [],
        blasts: [],
        pickups: [],
        portalPairs: [],
        gravityFields: [],
      };
      const player = {
        ...fixture.players[0]!,
        color: "#22d3ee",
        x: 800,
        y: 450,
        shielded: true,
        drunkUntilTick: 200,
        invulnerableUntilTick: 200,
        portalGraceUntilTick: 200,
        trail: [
          {
            x1: 200,
            y1: 200,
            x2: 600,
            y2: 200,
            createdTick: 80,
            expiresAtTick: 200,
          },
        ],
      };
      const read = (): Uint8Array => {
        const gl = mode === "webgl" ? canvas.getContext("webgl") : null;
        if (!gl)
          return new Uint8Array(
            canvas.getContext("2d")!.getImageData(0, 0, 1600, 900).data,
          );
        const pixels = new Uint8Array(1600 * 900 * 4);
        gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        return pixels;
      };
      const regionDifference = (
        a: Uint8Array,
        b: Uint8Array,
        x: number,
        y: number,
        width: number,
        height: number,
      ) => {
        let difference = 0;
        for (let row = y; row < y + height; row++)
          for (let col = x; col < x + width; col++) {
            const offset =
              ((mode === "webgl" ? 899 - row : row) * 1600 + col) * 4;
            for (let channel = 0; channel < 3; channel++)
              difference += Math.abs(
                a[offset + channel]! - b[offset + channel]!,
              );
          }
        return difference;
      };
      const results = [];
      for (const theme of ["neon-pixel", "clean-neon"] as const) {
        const paint = (players: (typeof player)[], tick = 100) => {
          const snapshot = { ...base, tick, players };
          arena.render(snapshot, 1000, themes[theme], "dead-rider-browser");
          return read();
        };
        arena.reset();
        const empty = paint([]);
        const alive = paint([player]);
        const livingTrail = regionDifference(alive, empty, 250, 198, 300, 4);
        if (livingTrail <= 0) throw Error("Live trail missing");
        if (regionDifference(alive, empty, 750, 395, 100, 110) === 0)
          throw Error("Live avatar missing");
        const game = createGame("decaying-trail");
        game.tick = 100;
        addPlayer(game, {
          id: player.id,
          name: player.name,
          slot: 0,
          color: player.color,
        });
        addPlayer(game, {
          id: "other",
          name: "Other",
          slot: 1,
          color: "#ff4fa3",
        });
        startMatch(game);
        game.players.get(player.id)!.trail = structuredClone(player.trail);
        eliminatePlayer(game, player.id);
        const dead = {
          ...player,
          alive: false,
          trail: game.players.get(player.id)!.trail,
        };
        paint([dead]);
        if (arena.metrics().particles === 0) throw Error("Death burst missing");
        // Remove the transient sparks so we can inspect the pooled avatar and its overlays underneath.
        arena.reset();
        const crashed = paint([dead]);
        if (regionDifference(crashed, empty, 750, 395, 100, 110) !== 0)
          throw Error("Dead rider obscures crash");
        const deadRatio =
          regionDifference(crashed, empty, 250, 198, 300, 4) / livingTrail;
        if (deadRatio < 0.5 || deadRatio > 0.8)
          throw Error(`Dead trail too faint: ${deadRatio}`);
        const detached = paint([{ ...player, trail: dead.trail }]);
        const detachedRatio =
          regionDifference(detached, empty, 250, 198, 300, 4) / livingTrail;
        if (Math.abs(detachedRatio - deadRatio) > 0.01)
          throw Error("Living detached pieces have different opacity");
        const paused = paint([dead], 120);
        const pausedRatio =
          regionDifference(paused, empty, 250, 198, 300, 4) / livingTrail;
        if (Math.abs(pausedRatio - deadRatio) > 0.01)
          throw Error("Pause faded the whole trail");
        const shrinking = {
          ...dead,
          trail: advanceTrail(dead.trail, 160, 120),
        };
        const eroded = paint([shrinking], 160);
        if (regionDifference(eroded, empty, 210, 190, 50, 20) !== 0)
          throw Error("Old endpoint did not shrink");
        if (regionDifference(eroded, empty, 540, 190, 50, 20) !== 0)
          throw Error("New endpoint did not shrink");
        if (regionDifference(eroded, empty, 300, 198, 200, 4) <= 0)
          throw Error("Surviving middle vanished");
        const removed = paint(
          [{ ...dead, trail: advanceTrail(shrinking.trail, 240, 160) }],
          240,
        );
        if (regionDifference(removed, empty, 200, 190, 400, 20) !== 0)
          throw Error("Eroded trail remains visible");
        const revived = paint([player]);
        if (regionDifference(revived, empty, 750, 395, 100, 110) === 0)
          throw Error("Live avatar did not return");
        results.push({ theme, deadRatio, detachedRatio, pausedRatio });
        paint([dead]);
        arena.reset();
        paint([dead]);
      }
      Reflect.set(window, "disposeDeadRiderCheck", () => {
        arena.destroy();
        canvas.remove();
      });
      return results;
    }, mode);
    await page.screenshot({
      path: `artifacts/dead-rider-${mode}-${browserName}.png`,
    });
    await page.evaluate(() => {
      (Reflect.get(window, "disposeDeadRiderCheck") as () => void)();
    });
    console.log(JSON.stringify({ mode, results }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
