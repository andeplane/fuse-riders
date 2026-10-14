import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, webkit } from "playwright";

const url =
  process.env.FUSE_CRAFT_URL ?? "http://127.0.0.1:5190/fuse-craft/?mute";
const output = process.argv[2] ?? "/tmp/fuse-craft-asset-recovery";
mkdirSync(output, { recursive: true });
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch();
  try {
    for (const permanent of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const errors: string[] = [];
      const retries: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*.png*", async (route) => {
        const asset = new URL(route.request().url());
        if (
          route.request().resourceType() === "image" &&
          /deposit-biomass|blocker-rock-ridge-a|terrain-walkable-v6|terrain-cliff-material-v1/.test(
            asset.pathname,
          )
        ) {
          if (asset.searchParams.has("sprite-retry")) retries.push(asset.href);
          if (permanent || !asset.searchParams.has("sprite-retry"))
            return route.abort("failed");
        }
        await route.continue();
      });
      await page.goto(url);
      await page.locator('[data-action="new-game"]').click();
      await page.locator('[data-action="mode-sandbox"]').click();
      await page.locator('[data-action="start"]').click();
      const guide = page.locator(".fui-round-controls");
      await guide.waitFor({ state: "visible" });
      await guide.getByRole("button", { name: "Dismiss controls" }).click();
      await guide.waitFor({ state: "hidden" });
      // A live game frame must not reopen the dismissed guide.
      const income = await page
        .locator(".resource-row strong")
        .first()
        .innerText();
      await page.waitForFunction(
        (previous) =>
          document.querySelector(".resource-row strong")?.textContent !==
          previous,
        income,
      );
      assert.equal(await guide.isVisible(), false);
      await page.waitForFunction((permanentFailure) => {
        const images = [
          ...document.querySelectorAll<SVGImageElement>(
            '#nd-board image[data-sprite="deposit-biomass"], #nd-board image[data-sprite="blocker-rock-ridge-a"]',
          ),
        ];
        return (
          images.length > 0 &&
          images.every((image) => {
            const href = image.getAttribute("href") ?? "";
            return permanentFailure
              ? href.startsWith("data:image/svg+xml")
              : href.includes("sprite-retry=");
          })
        );
      }, permanent);
      // Check decoding, not just URL strings: the old smoke missed broken icons.
      const decoded = await page.evaluate(async () => {
        const sources = [
          ...new Set(
            [...document.querySelectorAll("#nd-board image[data-sprite]")].map(
              (image) => image.getAttribute("href")!,
            ),
          ),
        ];
        return Promise.all(
          sources.map(async (source) => {
            const image = new Image();
            image.src = source;
            try {
              await image.decode();
              return true;
            } catch {
              return false;
            }
          }),
        );
      });
      assert.ok(
        decoded.every(Boolean),
        `${name}: every displayed sprite decodes`,
      );
      if (permanent) {
        for (const asset of ["deposit-biomass", "blocker-rock-ridge-a"]) {
          assert.equal(
            retries.filter((source) => source.includes(asset)).length,
            2,
            `${asset}: retries shared and bounded`,
          );
        }
      }
      await page.screenshot({
        path: `${output}/${name}-${permanent ? "permanent" : "transient"}.png`,
      });
      await page.getByRole("button", { name: "MENU", exact: true }).click();
      await page.getByRole("button", { name: "CONTROLS", exact: true }).click();
      assert.match(
        await page.locator(".fui-game-menu-controls").innerText(),
        /Shift \+ click/,
      );
      assert.deepEqual(errors, []);
      writeFileSync(
        `${output}/${name}-${permanent ? "permanent" : "transient"}.json`,
        JSON.stringify(
          {
            browser: browser.version(),
            decoded: decoded.length,
            retries,
            errors,
          },
          null,
          2,
        ),
      );
      await page.close();
    }
    console.log(
      `${name}: transient recovery, permanent fallback, decoding and dismiss/reopen passed`,
    );
  } finally {
    await browser.close();
  }
}
