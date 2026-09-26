import assert from "node:assert/strict";
import { chromium, webkit, type Page } from "playwright";

const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
const view = (page: Page) =>
  page
    .locator("#nd-board")
    .getAttribute("viewBox")
    .then((v) => v!.split(/\s+/).map(Number));
for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1840, height: 1000 },
    });
    await page.goto(url);
    await page.locator('[data-action="new-game"]').click();
    await page.locator('[data-action="mode-sandbox"]').click();
    await page.locator('[data-action="start"]').click();
    const viewport = page.locator("#nd-viewport");
    for (const size of [
      { width: 1840, height: 1000 },
      { width: 390, height: 844 },
      { width: 568, height: 320 },
    ]) {
      await page.setViewportSize(size);
      for (let i = 0; i < 12; i++)
        await viewport.dispatchEvent("wheel", {
          deltaY: 400,
          clientX: 150,
          clientY: 150,
        });
      const box = (await viewport.boundingBox())!;
      const v = await view(page);
      const ground = await page.locator(".terrain-layer").evaluate((el) => {
        const b = (el as SVGGraphicsElement).getBBox();
        return { width: b.width, height: b.height };
      });
      assert.ok(
        v[2]! <= ground.width + 12,
        "map fills viewport width at zoom-out limit",
      );
      assert.ok(
        v[3]! <= ground.height + 1,
        "map fills viewport height at zoom-out limit",
      );
      assert.ok(box.width / v[2]! >= 1.1 - 0.001, "units stay readable");
      await page.screenshot({
        path: `/tmp/neural-camera-${name}-${size.width}.png`,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await viewport.dispatchEvent("wheel", {
      deltaY: -400,
      clientX: 450,
      clientY: 300,
    });
    const selected = await page.locator(".tile-heading").innerText();
    await page.keyboard.press("w");
    await page.keyboard.press("q");
    const before = await view(page);
    const queued = await page.locator(".queue-mark").count();
    await page.mouse.move(500, 300);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(380, 240, { steps: 8 });
    await page.mouse.up({ button: "right" });
    assert.notDeepEqual(
      await view(page),
      before,
      "secondary drag pans during placement",
    );
    assert.equal(await page.locator(".queue-mark").count(), queued);
    assert.equal(await page.locator(".placement-instructions").count(), 1);
    assert.ok(
      await viewport.evaluate((el) => {
        const event = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      "native map context menu is suppressed",
    );
    // Mac Control-click follows the same pan-only path.
    const controlBefore = await view(page);
    await page.keyboard.down("Control");
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(420, 260, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    assert.notDeepEqual(await view(page), controlBefore);
    assert.equal(await page.locator(".queue-mark").count(), queued);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".tile-heading").innerText(), selected);
    console.log(
      `${name}: bounded readable zoom at desktop/phone sizes; secondary and Control drag pan without placement; context menu suppressed`,
    );
  } finally {
    await browser.close();
  }
}
