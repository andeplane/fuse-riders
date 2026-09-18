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
        String("/src/engine/trail-lifecycle.ts")
      )) as typeof import("../src/engine/trail-lifecycle.js");
      const { createGame, addPlayer, startMatch, eliminatePlayer } =
        (await import(
          String("/src/engine/game.ts")
        )) as typeof import("../src/engine/game.js");
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
        if (Math.abs(deadRatio - 1) > 0.01)
          throw Error(`Fresh dead trail lost opacity: ${deadRatio}`);
        const detached = paint([{ ...player, trail: dead.trail }]);
        if (regionDifference(detached, crashed, 250, 198, 300, 4) !== 0)
          throw Error("Living detached pieces have different styling");
        const at = (pixels: Uint8Array) => {
          const offset =
            ((mode === "webgl" ? 899 - 198 : 198) * 1600 + 350) * 4;
          return Array.from(pixels.slice(offset, offset + 3));
        };
        const chroma = (pixels: Uint8Array) =>
          Math.max(...at(pixels)) - Math.min(...at(pixels));
        const partial = paint([dead], 130);
        const gray = paint([dead], 160);
        if (!(
          chroma(crashed) > chroma(partial) && chroma(partial) > chroma(gray)
        ))
          throw Error("Trail saturation did not fade gradually");
        if (chroma(gray) > 1) throw Error("Old trail is not neutral gray");
        // A contrasting trail underneath must not show through the solid body.
        const underlay = { ...player, id: "underlay", color: "#ff00ff" };
        for (const tick of [100, 130, 160]) {
          const alone = paint([dead], tick);
          const over = paint([underlay, dead], tick);
          if (at(alone).some((channel, i) => channel !== at(over)[i]))
            throw Error(`Trail body is translucent at tick ${tick}`);
        }
        const frozen = {
          ...base,
          tick: 160,
          presentationTick: 190,
          decidedRound: {
            matchId: "dead-rider-browser",
            round: base.round,
            tick: 130,
            shots: [],
          },
          phase: "roundOver" as const,
          players: [dead],
        };
        arena.render(frozen, 2000, themes[theme], "dead-rider-browser");
        if (at(read()).some((channel, i) => channel !== at(partial)[i]))
          throw Error("Results kept desaturating beyond the final snapshot");
        for (const phase of ["roundOver", "matchOver"] as const) {
          arena.reset(); // A fresh/reconnected renderer also recovers the decision-time color.
          arena.render(
            { ...frozen, phase, tick: 220, presentationTick: 220.5 },
            3000,
            themes[theme],
            "dead-rider-browser",
          );
          if (at(read()).some((channel, i) => channel !== at(partial)[i]))
            throw Error(
              "Advancing result ticks changed the frozen trail color",
            );
        }
        const restored = paint([dead], 100);
        if (at(restored).some((channel, i) => channel !== at(crashed)[i]))
          throw Error("Rollback did not restore trail color");
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
        results.push({
          theme,
          deadRatio,
          chroma: [chroma(crashed), chroma(partial), chroma(gray)],
        });
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
