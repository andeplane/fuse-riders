import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
const output = process.argv[3] ?? "/tmp/neural-network-smoke";
await mkdir(output, { recursive: true });
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await engine.launch();
  try {
    await Promise.all(
      [
        { name: "desktop", width: 1280, height: 800 },
        { name: "phone", width: 390, height: 844 },
      ].map(async (device) => {
        const page = await browser.newPage({ viewport: device });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(url);
        await page.locator('[data-action="new-game"]').click();
        await page.locator('[data-action="mode-sandbox"]').click();
        await page.locator('[data-action="start"]').click();
        await page.locator('[data-action="auto-expand"]').click();
        await page.waitForFunction(
          () => document.querySelectorAll(".structure-neuron").length >= 3,
          undefined,
          { timeout: 45000 },
        );
        await page.locator('[data-action="auto-expand"]').click();
        const neurons = page.locator(".structure-neuron .neuron-body");
        assert.ok(
          new Set(
            await neurons.evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute("data-phase")),
            ),
          ).size >= 3,
        );
        assert.ok(
          (await page
            .locator(".network-link:not(.disconnected-link)")
            .count()) >= 3,
        );
        const before = await neurons
          .first()
          .evaluate((node) => getComputedStyle(node).transform);
        await page.waitForFunction(
          (value) =>
            getComputedStyle(
              document.querySelector(".structure-neuron .neuron-body")!,
            ).transform !== value,
          before,
        );
        // Select a real node and supply it through ordinary Charge commands.
        // The body intentionally animates, so locator.click's stable-bounds
        // wait cannot complete. A real pointer click at its visible center can.
        const node = await neurons.first().boundingBox();
        assert.ok(node && node.x >= 0 && node.y >= 0);
        await page.mouse.click(
          node.x + node.width / 2,
          node.y + node.height / 2,
        );
        await page.locator('[data-action="charge"]').click();
        await page.waitForFunction(
          () => document.querySelectorAll(".attack-particle").length > 0,
        );
        await page.locator("#nd-board").focus();
        await page.mouse.move(device.width - 8, 80);
        await page.screenshot({
          path: `${output}/${name}-network-${device.name}.png`,
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await neurons
            .first()
            .evaluate((node) => getComputedStyle(node).transform),
          "none",
        );
        assert.deepEqual(errors, []);
        await page.close();
      }),
    );
    console.log(
      `${name}: real expansion, varied animated neurons, links, particle supply and reduced motion passed at desktop and phone sizes`,
    );
  } finally {
    await browser.close();
  }
}
