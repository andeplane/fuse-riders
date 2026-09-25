import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { loadMap } from "../games/neural-defence/src/engine/map.js";

const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
const map = loadMap(
  JSON.parse(
    await readFile(
      new URL("../games/neural-defence/maps/sandbox-12.json", import.meta.url),
      "utf8",
    ),
  ),
);
for (const [name, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('[data-action="new-game"]').click();
    await page.locator('[data-action="mode-sandbox"]').click();
    await page.locator('[data-action="start"]').click();
    const cells = await page
      .locator("#nd-board .terrain-layer .hex")
      .evaluateAll((tiles) =>
        tiles.map((tile) => ({
          cell: Number(tile.getAttribute("data-cell")),
          terrain: [...tile.classList]
            .find((value) => value.startsWith("terrain-"))
            ?.slice(8),
          image:
            tile.querySelector(".terrain-object image")?.getAttribute("href") ??
            null,
        })),
      );
    assert.equal(cells.length, map.cells.length);
    for (const tile of cells) {
      const expected = map.cells[tile.cell]!;
      assert.equal(tile.terrain, expected.terrain);
      if (expected.terrain === "blocked") assert.match(tile.image!, /blocker-/);
      if (expected.terrain === "deposit")
        assert.match(
          tile.image!,
          new RegExp(`deposit-${expected.resourceKind}`),
        );
    }
    assert.match(
      (await page
        .locator("#nd-board #ground-continuation image")
        .getAttribute("href"))!,
      /terrain-walkable-v5/,
    );
    const viewport = (await page.locator("#nd-viewport").boundingBox())!;
    const rocks = await page.locator("#nd-board .terrain-blocked").all();
    let target: { x: number; y: number } | undefined;
    for (const rock of rocks) {
      const box = (await rock.boundingBox())!;
      if (
        box.x > viewport.x &&
        box.y > viewport.y &&
        box.x + box.width < viewport.x + viewport.width &&
        box.y + box.height < viewport.y + viewport.height
      ) {
        target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        break;
      }
    }
    assert.ok(target, "at least one actual blocked tile is visible");
    await page.keyboard.press("w");
    await page.keyboard.press("q");
    await page.mouse.move(target.x, target.y);
    await page.locator('.placement-preview[data-valid="false"]').waitFor();
    await page.mouse.click(target.x, target.y);
    assert.equal(
      await page.locator("#nd-board .queue-mark").count(),
      0,
      "clicking a visible rock never queues construction",
    );
    await page.keyboard.press("Escape");
    const before = await page.locator("#nd-board").getAttribute("viewBox");
    const minimap = (await page.locator("#nd-minimap").boundingBox())!;
    await page.mouse.click(
      minimap.x + minimap.width * 0.8,
      minimap.y + minimap.height * 0.8,
    );
    assert.notEqual(
      await page.locator("#nd-board").getAttribute("viewBox"),
      before,
      "minimap moves camera",
    );
    assert.deepEqual(errors, []);
    console.log(
      `${name}: terrain matches map data, visible rock rejects placement, minimap pans`,
    );
  } finally {
    await browser.close();
  }
}
