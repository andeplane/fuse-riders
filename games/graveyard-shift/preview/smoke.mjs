import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const base = process.argv[2] ?? "http://localhost:8797/";
const shots = process.argv[3] ?? "games/graveyard-shift/preview/screenshots";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
async function open(path, phone = false) {
  const ctx = await browser.newContext({
    viewport: phone
      ? { width: 844, height: 390 }
      : { width: 1365, height: 1000 },
    hasTouch: phone,
    isMobile: phone,
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base + "graveyard-shift/" + path);
  return p;
}
const snap = (p, name) =>
  p.screenshot({ path: join(shots, name + ".png"), fullPage: true });
try {
  const splash = await open("?mute");
  await splash
    .getByRole("button", { name: "START SOLO SHIFT", exact: true })
    .waitFor();
  await snap(splash, "menu");
  await splash
    .getByRole("button", { name: "HOW TO PLAY", exact: true })
    .click();
  await splash.getByRole("dialog").waitFor();
  await snap(splash, "tutorial");
  await splash.getByRole("button", { name: "READY FOR THE NIGHT" }).click();
  await splash
    .getByRole("button", { name: "START SOLO SHIFT", exact: true })
    .click();
  await splash.locator("[data-phase=running]").waitFor();
  await splash.keyboard.press("Escape");
  await splash.locator("canvas").click({ position: { x: 200, y: 200 } });
  await splash.keyboard.down("w");
  await splash.keyboard.down("j");
  await splash.waitForTimeout(2000);
  await splash.keyboard.up("w");
  await splash.keyboard.up("j");
  await snap(splash, "gameplay");
  assert.equal(await splash.locator(".score").count(), 4);
  console.log("PASS splash, handbook, solo, keyboard");
  const host = await open("?mute");
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.waitForURL(/room=/);
  await host.locator("input.fui-name-input").fill("Ada");
  await host.getByRole("button", { name: "JOIN CREW", exact: true }).click();
  await host.getByRole("button", { name: "READY", exact: true }).waitFor();
  const code = new URL(host.url()).searchParams.get("room");
  const guest = await open(`?room=${code}&mute`);
  await guest.locator("input.fui-name-input").fill("Bo");
  await guest.getByRole("button", { name: "JOIN CREW", exact: true }).click();
  await guest.getByRole("button", { name: "READY", exact: true }).waitFor();
  await guest.locator("form.fui-name-entry").waitFor({ state: "hidden" });
  await host.getByText("Bo", { exact: true }).waitFor();
  await host.getByRole("button", { name: "+ ADD BOT", exact: true }).click();
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
  await tvHost.getByRole("checkbox").check();
  await tvHost
    .getByRole("button", { name: "CREATE ROOM", exact: true })
    .click();
  await tvHost.waitForURL(/room=/);
  const tvCode = new URL(tvHost.url()).searchParams.get("room");
  await tvHost.locator("input.fui-name-input").fill("Cora");
  await tvHost.getByRole("button", { name: "JOIN CREW", exact: true }).click();
  await tvHost.getByRole("button", { name: "+ ADD BOT", exact: true }).click();
  const tv = await open(`?room=${tvCode}&display=1&mute`);
  const phone = await open(`?room=${tvCode}&mute`, true);
  await phone.locator("input.fui-name-input").fill("Dax");
  await phone.getByRole("button", { name: "JOIN CREW", exact: true }).click();
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
  await browser.close();
}
