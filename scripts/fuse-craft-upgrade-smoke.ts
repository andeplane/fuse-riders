import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, webkit } from "playwright";
const url =
  process.argv[2] ??
  process.env.FUSE_CRAFT_URL ??
  "http://127.0.0.1:5174/games/fuse-craft/?mute";
const out = "/tmp/fuse-neuron-upgrades";
mkdirSync(out, { recursive: true });
await Promise.all(
  Object.entries({ chromium, webkit }).map(async ([name, type]) => {
    const browser = await type.launch();
    try {
      for (const [size, viewport] of Object.entries({
        desktop: { width: 1280, height: 800 },
        phone: { width: 390, height: 844 },
      })) {
        const page = await browser.newPage({
          viewport,
          hasTouch: size === "phone",
        });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.routeWebSocket("**", (s) => s.close());
        await page.goto(url);
        await page.locator('[data-action="new-game"]').click();
        await page.locator('[data-action="mode-sandbox"]').click();
        await page.locator('[data-action="start"]').click();
        await page.locator('[data-action="panel-build"]').click();
        await page.locator('[data-action="build-neuron"]').click();
        const tile = page
          .locator('#nd-board .terrain-layer [data-cell="26"] > polygon')
          .first();
        const box = (await tile.boundingBox())!;
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        if (size === "phone") await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await page
          .locator('.structure-neuron[data-cell="26"]')
          .waitFor({ timeout: 20000 });
        await page.locator('[data-action="build-tower"]').click();
        await page.mouse.move(x, y);
        await page
          .locator('.placement-preview[data-valid="true"][data-upgrade="true"]')
          .waitFor();
        assert.match(
          await page.locator(".placement-instructions").innerText(),
          /Upgrade neuron to Pulse/,
        );
        const ghost = page.locator(".placement-preview image[data-sprite]");
        const art = await ghost.getAttribute("data-sprite");
        assert.equal(art, "tower-pulse-v3", "ghost shows the Pulse tower art");
        if (size === "phone") await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
        await page
          .locator('[data-action="build-tower"] [role="progressbar"]')
          .waitFor({ timeout: 20000 });
        assert.equal(
          await page.locator('.structure-neuron[data-cell="26"]').count(),
          1,
        );
        await page.screenshot({ path: `${out}/${name}-${size}-working.png` });
        const finished = page.locator('.structure-tower[data-cell="26"]');
        await finished.waitFor({ timeout: 30000 });
        assert.equal(
          await page.locator('.structure[data-cell="26"]').count(),
          1,
        );
        // Finished art may be a rasterised blob: copy, so compare sprite identity.
        const built = finished.locator("image[data-sprite]");
        assert.equal(
          await built.getAttribute("data-sprite"),
          art,
          "finished tower keeps the ghost's sprite",
        );
        const href = (await built.getAttribute("href")) ?? "";
        assert.ok(
          await page.evaluate(async (src) => {
            const image = new Image();
            image.src = src;
            await image.decode();
            return image.naturalWidth > 0;
          }, href),
          `finished tower art loads (${href})`,
        );
        assert.equal(
          await page.locator('.queue-mark[data-cell="26"]').count(),
          0,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        assert.deepEqual(errors, []);
        await page.screenshot({ path: `${out}/${name}-${size}-complete.png` });
        await page.close();
        console.log(
          `${name} ${size}: normal-time neuron specialization, ghost, clock and single completed tower passed`,
        );
      }
    } finally {
      await browser.close();
    }
  }),
);
