import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = new URL(process.argv[2] ?? "http://localhost:62202/");
const shots = process.argv[3];
if (shots) await mkdir(shots, { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
  args: ["--mute-audio"],
});
const errors = [];
const open = async (search, options = {}) => {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL(`fuse-choppers/${search}`, base).href);
  return page;
};
const show = async (page) => {
  await page
    .getByRole("button", { name: "♫ RADIO", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await page.getByRole("dialog", { name: "Fuse Choppers Radio" }).waitFor();
};
try {
  const muted = await open("?mute");
  await show(muted);
  assert.equal(
    await muted.getByRole("button", { name: "PLAY", exact: true }).isDisabled(),
    true,
  );
  assert.match(
    await muted
      .getByRole("status")
      .filter({ hasText: "Audio muted" })
      .textContent(),
    /preview URL/,
  );
  await muted.keyboard.press("Escape");
  await muted.getByRole("button", { name: "PLAY SOLO VS BOTS" }).click();
  await muted.locator('main[data-phase="play"]').waitFor();
  await muted.keyboard.down("Space");
  await muted.keyboard.press("Control+a");
  await muted.keyboard.up("Space");
  assert.equal(await muted.getByRole("dialog").isVisible(), true);
  await muted
    .getByRole("button", { name: "BACK TO GAME", exact: true })
    .click();

  const desktop = await open("", { viewport: { width: 1280, height: 800 } });
  const audio = desktop.waitForResponse((response) =>
    response.url().endsWith("/music/pixel-sax-parade.m4a"),
  );
  await show(desktop);
  assert.ok((await audio).ok());
  await desktop.getByRole("button", { name: "PAUSE", exact: true }).waitFor();
  await desktop.getByRole("button", { name: "NEXT", exact: true }).click();
  assert.equal(await desktop.getByLabel("Radio track").inputValue(), "1");
  await desktop.getByLabel("Radio track").selectOption("4");
  await desktop.getByRole("button", { name: "REPEAT SONG OFF" }).click();
  await desktop.getByLabel("Music volume").fill("35");
  await desktop.getByRole("button", { name: "PAUSE", exact: true }).click();
  await desktop.reload();
  await show(desktop);
  assert.equal(await desktop.getByLabel("Radio track").inputValue(), "4");
  assert.equal(await desktop.getByLabel("Music volume").inputValue(), "35");
  await desktop.getByRole("button", { name: "PLAY", exact: true }).waitFor();
  if (shots) await desktop.screenshot({ path: `${shots}/radio-desktop.png` });

  const phone = await open("?solo=1&mute", {
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.locator('main[data-phase="play"]').waitFor();
  await show(phone);
  const box = await phone.getByRole("dialog").boundingBox();
  assert.ok(
    box &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= 844 &&
      box.y + box.height <= 390,
  );
  if (shots) await phone.screenshot({ path: `${shots}/radio-phone.png` });

  const touch = await open("", {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await show(touch);
  await touch.getByRole("button", { name: "PLAY", exact: true }).waitFor();
  await touch.getByRole("button", { name: "PLAY", exact: true }).click();
  await touch.getByRole("button", { name: "PAUSE", exact: true }).waitFor();
  if (shots) await touch.screenshot({ path: `${shots}/radio-portrait.png` });
  await touch.route("**/music/coin-op-swing.m4a", (route) => route.abort());
  await touch.getByRole("button", { name: "NEXT", exact: true }).click();
  await touch
    .getByText(
      "Track unavailable. Press PLAY to retry or choose another track.",
    )
    .waitFor();
  await touch.unroute("**/music/coin-op-swing.m4a");
  const retry = touch.waitForResponse((response) =>
    response.url().endsWith("/music/coin-op-swing.m4a"),
  );
  await touch.getByRole("button", { name: "PLAY", exact: true }).click();
  assert.ok((await retry).ok());
  await touch.getByRole("button", { name: "PAUSE", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Radio browser smoke passed: muted solo, desktop playback/preferences, landscape and touch opt-in.",
  );
} finally {
  await browser.close();
}
