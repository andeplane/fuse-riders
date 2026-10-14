import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { startRoomService } from "./lib/server.js";

// Uses the real menu, room service and WebRTC transport. Build before running.
const service = await startRoomService({
  logFile: "artifacts/fuse-lane-online-service.log",
});
const browser = await chromium.launch();
const errors: string[] = [];
await mkdir("artifacts", { recursive: true });
async function page(phone = false): Promise<Page> {
  const context = await browser.newContext({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
  });
  const result = await context.newPage();
  result.on("pageerror", (error) => errors.push(error.message));
  return result;
}
async function create(host: Page, shared: boolean): Promise<string> {
  await host.goto(`${service.url}?mute`);
  await host.locator('.arcade-game[href*="fuse-lane/"]').click();
  await host.getByRole("tab", { name: "PLAY ONLINE" }).click();
  await host.getByRole("textbox", { name: "Your name" }).fill("Host");
  if (shared)
    await host.getByRole("button", { name: "SHARED TV", exact: true }).click();
  await host.getByRole("button", { name: "CREATE ROOM", exact: true }).click();
  await host.locator(".fl-code").waitFor();
  return (await host.locator(".fl-code").innerText()).trim();
}
async function join(phone: Page, code: string, name: string): Promise<void> {
  await phone.goto(`${service.url}fuse-lane/?room=${code}&mute`);
  await phone.locator(".fl-join-card").waitFor();
  await phone.getByRole("textbox").fill(name);
  await phone.getByRole("button", { name: "JOIN", exact: true }).click();
  await phone.locator(".fl-roster-name").filter({ hasText: name }).waitFor();
}
async function running(target: Page, layout: string): Promise<void> {
  await target
    .locator(
      `.fl-room[data-phase="running"][data-part="week"][data-layout="${layout}"]`,
    )
    .waitFor();
}
try {
  const host = await page();
  const guest = await page(true);
  const code = await create(host, false);
  await join(guest, code, "Guest");
  await host.getByRole("button", { name: "START MATCH", exact: true }).click();
  await running(host, "board");
  await running(guest, "board");
  await guest.getByRole("button", { name: "MENU", exact: true }).click();
  await guest.getByRole("button", { name: "CONTROLS", exact: true }).click();
  await guest.locator(".fui-game-menu-controls .fui-controls-list").waitFor();
  await guest.keyboard.press("Escape");
  await guest.locator(".fui-game-menu-panel").waitFor({ state: "hidden" });
  await host
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await host.locator(".fl-waiting").waitFor();
  assert.match(await host.locator(".fl-waiting").innerText(), /Guest/);
  await guest
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await host.locator('.fl-room[data-week="2"]').waitFor();
  await guest.locator('.fl-room[data-week="2"]').waitFor();
  await host.screenshot({ path: "artifacts/fuse-lane-devices.png" });
  await host.context().close();
  await guest.context().close();

  const tv = await page();
  const first = await page(true);
  const second = await page(true);
  const sharedCode = await create(tv, true);
  await join(first, sharedCode, "First");
  await join(second, sharedCode, "Second");
  await tv.locator(".fl-roster-name").filter({ hasText: "Second" }).waitFor();
  assert.equal(
    await tv.locator(".fl-roster-name").count(),
    2,
    "the TV holds no seat",
  );
  await tv.getByRole("button", { name: "START MATCH", exact: true }).click();
  await running(tv, "tv");
  await running(first, "controller");
  await running(second, "controller");
  await tv.getByRole("button", { name: "MENU", exact: true }).click();
  await tv.getByRole("button", { name: "CONTROLS", exact: true }).click();
  await tv
    .getByText(
      "Shared screen: watch here. Players use their own phones or devices.",
    )
    .waitFor();
  await tv.locator(".fui-game-menu-controls .fui-controls-list").waitFor();
  await tv.keyboard.press("Escape");
  await first.getByRole("button", { name: "FreshCo", exact: true }).click();
  await first.locator(".fl-panel:not([hidden])").waitFor();
  await first
    .locator(".fl-panel:not([hidden]) .fl-card:not([disabled])")
    .first()
    .waitFor();
  await first.reload();
  await running(first, "controller");
  await first.locator(".fl-panel:not([hidden])").waitFor();
  await first
    .locator(".fl-panel:not([hidden]) .fl-card:not([disabled])")
    .first()
    .waitFor();
  await first
    .locator(".fl-panel:not([hidden])")
    .screenshot({ path: "artifacts/fuse-lane-rejoined-phone.png" });
  await tv.screenshot({ path: "artifacts/fuse-lane-shared-tv.png" });
  await second
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await first.locator(".fl-panel:not([hidden]) .fl-close").click();
  await first
    .getByRole("button", { name: "CALL IT A WEEK", exact: true })
    .click();
  await tv.locator('.fl-room[data-week="2"]').waitFor();
  await tv.getByText("GET READY · PHONE CONTROLS", { exact: true }).waitFor();
  assert.deepEqual(errors, [], "no browser exceptions");
  console.log(
    "Chromium: device room to week 2; shared TV + two phone viewports; shop refresh recovers mid-week; shared week 2; no page errors",
  );
} finally {
  await browser.close();
  await service.stop();
}
