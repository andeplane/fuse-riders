import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, webkit } from "playwright";

const output = process.argv[2] ?? "/tmp/fuse-live-watch";
mkdirSync(output, { recursive: true });
await Promise.all(
  [
    {
      name: "chromium-desktop",
      engine: chromium,
      viewport: { width: 1280, height: 800 },
    },
    {
      name: "webkit-phone",
      engine: webkit,
      viewport: { width: 390, height: 844 },
    },
  ].map(async ({ name, engine, viewport }) => {
    const browser = await engine.launch();
    const context = await browser.newContext({
      viewport,
      recordVideo: { dir: output, size: viewport },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(
        process.env.FUSE_CRAFT_URL ??
          "http://127.0.0.1:5174/games/neural-defence/?mute",
      );
      await page.locator('[data-action="new-game"]').click();
      await page.locator('[data-action="mode-watch"]').click();
      await page.locator('[data-action="start"]').click();
      // Let the ordinary session clock run. No injected worlds or accelerated time.
      await page.waitForFunction(
        () => document.querySelector(".combat-damage"),
        undefined,
        { timeout: 300000 },
      );
      await page.locator('[data-action="find-battle"]').click();
      await page.screenshot({ path: `${output}/${name}-contact.png` });
      console.log(`${name}: reached live combat`);
      const observed = { samples: 0, shots: 0, wrecks: 0, moving: 0 };
      for (let i = 0; i < 60; i++) {
        const current = await page.evaluate(() => ({
          shots: document.querySelectorAll(".combat-damage").length,
          wrecks: document.querySelectorAll(".combat-wreck").length,
          moving: document.querySelectorAll(".attack-particle").length,
        }));
        observed.samples++;
        observed.shots = Math.max(observed.shots, current.shots);
        observed.wrecks = Math.max(observed.wrecks, current.wrecks);
        observed.moving = Math.max(observed.moving, current.moving);
        await page.waitForTimeout(500);
      }
      await page.locator('[data-action="find-battle"]').click();
      await page.screenshot({ path: `${output}/${name}-battle.png` });
      assert.ok(observed.shots! > 0 && observed.moving! > 0);
      assert.deepEqual(errors, []);
      writeFileSync(
        `${output}/${name}.json`,
        JSON.stringify(
          {
            observed,
            players: await page.locator(".watch-players").innerText(),
            clock: await page.locator(".hud-mini").innerText(),
            errors,
          },
          null,
          2,
        ),
      );
      await context.close();
      await page.video()!.saveAs(`${output}/${name}.webm`);
      console.log(
        `${name}: ordinary live combat captured, ${JSON.stringify(observed)}`,
      );
    } finally {
      await browser.close();
    }
  }),
);
