import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { launchSelected } from "./lib/browser.js";
import { smokeTimeout } from "./smoke-timeout.js";

/**
 * Dice (Pig) browser smoke: a creator and a phone joiner in one room over WebRTC, playing turns to a round result
 * with a refresh mid-round that recovers the world from the peer; then a shared-screen room, where the TV shows the
 * table and the phone is a controller. `BROWSER=webkit` runs it in WebKit. `ONLINE_URL` is the room service that
 * serves the build (`pnpm exec tsx service/dev.ts`); screenshots go to `SMOKE_SHOTS` (default artifacts/).
 */
const base = process.env.ONLINE_URL ?? "http://localhost:8787/";
const page = new URL("dice/", base).href;
const shots = process.env.SMOKE_SHOTS ?? "artifacts";
const engine = process.env.BROWSER === "webkit" ? "webkit" : "chromium";
await mkdir(shots, { recursive: true });
const phoneSize = {
  viewport: { width: 390, height: 844 },
  isMobile: engine !== "webkit" || undefined,
  hasTouch: true,
} as const;

const phase = (tab: Page) =>
  tab.locator(".dice-room").getAttribute("data-phase");
const waitPhase = (tab: Page, phases: string[], timeout = 30_000) =>
  tab.waitForFunction(
    (wanted) =>
      wanted.includes(
        document.querySelector<HTMLElement>(".dice-room")?.dataset.phase ?? "",
      ),
    phases,
    { timeout: smokeTimeout(timeout) },
  );
/** This tab's own score card is on the table: it holds a seat in the running match. */
const seated = (tab: Page, timeout = 30_000) =>
  tab
    .locator(".dice-player.you")
    .first()
    .waitFor({ timeout: smokeTimeout(timeout) });
/**
 * A phone page never scrolls sideways: every control stays on screen and under the finger that aims at it. Measured
 * against the phone's width, not `innerWidth`: a mobile browser widens its layout viewport to fit a page that overflows.
 */
const fitsPhone = async (tab: Page, where: string) => {
  const page = await tab.evaluate(() => document.documentElement.scrollWidth);
  const screen = phoneSize.viewport.width;
  assert.ok(
    page <= screen,
    `${where}: page is ${page}px wide on a ${screen}px phone`,
  );
};
const joinAs = async (tab: Page, name: string) => {
  const field = tab.getByPlaceholder("Your name");
  await field.waitFor();
  await field.fill(name);
  await tab.getByRole("button", { name: "JOIN", exact: true }).click();
  await tab
    .locator(".fui-roster-name", { hasText: name })
    .first()
    .waitFor({ timeout: smokeTimeout(30_000) });
};
/** One press if it is this tab's turn: roll until 12 are at risk, then hold. */
async function act(tab: Page): Promise<boolean> {
  const roll = tab.locator(".dice-roll"),
    hold = tab.locator(".dice-hold");
  if (!(await roll.isVisible()) || !(await roll.isEnabled())) return false;
  const total = Number(
    (await tab.locator(".dice-total strong").textContent()) ?? "0",
  );
  const button = total >= 12 && (await hold.isEnabled()) ? hold : roll;
  // The turn can pass between the check and the press (the timer, the frame after a HOLD): that press is simply lost.
  return button.click({ timeout: smokeTimeout(2_000) }).then(
    () => true,
    () => false,
  );
}
/** Both boards show the same scores: the replicas agree. */
const boards = (tab: Page) => tab.locator(".dice-board").innerText();
async function agree(a: Page, b: Page): Promise<void> {
  const deadline = Date.now() + smokeTimeout(15_000);
  for (;;) {
    const [left, right] = [await boards(a), await boards(b)];
    // The "(you)" marker differs by device; the names and scores must not.
    const plain = (text: string) => text.replaceAll(" (you)", "");
    if (plain(left) === plain(right)) return;
    if (Date.now() > deadline)
      assert.fail(`boards differ:\n${left}\n---\n${right}`);
    await a.waitForTimeout(200);
  }
}

async function twoPlayers(browser: Browser): Promise<void> {
  const desktop = await browser.newContext({
    viewport: { width: 1100, height: 800 },
  });
  const phone = await browser.newContext(phoneSize);
  desktop.setDefaultTimeout(smokeTimeout(30_000));
  phone.setDefaultTimeout(smokeTimeout(30_000));
  const a = await desktop.newPage(),
    b = await phone.newPage();
  for (const tab of [a, b])
    tab.on("pageerror", (error) => console.error("page error:", error));
  await a.goto(`${page}?mute`);
  await a.screenshot({ path: `${shots}/dice-landing-${engine}.png` });
  await a.getByRole("button", { name: "CREATE ROOM" }).click();
  await a.waitForURL(/\?room=[A-Z0-9]+/);
  const code = new URL(a.url()).searchParams.get("room")!;
  await joinAs(a, "Ada");

  await b.goto(`${page}?mute`);
  await b.getByPlaceholder("Room code").fill(code.toLowerCase());
  await b.getByRole("button", { name: "JOIN ROOM" }).click();
  await b.waitForURL(new RegExp(`room=${code}`));
  await b.getByPlaceholder("Your name").waitFor();
  await fitsPhone(b, "name entry");
  await joinAs(b, "Bo");
  await fitsPhone(b, "lobby");
  await a.locator(".fui-roster-name", { hasText: "Bo" }).waitFor();
  await a.screenshot({ path: `${shots}/dice-lobby-${engine}.png` });

  const start = a.getByRole("button", { name: "START MATCH" });
  await assert.doesNotReject(() => start.waitFor());
  assert.equal(
    await b.getByRole("button", { name: "START MATCH" }).isVisible(),
    false,
    "only the creator starts",
  );
  await start.click();
  await Promise.all([waitPhase(a, ["running"]), waitPhase(b, ["running"])]);
  await Promise.all([seated(a), seated(b)]);
  await fitsPhone(b, "table");
  await a.screenshot({ path: `${shots}/dice-table-${engine}.png` });

  // Turns until the round is decided; the joiner refreshes once it has played, mid-round.
  let refreshed = false,
    presses = 0;
  const deadline = Date.now() + smokeTimeout(240_000);
  while ((await phase(a)) === "running") {
    assert.ok(Date.now() < deadline, "the round never ended");
    const acted = (await act(a)) || (await act(b));
    if (acted) presses++;
    if (!refreshed && presses >= 6 && (await phase(b)) === "running") {
      refreshed = true;
      await b.screenshot({ path: `${shots}/dice-phone-${engine}.png` });
      await b.reload();
      await seated(b, 45_000);
      await waitPhase(b, ["running", "between", "over"]);
      await agree(a, b);
    }
    await a.waitForTimeout(acted ? 120 : 60);
  }
  assert.ok(refreshed, "the joiner refreshed mid-round");
  await waitPhase(a, ["between", "over"]);
  await waitPhase(b, ["between", "over"]);
  const [ha, hb] = [
    await a.locator(".dice-headline").textContent(),
    await b.locator(".dice-headline").textContent(),
  ];
  assert.match(ha ?? "", /WINS (ROUND 1|THE MATCH)/);
  assert.equal(ha, hb, "both devices show the same round result");
  await agree(a, b);
  await a.screenshot({ path: `${shots}/dice-round-${engine}.png` });
  console.log(`${engine}: room ${code}, ${presses} presses, ${ha}`);
  await desktop.close();
  await phone.close();
}

async function sharedScreen(browser: Browser): Promise<void> {
  const host = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const phone = await browser.newContext(phoneSize);
  host.setDefaultTimeout(smokeTimeout(30_000));
  phone.setDefaultTimeout(smokeTimeout(30_000));
  const h = await host.newPage();
  await h.goto(`${page}?mute`);
  await h.getByLabel(/Shared TV/).check();
  await h.getByRole("button", { name: "CREATE ROOM" }).click();
  await h.waitForURL(/\?room=[A-Z0-9]+/);
  const code = new URL(h.url()).searchParams.get("room")!;
  await joinAs(h, "Host");
  const tv = await host.newPage();
  await tv.goto(`${page}?room=${code}&display=1&mute`);
  await tv.locator(".fui-invite .fui-room-code", { hasText: code }).waitFor();
  assert.equal(
    await tv.getByPlaceholder("Your name").isVisible(),
    false,
    "the TV holds no seat",
  );
  const p = await phone.newPage();
  await p.goto(`${page}?room=${code}&mute`);
  await joinAs(p, "Pat");
  await tv.locator(".fui-roster-name", { hasText: "Pat" }).waitFor();
  await h.getByRole("button", { name: "START MATCH" }).click();
  await Promise.all([waitPhase(tv, ["running"]), waitPhase(p, ["running"])]);
  await seated(p);
  assert.equal(
    await p.locator(".dice-room").getAttribute("data-layout"),
    "controller",
  );
  assert.equal(await tv.locator(".dice-pad").isVisible(), false);
  assert.equal(await tv.locator(".dice-player").count(), 2);
  // A press on either phone shows on the TV.
  const before = await tv.locator(".dice-die").getAttribute("aria-label");
  const deadline = Date.now() + smokeTimeout(30_000);
  while (!(await act(p)) && !(await act(h))) {
    assert.ok(Date.now() < deadline, "nobody got a turn");
    await p.waitForTimeout(100);
  }
  await tv.waitForFunction(
    (label) =>
      document.querySelector(".dice-die")?.getAttribute("aria-label") !== label,
    before,
    { timeout: smokeTimeout(10_000) },
  );
  await tv.screenshot({ path: `${shots}/dice-tv-${engine}.png` });
  await p.screenshot({ path: `${shots}/dice-controller-${engine}.png` });
  await fitsPhone(p, "controller");
  console.log(`${engine}: shared screen ${code} ok`);
  await host.close();
  await phone.close();
}

const browser = await launchSelected("chromium", { headless: true });
try {
  await twoPlayers(browser);
  await sharedScreen(browser);
  console.log(`dice smoke passed (${engine})`);
} finally {
  await browser.close();
}
