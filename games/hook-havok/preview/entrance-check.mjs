import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const errors = [],
    music = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/music/")) music.push(r.url());
  });
  await page.goto(base + "?mute");
  await page.getByRole("link", { name: /HOOK HAVOK/ }).click();
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator('#entrance[data-art="ready"]').waitFor();
  assert.equal(await page.locator("main").evaluate((e) => e.inert), true);
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/entrance-desktop.png",
    fullPage: true,
  });
  await page.locator("#menu-help").focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("#entrance-help").evaluate((e) => e.open),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "menu-help",
  );
  await page.locator("#menu-settings").click();
  assert.equal(
    await page.getByRole("button", { name: "Play radio" }).isDisabled(),
    true,
  );
  await page.locator("#atmosphere").uncheck();
  assert.equal(
    await page
      .locator(".entrance-motes i")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.locator("#atmosphere").check();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".entrance-motes i")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/entrance-settings.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator("#menu-join").click();
  await page.locator("#room-code").fill("!");
  await page.locator("#join-room").click();
  assert.match(
    await page.locator(".join-error").textContent(),
    /valid room code/,
  );
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/entrance-phone.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  let creates = 0,
    releaseCreate;
  const pendingCreate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  await page.route("**/api/rooms?*", async (route) => {
    creates++;
    await pendingCreate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Test unavailable" }),
    });
  });
  await page.locator("#start").click();
  assert.equal(await page.locator("#start").isDisabled(), true);
  assert.equal(await page.locator("#menu-join").isDisabled(), true);
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/entrance-loading.png",
    fullPage: true,
  });
  releaseCreate();
  await page.locator('#status[data-state="error"]').waitFor();
  assert.equal(creates, 1);
  assert.equal(await page.locator("#entrance").isVisible(), true);
  await page.screenshot({
    path: "games/hook-havok/docs/evidence/entrance-error.png",
    fullPage: true,
  });
  await page.unroute("**/api/rooms?*");
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await page.locator("#entrance").isVisible(), false);
  assert.equal(await page.locator("main").evaluate((e) => e.inert), false);
  assert.equal(await page.locator("#scene canvas").count(), 1);
  const code = await page.locator("#room-code").inputValue();
  const invite = await page.locator("#invite-url").inputValue();
  const guest = await browser.newPage();
  guest.on("pageerror", (e) => errors.push(e.message));
  await guest.goto(base + "hook-havok/?mute");
  await guest.locator('#status[data-state="ready"]').waitFor();
  await guest.locator("#menu-join").click();
  await guest.locator("#room-code").fill(code);
  await guest.locator("#room-code").press("Enter");
  await guest.locator('#status[data-state="playing"]').waitFor();
  await guest.reload();
  await guest.locator('#status[data-state="playing"]').waitFor();
  const invited = await browser.newPage();
  await invited.goto(invite);
  await invited.locator('#status[data-state="playing"]').waitFor();
  const display = await browser.newPage();
  await display.goto(await page.locator("#display-link").getAttribute("href"));
  await display.locator('#status[data-state="playing"]').waitFor();
  console.log(
    "PASS splash/help/settings, keyboard join, failed create retry, invite/refresh/shared display",
  );
  await page.locator("#leave-room").click();
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await page.locator("#entrance").isVisible(), true);
  assert.equal(new URL(page.url()).searchParams.has("room"), false);
  await page.route("**/entrance-source-*.png", (route) => route.abort());
  await page.route("**/lantern-keeper-run-source-*.png", (route) =>
    route.abort(),
  );
  await page.reload();
  await page.locator('#status[data-state="error"]').waitFor();
  await page.locator('#entrance[data-art="error"]').waitFor();
  assert.equal(await page.locator("#start").isDisabled(), true);
  await page.unroute("**/entrance-source-*.png");
  await page.locator("#retry-entrance-art").click();
  await page.locator('#entrance[data-art="ready"]').waitFor();
  await page.unroute("**/lantern-keeper-run-source-*.png");
  await page.locator("#retry").click();
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await page.locator("#scene canvas").count(), 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(music, []);
  await page.route("**/playground-*.js", (route) => route.abort());
  await page.goto(base + "hook-havok/?mute");
  await page.locator("#retry-app").waitFor();
  assert.match(
    await page.locator("#boot-status").textContent(),
    /could not load/,
  );
  await page.unroute("**/playground-*.js");
  await page.locator("#retry-app").click();
  await page.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await page.locator("#boot-status").count(), 0);
  console.log("PASS application chunk failure and reload retry");
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base + "hook-havok/?mute&room=invalid&display=1");
  await phone.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await phone.locator("#start").textContent(), "Create room");
  await phone.locator('#entrance[data-art="ready"]').waitFor();
  await phone.screenshot({
    path: "games/hook-havok/docs/evidence/entrance-phone.png",
    fullPage: true,
  });
  await phone.locator("#menu-settings").tap();
  assert.equal(await phone.locator("#touch-toggle").isChecked(), true);
  await phone.locator("#entrance-settings .dialog-close").tap();
  await phone.setViewportSize({ width: 844, height: 390 });
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await phone.screenshot({
    path: "games/hook-havok/docs/evidence/entrance-landscape.png",
    fullPage: true,
  });
  await phone.locator("#start").tap();
  await phone.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await phone.locator("#touch-deck").isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS native touch menu and create, portrait/landscape, malformed invite fallback",
  );
  console.log(
    "PASS leave-to-menu, separate illustration/graphics failures and retries, muted media, phone and reduced motion",
  );
} finally {
  await browser.close();
}
