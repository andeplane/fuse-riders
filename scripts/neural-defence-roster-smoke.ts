import assert from "node:assert/strict";
import { chromium, webkit, type Page } from "playwright";

// Real resources, delivery, construction and research timing. No injected world,
// debug cheats, accelerated clock or privileged commands.
const url =
  process.argv[2] ?? "http://127.0.0.1:5174/games/neural-defence/?mute";
async function root(page: Page) {
  const back = page.locator('[data-action="close-panel"]');
  if (await back.count()) await back.click();
}
async function research(page: Page, kind: string) {
  await root(page);
  await page.locator('[data-action="panel-research"]').click();
  let button = page.locator(`[data-action="research-${kind}"]`);
  if (!(await button.count()))
    await page.locator('[data-action="next-command-page"]').click();
  button = page.locator(`[data-action="research-${kind}"]`);
  await page
    .locator(`[data-action="research-${kind}"][aria-disabled="false"]`)
    .waitFor({ timeout: 90_000 });
  await button.click();
  await button.locator('[role="progressbar"]').waitFor();
  await page.waitForFunction(
    (action) =>
      document.querySelector(`[data-action="${action}"] .command-cost`)
        ?.textContent === "✓",
    `research-${kind}`,
    { timeout: 30_000 },
  );
}
async function build(page: Page, kind: string, cell: number) {
  await root(page);
  await page.locator('[data-action="panel-build"]').click();
  if (!(await page.locator(`[data-action="build-${kind}"]`).count()))
    await page.locator('[data-action="next-command-page"]').click();
  await page
    .locator(`[data-action="build-${kind}"][aria-disabled="false"]`)
    .click();
  const tile = (await page
    .locator(`#nd-board .terrain-layer [data-cell="${cell}"] > polygon`)
    .first()
    .boundingBox())!;
  const x = tile.x + tile.width / 2,
    y = tile.y + tile.height / 2;
  await page.mouse.move(x, y);
  const ghost = await page
    .locator(".placement-preview image")
    .getAttribute("href");
  assert.ok(ghost);
  await page.mouse.click(x, y);
  await page
    .locator(`[data-action="build-${kind}"] [role="progressbar"]`)
    .waitFor({ timeout: 120_000 });
  const structure = page.locator(
    `#nd-board .structure-${kind}[data-cell="${cell}"]`,
  );
  await structure.waitFor({ timeout: 25_000 });
  assert.equal(
    await structure.locator("image").first().getAttribute("href"),
    ghost,
    "completed art matches the placement ghost",
  );
  return ghost;
}

await Promise.all(
  (
    [
      ["chromium", chromium],
      ["webkit", webkit],
    ] as const
  ).map(async ([name, browserType]) => {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.routeWebSocket("**", (socket) => socket.close());
      await page.goto(url);
      await page.locator('[data-action="new-game"]').click();
      await page.locator('[data-action="mode-sandbox"]').click();
      await page.locator('[data-action="start"]').click();
      await build(page, "neuron", 26); // Mine Insight beside cell 37.
      await build(page, "neuron", 27); // Mine Biomass beside cell 39.
      console.log(`${name}: connected resource expansion completed`);
      await research(page, "excitation");
      await research(page, "ballistics");
      console.log(`${name}: Ballistics unlocked through ordinary research`);
      const pulse = await build(page, "tower", 12);
      await research(page, "conduction");
      const siege = await build(page, "siege", 14);
      await research(page, "resonance");
      const relay = await build(page, "relay", 25);
      assert.equal(new Set([pulse, siege, relay]).size, 3);
      await root(page);
      await page.locator('[data-action="panel-particles"]').click();
      for (const kind of ["heavy", "swift"]) {
        const button = page.locator(
          `[data-action="particle-${kind}"][aria-disabled="false"]`,
        );
        await button.click();
        await page
          .locator(`[data-action="particle-${kind}"][aria-pressed="true"]`)
          .waitFor();
      }
      await root(page);
      for (const [kind, cell, art] of [
        ["tower", 12, pulse],
        ["siege", 14, siege],
        ["relay", 25, relay],
      ] as const) {
        const head = await page
          .locator(`.structure-${kind}[data-cell="${cell}"] image`)
          .evaluate((node) => {
            const image = node as SVGImageElement;
            const point = new DOMPoint(
              Number(image.getAttribute("x")) +
                Number(image.getAttribute("width")) / 2,
              Number(image.getAttribute("y")) +
                Number(image.getAttribute("height")) * 0.18,
            ).matrixTransform(image.getScreenCTM()!);
            return { x: point.x, y: point.y };
          });
        await page.mouse.click(head.x, head.y);
        assert.match(
          await page.locator(".tile-heading").innerText(),
          new RegExp(`HEX ${cell}\\b`),
        );
        assert.equal(
          await page.locator(".selection-portrait img").getAttribute("src"),
          art,
        );
        await page.locator('[data-action="charge"]').click();
        await page.waitForFunction(
          () =>
            /Connected · [1-9]\d* particles/.test(
              document.querySelector(".selection-summary")?.textContent ?? "",
            ),
          undefined,
          { timeout: 15_000 },
        );
      }
      await page.screenshot({ path: `/tmp/neural-roster-${name}-desktop.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      // Use ordinary keyboard navigation to bring the selected base back into
      // view after changing from a wide desktop viewport to portrait.
      await page.locator("#nd-board").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowLeft");
      await page.screenshot({ path: `/tmp/neural-roster-${name}-phone.png` });
      assert.deepEqual(errors, []);
      console.log(
        `${name}: normal-time specialist research, all towers, ghost/portrait art, selection, profiles and supplied stock passed`,
      );
    } finally {
      await browser.close();
    }
  }),
);
