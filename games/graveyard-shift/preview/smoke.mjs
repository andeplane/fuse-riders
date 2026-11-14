import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startGameCoverage } from "../../../scripts/lib/game-browser-coverage.ts";
import {
  openPlayOptions,
  takeHostSeat,
} from "../../../scripts/lib/main-menu.ts";
const base =
  process.env.ONLINE_URL ?? process.argv[2] ?? "http://localhost:8797/";
const shots =
  process.env.SMOKE_SHOTS ??
  process.argv[3] ??
  (process.env.FUSE_GAME_COVERAGE_DIR
    ? "/tmp/graveyard-shift-coverage-shots"
    : "games/graveyard-shift/preview/screenshots");
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const coverage = [];
async function open(path, phone = false) {
  const ctx = await browser.newContext({
    viewport: phone
      ? { width: 844, height: 390 }
      : { width: 1365, height: 1000 },
    hasTouch: phone,
    isMobile: phone,
  });
  const p = await ctx.newPage();
  coverage.push(await startGameCoverage(p, { gameId: "graveyard-shift" }));
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "graveyard-shift/" + path);
  return p;
}
const snap = (p, name) =>
  p.screenshot({ path: join(shots, name + ".png"), fullPage: true });
const hostRoom = (p) =>
  p.getByRole("button", { name: "Host room", exact: true }).click();
const addBot = (p) =>
  p
    .locator(".fui-room-open-slot")
    .getByRole("button", { name: "Add AI", exact: true })
    .first()
    .click();
try {
  const splash = await open("?mute");
  await splash.getByRole("button", { name: "Play", exact: true }).waitFor();
  await snap(splash, "menu");
  // The main menu's How to play opens the summary; its HOW TO PLAY button opens the handbook.
  await splash
    .getByRole("button", { name: "How to play", exact: true })
    .click();
  await splash
    .getByRole("button", { name: "HOW TO PLAY", exact: true })
    .click();
  await splash.locator("dialog.handbook").waitFor();
  await snap(splash, "tutorial");
  await splash.getByRole("button", { name: "READY FOR THE NIGHT" }).click();
  await splash.locator("dialog.handbook").waitFor({ state: "hidden" });
  await splash.keyboard.press("Escape");
  await openPlayOptions(splash, "single");
  await splash.locator("[data-phase=running]").waitFor();
  await splash.keyboard.press("Escape");
  await splash.locator("canvas.arena").click({ position: { x: 200, y: 200 } });
  await splash.keyboard.down("w");
  await splash.keyboard.down("j");
  await splash.waitForTimeout(2000);
  await splash.keyboard.up("w");
  await splash.keyboard.up("j");
  await snap(splash, "gameplay");
  assert.equal(await splash.locator(".score").count(), 4);
  // A focused header control keeps its own keys (scripts/top-bar-input-smoke.ts); the arena takes them back.
  await splash.getByRole("button", { name: "Open game menu" }).focus();
  await splash.locator("canvas.arena").click({ position: { x: 200, y: 200 } });
  const oldX = Number(await splash.locator(".personal").getAttribute("data-x"));
  await splash.keyboard.down("d");
  await splash.waitForTimeout(300);
  await splash.keyboard.up("d");
  assert.ok(
    Number(await splash.locator(".personal").getAttribute("data-x")) > oldX,
    "the arena moves the hunter again after a header control held focus",
  );
  console.log("PASS splash, handbook, solo, keyboard");
  const host = await open("?mute");
  await openPlayOptions(host);
  await hostRoom(host);
  await host.waitForURL(/room=/);
  // The creator joins from an open slot; its Join opens the name entry.
  await host
    .locator(".fui-room-open-slot")
    .getByRole("button", { name: "Join", exact: true })
    .first()
    .click();
  const entry = host.locator(".fui-slot-admission[open]");
  await entry.locator("input.fui-name-input").fill("Ada");
  const beforeJoinTick = Number(
    await host.locator("main.room").getAttribute("data-tick"),
  );
  await host.waitForFunction(
    (tick) =>
      Number(document.querySelector("main.room")?.getAttribute("data-tick")) >
      tick,
    beforeJoinTick,
  );
  assert.ok(
    await entry.getByRole("button", { name: "Join", exact: true }).isVisible(),
    "typing a fresh name must not submit it on the next room frame",
  );
  await entry.getByRole("button", { name: "Join", exact: true }).click();
  await host.getByRole("button", { name: "READY", exact: true }).waitFor();
  const code = new URL(host.url()).searchParams.get("room");
  const guest = await open(`?room=${code}&mute`);
  await takeHostSeat(guest, "Bo");
  await guest.getByRole("button", { name: "READY", exact: true }).waitFor();
  await guest.locator("form.fui-name-entry").waitFor({ state: "hidden" });
  await host.getByText("Bo", { exact: true }).waitFor();
  await addBot(host);
  await host.getByText(/\/ BOT/).waitFor();
  await host.getByRole("button", { name: "READY", exact: true }).click();
  await guest.getByRole("button", { name: "READY", exact: true }).click();
  await Promise.all([
    host.locator("[data-phase=running]").waitFor(),
    guest.locator("[data-phase=running]").waitFor(),
  ]);
  await guest.reload();
  await guest.locator("[data-phase=running]").waitFor();
  assert.equal(await guest.locator(".score").count(), 3);
  await snap(host, "online");
  console.log("PASS online readiness, mixed bots, peer checkpoint reload");
  const tvHost = await open("?mute");
  await openPlayOptions(tvHost);
  await tvHost.getByRole("checkbox").check();
  await hostRoom(tvHost);
  await tvHost.waitForURL(/room=/);
  const tvCode = new URL(tvHost.url()).searchParams.get("room");
  await takeHostSeat(tvHost, "Cora");
  await addBot(tvHost);
  const tv = await open(`?room=${tvCode}&display=1&mute`);
  const phone = await open(`?room=${tvCode}&mute`, true);
  await takeHostSeat(phone, "Dax");
  await tvHost.getByRole("button", { name: "READY", exact: true }).click();
  await phone.getByRole("button", { name: "READY", exact: true }).click();
  await phone.locator("[data-layout=controller][data-phase=running]").waitFor();
  await tv.locator("[data-phase=running]").waitFor();
  await phone.getByRole("button", { name: "VACUUM", exact: true }).tap();
  await snap(phone, "phone-controller");
  await snap(tv, "shared-tv");
  console.log("PASS shared TV and phone controller");
  const phoneSolo = await open("?solo=1&mute", true);
  await phoneSolo.locator("[data-phase=running]").waitFor();
  for (const selector of ["canvas", ".up", ".vacuum", ".pulse"]) {
    const box = await phoneSolo.locator(selector).boundingBox();
    assert.ok(
      box &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= 844 &&
        box.y + box.height <= 390,
      `${selector} fits the phone viewport before interaction`,
    );
  }
  const beforeY = Number(
    await phoneSolo.locator(".personal").getAttribute("data-y"),
  );
  const upBox = await phoneSolo.locator(".up").boundingBox();
  const cdp = await phoneSolo.context().newCDPSession(phoneSolo);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: upBox.x + upBox.width / 2, y: upBox.y + upBox.height / 2, id: 1 },
    ],
  });
  await phoneSolo.waitForTimeout(350);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert.ok(
    Number(await phoneSolo.locator(".personal").getAttribute("data-y")) <
      beforeY,
    "held phone direction moves the hunter",
  );
  await phoneSolo.getByRole("button", { name: "↑", exact: true }).tap();
  await snap(phoneSolo, "phone-solo");
  assert.equal(
    await phoneSolo.evaluate(() => localStorage.getItem("fuse-riders-audio")),
    null,
  );
  console.log("PASS phone individual-device controls and temporary mute");
  await Promise.all([
    host.locator("[data-phase=over]").waitFor({ timeout: 110000 }),
    guest.locator("[data-phase=over]").waitFor({ timeout: 110000 }),
  ]);
  assert.deepEqual(
    await host.locator(".ranks").innerText(),
    await guest.locator(".ranks").innerText(),
  );
  await snap(host, "results");
  await host
    .getByRole("button", { name: "READY FOR ANOTHER SHIFT", exact: true })
    .click();
  await guest
    .getByRole("button", { name: "READY FOR ANOTHER SHIFT", exact: true })
    .click();
  await host.locator("[data-phase=running]").waitFor();
  await guest.locator("[data-phase=running]").waitFor();
  console.log("PASS matching results and unanimous rematch");
  assert.deepEqual(errors, []);
  console.log("PASS no browser errors");
} finally {
  try {
    for (const finish of coverage) await finish();
  } finally {
    await browser.close();
  }
}
