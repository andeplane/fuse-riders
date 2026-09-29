import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const errors = [];
  const make = async (url, phone = false) => {
    const context = await browser.newContext(
      phone
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
          }
        : { viewport: { width: 1440, height: 1000 } },
    );
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    return p;
  };
  const phase = (p, value) =>
    p.waitForFunction(
      (value) =>
        JSON.parse(document.querySelector("#scene").dataset.contest || "{}")
          .phase === value,
      value,
    );
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#keeper-name").fill("<b>Amber</b>");
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  assert.match(await host.locator("#room-authority").innerText(), /You manage/);
  assert.equal(
    await host.locator("#development-workshop").getAttribute("open"),
    null,
  );
  assert.equal(await host.locator("#debug").isVisible(), false);
  await host.locator("#development-workshop > summary").click();
  assert.equal(await host.locator("#debug").isVisible(), true);
  await host.locator("#jump-mode").selectOption("double");
  await host.locator("#development-workshop > summary").click();
  assert.equal(await host.locator("#keyboard-mode").isVisible(), true);
  assert.equal(await host.locator(".keeper-name b").count(), 0);
  assert.match(await host.locator(".keeper-name").innerText(), /<b>Amber<\/b>/);
  const invite = await host.locator("#invite-url").inputValue();
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/match-lounge.png",
    fullPage: true,
  });
  await host.locator("#rules").selectOption("elimination");
  await phase(host, "waiting");
  assert.equal(await host.locator("#rules-help").isVisible(), true);
  assert.match(
    await host.locator("#rules-help").innerText(),
    /A fall puts you out/,
  );
  assert.match(
    await host.locator("#spectator-state").innerText(),
    /second keeper/,
  );
  const guest = await make(invite);
  await phase(host, "countdown");
  assert.equal(await host.locator("#countdown-card").isVisible(), true);
  await phase(host, "active");
  await phase(guest, "active");
  assert.equal(await guest.locator("#rules").isDisabled(), true);
  assert.equal(await host.locator("#roster .keeper-portrait").count(), 2);
  const late = await make(invite, true);
  await late.locator('#status[data-state="playing"]').waitFor();
  assert.match(await late.locator("#spectator-state").innerText(), /WATCHING/);
  const tv = await make(
    await host.locator("#display-link").getAttribute("href"),
  );
  await tv.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await tv.locator("#room-lounge").isVisible(), false);
  await host.locator("#arena-focus").click();
  const box = await host.locator("#scene canvas").boundingBox();
  assert.ok(box.y + box.height <= 1000, "focused desktop fits");
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/match-hud.png",
    fullPage: true,
  });
  await guest.locator("#scene").focus();
  await guest.keyboard.down("d");
  await phase(host, "over");
  await guest.keyboard.up("d");
  await phase(guest, "over");
  assert.match(
    await host.locator("#result-detail").innerText(),
    /<b>Amber<\/b>/,
  );
  assert.equal(await host.locator("#result-detail b").count(), 0);
  assert.equal(await guest.locator("#rematch").isDisabled(), true);
  assert.equal(await tv.locator("#rematch").isVisible(), false);
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/match-result.png",
    animations: "disabled",
    fullPage: true,
  });
  await late.locator("#arena-focus").click();
  assert.ok(
    await late.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await late.screenshot({
    path: "games/hook-havok/docs/evidence/match-phone.png",
    fullPage: true,
  });
  await late.setViewportSize({ width: 844, height: 390 });
  const pad = await late.locator('[data-pad="move"]').boundingBox();
  assert.ok(pad.y + pad.height <= 390, "landscape phone pad fits");
  await host.locator("#dismiss-results").click();
  assert.equal(await host.locator("#result-card").isVisible(), false);
  await host.locator("#show-results").click();
  assert.equal(await host.locator("#result-card").isVisible(), true);
  await host.locator("#rematch").click();
  await phase(host, "countdown");
  await phase(host, "active");
  const startX = Number(
    await host.locator("#scene").getAttribute("data-actor-x"),
  );
  await host.keyboard.down("a");
  await host.waitForFunction(
    (x) => Number(document.querySelector("#scene").dataset.actorX) < x - 20,
    startX,
  );
  await host.keyboard.up("a");
  assert.equal(await host.locator("#result-card").isVisible(), false);
  console.log(
    "PASS lounge, name safety, workshop, countdown, late watcher, HUD, winner, result reopen, rematch, display and phone layouts",
  );
  // Both opponents leave their ledge through ordinary input; no injected game state.
  for (const p of [guest, late]) {
    await p.locator("#scene").focus();
    await p.keyboard.down("d");
  }
  await phase(host, "over");
  for (const p of [guest, late]) await p.keyboard.up("d");
  await host.locator("#result-free").click();
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.contest).rules ===
      "free",
  );
  assert.equal(await host.locator("#match-overlay").isVisible(), false);
  await host.reload();
  await host.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await host.locator("#match-mode").innerText(), "Free play");
  assert.deepEqual(errors, []);
  console.log(
    "PASS result action returns every client to free play; refresh restores shell",
  );
} finally {
  await browser.close();
}
