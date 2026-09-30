import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
try {
  const make = async (url, phone = false) => {
    const page = await browser.newPage(
      phone
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1600, height: 1050 } },
    );
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    return page;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const invite = await host.locator("#invite-url").inputValue();
  const guests = [];
  for (let i = 0; i < 4; i++) {
    const page = await make(invite, i === 3);
    await page.locator('#status[data-state="playing"]').waitFor();
    guests.push(page);
  }
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).length === 5,
  );
  await host.locator("#arena-focus").click();
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/art-production-desktop.png",
    fullPage: true,
  });
  // Ordinary input only: screenshots are of a real five-member room, no injected world.
  await host.keyboard.down("Space");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.frame === "5",
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/art-production-jump.png",
    fullPage: true,
  });
  await host.keyboard.up("Space");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.frame === "6",
  );
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.grounded === "true",
  );
  const box = await host.locator("#scene canvas").boundingBox();
  const x = await host
    .locator("#scene")
    .evaluate((e) => Number(e.dataset.actorX));
  await host.mouse.move(
    box.x + (x / 1600) * box.width,
    box.y + (650 / 900) * box.height,
  );
  await host.mouse.down();
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.frame === "8",
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/art-production-pull.png",
    fullPage: true,
  });
  await host.mouse.up();
  const phone = guests[3];
  await phone.locator("#arena-focus").click();
  assert.equal(await phone.locator("#touch-deck").isVisible(), true);
  await phone.screenshot({
    path: "games/hook-havok/docs/evidence/art-production-phone.png",
    fullPage: true,
  });
  await phone.setViewportSize({ width: 844, height: 390 });
  const canvas = await phone.locator("#scene canvas").boundingBox();
  assert.ok(canvas.y + canvas.height <= 390);
  await phone.screenshot({
    path: "games/hook-havok/docs/evidence/art-production-landscape.png",
    fullPage: true,
  });
  // The new sheet must retain the existing visible load-error/retry flow.
  const retry = await make(base + "hook-havok/?showcase=1&mute");
  await retry.locator('#status[data-state="ready"]').waitFor();
  await retry.route("**/lantern-keeper-nine-pose-source-*.png", (route) =>
    route.abort(),
  );
  await retry.reload();
  await retry.locator('#status[data-state="error"]').waitFor();
  await retry.unroute("**/lantern-keeper-nine-pose-source-*.png");
  await retry.locator("#retry").click();
  await retry.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await retry.locator("#scene canvas").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS real five-player art, rise/fall/pull poses, phone layouts and new-sheet retry",
  );
} finally {
  await browser.close();
}
