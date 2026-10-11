/**
 * Browser smoke for Fuse Axe against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-axe/preview/smoke.mjs http://localhost:PORT/ [screenshot-dir]
 *
 * 1. The landing page: the portal button first in the header, the keys on screen.
 * 2. Solo: the hero picker comes first; Rhea is picked, START sets out, and the hero walks right, jumps and swings;
 *    the HUD's empty seats never blink JOIN.
 * 3. Online: one page creates a room, a second joins by its code and picks Gorm, and a third joins; the rosters show
 *    it, the host starts, the guest walks and both pages draw its hero in the same place. Every page's HUD frames the
 *    three heroes in their seats' colours, an empty seat blinks JOIN, the canvas names the party in words, and the
 *    party walks on into the first wave's fight.
 * 4. A shared screen: the host switches it on in the lobby, a TV page joins with `display=1` and an emulated phone
 *    (Playwright's Pixel 7, landscape) picks Gorm; once the run starts the TV draws the game with its QR code, the
 *    phone shows only its controller, and a touch on the d-pad's right walks Gorm on the TV.
 * 5. Solo on the emulated phone: the pads sit over the game, and a touch on the d-pad walks the hero.
 * 6. A well-formed code for a room that does not exist shows the closed-room card.
 * Run by hand; not in CI. Screenshots go to the directory given, and nowhere else. Every page opens muted. Browser
 * emulation is not a physical phone.
 */
import { chromium, devices } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL, e.g. http://localhost:8787/");
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const snap = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
const PHONE = devices["Pixel 7 landscape"];
const open = async (
  path,
  options = { viewport: { width: 1280, height: 800 } },
) => {
  const context = await browser.newContext(options);
  // Counts the audio contexts the page makes (`window.audioContexts`): a page opened with `?mute` must make none.
  // Instruments only the constructor, which is what a page uses to make one.
  await context.addInitScript(() => {
    const Real = window.AudioContext;
    if (!Real) return;
    window.audioContexts = 0;
    window.AudioContext = class extends Real {
      constructor(...args) {
        super(...args);
        window.audioContexts++;
      }
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource/.test(message.text())
    )
      errors.push(message.text());
  });
  // The browser's own favicon probe is the one request allowed to miss.
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(base + path);
  return page;
};
const P1 = [0x2d, 0xe2, 0xff],
  P2 = [0xff, 0x4f, 0xa3],
  P3 = [0xb6, 0xff, 0x4d];
/**
 * Where a seat's marker (the chevron over its hero) is on the native 320 × 180 screen, from the scaled canvas; null if
 * not drawn. It is looked for below the HUD's strip (`HUD_H`, 22 rows), which wears the seats' colours too.
 */
const hero = (page, rgb) =>
  page.evaluate((rgb) => {
    const canvas = document.querySelector(".fa-canvas"),
      scale = canvas.width / 320,
      { data, width, height } = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height);
    let left = Infinity,
      top = Infinity;
    for (let y = 22 * scale; y < height; y += scale)
      for (let x = 0; x < width; x += scale) {
        const i = (y * width + x) * 4;
        if (
          data[i] === rgb[0] &&
          data[i + 1] === rgb[1] &&
          data[i + 2] === rgb[2]
        ) {
          left = Math.min(left, x / scale);
          top = Math.min(top, y / scale);
        }
      }
    return left === Infinity ? null : { x: left, y: top, scale };
  }, rgb);
/** The colour of one native pixel of the screen, as `[r, g, b]`. */
const pixel = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const canvas = document.querySelector(".fa-canvas"),
        scale = canvas.width / 320;
      const { data } = canvas
        .getContext("2d")
        .getImageData(x * scale, y * scale, 1, 1);
      return [data[0], data[1], data[2]];
    },
    [x, y],
  );
/** The HUD frames each seated hero's portrait in its seat's colour: P1's panel from x 0, P2's from x 64. */
const framed = async (page, seat, rgb) =>
  assert.deepEqual(
    await pixel(page, seat * 64 + 1, 10),
    rgb,
    `the HUD frames P${seat + 1}`,
  );
/**
 * The most native pixels of the rectangle [x, y, w, h] that were not the HUD strip's own colour in any frame over `ms`
 * (long enough to see a blinking label both ways): 0 for a panel with nothing written in it.
 */
const inked = (page, rect, ms) =>
  page.evaluate(
    async ([[x, y, w, h], ms]) => {
      const canvas = document.querySelector(".fa-canvas"),
        scale = canvas.width / 320,
        context = canvas.getContext("2d");
      let most = 0;
      for (const end = performance.now() + ms; performance.now() < end;) {
        let count = 0;
        for (let py = y; py < y + h; py++)
          for (let px = x; px < x + w; px++) {
            const { data } = context.getImageData(
              Math.floor((px + 0.5) * scale),
              Math.floor((py + 0.5) * scale),
              1,
              1,
            );
            if (data[0] !== 0x0b || data[1] !== 0x06 || data[2] !== 0x14)
              count++;
          }
        most = Math.max(most, count);
        await new Promise((done) => setTimeout(done, 50));
      }
      return most;
    },
    [rect, ms],
  );
/**
 * The white-hot pixels (the glowing yellow and white a swing's smear is drawn in) seen under and around the marker at
 * `at` over `ms`, reading every animation frame as the blade is out for a few steps only: the most in one frame that
 * were not in `known`, and every place any showed. The backdrop's fires flicker in the same colours, so a swing is
 * measured against the places seen while the hero stood still.
 */
const hot = (page, at, ms, known = []) =>
  page.evaluate(
    ([at, ms, known]) =>
      new Promise((done) => {
        const canvas = document.querySelector(".fa-canvas"),
          g = canvas.getContext("2d"),
          scale = canvas.width / 320,
          end = performance.now() + ms,
          skip = new Set(known),
          seen = new Set();
        let most = 0;
        const read = () => {
          const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
          let count = 0;
          for (let y = at.y; y < Math.min(180, at.y + 64); y++)
            for (
              let x = Math.max(0, at.x - 40);
              x < Math.min(320, at.x + 64);
              x++
            ) {
              const i = (y * scale * canvas.width + x * scale) * 4;
              const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
              if (rgb !== 0xfff6b8 && rgb !== 0xffffff) continue;
              seen.add(y * 320 + x);
              if (!skip.has(y * 320 + x)) count++;
            }
          most = Math.max(most, count);
          if (performance.now() < end) requestAnimationFrame(read);
          else done({ most, seen: [...seen] });
        };
        read();
      }),
    [at, ms, known],
  );
const hold = async (page, key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};
/**
 * A thumb on the right edge of the d-pad for `ms`, as real touch events (CDP), then `during(page)` before it lifts;
 * the d-pad must light its right arrow.
 */
const thumbRight = async (page, ms, during = async () => {}) => {
  const pad = await page.locator(".fa-dpad:visible").boundingBox(),
    cdp = await page.context().newCDPSession(page);
  const at = { x: pad.x + pad.width * 0.9, y: pad.y + pad.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [at],
  });
  await page.waitForTimeout(ms);
  assert.equal(
    await page.locator(".fa-dpad:visible").getAttribute("data-dir"),
    "right",
  );
  await during(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
};

/**
 * What is wrong with the pads' places on a phone in play, as words (none when all is well): a pad outside the screen,
 * over the HUD's strip (the canvas's top 22 of 180 rows) or under MENU, or a page wider than the screen.
 */
const padsFit = (page) =>
  page.evaluate(() => {
    const box = (selector) => {
      const shown = [...document.querySelectorAll(selector)].find(
        (e) => e.getBoundingClientRect().width > 0,
      );
      return shown?.getBoundingClientRect();
    };
    const meet = (a, b) =>
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;
    const problems = [],
      canvas = box(".fa-canvas"),
      menu = box(".fui-tools-toggle");
    if (document.documentElement.scrollWidth > innerWidth)
      problems.push("the page is wider than the screen");
    for (const selector of [".fa-dpad", ".fa-buttons"]) {
      const pad = box(selector);
      if (!pad) problems.push(`${selector} is not shown`);
      else {
        if (
          pad.left < 0 ||
          pad.top < 0 ||
          pad.right > innerWidth ||
          pad.bottom > innerHeight
        )
          problems.push(`${selector} is off the screen`);
        if (
          canvas &&
          meet(pad, {
            left: canvas.left,
            right: canvas.right,
            top: canvas.top,
            bottom: canvas.top + (canvas.height * 22) / 180,
          })
        )
          problems.push(`${selector} covers the HUD`);
        if (menu && meet(pad, menu)) problems.push(`${selector} is under MENU`);
      }
    }
    return problems;
  });

try {
  // ---- the landing page ----
  const landing = await open("fuse-axe/?mute");
  await landing.locator(".fui-landing").waitFor({ timeout: 15_000 });
  assert.equal(
    await landing.locator(".fa-top > .fui-portal:first-child").count(),
    1,
    "the portal leads the header",
  );
  // The portal lists Fuse Axe as the current game.
  await landing.locator(".fui-portal-toggle").click();
  assert.ok(
    await landing
      .locator(".fui-portal-game", { hasText: "Fuse Axe" })
      .isVisible(),
  );
  await snap(landing, "portal");
  await landing.keyboard.press("Escape");
  assert.match(await landing.locator(".fa-keys").textContent(), /J \/ Z/);
  await snap(landing, "landing");

  // ---- solo: pick a hero, set out, walk and jump ----
  await landing.getByRole("button", { name: "PLAY SOLO" }).click();
  await landing.waitForURL(/solo=1/);
  assert.ok(new URL(landing.url()).searchParams.has("mute"), "mute carries");
  await landing
    .locator('main[data-screen="lobby"]')
    .waitFor({ timeout: 15_000 });
  await landing.locator('[data-hero="rhea"]').click();
  await landing.locator('main[data-hero="rhea"]').waitFor({ timeout: 5_000 });
  await landing.getByRole("button", { name: "START" }).click();
  await landing.locator('main[data-screen="play"]').waitFor({ timeout: 5_000 });
  await landing.waitForTimeout(500);
  const before = await hero(landing, P1);
  assert.ok(before, "P1 is drawn");
  assert.ok(before.scale >= 2 && Number.isInteger(before.scale), "whole scale");
  await framed(landing, 0, P1);
  // Nobody joins a solo game, so its empty seats never blink JOIN: P2's name area stays blank.
  assert.equal(await inked(landing, [85, 2, 40, 16], 1_200), 0, "no JOIN solo");
  await hold(landing, "ArrowRight", 800);
  const walked = await hero(landing, P1);
  assert.ok(
    walked.x > before.x + 20,
    `walked right: ${before.x} → ${walked.x}`,
  );
  await landing.keyboard.down("KeyK");
  await landing.waitForTimeout(250);
  const jumped = await hero(landing, P1);
  await landing.keyboard.up("KeyK");
  assert.ok(jumped.y < walked.y - 10, `jumped: ${walked.y} → ${jumped.y}`);
  await landing.waitForTimeout(800);
  // J swings: the blade's white-hot smear sweeps round the hero while the swing lasts.
  const standing = await hero(landing, P1);
  const calm = await hot(landing, standing, 400);
  await landing.keyboard.down("KeyJ");
  const swung = await hot(landing, standing, 400, calm.seen);
  // The smallest strike frame has 27 of them; a few more than a stray spark or a late flicker.
  assert.ok(
    swung.most >= 15,
    `Attack swings a blade: ${swung.most} new white-hot pixels, ${calm.seen.length} while standing`,
  );
  await snap(landing, "solo-play");
  await landing.keyboard.up("KeyJ");
  // Sound is wired but silent: `?mute` plays nothing and greys out the toggles (never click them: they keep a choice),
  // while the page still hears its cues (GO, the jump, the landing, the swing). The keys pressed were gestures, yet no
  // audio context was made, so the stage's loop never started either.
  const room = landing.locator("main.fa-room");
  assert.equal(await room.getAttribute("data-audio"), "muted");
  assert.equal(
    await landing.evaluate(() => window.audioContexts),
    0,
    "?mute makes no audio context",
  );
  const heard = Number(await room.getAttribute("data-cues"));
  assert.ok(heard >= 3, `cues heard: ${heard}`);
  for (const name of ["♫ MUSIC OFF", "EFFECTS OFF"])
    assert.ok(await landing.getByRole("button", { name }).isDisabled(), name);
  console.log(
    `solo: Rhea walked ${walked.x - before.x}px, jumped ${walked.y - jumped.y}px and swung ${swung.most} white-hot pixels at ${before.scale}×; ${heard} cues heard, muted`,
  );
  await landing.context().close();

  // ---- online: create, join by code, pick, start, play ----
  const host = await open("fuse-axe/?mute");
  await host.getByRole("button", { name: "CREATE ROOM" }).click();
  await host.waitForURL(/room=[A-Z0-9]+/);
  const code = new URL(host.url()).searchParams.get("room");
  const enter = async (page, name) => {
    const input = page.locator(".fui-name-input").first();
    await input.waitFor({ timeout: 15_000 });
    await input.fill(name);
    await page.getByRole("button", { name: "JOIN", exact: true }).click();
  };
  await enter(host, "Host");
  const guest = await open(`fuse-axe/?room=${code}&mute`);
  await enter(guest, "Guest");
  await host.locator(".fui-roster-row").nth(1).waitFor({ timeout: 20_000 });
  // A third rider joins as Brakka, the host's hero, so the HUD shows a second Brakka in his own colours.
  const third = await open(`fuse-axe/?room=${code}&mute`);
  await enter(third, "Cy");
  await host.locator(".fui-roster-row").nth(2).waitFor({ timeout: 20_000 });
  await guest.locator('main[data-hero="brakka"]').waitFor({ timeout: 10_000 });
  await guest.locator('[data-hero="gorm"]').click();
  for (const page of [host, guest])
    await page
      .locator(".fui-roster-row", { hasText: "P2 · GORM" })
      .waitFor({ timeout: 10_000 });
  await snap(host, "online-lobby");
  await host.getByRole("button", { name: "START" }).click();
  for (const page of [host, guest, third])
    await page.locator('main[data-screen="play"]').waitFor({ timeout: 20_000 });
  await guest.waitForTimeout(500);
  await hold(guest, "KeyD", 700);
  await guest.waitForTimeout(1_000);
  const [onHost, onGuest] = await Promise.all(
    [host, guest].map((page) => hero(page, P2)),
  );
  assert.ok(onHost && onGuest, "both pages draw P2");
  assert.deepEqual(
    [onHost.x, onHost.y],
    [onGuest.x, onGuest.y],
    "both pages put P2 in the same place",
  );
  assert.ok(onGuest.x > 50, `P2 walked: ${onGuest.x}`);
  await snap(host, "online-host");
  await snap(guest, "online-guest");
  console.log(`online ${code}: Gorm picked, walked to x ${onGuest.x} on both`);
  // The HUD frames every seated hero's portrait in its seat's colour, on every page.
  for (const page of [host, guest, third])
    for (const [seat, rgb] of [P1, P2, P3].entries())
      await framed(page, seat, rgb);
  // The empty fourth seat invites a player (JOIN blinks in its name area); and the canvas names the party in words.
  assert.ok((await inked(host, [213, 2, 40, 16], 1_200)) > 0, "JOIN in a room");
  for (const page of [host, guest, third])
    assert.match(
      (await page.locator(".fa-canvas").getAttribute("aria-label")) ?? "",
      /P1 Host.*P2 Guest.*GORM.*P3 Cy.*BRAKKA/,
      "the canvas names the party",
    );
  // A fight: all three walk on to the first wave and meet its ravagers, then swing.
  await Promise.all(
    [
      [host, "ArrowRight"],
      [guest, "KeyD"],
      [third, "ArrowRight"],
    ].map(([page, key]) => hold(page, key, 6_000)),
  );
  await host.waitForTimeout(2_500);
  await snap(host, "online-fight");
  for (let i = 0; i < 8; i++) {
    await Promise.all(
      [host, guest, third].map((page) => page.keyboard.press("KeyJ")),
    );
    await host.waitForTimeout(200);
  }
  await snap(host, "online-fight-swing");
  console.log("online: every page's HUD frames P1–P3, through a fight");
  for (const page of [host, guest, third]) await page.context().close();

  // ---- a shared screen: the TV draws the game, an emulated phone is the controller ----
  const lead = await open("fuse-axe/?mute");
  await lead.getByRole("button", { name: "CREATE ROOM" }).click();
  await lead.waitForURL(/room=[A-Z0-9]+/);
  const shared = new URL(lead.url()).searchParams.get("room");
  await enter(lead, "Host");
  await lead.locator(".fa-share input").check();
  await lead.getByRole("button", { name: "OPEN TV SCREEN" }).waitFor();
  assert.equal(
    await lead.evaluate(() => localStorage.getItem("fuse-axe-shared-screen")),
    "1",
    "the host's choice is kept once the room has taken it",
  );
  const tv = await open(`fuse-axe/?room=${shared}&display=1&mute`, {
    viewport: { width: 1280, height: 720 },
  });
  const phone = await open(`fuse-axe/?room=${shared}&mute`, PHONE);
  await enter(phone, "Phone");
  await phone.locator('main[data-hero="brakka"]').waitFor({ timeout: 15_000 });
  await phone.locator('[data-hero="gorm"]').click();
  await tv
    .locator(".fui-roster-row", { hasText: "P2 · GORM" })
    .waitFor({ timeout: 15_000 });
  // A second phone, held upright: its controller shares the width between the pads.
  const upright = await open(
    `fuse-axe/?room=${shared}&mute`,
    devices["Pixel 7"],
  );
  await enter(upright, "Upright");
  await tv.locator(".fui-roster-row").nth(2).waitFor({ timeout: 15_000 });
  await lead.getByRole("button", { name: "START" }).click();
  await tv.locator('main[data-screen="play"]').waitFor({ timeout: 20_000 });
  for (const page of [lead, phone, upright])
    await page
      .locator('main[data-screen="controller"]')
      .waitFor({ timeout: 20_000 });
  for (const [page, how] of [
    [phone, "landscape"],
    [upright, "upright"],
  ])
    assert.deepEqual(
      await padsFit(page),
      [],
      `the controller's pads fit, ${how}`,
    );
  if (shots)
    await upright.screenshot({
      path: join(shots, "shared-phone-upright.png"),
      scale: "css",
    });
  assert.ok(await tv.locator(".fa-tv-qr").isVisible(), "the TV's QR code");
  assert.match(
    await tv.locator(".fa-tv-qr").getAttribute("src"),
    /^data:image\//,
    "the QR code is drawn",
  );
  // The TV is no member of the room: it keeps no token for it, neither the host's nor a joiner's.
  assert.deepEqual(
    await tv.evaluate(() =>
      Object.keys(localStorage).filter((key) => /-(room|peer)-/.test(key)),
    ),
    [],
    "the TV stores no room token",
  );
  // The host's controller (a desktop page here, its header showing) can still call the room back to the lobby.
  assert.ok(
    await lead.locator(".fa-to-lobby").isVisible(),
    "the host's controller offers the lobby",
  );
  assert.equal(await phone.locator(".fa-to-lobby").isVisible(), false);
  assert.equal(await phone.locator(".fa-canvas").isVisible(), false);
  assert.match(
    await phone.locator(".fa-controller-head").textContent(),
    /P2 · Phone.*GORM/,
  );
  await tv.waitForTimeout(800);
  const parked = await hero(tv, P2);
  await thumbRight(phone, 800, async (page) => {
    if (shots)
      await page.screenshot({
        path: join(shots, "shared-phone.png"),
        scale: "css",
      });
  });
  await tv.waitForTimeout(600);
  const moved = await hero(tv, P2);
  assert.ok(
    moved.x > parked.x + 15,
    `the phone's d-pad walks P2 on the TV: ${parked.x} → ${moved.x}`,
  );
  await snap(tv, "shared-tv");
  console.log(
    `shared screen ${shared}: the phone's d-pad walked Gorm from x ${parked.x} to ${moved.x} on the TV`,
  );
  for (const page of [lead, tv, phone, upright]) await page.context().close();

  // ---- solo on the emulated phone: the pads over the game ----
  const thumb = await open("fuse-axe/?solo=1&mute", PHONE);
  await thumb.locator('main[data-screen="lobby"]').waitFor({ timeout: 15_000 });
  await thumb.getByRole("button", { name: "START" }).click();
  await thumb.locator(".fa-touch .fa-dpad").waitFor({ timeout: 10_000 });
  await thumb.waitForTimeout(500);
  const resting = await hero(thumb, P1);
  await thumbRight(thumb, 700);
  const stepped = await hero(thumb, P1);
  assert.ok(
    stepped.x > resting.x + 10,
    `the pad walks: ${resting.x} → ${stepped.x}`,
  );
  if (shots)
    await thumb.screenshot({
      path: join(shots, "solo-phone.png"),
      scale: "css",
    });
  console.log(`solo phone: the d-pad walked ${stepped.x - resting.x}px`);
  assert.deepEqual(await padsFit(thumb), [], "the pads fit (landscape)");
  // The pads leave the screen under a thumb that stays down (the host calls the lobby): the pad lets go as it goes (the
  // phone layout clears the controls), the thumb's later moves steer nothing, and the next run starts with the hero
  // standing still.
  const pad = await thumb.locator(".fa-dpad:visible").boundingBox(),
    cdp = await thumb.context().newCDPSession(thumb),
    onPad = (x) => ({ x: pad.x + pad.width * x, y: pad.y + pad.height / 2 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [onPad(0.9)],
  });
  await thumb.waitForTimeout(300);
  assert.equal(
    await thumb.locator(".fa-dpad:visible").getAttribute("data-dir"),
    "right",
  );
  await thumb.evaluate(() => document.querySelector(".fa-to-lobby").click());
  await thumb.locator('main[data-screen="lobby"]').waitFor({ timeout: 5_000 });
  assert.equal(
    await thumb.locator(".fa-dpad").getAttribute("data-dir"),
    "",
    "the d-pad let go as it left",
  );
  await thumb.getByRole("button", { name: "START" }).click();
  await thumb.locator(".fa-touch .fa-dpad").waitFor({ timeout: 10_000 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [onPad(0.1)],
  });
  await thumb.waitForTimeout(500);
  const atRest = await hero(thumb, P1);
  await thumb.waitForTimeout(700);
  const stood = await hero(thumb, P1);
  assert.equal(
    await thumb.locator(".fa-dpad:visible").getAttribute("data-dir"),
    "",
    "a thumb that was let go steers no more",
  );
  assert.ok(
    Math.abs(stood.x - atRest.x) < 3,
    `the hero stands still: ${atRest.x} → ${stood.x}`,
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await thumb.context().close();
  // Upright and on a small screen: the pads fit, clear of the HUD and of MENU.
  for (const [name, device] of [
    ["Pixel 7", devices["Pixel 7"]],
    ["iPhone SE", devices["iPhone SE"]],
    ["iPhone SE landscape", devices["iPhone SE landscape"]],
  ]) {
    const small = await open("fuse-axe/?solo=1&mute", device);
    await small
      .locator('main[data-screen="lobby"]')
      .waitFor({ timeout: 15_000 });
    await small.getByRole("button", { name: "START" }).click();
    await small.locator(".fa-touch .fa-dpad").waitFor({ timeout: 10_000 });
    await small.waitForTimeout(500);
    assert.deepEqual(await padsFit(small), [], `the pads fit on ${name}`);
    if (shots && name === "Pixel 7")
      await small.screenshot({
        path: join(shots, "solo-phone-upright.png"),
        scale: "css",
      });
    await small.context().close();
  }

  // ---- a room that does not exist ----
  const nowhere = await open("fuse-axe/?room=ZZ99&mute");
  await nowhere.locator(".fa-closed").waitFor({ timeout: 20_000 });
  assert.equal(
    await nowhere.getByRole("button", { name: "START" }).isVisible(),
    false,
  );
  console.log("a missing room shows the closed-room card");
  await nowhere.context().close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("fuse-axe smoke: ok");
} finally {
  await browser.close();
}
