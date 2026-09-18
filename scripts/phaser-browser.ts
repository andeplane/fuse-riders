import assert from "node:assert/strict";
import { launchSelected } from "./lib/browser.js";
import { startViteServer } from "./lib/server.js";
import { smokeTimeout } from "./smoke-timeout.js";
const server = await startViteServer();
const browser = await launchSelected("chrome");
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: Number(process.env.DPR ?? 2),
});
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
try {
  await page.addInitScript("window.__name = value => value");
  await page.goto(`${server.url}?mute&room=INVALID`);
  await page.getByText("Invalid room code", { exact: true }).waitFor();
  const result = await page.evaluate(async (recoveryBudgetMs) => {
    const { createPhaserArena } = (await import(
      String("/src/client/phaser/arena.ts")
    )) as typeof import("../src/client/phaser/arena.js");
    const { visualFixture } = (await import(
      String("/src/client/phaser/benchmark-fixture.ts")
    )) as typeof import("../src/client/phaser/benchmark-fixture.js");
    const { themes } = (await import(
      String("/src/client/themes.ts")
    )) as typeof import("../src/client/themes.js");
    const results = [];
    // #127: a navigation can abort the embedded default images Phaser decodes at boot. Its texture manager still reports
    // READY, and booting the WebGL renderer without __DEFAULT throws. Failing those images (only they are data PNGs set
    // through HTMLImageElement.src here) must reject readiness instead of throwing.
    {
      const source = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        "src",
      )!;
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        get() {
          return source.get!.call(this);
        },
        set(value: string) {
          if (String(value).startsWith("data:image/png;base64,")) {
            const image = this as HTMLImageElement;
            setTimeout(() => image.onerror?.(new Event("error")), 0);
            return;
          }
          source.set!.call(this, value);
        },
      });
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        document.body.append(canvas);
        const arena = createPhaserArena(canvas, { renderer: "auto" });
        const outcome = await Promise.race([
          arena.ready.then(
            () => "ready",
            () => "rejected",
          ),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("pending"), 2000),
          ),
        ]);
        if (outcome !== "rejected")
          throw Error(
            `Arena with aborted default textures ended ${outcome}, expected a rejected readiness`,
          );
        arena.destroy();
        canvas.remove();
      } finally {
        Object.defineProperty(HTMLImageElement.prototype, "src", source);
      }
    }

    // Game boot precedes asynchronous default textures and SceneManager boot.
    // Disposal in that gap must reject readiness without touching a missing system scene.
    for (const backend of ["auto", "canvas"] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      document.body.append(canvas);
      const arena = createPhaserArena(canvas, { renderer: backend });
      const outcome = arena.ready.then(
        () => false,
        () => true,
      );
      arena.destroy();
      arena.destroy();
      if (!(await outcome)) throw Error("Disposed renderer reported readiness");
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      canvas.remove();
    }

    for (const backend of ["auto", "canvas"] as const) {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:fixed;inset:0;width:800px;height:450px";
      document.body.append(wrapper);
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 900;
      wrapper.append(canvas);
      const arena = createPhaserArena(canvas, { renderer: backend });
      await arena.ready;
      let now = performance.now();
      if (
        backend === "auto" &&
        !canvas.getContext("webgl")?.getContextAttributes()?.antialias
      )
        throw Error("WebGL trail antialiasing is disabled");
      const fixed = visualFixture(40);
      arena.render(fixed, now, themes["neon-pixel"], "cache-test");
      const settle = async () => {
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
      };
      for (const [w, h] of [
        [800, 450],
        [1200, 675],
        [400, 225],
      ] as const) {
        wrapper.style.width = `${w}px`;
        wrapper.style.height = `${h}px`;
        await settle();
        arena.render(fixed, now, themes["neon-pixel"], "cache-test");
        if (
          canvas.width !== w * devicePixelRatio ||
          canvas.height !== h * devicePixelRatio
        )
          throw Error(
            `DPR sizing failed: ${canvas.width}x${canvas.height} at ${w}x${h} DPR ${devicePixelRatio}`,
          );
        // A fixture containing just two bright, far-apart landmarks verifies world-to-pixel mapping
        // and the boundary mask after every resize, on both actual rendering backends.
        const marker = {
          ...fixed,
          players: fixed.players.slice(0, 1).map((p) => ({
            ...p,
            alive: true,
            shielded: false,
            x: 500,
            y: 400,
            trail: [
              {
                x1: 100,
                y1: 100,
                x2: 300,
                y2: 100,
                createdTick: 39,
                expiresAtTick: 100,
              },
              {
                x1: 1200,
                y1: 800,
                x2: 1400,
                y2: 800,
                createdTick: 40,
                expiresAtTick: 100,
              },
            ],
          })),
          pickups: [],
          bombs: [],
          blasts: [],
        };
        arena.render(marker, now, themes["neon-pixel"], "sizing-markers");
        for (const [x, y] of [
          [200, 100],
          [1300, 800],
        ] as const) {
          const px = Math.floor((x * canvas.width) / 1600),
            py = Math.floor((y * canvas.height) / 900);
          const gl = backend === "auto" ? canvas.getContext("webgl") : null;
          const pixel = new Uint8Array(4);
          if (gl)
            gl.readPixels(
              px,
              canvas.height - 1 - py,
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixel,
            );
          else
            pixel.set(canvas.getContext("2d")!.getImageData(px, py, 1, 1).data);
          if (Math.max(...pixel.slice(0, 3)) < 100)
            throw Error(
              `World landmark missing after resize at ${x},${y}: ${pixel}`,
            );
        }
      }
      arena.render(fixed, now, themes["neon-pixel"], "cache-test");
      const stableHistoryBuilds = arena.metrics().trailHistoryBuilds;
      for (let frame = 1; frame <= 12; frame++) {
        const moving = {
          ...fixed,
          tick: 40 + frame / 20,
          players: fixed.players.map((p) => ({
            ...p,
            x: p.x + frame / 10,
            trail: p.trail.map((segment, index) =>
              index === p.trail.length - 1
                ? { ...segment, x2: segment.x2 + frame / 10 }
                : { ...segment },
            ),
          })),
        };
        arena.render(
          moving,
          now + frame * 16,
          themes["neon-pixel"],
          "cache-test",
        );
      }
      if (arena.metrics().trailHistoryBuilds !== stableHistoryBuilds)
        throw Error("Fractional presentation rebuilt stable trail history");
      const clipped = {
        ...fixed,
        players: fixed.players.map((p, index) =>
          index ? p : { ...p, trail: p.trail.slice(1) },
        ),
      };
      arena.render(clipped, now + 220, themes["neon-pixel"], "cache-test");
      if (arena.metrics().trailHistoryBuilds !== stableHistoryBuilds + 1)
        throw Error("Trail expiry did not refresh geometry");
      arena.reset();
      for (let tick = 0; tick < 30; tick++)
        arena.render(
          visualFixture(tick),
          now + tick * 16,
          themes["neon-pixel"],
          "epoch1:match",
        );
      // Blast sparks are now sampled geometry; only rider deaths use the bounded particle emitter.
      const death = visualFixture(30);
      arena.render(
        {
          ...death,
          players: death.players.map((p) => ({ ...p, alive: false })),
        },
        now + 480,
        themes["neon-pixel"],
        "epoch1:match",
      );
      const active = arena.metrics();
      if (active.automaticLoopRunning) throw Error("Two render loops");
      if (active.particles <= 0 || active.particles > 480)
        throw Error("Particles not bounded/emitting");
      arena.reset();
      if (arena.metrics().particles !== 0)
        throw Error("Reset retained effects");
      arena.render(
        { ...visualFixture(36), boundaryInset: 100 },
        now + 500,
        themes["clean-neon"],
        "epoch2:match",
      );
      if (arena.metrics().particles !== 0)
        throw Error("New epoch replayed old bursts");
      const gl = backend === "auto" ? canvas.getContext("webgl") : null;
      const extension = gl?.getExtension("WEBGL_lose_context");
      let restored = false;
      if (extension) {
        const wait = (event: string) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error(`${event} timed out`)),
              4000,
            );
            canvas.addEventListener(
              event,
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
        const lost = wait("webglcontextlost");
        extension.loseContext();
        await lost;
        arena.render(
          visualFixture(37),
          now + 550,
          themes["clean-neon"],
          "epoch2:match",
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const restore = wait("webglcontextrestored");
        extension.restoreContext();
        await restore;
        arena.render(
          visualFixture(38),
          now + 600,
          themes["clean-neon"],
          "epoch2:match",
        );
        const pixel = new Uint8Array(4);
        gl!.readPixels(200, 200, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, pixel);
        if (pixel[0]! + pixel[1]! + pixel[2]! === 0)
          throw Error("Restored renderer remained blank");
        restored = true;
      }
      results.push({
        backend: active.renderer,
        objects: active.objects,
        particles: active.particles,
        contextRestored: restored,
      });
      arena.destroy();
      arena.destroy();
      wrapper.remove();
    }
    const { mountArenaPresentation } = (await import(
      String("/src/client/phaser/presentation.ts")
    )) as typeof import("../src/client/phaser/presentation.js");
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "width:800px;height:450px";
    document.body.append(wrapper);
    let canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    wrapper.append(canvas);
    const presentation = mountArenaPresentation(canvas, (replacement) => {
      canvas = replacement;
    });
    let raf = 0;
    const render = () => {
      presentation.render(
        visualFixture(40),
        performance.now(),
        themes["neon-pixel"],
        "recovery-test",
      );
      raf = requestAnimationFrame(render);
    };
    render();
    const until = async (stage: string, predicate: () => boolean) => {
      const end = performance.now() + recoveryBudgetMs;
      while (!predicate()) {
        if (performance.now() > end)
          throw Error(
            `Presentation recovery timed out waiting for ${stage} (renderer=${canvas.dataset.renderer}, status=${canvas.dataset.rendererStatus})`,
          );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
    };
    await until(
      "WebGL startup",
      () => canvas.dataset.renderer === "phaser-webgl",
    );
    const extension = canvas
      .getContext("webgl")!
      .getExtension("WEBGL_lose_context");
    if (!extension)
      throw Error(
        "Context loss extension unavailable: recovery was not tested",
      );
    extension.loseContext();
    await until(
      "context loss",
      () => canvas.dataset.rendererStatus === "context-lost",
    );
    extension.restoreContext();
    await until(
      "automatic restoration",
      () => canvas.dataset.rendererStatus === "restored",
    );
    const readPixel = () => {
      const gl = canvas.getContext("webgl")!;
      const pixel = new Uint8Array(4);
      gl.readPixels(200, 200, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[0]! + pixel[1]! + pixel[2]! > 0;
    };
    await until("restored pixels", readPixel);
    extension.loseContext();
    await until(
      "retry after unrecovered context loss",
      () => canvas.dataset.rendererStatus === "failed",
    );
    const oldCanvas = canvas;
    const retry = document.querySelector<HTMLButtonElement>(
      ".graphics-status:not([hidden]) button",
    )!;
    if (!retry || retry.hidden || retry.textContent !== "RETRY GRAPHICS")
      throw Error("No visible graphics retry action");
    retry.click();
    if (canvas === oldCanvas || oldCanvas.isConnected)
      throw Error("Retry did not replace failed GPU canvas");
    await until(
      "WebGL retry",
      () => canvas.dataset.renderer === "phaser-webgl",
    );
    await until("retry pixels", readPixel);
    wrapper.style.width = "400px";
    wrapper.style.height = "225px";
    await until(
      "retried backing size",
      () =>
        canvas.width === 400 * devicePixelRatio &&
        canvas.height === 225 * devicePixelRatio,
    );
    cancelAnimationFrame(raf);
    presentation.destroy();
    presentation.destroy();
    wrapper.remove();
    if (document.querySelector(".graphics-status"))
      throw Error("Disposal retained graphics status");
    const { checkPresentationLifecycle } = (await import(
      String("/scripts/presentation-lifecycle.ts")
    )) as typeof import("./presentation-lifecycle.js");
    await checkPresentationLifecycle();
    return results;
  }, smokeTimeout(15000));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result, errors }, null, 2));
} finally {
  if (errors.length) console.error("Page errors:", errors);
  await browser.close();
  await server.stop();
}
