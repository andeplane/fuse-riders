import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

// Isolated presentation fixtures: no room, input injection or occupied match.
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
const name = process.env.BROWSER ?? "chrome";
const browser =
  name === "webkit"
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
  for (const mode of ["webgl", "canvas"] as const) {
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
      if (arena.metrics().renderer !== mode)
        throw Error(`Wrong renderer ${arena.metrics().renderer}`);
      const fixture = visualFixture(100);
      const player = {
        ...fixture.players[0]!,
        x: 300,
        y: 450,
        angle: 0,
        shielded: false,
        trail: [],
        gunArmed: false,
      };
      const shot = {
        ...fixture.bombs[0]!,
        id: 1,
        ownerId: player.id,
        launchX: 300,
        launchY: 450,
        x: 1200,
        y: 450,
        launchedTick: 100,
        explodeAtTick: 103,
        shell: { gun: true, vx: 1, vy: 0 },
      };
      const base = {
        ...fixture,
        players: [player],
        bombs: [shot],
        blasts: [],
        pickups: [],
        portalPairs: [],
        gravityFields: [],
        obstacles: [],
      };
      const read = () => {
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
      for (const theme of Object.values(themes)) {
        const paint = (tick: number, now = 1000) => {
          arena.render(
            { ...base, presentationTick: tick },
            now,
            theme,
            "gun-browser",
          );
          return read();
        };
        const fresh = paint(100);
        const fading = paint(100.5);
        if (fresh.every((v, i) => v === fading[i]))
          throw Error("Gun does not animate");
        const paused = paint(100.5, 1000);
        if (!paused.every((v, i) => v === fading[i]))
          throw Error("Paused Gun changed");
        const expired = paint(103);
        arena.render({ ...base, bombs: [] }, 1000, theme, "gun-browser");
        const empty = read();
        if (!expired.every((v, i) => v === empty[i]))
          throw Error("Expired shot left effects");
        arena.reset();
        const reset = paint(100);
        if (!fresh.every((v, i) => v === reset[i]))
          throw Error("Reset changed Gun presentation");
        arena.render(
          { ...base, bombs: [], players: [{ ...player, gunArmed: true }] },
          1000,
          theme,
          "gun-browser",
        );
        const armed = read();
        arena.render({ ...base, bombs: [] }, 1000, theme, "gun-browser");
        const unarmed = read();
        if (armed.every((v, i) => v === unarmed[i]))
          throw Error("Armed rider has no marker");
        // A real-shaped authoritative trail cut leaves sparks after its tracer is gone.
        const target = {
          ...player,
          id: "target",
          x: 1200,
          y: 650,
          color: "#ff5577",
        };
        const trail = {
          x1: 900,
          y1: 350,
          x2: 900,
          y2: 550,
          createdTick: 90,
          expiresAtTick: 300,
        };
        const cut = Math.sqrt(14 ** 2 - 5 ** 2);
        const after = {
          ...base,
          tick: 100,
          players: [
            player,
            {
              ...target,
              trail: [
                { ...trail, y2: 450 - cut },
                { ...trail, y1: 450 + cut },
              ],
            },
          ],
          bombs: [{ ...shot, x: 895 }],
        };
        arena.reset();
        arena.render(
          {
            ...base,
            tick: 99,
            bombs: [],
            players: [player, { ...target, trail: [trail] }],
          },
          1000,
          theme,
          "gun-impact",
        );
        arena.render(after, 1000, theme, "gun-impact");
        const aftermath = {
          ...after,
          tick: 104,
          presentationTick: 104,
          bombs: [],
        };
        arena.render(aftermath, 1000, theme, "gun-impact");
        const debris = read();
        arena.reset();
        arena.render(aftermath, 1000, theme, "gun-impact");
        const baseline = read();
        if (debris.every((v, i) => v === baseline[i]))
          throw Error("Trail hit produced no debris");
        arena.reset();
        paint(100);
        results.push({ theme: theme.id, renderer: arena.metrics().renderer });
      }
      const controls = document.createElement("div");
      controls.className = "online-controls";
      const fire = document.createElement("button");
      fire.className = "gun-armed";
      fire.textContent = "TAP TO FIRE GUN";
      controls.append(fire);
      document.body.append(controls);
      const hud = document.createElement("span");
      hud.className = "hud-fire gun-armed";
      document.body.append(hud);
      for (const element of [fire, hud]) {
        if (!getComputedStyle(element, "::before").content.includes("›"))
          throw Error("Armed control lacks chevron");
        element.classList.remove("gun-armed");
        if (getComputedStyle(element, "::before").content.includes("›"))
          throw Error("Unarmed control retains chevron");
      }
      controls.remove();
      hud.remove();
      Reflect.set(window, "disposeGun", () => arena.destroy());
      return results;
    }, mode);
    await page.screenshot({ path: `artifacts/gun-${mode}-${name}.png` });
    await page.screenshot({
      path: `artifacts/gun-detail-${mode}-${name}.png`,
      clip: { x: 265, y: 400, width: 980, height: 100 },
    });
    await page.evaluate(() =>
      (Reflect.get(window, "disposeGun") as () => void)(),
    );
    console.log(JSON.stringify(results));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
}
