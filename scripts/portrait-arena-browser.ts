/** Isolated renderer fixtures plus offline solo input/layout: no occupied rooms or network impairment. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { chromium, webkit } from "playwright";

const server = await createServer({
  server: { port: 0, host: "127.0.0.1", hmr: false },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw Error("No server");
const base = `http://127.0.0.1:${address.port}/`;
const browserName = process.env.BROWSER ?? "chrome";
const browser =
  browserName === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
  viewport: { width: 900, height: 1000 },
  deviceScaleFactor: 2,
});
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await mkdir("artifacts", { recursive: true });
  await page.addInitScript("window.__name = value => value");
  await page.goto(`${base}?room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  const results = await page.evaluate(async () => {
    const { createPhaserArena } = (await import(
      String("/src/client/phaser/arena.ts")
    )) as typeof import("../src/client/phaser/arena.js");
    const { visualFixture } = (await import(
      String("/src/client/phaser/benchmark-fixture.ts")
    )) as typeof import("../src/client/phaser/benchmark-fixture.js");
    const { themes } = (await import(
      String("/src/client/themes.ts")
    )) as typeof import("../src/client/themes.js");
    const { crossScreenPoint } = (await import(
      String("/src/client/arena-views.ts")
    )) as typeof import("../src/client/arena-views.js");
    document.body.replaceChildren();
    const results = [];
    for (const backend of ["auto", "canvas"] as const) {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "width:450px;height:800px";
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      canvas.style.objectFit = "cover";
      wrapper.append(canvas);
      document.body.append(wrapper);
      const arena = createPhaserArena(canvas, {
        renderer: backend,
        rotateToFit: true,
      });
      await arena.ready;
      const fixture = visualFixture(100);
      const points = [
        [200, 100],
        [1300, 100],
        [200, 800],
        [1300, 800],
      ];
      const fixed = {
        ...fixture,
        bombs: [],
        blasts: [],
        pickups: [],
        obstacles: [],
        players: [
          {
            ...fixture.players[0]!,
            x: 500,
            y: 400,
            shielded: false,
            angle: 0,
            trail: points.map(([x, y]) => ({
              x1: x! - 50,
              y1: y!,
              x2: x! + 50,
              y2: y!,
              createdTick: 99,
              expiresAtTick: 200,
            })),
          },
        ],
      };
      const source = JSON.stringify(fixed);
      const settle = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      // The online lobby now boots this same arena in cover mode. Play and replay
      // must switch to contain even when changing fit mode does not resize the element.
      for (const fit of ["cover", "contain", "cover", "contain"]) {
        canvas.style.objectFit = fit;
        await settle();
        arena.render(fixed, 1000, themes["neon-pixel"], "lobby-to-play");
        if (canvas.height > canvas.width !== (fit === "contain"))
          throw Error(
            `Stale ${fit} sizing after lobby/play transition: ${backend}`,
          );
      }
      for (const theme of Object.values(themes))
        for (const map of [
          "classic",
          "wrap",
          "cross",
          "forest",
          "city",
          "desert",
        ] as const) {
          const snapshot = { ...fixed, map };
          let upright: ImageData[] = [];
          for (const rotated of [false, true, false]) {
            wrapper.style.width = rotated ? "450px" : "800px";
            wrapper.style.height = rotated ? "800px" : "450px";
            await settle();
            arena.render(snapshot, 1000, theme, "portrait-fixture");
            if (
              canvas.width !== (rotated ? 900 : 1600) ||
              canvas.height !== (rotated ? 1600 : 900)
            )
              throw Error(`Backing ${canvas.width}x${canvas.height}`);
            const copy = document.createElement("canvas");
            copy.width = canvas.width;
            copy.height = canvas.height;
            const ctx = copy.getContext("2d")!;
            ctx.drawImage(canvas, 0, 0);
            const screen = (x: number, y: number) => {
              const p =
                map === "cross"
                  ? crossScreenPoint(x, y, 1600, 900)
                  : { x: x / 1600, y: y / 900 };
              return rotated
                ? { x: (1 - p.y) * 900, y: p.x * 1600 }
                : { x: p.x * 1600, y: p.y * 900 };
            };
            for (const [x, y] of points) {
              const p = screen(x!, y!);
              const pixel = ctx.getImageData(
                Math.floor(p.x),
                Math.floor(p.y),
                1,
                1,
              ).data;
              if (Math.max(...pixel.slice(0, 3)) < 100)
                throw Error(
                  `Missing trail ${backend}/${map}/${rotated} at ${x},${y}: ${pixel}`,
                );
            }
            const rider = screen(500, 400);
            const patches = [
              ctx.getImageData(
                Math.round(rider.x) - 12,
                Math.round(rider.y) - 12,
                24,
                24,
              ),
              ctx.getImageData(
                Math.round(rider.x) - 80,
                Math.round(rider.y) - 34,
                160,
                15,
              ),
            ];
            if (!rotated) upright = patches;
            else
              for (const [i, patch] of patches.entries()) {
                let delta = 0;
                for (let j = 0; j < patch.data.length; j++)
                  delta += Math.abs(patch.data[j]! - upright[i]!.data[j]!);
                const mean = delta / patch.data.length;
                if (mean > 18)
                  throw Error(
                    `Upright ${i === 0 ? "avatar" : "labels"} differ ${mean}: ${backend}/${theme.id}/${map}`,
                  );
              }
            if (rotated && map === "classic")
              results.push({
                name: `${backend}-${theme.id}`,
                data: copy.toDataURL(),
              });
          }
        }
      if (JSON.stringify(fixed) !== source)
        throw Error("Rendering mutated the snapshot");
      if (arena.metrics().automaticLoopRunning)
        throw Error("Independent loop started");
      arena.destroy();
      wrapper.remove();
    }
    return results;
  });
  for (const result of results)
    await writeFile(
      `artifacts/portrait-${browserName}-${result.name}.png`,
      Buffer.from(result.data.split(",")[1]!, "base64"),
    );
  // Both a touch phone and a narrow mouse window get a usable portrait game.
  for (const hasTouch of [true, false]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch,
      deviceScaleFactor: 2,
    });
    const solo = await context.newPage();
    solo.on("pageerror", (error) => errors.push(error.message));
    await solo.goto(`${base}?solo=1`);
    await solo.locator(".mobile-play.mobile-portrait").waitFor();
    await solo.waitForFunction(
      () =>
        document.querySelector("canvas")?.dataset.arenaOrientation ===
        "portrait",
    );
    const canvas = solo.locator(".online-arena");
    assert.ok(
      await canvas.evaluate(
        (e) =>
          (e as HTMLCanvasElement).height / (e as HTMLCanvasElement).width >
          1.7,
      ),
    );
    const left = solo.locator(".online-controls button").first();
    await left.dispatchEvent("pointerdown", {
      pointerId: 41,
      pointerType: hasTouch ? "touch" : "mouse",
      button: 0,
    });
    assert.match((await left.getAttribute("class")) ?? "", /active/);
    await solo.locator(".mobile-tools-toggle").click();
    assert.doesNotMatch(
      (await left.getAttribute("class")) ?? "",
      /active/,
      "opening menu cancels held steering",
    );
    await solo
      .getByRole("button", { name: "BACK TO LOBBY", exact: true })
      .click();
    await solo.locator(".phone-lobby").waitFor();
    await solo.getByRole("button", { name: "START RACE", exact: true }).click();
    await solo
      .locator(".mobile-play.mobile-portrait:not(.mobile-tools-open)")
      .waitFor();
    await solo.screenshot({
      path: `artifacts/portrait-solo-${browserName}-${hasTouch ? "touch" : "mouse"}.png`,
    });
    const zone = await left.boundingBox();
    assert.ok(
      zone && zone.y > 600 && zone.height >= 112,
      "portrait steering has a large bottom hit area",
    );
    await solo.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2);
    await solo.mouse.down();
    assert.match((await left.getAttribute("class")) ?? "", /active/);
    await solo.setViewportSize({ width: 844, height: 390 });
    await solo.waitForFunction(
      () =>
        document.querySelector("canvas")?.dataset.arenaOrientation ===
        "landscape",
    );
    assert.doesNotMatch(
      (await left.getAttribute("class")) ?? "",
      /active/,
      "rotation cancels held input",
    );
    await solo.mouse.up();
    await solo.setViewportSize({ width: 390, height: 844 });
    await solo.waitForFunction(
      () =>
        document.querySelector("canvas")?.dataset.arenaOrientation ===
        "portrait",
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    `${browserName}: portrait WebGL/Canvas, both themes, all maps, upright avatars/labels, resize, solo touch/mouse controls passed`,
  );
} finally {
  await browser.close();
  await server.close();
}
