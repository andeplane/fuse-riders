import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, webkit } from "playwright";

const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
const output = process.argv[3] ?? "/tmp/fuse-watch-smoke";
mkdirSync(output, { recursive: true });
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    for (const [size, viewport] of Object.entries({
      desktop: { width: 1280, height: 800 },
      phone: { width: 390, height: 844 },
      landscape: { width: 844, height: 390 },
    })) {
      const page = await browser.newPage({ viewport });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.locator('[data-action="new-game"]').click();
      await page.locator('[data-action="mode-watch"]').click();
      await page.locator("#first-strategy-picker").selectOption("economy");
      await page.locator("#strategy-picker").selectOption("relay");
      await page.screenshot({ path: `${output}/${name}-${size}-setup.png` });
      await page.locator('[data-action="start"]').click();
      await page.waitForFunction(
        () => {
          const cards = [...document.querySelectorAll(".watch-player small")];
          return (
            cards.length === 2 &&
            cards.every((card) => parseInt(card.textContent ?? "0", 10) > 0)
          );
        },
        undefined,
        { timeout: 30000 },
      );
      assert.equal(await page.locator(".command-card").count(), 0);
      assert.match(
        await page.locator(".watch-players").innerText(),
        /economy/i,
      );
      assert.match(await page.locator(".watch-players").innerText(), /relay/i);
      await page.locator('[data-watch-player="ai-opponent"]').click();
      assert.match(await page.locator(".inspector").innerText(), /Red · BRAIN/);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const clipped = await page.evaluate(() => {
        const dock = document
          .querySelector(".watch-dock")!
          .getBoundingClientRect();
        return [
          ...document.querySelectorAll(
            ".watch-dock .selection-details, .watch-player",
          ),
        ]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return (
              box.top < dock.top ||
              box.bottom > Math.min(dock.bottom, innerHeight) ||
              box.left < 0 ||
              box.right > innerWidth ||
              element.scrollHeight > element.clientHeight + 1
            );
          })
          .map((element) => element.className);
      });
      assert.deepEqual(
        clipped,
        [],
        `${name}/${size}: clipped spectator controls`,
      );
      await page.screenshot({ path: `${output}/${name}-${size}-battle.png` });
      await page.locator('[data-action="reset"]').click();
      await page.locator('[data-action="confirm-reset"]').click();
      assert.match(
        await page.locator(".watch-players").innerText(),
        /economy/i,
      );
      assert.match(await page.locator(".watch-players").innerText(), /relay/i);
      await page.locator('[data-action="leave"]').click();
      await page.locator('[data-action="confirm-leave"]').click();
      await page.locator('[data-action="new-game"]').waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(
      `${name}: real AI vs AI selection, both builders, inspection, restart and menu passed on desktop/phone/landscape`,
    );
  } finally {
    await browser.close();
  }
}
