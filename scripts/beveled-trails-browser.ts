import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

// Isolated renderer fixtures; never joins or interrupts a real match.
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
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (message) => {
  if (
    message.type() === "error" &&
    /shader|webgl|gl_invalid/i.test(message.text())
  )
    errors.push(message.text());
});
try {
  await mkdir("artifacts", { recursive: true });
  await page.addInitScript("window.__name = value => value");
  await page.goto(`http://127.0.0.1:${address.port}/?mute&room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  const result = await page.evaluate(async () => {
    const { createPhaserArena } = (await import(
      String("/src/render/phaser/arena.ts")
    )) as typeof import("../src/render/phaser/arena.js");
    const { visualFixture } = (await import(
      String("/scripts/lib/benchmark-fixture.ts")
    )) as typeof import("./lib/benchmark-fixture.js");
    const { themes } = (await import(
      String("/src/render/themes.ts")
    )) as typeof import("../src/render/themes.js");
    document.body.replaceChildren();
    document.body.style.cssText = "margin:0;background:#020715";
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    document.body.append(canvas);
    const arena = createPhaserArena(canvas, { resolution: "world" });
    await arena.ready;
    if (arena.metrics().renderer !== "webgl") throw Error("WebGL missing");
    const fixture = visualFixture(200);
    const base = {
      ...fixture,
      obstacles: [],
      pickups: [],
      bombs: [],
      blasts: [],
      portalPairs: [],
      gravityFields: [],
      players: [],
    };
    const rider = {
      ...fixture.players[0]!,
      shielded: false,
      x: 1300,
      y: 600,
      color: "#a3e635",
    };
    const segment = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      createdTick: number,
    ) => ({ x1, y1, x2, y2, createdTick, expiresAtTick: 500 });
    const testRider = {
      ...rider,
      trail: [
        segment(200, 200, 500, 200, 198),
        segment(500, 200, 800, 200, 199),
      ],
    };
    const gl = canvas.getContext("webgl")!;
    const paint = (
      players: (typeof testRider)[],
      theme: keyof typeof themes = "neon-pixel",
    ) => {
      arena.render({ ...base, players }, 1000, themes[theme], "bevel-fixture");
      const pixels = new Uint8Array(1600 * 900 * 4);
      gl.readPixels(0, 0, 1600, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const at = (pixels: Uint8Array, x: number, y: number) =>
      Array.from(
        pixels.slice(
          ((899 - y) * 1600 + x) * 4,
          ((899 - y) * 1600 + x) * 4 + 3,
        ),
      );
    const distance = (a: number[], b: number[]) =>
      a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0);
    const empty = paint([]);
    const filled = paint([testRider]);
    // Sample opposite shoulders of the wider body, away from the antialiased rim.
    const upper = at(filled, 350, 197),
      lower = at(filled, 350, 202);
    if (distance(upper, lower) < 50) throw Error("Beveled lighting is flat");
    if (distance(at(filled, 499, 200), at(filled, 501, 200)) > 10)
      throw Error("History/tip join has a seam");
    // A missing tick at the same coordinate still splits the geometry; a real gap stays empty.
    const cut = paint([
      {
        ...testRider,
        trail: [
          segment(200, 200, 400, 200, 197),
          segment(450, 200, 800, 200, 199),
        ],
      },
    ]);
    if (distance(at(cut, 425, 200), at(empty, 425, 200)) !== 0)
      throw Error("Explosion gap bridged");
    const cleared = paint([]);
    if (distance(at(cleared, 350, 200), at(empty, 350, 200)) !== 0)
      throw Error("Stale trail after removal");
    const alternate = paint([testRider], "clean-neon");
    if (distance(at(alternate, 350, 199), at(filled, 350, 199)) > 2)
      throw Error("Theme changes solid trail shading");

    // Hand-authored centerlines are sampled into ordinary authoritative-style segments.
    // Broad bends, all directions, open caps, and an explosion-cut detached piece.
    const players = fixture.players.slice(0, 3).map((p, index) => {
      const points = Array.from({ length: 181 }, (_, i) => {
        const t = i / 180;
        return {
          x: 150 + t * 1280,
          y: 205 + index * 245 + Math.sin(t * Math.PI * 3.2 + index * 0.6) * 95,
        };
      });
      const trail = points.slice(1).flatMap((point, i) => {
        if (index === 1 && i >= 78 && i <= 84) return [];
        return [
          {
            ...segment(points[i]!.x, points[i]!.y, point.x, point.y, 20 + i),
            ...(index === 1 && i < 78
              ? { detached: { id: 1, decayStartTick: 240 } }
              : {}),
          },
        ];
      });
      return {
        ...p,
        shielded: false,
        drunkUntilTick: 0,
        color: ["#a3e635", "#22d3ee", "#ff4fa3"][index]!,
        name: ["LIME", "CYAN", "PINK"][index]!,
        x: points.at(-1)!.x,
        y: points.at(-1)!.y,
        trail,
      };
    });
    const show = () =>
      arena.render(
        { ...base, players },
        1000,
        themes["neon-pixel"],
        "bevel-showcase",
      );
    show();
    Reflect.set(window, "bevelPreview", { arena, show, players, base, themes });
    return { upper, lower, metrics: arena.metrics() };
  });
  await page.screenshot({
    path: `artifacts/beveled-trails-${browserName}.png`,
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browserName, ...result }));
} finally {
  await browser.close();
  await server.close();
}
