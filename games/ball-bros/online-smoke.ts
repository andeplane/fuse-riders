import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import { launchSelected } from "../../scripts/lib/browser.js";
import { startGameCoverage } from "../../scripts/lib/game-browser-coverage.js";
import { openPlayOptions, takeHostSeat } from "../../scripts/lib/main-menu.js";

// Real room service + WebRTC, no injected game state or accelerated clocks.
const origin = process.env.ONLINE_URL ?? "http://localhost:8792/";
const url = new URL("ball-bros/?mute", origin).href;
const browser = await launchSelected("chrome");
const errors: string[] = [];
const contexts = await Promise.all([
  browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  }),
  browser.newContext({ viewport: { width: 1440, height: 1000 } }),
]);
const [host, guest, tv] = await Promise.all(contexts.map((c) => c.newPage()));
const tabs = [host!, guest!, tv!];
const finishCoverage = await Promise.all(
  tabs.map((page) => startGameCoverage(page, { gameId: "ball-bros" })),
);
for (const page of tabs) page.on("pageerror", (e) => errors.push(e.message));
await mkdir("artifacts", { recursive: true });
const phase = (p: Page, value: string, timeout = 30000) =>
  p.waitForFunction(
    (v) => document.querySelector<HTMLElement>("#app")?.dataset.phase === v,
    value,
    { timeout },
  );
async function join(page: Page, name: string) {
  await takeHostSeat(page, name);
  await page.locator(".fui-roster-name", { hasText: name }).waitFor();
}
const hostRoom = (page: Page) =>
  page.getByRole("button", { name: "Host room", exact: true });
const arena = (page: Page) => page.getByRole("combobox", { name: "ARENA" });
/** Radio, Reconnect and Leave sit in the header's game menu. */
async function fromGameMenu(page: Page, name: string) {
  await page.getByRole("button", { name: "Open game menu" }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function addBot(page: Page) {
  await page
    .locator(".fui-room-open-slot")
    .getByRole("button", { name: "Add AI", exact: true })
    .first()
    .click();
}
try {
  const a = host!,
    b = guest!,
    display = tv!;
  // Refused room creation keeps a working retry; no credentials enter links.
  await a.route(
    "**/api/rooms?gameId=ball-bros",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Try again shortly" }),
      }),
    { times: 1 },
  );
  await a.goto(url);
  // The landing keeps the arena under Settings; the room keeps it under Game settings.
  await a.getByRole("button", { name: "Settings", exact: true }).click();
  await arena(a).selectOption("ricochet");
  await a.keyboard.press("Escape");
  await openPlayOptions(a);
  await hostRoom(a).click();
  await a
    .locator(".fui-menu-error", { hasText: "Try again shortly" })
    .waitFor();
  await hostRoom(a).click();
  await a.waitForURL(/room=/);
  const code = new URL(a.url()).searchParams.get("room")!;
  await join(a, "Alice");
  await b.goto(url);
  await openPlayOptions(b, "join");
  await b.getByPlaceholder("Room code").fill(code);
  await b.getByRole("button", { name: "JOIN ROOM", exact: true }).click();
  await join(b, "Bob");
  await a.locator(".fui-roster-name", { hasText: "Bob" }).waitFor();
  for (const page of [a, b])
    await page
      .getByRole("button", { name: "Game settings", exact: true })
      .click();
  await arena(a).selectOption("crossfire");
  await arena(b).waitFor();
  assert.equal(await arena(b).isDisabled(), true);
  await arena(a).selectOption("ricochet");
  await b.waitForFunction(
    () =>
      (document.querySelector(".room-panel .map-select") as HTMLSelectElement)
        ?.value === "ricochet",
  );
  for (const page of [a, b]) await page.keyboard.press("Escape");
  for (let count = 3; count <= 5; count++) {
    await addBot(a);
    await a.waitForFunction(
      (n) => document.querySelectorAll(".fui-roster-name").length === n,
      count,
    );
  }
  await a.screenshot({
    path: "artifacts/ball-bros-online-lobby.png",
    fullPage: true,
  });
  assert.equal(
    await b
      .getByRole("button", { name: "START MATCH", exact: true })
      .isVisible(),
    false,
  );
  await a.getByRole("button", { name: "START MATCH", exact: true }).click();
  await Promise.all([phase(a, "running"), phase(b, "running")]);
  assert.equal(await a.locator(".map-name").innerText(), "RICOCHET REACTOR");
  assert.equal(await b.locator(".map-name").innerText(), "RICOCHET REACTOR");
  await a.keyboard.down("KeyD");
  await a.keyboard.down("KeyW");
  await b.getByRole("button", { name: "OUT ↑", exact: true }).tap();
  await a.getByText("GET READY · 1", { exact: true }).waitFor();
  await a.keyboard.up("KeyD");
  await a.keyboard.up("KeyW");
  await a.getByText("SPACE TO LAUNCH", { exact: true }).waitFor();
  await a.keyboard.press("Space");
  await b.getByRole("button", { name: "LAUNCH", exact: true }).tap();
  assert.match(await b.locator(".controller-identity").innerText(), /P2 BOB/);
  await b.reload();
  await phase(b, "running");
  await b.locator(".controller-identity", { hasText: "P2 BOB" }).waitFor();
  assert.equal(
    await b.getByPlaceholder("Your name").isVisible(),
    false,
    "reload restores the existing live seat",
  );
  await a.screenshot({
    path: "artifacts/ball-bros-online-arena.png",
    fullPage: true,
  });
  await Promise.all([phase(a, "over", 140000), phase(b, "over", 140000)]);
  assert.equal(
    await a.locator(".overlay h2").innerText(),
    await b.locator(".overlay h2").innerText(),
  );
  assert.deepEqual(
    await a.locator(".scorecard strong").allTextContents(),
    await b.locator(".scorecard strong").allTextContents(),
  );
  await a.getByRole("button", { name: "PLAY AGAIN", exact: true }).click();
  await Promise.all([phase(a, "running"), phase(b, "running")]);
  console.log(
    "PASS individual: create retry, lobby/bots, two real peers, controls, reload recovery, agreed result and rematch.",
  );
  // Creator leaves during a match. The remaining peer continues without a new room.
  await fromGameMenu(a, "LEAVE");
  await a.locator(".fui-main-menu").waitFor();
  await phase(b, "running");
  await b.waitForFunction(
    () => document.querySelector(".clock")?.textContent !== "02:00",
  );
  await fromGameMenu(b, "LEAVE");
  await b.locator(".fui-main-menu").waitFor();

  await openPlayOptions(a);
  await a.getByLabel("Shared TV + phone controllers").check();
  await hostRoom(a).click();
  await a.waitForURL(/room=/);
  // The creator takes a seat explicitly; a remembered guest below rejoins by itself.
  await join(a, "Alice");
  const sharedCode = new URL(a.url()).searchParams.get("room")!;
  const tvUrl = await a
    .getByRole("link", { name: "OPEN TV SCREEN" })
    .getAttribute("href");
  assert.ok(tvUrl && !tvUrl.includes("token"));
  await display.goto(tvUrl!);
  await display.locator(".fui-roster-name", { hasText: "Alice" }).waitFor();
  assert.equal(await display.getByPlaceholder("Your name").isVisible(), false);
  await b.goto(`${url}&room=${sharedCode}`);
  await b.locator(".fui-roster-name", { hasText: "Bob" }).waitFor();
  await a.locator(".fui-roster-name", { hasText: "Bob" }).waitFor();
  await a.getByRole("button", { name: "START MATCH", exact: true }).click();
  await Promise.all([
    phase(a, "running"),
    phase(b, "running"),
    phase(display, "running"),
  ]);
  await b.locator("#app.controller-mode").waitFor();
  await display.locator("#app.display-mode").waitFor();
  assert.equal(await display.locator(".pad").first().isVisible(), false);
  assert.equal(await b.locator(".canvas-host").isVisible(), false);
  await b.getByRole("button", { name: "OUT ↑", exact: true }).tap();
  await b.getByRole("button", { name: "RIGHT ↷", exact: true }).tap();
  await b.screenshot({
    path: "artifacts/ball-bros-controller.png",
    fullPage: true,
  });
  await display.screenshot({
    path: "artifacts/ball-bros-display.png",
    fullPage: true,
  });
  assert.ok(
    await b.evaluate(() => document.documentElement.scrollWidth <= 390),
  );
  const pad = await b
    .getByRole("button", { name: "LAUNCH", exact: true })
    .boundingBox();
  assert.ok(pad && pad.y + pad.height <= 844, "controller fits phone height");
  assert.equal(
    await display.locator(".scorecard:not([hidden])").count(),
    2,
    "display has no player slot",
  );
  console.log(
    "PASS shared: credential-free invitation, TV without a seat, phone controls and viewport fit.",
  );
  const blocked = await browser.newContext({
    viewport: { width: 1100, height: 900 },
  });
  // Browser impairment only: emulate a browser refusing storage. No game state is injected.
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  });
  const privatePage = await blocked.newPage();
  privatePage.on("pageerror", (e) => errors.push(e.message));
  await privatePage.goto(url);
  await openPlayOptions(privatePage);
  await hostRoom(privatePage).click();
  await privatePage.waitForURL(/room=/);
  await join(privatePage, "Private");
  await addBot(privatePage);
  await privatePage
    .locator(".fui-roster-name", { hasText: "Sparks" })
    .waitFor();
  await fromGameMenu(privatePage, "RECONNECT");
  // Alone in the room, the reconnect starts a fresh lobby. The creator still manages it and takes a seat again.
  await privatePage.locator(".fui-room-count", { hasText: "0 / 5" }).waitFor();
  await join(privatePage, "Private");
  assert.equal(
    await privatePage
      .getByRole("button", { name: "START MATCH", exact: true })
      .isVisible(),
    true,
  );
  await privatePage.screenshot({
    path: "artifacts/ball-bros-private-room.png",
    fullPage: true,
  });
  await blocked.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS storage refusal: creator identity survives room entry and same-page reconnect.",
  );
  await Promise.all(finishCoverage.map((finish) => finish()));
} catch (error) {
  await Promise.all(
    tabs.map((p, i) =>
      p
        .screenshot({
          path: `artifacts/ball-bros-online-failure-${i}.png`,
          fullPage: true,
        })
        .catch(() => {}),
    ),
  );
  throw error;
} finally {
  await browser.close();
}
