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
    // The brain projects above its base hex. Selection should pick the body;
    // placement at the same point should still pick the ground behind it.
    const head = await page
      .locator(".structure-brain .building-art image")
      .first()
      .evaluate((node) => {
        const image = node as SVGImageElement;
        const x =
          Number(image.getAttribute("x")) +
          Number(image.getAttribute("width")) / 2;
        const y =
          Number(image.getAttribute("y")) +
          Number(image.getAttribute("height")) * 0.18;
        const point = new DOMPoint(x, y).matrixTransform(image.getScreenCTM()!);
        return { x: point.x, y: point.y };
      });
    await page.mouse.click(head.x, head.y);
    assert.match(await page.locator(".tile-heading").innerText(), /brain/i);
    await page.keyboard.press("w");
    await page.keyboard.press("q");
    await page.mouse.move(head.x + 1, head.y);
    await page.locator('.placement-preview[data-valid="true"]').waitFor();
    await page.keyboard.press("Escape");
    // Restore the brain context before the terrain checks below.
    await page.mouse.click(head.x, head.y);
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
    await page.goto(url);
    await page.locator('[data-action="new-game"]').click();
    await page.locator('[data-action="mode-combat-lab"]').click();
    await page.locator('[data-action="start"]').click();
    const anatomies = await page
      .locator("#nd-board .neuron-body image")
      .evaluateAll((images) => [
        ...new Set(images.map((node) => node.getAttribute("href"))),
      ]);
    assert.equal(
      anatomies.length,
      3,
      "live network shows three different neuron anatomies",
    );
    await page.locator(".structure-tower .structure-hp").first().waitFor();
    const readableHealth = await page
      .locator(".structure-tower")
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => node.querySelector(".structure-hp"))
          .every((node) => {
            const hp = node.querySelector(".structure-hp")!;
            const art = node.querySelector(".building-art image")!;
            return (
              Number(hp.getAttribute("y")) + Number(hp.getAttribute("height")) <
              Number(art.getAttribute("y"))
            );
          }),
      );
    assert.ok(readableHealth, "live damaged tower bars clear the artwork");
    assert.equal(await page.locator(".charge-halo").count(), 0);
    assert.ok((await page.locator(".supply-footprint").count()) > 0);
    assert.ok(
      await page.locator(".supply-footprint").evaluateAll((markers) =>
        markers.every((marker) => {
          const siblings = [...marker.parentElement!.children];
          const art = marker.parentElement!.querySelector(
            ".building-art, .neuron-body",
          )!;
          return siblings.indexOf(marker) < siblings.indexOf(art);
        }),
      ),
      "supplied structures paint their ground marker beneath artwork",
    );
    await page.screenshot({ path: `/tmp/neural-anatomy-${name}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `/tmp/neural-anatomy-${name}-phone.png` });
    console.log(
      `${name}: raised body selection, ground placement, terrain rejection and minimap navigation passed`,
    );
  } finally {
    await browser.close();
  }
}
