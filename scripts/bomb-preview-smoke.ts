import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
  await page.goto(`http://127.0.0.1:${address.port}/?mute`);
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
      // Linear clamped aim unless a case below turns the bounce on; the fixture now carries the default settings.
      aimBounce: false,
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
    const pictures: { name: string; data: string }[] = [];
    for (const backend of ["auto", "canvas"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      canvas.style.cssText = "position:fixed;inset:0;width:1600px;height:900px";
      document.body.append(canvas);
      const arena = createPhaserArena(canvas, { renderer: backend });
      await arena.ready;
      try {
        const expectedRenderer = backend === "auto" ? "webgl" : "canvas";
        if (arena.metrics().renderer !== expectedRenderer)
          throw Error(
            `Expected ${expectedRenderer}, got ${arena.metrics().renderer}`,
          );
        // Read the white landing dot and return its centre column. Taking the
        // window as an argument is what lets the bouncing cases below look where their marker actually lands.
        const markerCenter = (left: number) => {
          const y = 298,
            width = 80,
            height = 4;
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
              pixels[i]! > 220 &&
              pixels[i + 1]! > 220 &&
              pixels[i + 2]! > 220
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
        // Full-charge Range markers must match the authoritative 600/700/800-unit reach.
        for (const theme of Object.values(themes))
          for (const [rangeLevel, reach] of [
            [1, 600],
            [2, 700],
            [3, 800],
          ] as const) {
            arena.render(
              {
                ...snapshot,
                tick: 48,
                bombChargeTicks: 8,
                players: snapshot.players.map((player) => ({
                  ...player,
                  rangeLevel,
                })),
                pickups: [
                  { id: 1, type: "range", x: 500, y: 500, expiresAtTick: 200 },
                ],
              },
              1600,
              theme,
              "range",
            );
            const center = markerCenter(200 + reach! - 40);
            if (
              !Number.isFinite(center) ||
              Math.abs(center - (200 + reach!)) > 1.5
            )
              throw Error(
                `${backend}/${theme.id}/range ${rangeLevel}: ${center}`,
              );
            results.push({ backend, theme: theme.id, rangeLevel, center });
          }
        // Check the eased approach and return against fixed reference positions, alongside linear clamped aim.
        for (const timing of ["local", "world"] as const) {
          for (const aimBounce of [true, false] as const) {
            const expected = aimBounce
              ? [
                  598.0688095092773, 600, 600, 600, 598.0688095092773,
                  587.4114990234375,
                ]
              : [581.25, 600, 600, 600, 600, 600];
            const ages = [7.5, 8, 9, 10, 10.5, 11],
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
        for (const override of [
          { bombChargeStartedTick: undefined },
          { shellArmed: true },
          { gunArmed: true },
        ]) {
          arena.render(snapshot, 2900, themes["neon-pixel"], "aim-cleared");
          if (
            Math.abs(markerCenter(280) - 300) > 1.5 ||
            !Number.isFinite(markerCenter(280))
          )
            throw Error(`${backend}: missing active aim before clear`);
          arena.render(
            {
              ...snapshot,
              players: snapshot.players.map((p) => ({ ...p, ...override })),
            },
            2900,
            themes["neon-pixel"],
            "aim-cleared",
          );
          if (Number.isFinite(markerCenter(280)))
            throw Error(
              `${backend}: stale bomb aim after ${JSON.stringify(override)}`,
            );
        }
        const sheet = document.createElement("canvas");
        sheet.width = 1280;
        sheet.height = 4 * 350;
        const ctx = sheet.getContext("2d")!;
        const cases = [
          { name: "Single / gold", angle: 0.16, color: "#ffdd55" },
          { name: "Five-shot / cyan", fiveShotArmed: true },
          {
            name: "Target / nearby / pink",
            targetBombArmed: true,
            bombTarget: { x: 230, y: 310 },
            color: "#ff70bd",
          },
          {
            name: "Wall-clamped / violet",
            x: 60,
            angle: Math.PI,
            color: "#b79aff",
          },
        ];
        for (const [column, theme] of Object.values(themes).entries()) {
          for (const [row, { name, ...player }] of cases.entries()) {
            arena.render(
              {
                ...snapshot,
                tick: 48,
                bombChargeTicks: 8,
                players: snapshot.players.map((p) => ({ ...p, ...player })),
              },
              3000,
              theme,
              "aim-showcase",
            );
            ctx.fillStyle = "#080e1c";
            ctx.fillRect(column * 640, row * 350, 640, 350);
            ctx.fillStyle = "#ffffff";
            ctx.font = "14px monospace";
            ctx.fillText(
              `${name} / ${theme.id}`,
              column * 640 + 12,
              row * 350 + 21,
            );
            ctx.drawImage(
              canvas,
              0,
              100,
              800,
              400,
              column * 640,
              row * 350 + 30,
              640,
              320,
            );
          }
        }
        pictures.push({
          name: `bomb-aim-${backend}`,
          data: sheet.toDataURL("image/png"),
        });
      } finally {
        arena.destroy();
        canvas.remove();
      }
    }
    return { results, pictures };
  });
  assert.deepEqual(errors, []);
  await mkdir("artifacts", { recursive: true });
  for (const picture of results.pictures)
    await writeFile(
      `artifacts/${picture.name}-${process.env.BROWSER ?? "chrome"}.png`,
      Buffer.from(picture.data.split(",")[1]!, "base64"),
    );
  console.log(
    JSON.stringify(
      {
        browser: process.env.BROWSER ?? "chrome",
        results: results.results,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
