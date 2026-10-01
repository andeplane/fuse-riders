import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";

const url =
  process.argv[2] ??
  process.env.FUSE_CRAFT_URL ??
  "http://127.0.0.1:5174/games/neural-defence/?mute";
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
          "neurons animate with varied phases",
        );
        assert.ok(
          (await page
            .locator(".network-link:not(.disconnected-link)")
            .count()) >= 3,
          "at least three connected network links",
        );
        // Dendrites sway by transform attribute; the body itself stays put.
        const sway = ".structure-neuron:not(.disconnected) .dendrite-side";
        const before = await page
          .locator(sway)
          .first()
          .getAttribute("transform");
        await page.waitForFunction(
          ([selector, value]) =>
            document.querySelector(selector!)?.getAttribute("transform") !==
            value,
          [sway, before],
        );
        // Select a real node. The body intentionally animates, so
        // locator.click's stable-bounds wait cannot complete. A real pointer
        // click at its visible center can.
        const node = await neurons.first().boundingBox();
        assert.ok(
          node && node.x >= 0 && node.y >= 0,
          `first neuron body is on screen: ${JSON.stringify(node)}`,
        );
        await page.mouse.click(
          node.x + node.width / 2,
          node.y + node.height / 2,
        );
        await page
          .locator(".tile-heading", { hasText: "NEURON" })
          .waitFor({ timeout: 15_000 });
        // Neurons are unarmed (rules 12): only towers take a Charge order.
        assert.equal(
          await page.locator('[data-action="charge"]').count(),
          0,
          "a selected neuron offers no Charge command",
        );
        // Grow a Pulse tower beside the brain through the ordinary build
        // command, then supply it with Charge so particles travel the network.
        const cell = await page.evaluate(
          () =>
            [14, 25, 26, 24, 2, 12].find(
              (c) =>
                !document.querySelector(
                  `#nd-board .structure[data-cell="${c}"], #nd-board .queue-mark[data-cell="${c}"]`,
                ),
            ) ?? null,
        );
        assert.ok(cell !== null, "an open hex beside the brain for a tower");
        await page.locator('[data-action="panel-build"]').click();
        await page
          .locator('[data-action="build-tower"][aria-disabled="false"]')
          .click({ timeout: 90_000 });
        const tile = await page
          .locator(`#nd-board .terrain-layer [data-cell="${cell}"] > polygon`)
          .first()
          .boundingBox();
        assert.ok(tile, `hex ${cell} is on screen for placement`);
        await page.mouse.move(
          tile.x + tile.width / 2,
          tile.y + tile.height / 2,
        );
        await page.mouse.click(
          tile.x + tile.width / 2,
          tile.y + tile.height / 2,
        );
        const tower = page.locator(
          `#nd-board .structure-tower[data-cell="${cell}"]`,
        );
        await tower.waitFor({ timeout: 180_000 });
        await page.locator('[data-action="close-panel"]').click();
        await page.mouse.click(
          tile.x + tile.width / 2,
          tile.y + tile.height / 2,
        );
        await page
          .locator(".tile-heading", { hasText: `HEX ${cell}` })
          .waitFor({ timeout: 15_000 });
        await page.locator('[data-action="charge"]').click();
        await page.waitForFunction(
          () => document.querySelectorAll(".attack-particle").length > 0,
          undefined,
          { timeout: 60_000 },
        );
        await page.locator("#nd-board").focus();
        await page.mouse.move(device.width - 8, 80);
        await page.screenshot({
          path: `${output}/${name}-network-${device.name}.png`,
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await page
            .locator(sway)
            .first()
            .evaluate((node) => getComputedStyle(node).transform),
          "none",
          "reduced motion stops dendrite sway",
        );
        assert.deepEqual(errors, [], "no page errors");
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
