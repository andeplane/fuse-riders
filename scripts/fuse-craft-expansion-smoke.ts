import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, webkit } from "playwright";
import { DEFAULT_MAP } from "../games/fuse-craft/src/online/maps.js";

const url =
  process.argv[2] ??
  process.env.FUSE_CRAFT_URL ??
  "http://127.0.0.1:5174/games/fuse-craft/?mute";
for (const [name, type] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.routeWebSocket("**", (socket) => socket.close());
    for (const id of [
      "close-quarters",
      "open-front",
      "narrow-front",
      "lean-resources",
    ]) {
      await page.goto(url);
      await page.locator('[data-action="new-game"]').click();
      assert.equal(
        await page.locator("#map-picker").inputValue(),
        DEFAULT_MAP,
        "setup preselects the default map",
      );
      await page.locator("#strategy-picker").selectOption("relay");
      await page.locator("#map-picker").selectOption(id);
      await page.locator('[data-action="start"]:enabled').click();
      await page.locator("#nd-board .terrain-layer .hex").first().waitFor();
      if (id === "close-quarters")
        assert.deepEqual(
          (
            await page
              .locator("#nd-board .structure-brain")
              .evaluateAll((nodes) =>
                nodes.map((n) => Number(n.getAttribute("data-cell"))),
              )
          ).sort((a, b) => a - b),
          [175, 304],
        );
      const map = JSON.parse(
        readFileSync(
          new URL(`../games/fuse-craft/maps/${id}.json`, import.meta.url),
          "utf8",
        ),
      );
      assert.equal(
        await page.locator("#nd-board .terrain-layer .hex").count(),
        map.cells.length,
      );
      assert.equal(
        await page.locator("#nd-board .terrain-blocked").count(),
        map.cells.filter((c: { terrain: string }) => c.terrain === "blocked")
          .length,
      );
      assert.equal(
        await page.locator("#nd-board .terrain-deposit").count(),
        map.cells.filter((c: { terrain: string }) => c.terrain === "deposit")
          .length,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.locator('[data-action="panel-build"]').click();
      await page.locator('[data-action="next-command-page"]').click();
      const locked = page.locator('[data-action="build-harvester"]');
      assert.equal(await locked.getAttribute("aria-disabled"), "true");
      const button = (await locked.boundingBox())!;
      await page.mouse.click(
        button.x + button.width / 2,
        button.y + button.height / 2,
      );
      assert.match(
        await page.locator("#help-build-harvester").innerText(),
        /Growth/,
      );
      await page.screenshot({ path: `/tmp/fuse-${name}-${id}-phone.png` });
    }
    assert.deepEqual(errors, []);
    console.log(
      `${name}: all four new maps, physical terrain categories, strategy setup, locked help and phone bounds passed`,
    );
  } finally {
    await browser.close();
  }
}
