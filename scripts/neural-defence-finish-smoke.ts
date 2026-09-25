import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";

// A real, normal-time skirmish: the unattended human loses to the ordinary AI.
// This checks the actual result/reset flow; it does not inject a finished world.
const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
const output = "/tmp/neural-finish-smoke";
await mkdir(output, { recursive: true });
await Promise.all(
  (
    [
      ["chromium", chromium],
      ["webkit", webkit],
    ] as const
  ).map(async ([name, engine]) => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 568, height: 320 },
        isMobile: true,
        hasTouch: true,
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.locator('[data-action="new-game"]').click();
      await page.locator('[data-action="mode-skirmish"]').click();
      await page.locator('[data-action="start"]').click();
      await page
        .locator("#match-result:not([hidden])")
        .waitFor({ state: "visible", timeout: 450_000 });
      assert.match(await page.locator("#match-result").innerText(), /Defeat/);
      const result = (await page.locator("#match-result").boundingBox())!;
      const dock = (await page.locator(".command-dock").boundingBox())!;
      assert.ok(
        result.y + result.height <= dock.y,
        "result stays above the landscape command dock",
      );
      for (const button of await page.locator("#match-result button").all()) {
        const box = (await button.boundingBox())!;
        assert.ok(
          box.y >= result.y && box.y + box.height <= result.y + result.height,
          "result buttons remain reachable",
        );
      }
      await page.screenshot({ path: `${output}/${name}-defeat-landscape.png` });
      await page.locator('#match-result [data-action="reset"]').click();
      await page.locator('[data-action="confirm-reset"]').click();
      await page.locator("#match-result").waitFor({ state: "hidden" });
      assert.equal(await page.locator(".structure-brain").count(), 2);
      assert.deepEqual(errors, []);
      console.log(
        `${name}: normal-time defeat, landscape result geometry and rematch passed`,
      );
    } finally {
      await browser.close();
    }
  }),
);
