import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    await page.goto(url);
    assert.equal(await page.title(), "Fuse Craft");
    assert.match(
      await page.locator(".fui-landing-title").innerText(),
      /FUSE\s+CRAFT/,
    );
    await page.screenshot({ path: `/tmp/fuse-craft-menu-${name}.png` });
    await page.locator('[data-action="new-game"]').click();
    await page.locator('[data-action="mode-sandbox"]').click();
    await page.locator('[data-action="start"]').click();
    await page.keyboard.press("w");
    await page.keyboard.press("q");
    async function clickCell(cell: number, shift = false) {
      // Queue art updates every tick. Target its stable ground coordinates
      // with real mouse input instead of waiting for the animated SVG to stop.
      const point = await page
        .locator(`.terrain-layer [data-cell="${cell}"] > polygon`)
        .first()
        .evaluate((node) => {
          const tile = node as SVGGraphicsElement;
          const b = tile.getBBox();
          const p = new DOMPoint(
            b.x + b.width / 2,
            b.y + b.height / 2,
          ).matrixTransform(tile.getScreenCTM()!);
          return { x: p.x, y: p.y };
        });
      assert.equal(
        await page.evaluate(
          (p) =>
            document
              .elementFromPoint(p.x, p.y)
              ?.closest("[data-cell]")
              ?.getAttribute("data-cell"),
          point,
        ),
        String(cell),
      );
      if (shift) await page.keyboard.down("Shift");
      await page.mouse.click(point.x, point.y);
      if (shift) await page.keyboard.up("Shift");
    }
    for (const cell of [14, 15]) {
      await clickCell(cell, true);
      await page.locator(`.queue-mark[data-cell="${cell}"]`).waitFor();
      assert.equal(await page.locator(".placement-instructions").count(), 1);
    }
    await clickCell(14, true);
    await clickCell(13, true);
    assert.equal(
      await page.locator(".queue-mark").count(),
      2,
      "duplicates and occupied tiles do not add plans",
    );
    assert.equal(await page.locator(".placement-instructions").count(), 1);
    await clickCell(26);
    await page.locator('.queue-mark[data-cell="26"]').waitFor();
    assert.equal(
      await page.locator(".placement-instructions").count(),
      0,
      "ordinary placement exits build mode",
    );
    assert.equal(await page.locator(".queue-mark").count(), 3);
    await page.screenshot({ path: `/tmp/neural-shift-queue-${name}.png` });
    console.log(
      `${name}: Shift queues consecutive plans, rejects duplicates/occupied cells, ordinary click exits`,
    );
  } finally {
    await browser.close();
  }
}
