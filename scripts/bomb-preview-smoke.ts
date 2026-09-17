import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

// Read actual marker pixels using supplied frame times in an isolated renderer.
// This checks presentation wiring, not real network latency or physical-phone performance.
const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const browser = await (process.env.BROWSER === "webkit"
  ? webkit.launch()
  : chromium.launch({ channel: "chrome" }));
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript("window.__name = value => value");
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const results = await page.evaluate(async () => {
    const { createPhaserArena } = (await import(
      String("/src/render/phaser/arena.ts")
    )) as typeof import("../src/render/phaser/arena.js");
    const { visualFixture } = (await import(
      String("/scripts/lib/benchmark-fixture.ts")
    )) as typeof import("./lib/benchmark-fixture.js");
    const { themes } = (await import(
      String("/src/render/themes.ts")
    )) as typeof import("../src/render/themes.js");
    const fixture = visualFixture(40);
    const snapshot = {
      ...fixture,
      boundaryInset: 20,
      bombs: [],
      blasts: [],
      pickups: [],
      portalPairs: [],
      players: fixture.players.slice(0, 1).map((player) => ({
        ...player,
        x: 200,
        y: 300,
        angle: 0,
        color: "#00ffff",
        trail: [],
        alive: true,
        shielded: false,
        shieldGraceUntilTick: 0,
        invulnerableUntilTick: 0,
        portalGraceUntilTick: 0,
        drunkUntilTick: 0,
        inkUntilTick: 0,
        bombChargeStartedTick: 40,
        targetBombArmed: false,
        tripleShotArmed: false,
        fiveShotArmed: false,
        shellArmed: false,
        gunArmed: false,
      })),
    };
    const results = [];
    for (const backend of ["auto", "canvas"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      canvas.style.cssText = "position:fixed;inset:0;width:1600px;height:900px";
      document.body.append(canvas);
      const arena = createPhaserArena(canvas, { renderer: backend });
      await arena.ready;
      try {
        // The marker is a cyan square; read a strip across its top edge and return its centre column. Taking the
        // window as an argument is what lets the bouncing cases below look where their marker actually lands.
        const markerCenter = (left: number) => {
          const y = 286,
            width = 80,
            height = 9;
          const pixels = new Uint8Array(width * height * 4);
          if (backend === "auto") {
            const gl = canvas.getContext("webgl")!;
            gl.readPixels(
              left,
              canvas.height - y - height,
              width,
              height,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels,
            );
          } else
            pixels.set(
              canvas.getContext("2d")!.getImageData(left, y, width, height)
                .data,
            );
          let minimum = Infinity,
            maximum = -Infinity;
          for (let i = 0; i < pixels.length; i += 4) {
            if (
              pixels[i]! < 100 &&
              pixels[i + 1]! > 140 &&
              pixels[i + 2]! > 140
            ) {
              const column = left + ((i / 4) % width);
              minimum = Math.min(minimum, column);
              maximum = Math.max(maximum, column);
            }
          }
          return (minimum + maximum) / 2;
        };
        for (const bombChargeTicks of [8, 24])
          for (const timing of ["local", "world"] as const) {
            const centers = [];
            for (let frame = 0; frame < 4; frame++) {
              const tick = 40 + frame / 3;
              const shown =
                timing === "local"
                  ? {
                      ...snapshot,
                      bombChargeTicks,
                      players: snapshot.players.map((player) => ({
                        ...player,
                        presentationTick: tick,
                      })),
                    }
                  : { ...snapshot, bombChargeTicks, tick };
              arena.render(
                shown,
                1000 + (frame * 1000) / 60,
                themes["neon-pixel"],
                timing,
              );
              const center = markerCenter(280);
              if (
                !Number.isFinite(center) ||
                Math.abs(center - (300 + (frame * 100) / bombChargeTicks)) > 1.5
              ) {
                throw Error(
                  `${backend}/${timing} marker at frame ${frame}: ${center}`,
                );
              }
              centers.push(center);
            }
            results.push({ backend, timing, bombChargeTicks, centers });
          }
        // A new room bounces by default (#175), and the fold is the only place the two ramps disagree: below the
        // peak they are identical, which is every frame the cases above render. At a window of 8 the rider sits at
        // x=200, so ages 7.5 → 9 walk the bouncing marker out to full reach and back, 581.25 → 600 → 581.25 →
        // 562.5, while the clamped ramp climbs the same way to 600 and then stays there. They agree at 7.5 and 8
        // and part company after the peak, so the control is what proves the flag moved the marker.
        for (const timing of ["local", "world"] as const) {
          for (const aimBounce of [true, false] as const) {
            const expected = aimBounce
              ? [581.25, 600, 581.25, 562.5]
              : [581.25, 600, 600, 600];
            const ages = [7.5, 8, 8.5, 9],
              centers = [];
            for (let index = 0; index < ages.length; index++) {
              const tick = 40 + ages[index]!;
              const shown =
                timing === "local"
                  ? {
                      ...snapshot,
                      bombChargeTicks: 8,
                      aimBounce,
                      players: snapshot.players.map((player) => ({
                        ...player,
                        presentationTick: tick,
                      })),
                    }
                  : { ...snapshot, bombChargeTicks: 8, aimBounce, tick };
              arena.render(
                shown,
                2000 + (index * 1000) / 60,
                themes["neon-pixel"],
                timing,
              );
              const center = markerCenter(Math.round(expected[index]!) - 40);
              if (
                !Number.isFinite(center) ||
                Math.abs(center - expected[index]!) > 1.5
              ) {
                throw Error(
                  `${backend}/${timing} bounce=${aimBounce} at age ${ages[index]}: ${center}, wanted ${expected[index]}`,
                );
              }
              centers.push(center);
            }
            results.push({
              backend,
              timing,
              aimBounce,
              bombChargeTicks: 8,
              centers,
            });
          }
        }
      } finally {
        arena.destroy();
        canvas.remove();
      }
    }
    return results;
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { browser: process.env.BROWSER ?? "chrome", results, errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
