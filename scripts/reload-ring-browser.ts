import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

// Isolated snapshots exercise actual rendered pixels without joining an occupied match.
const server = await createServer({
  server: {
    port: 0,
    host: "127.0.0.1",
    hmr: false,
    fs: { allow: [process.cwd(), await realpath("node_modules")] },
  },
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
        String("/games/fuse-riders/src/render/phaser/arena.ts")
      )) as typeof import("../games/fuse-riders/src/render/phaser/arena.js");
      const { visualFixture } = (await import(
        String("/scripts/lib/benchmark-fixture.ts")
      )) as typeof import("./lib/benchmark-fixture.js");
      const { themes } = (await import(
        String("/games/fuse-riders/src/render/themes.ts")
      )) as typeof import("../games/fuse-riders/src/render/themes.js");
      const { BOMB_COOLDOWN_TICKS } = (await import(
        String("/games/fuse-riders/src/engine/game.ts")
      )) as typeof import("../games/fuse-riders/src/engine/game.js");
      const { RELOAD_RING_RADIUS } = (await import(
        String("/games/fuse-riders/src/render/reload-ring.ts")
      )) as typeof import("../games/fuse-riders/src/render/reload-ring.js");
      type Snapshot =
        import("../games/fuse-riders/src/engine/view.js").WorldView;
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
      const player = {
        ...fixture.players[0]!,
        color: "#22d3ee",
        x: 800,
        y: 450,
        angle: 0,
        shielded: false,
        trail: [],
        bombReadyAtTick: 100 + BOMB_COOLDOWN_TICKS,
      };
      const base: Snapshot = {
        ...fixture,
        players: [player],
        bombs: [],
        blasts: [],
        pickups: [],
        portalPairs: [],
        gravityFields: [],
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
      const results = [];
      for (const theme of ["neon-pixel", "clean-neon"] as const) {
        const paint = (snapshot: Snapshot, now = 1000) => {
          arena.render(snapshot, now, themes[theme], "reload-ring-browser");
          return read();
        };
        const equal = (a: Uint8Array, b: Uint8Array, message: string) => {
          if (!a.every((v, i) => v === b[i]))
            throw Error(`${mode}/${theme}: ${message}`);
        };
        const ready = paint({
          ...base,
          players: [{ ...player, bombReadyAtTick: 0 }],
        });
        const full = paint(base);
        const halfway = { ...base, tick: 100 + BOMB_COOLDOWN_TICKS / 2 };
        const half = paint(halfway);
        const countArc = (pixels: Uint8Array) => {
          let count = 0;
          for (let y = 422; y < 479; y++)
            for (let x = 772; x < 829; x++) {
              const radius = Math.hypot(x - 800, y - 450);
              if (
                radius < RELOAD_RING_RADIUS - 2 ||
                radius > RELOAD_RING_RADIUS + 2
              )
                continue;
              const offset = ((mode === "webgl" ? 899 - y : y) * 1600 + x) * 4;
              if (
                pixels[offset + 1]! > ready[offset + 1]! + 60 &&
                pixels[offset + 2]! > ready[offset + 2]! + 60
              )
                count++;
            }
          return count;
        };
        const fullPixels = countArc(full),
          halfPixels = countArc(half);
        // At least half the nominal two-pixel arc area must brighten over the existing portrait glow.
        if (
          fullPixels < Math.PI * RELOAD_RING_RADIUS * 2 ||
          halfPixels < fullPixels * 0.35 ||
          halfPixels > fullPixels * 0.65
        )
          throw Error(`Arc does not drain: ${fullPixels}/${halfPixels}`);
        equal(half, paint(halfway, 5000), "wall time changed paused cooldown");
        equal(
          half,
          paint({ ...base, presentationTick: halfway.tick }),
          "world presentation time ignored",
        );
        equal(
          half,
          paint({
            ...base,
            presentationTick: 100,
            players: [{ ...player, presentationTick: halfway.tick }],
          }),
          "rider presentation time ignored",
        );
        const fractional = paint({ ...base, tick: halfway.tick + 0.75 });
        if (fractional.every((v, i) => v === half[i]))
          throw Error("Fractional cooldown does not move");
        equal(full, paint(base), "rollback did not restore full cooldown");
        equal(
          ready,
          paint({ ...base, tick: player.bombReadyAtTick }),
          "ring remains when ready",
        );
        equal(
          ready,
          paint({ ...base, phase: "countdown" }),
          "ring remains outside play",
        );
        arena.reset();
        const dead = { ...player, alive: false };
        const crashed = paint({ ...base, players: [dead] });
        equal(
          crashed,
          paint({ ...base, players: [{ ...dead, bombReadyAtTick: 0 }] }),
          "dead rider retains reload ring",
        );
        arena.reset();
        equal(full, paint(base), "reset lost cooldown");
        results.push({ theme, fullPixels, halfPixels });
      }
      // Visual review strip: full, 3/4, 1/2, 1/4 and ready in their ordinary rider colors.
      const strip = {
        ...base,
        players: fixture.players.map((p, i) => ({
          ...player,
          id: p.id,
          slot: p.slot,
          avatarId: p.avatarId,
          color: p.color,
          x: 240 + i * 280,
          bombReadyAtTick: 100 + BOMB_COOLDOWN_TICKS * (1 - i / 4),
        })),
      };
      arena.render(strip, 1000, themes["neon-pixel"], "reload-ring-browser");
      Reflect.set(window, "disposeReloadCheck", () => {
        arena.destroy();
        canvas.remove();
      });
      return results;
    }, mode);
    await page.screenshot({
      path: `artifacts/reload-ring-${mode}-${browserName}.png`,
    });
    await page.screenshot({
      path: `artifacts/reload-ring-detail-${mode}-${browserName}.png`,
      clip: { x: 195, y: 405, width: 1210, height: 90 },
    });
    await page.evaluate(() => {
      (Reflect.get(window, "disposeReloadCheck") as () => void)();
    });
    console.log(JSON.stringify({ mode, results }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
