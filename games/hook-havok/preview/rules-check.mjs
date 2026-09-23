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
  const page = async (url) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    return p;
  };
  const phase = (p, expected, timeout = 15000) =>
    p.waitForFunction(
      (phase) =>
        JSON.parse(document.querySelector("#scene").dataset.contest || "{}")
          .phase === phase,
      expected,
      { timeout },
    );
  const contest = (p) =>
    p.locator("#scene").evaluate((e) => JSON.parse(e.dataset.contest));
  const host = await page(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  await host.locator("#rules").selectOption("elimination");
  await phase(host, "waiting");
  const invite = await host.locator("#invite-url").inputValue();
  const guest = await page(invite);
  await phase(host, "countdown");
  await phase(host, "active");
  await phase(guest, "active");
  assert.equal((await contest(host)).entries.length, 2);
  const late = await page(invite);
  await late.locator('#status[data-state="playing"]').waitFor();
  assert.equal((await contest(late)).entries.length, 2);
  assert.match(await late.locator("#round-status").innerText(), /Watching/);
  const hostId = await host.locator("#scene").getAttribute("data-player-id");
  await guest.locator("#scene").focus();
  await guest.keyboard.down("d");
  await phase(host, "over", 25000);
  await guest.keyboard.up("d");
  assert.deepEqual((await contest(host)).winners, [hostId]);
  assert.equal(await guest.locator("#reset").isDisabled(), true);
  await guest.keyboard.press("r");
  assert.equal((await contest(guest)).phase, "over");
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/elimination-result.png",
    fullPage: true,
  });
  await host.locator("#restart-room").click();
  await phase(host, "countdown");
  await phase(host, "active");
  assert.equal((await contest(host)).entries.length, 3);
  await host.locator("#rules").selectOption("score");
  await phase(host, "countdown");
  await phase(host, "active");
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.contest).elapsed > 35,
  );
  const box = await host.locator("#scene canvas").boundingBox();
  await host.mouse.move(
    box.x + (170 / 1600) * box.width,
    box.y + (782 / 900) * box.height,
  );
  await host.mouse.down();
  await host.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector("#scene").dataset.contest).entries.find(
        (e) => e.id === id,
      ).score === 1,
    hostId,
  );
  await host.mouse.up();
  console.log(
    "PASS waiting/countdown, locked late join, elimination result, reset suppression, restart and scoring; checking full 60-second round",
  );
  await phase(host, "over", 65000);
  await phase(late, "over");
  assert.equal((await contest(host)).elapsed, 3600);
  assert.deepEqual(await contest(host), await contest(late));
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/score-result.png",
    fullPage: true,
  });
  await host.locator("#rules").selectOption("free");
  await host.waitForFunction(() => !document.querySelector("#reset").disabled);
  assert.deepEqual(errors, []);
  console.log(
    "PASS timed score result agrees across peers; returning to free play restores reset",
  );
} finally {
  await browser.close();
}
