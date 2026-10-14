import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (
  !/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}):\d+\/$/.test(
    base,
  )
)
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
try {
  const make = async (url, phone = false) => {
    const context = await browser.newContext(
      phone
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1280, height: 800 } },
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    return page;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#keeper-name").fill("<b>Amber</b>");
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const invite = await host.locator("#invite-url").inputValue();
  const guests = [];
  for (let i = 0; i < 4; i++) {
    const p = await make(invite, i === 3);
    await p.locator('#status[data-state="playing"]').waitFor();
    guests.push(p);
  }
  await host.waitForFunction(
    () => document.querySelectorAll(".keeper-card").length === 5,
  );
  assert.equal(await host.locator(".keeper-name b").count(), 0);
  assert.match(
    await host.locator(".keeper-name").first().innerText(),
    /<b>Amber<\/b>/,
  );
  const colors = await host
    .locator(".keeper-card")
    .evaluateAll((cards) =>
      cards.map((c) => c.style.getPropertyValue("--keeper-color")),
    );
  assert.equal(new Set(colors).size, 5);
  await host.locator("#arena-focus").click();
  assert.equal(
    await host.locator("#arena-focus").getAttribute("aria-pressed"),
    "true",
  );
  const box = await host.locator("#scene canvas").boundingBox();
  assert.ok(
    box.y + box.height <= 800,
    "desktop focused arena fits the viewport",
  );
  assert.equal(await host.locator("#invitation").isVisible(), false);
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/presentation-focus-desktop.png",
    fullPage: true,
  });
  await host.locator("#arena-focus").click();
  assert.equal(await host.locator("#invite-url").isVisible(), true);
  await host.locator("#rules").selectOption("elimination");
  await host.waitForFunction(() => {
    const c = JSON.parse(document.querySelector("#scene").dataset.contest);
    return c.rules === "elimination" && c.phase === "active";
  });
  await host.locator("#arena-focus").click();
  assert.equal(await host.locator("#round-status").isVisible(), true);
  const phone = guests[3];
  await phone.locator("#arena-focus").click();
  assert.equal(await phone.locator("#touch-deck").isVisible(), true);
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await phone.setViewportSize({ width: 844, height: 390 });
  const phoneCanvas = await phone.locator("#scene canvas").boundingBox();
  const pad = await phone.locator('[data-pad="move"]').boundingBox();
  assert.ok(
    phoneCanvas.y + phoneCanvas.height <= 390 && pad.y + pad.height <= 390,
    "focused phone landscape controls fit",
  );
  await phone.screenshot({
    path: "games/hook-havok/docs/evidence/presentation-focus-phone.png",
    fullPage: true,
  });
  await host.locator("#arena-focus").click();
  const tv = await make(
    await host.locator("#display-link").getAttribute("href"),
  );
  await tv.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await tv.locator(".keeper-card").count(), 5);
  await tv.locator("#arena-focus").click();
  assert.equal(await tv.locator("#touch-deck").isVisible(), false);
  assert.equal(await tv.locator("#round-status").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS five identities, literal names, focus/recovery controls, visible round status, phone portrait/landscape and seatless display",
  );
} finally {
  await browser.close();
}
