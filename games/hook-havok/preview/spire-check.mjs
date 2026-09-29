import { chromium } from "playwright";
import assert from "node:assert/strict";

/**
 * Neon Spire (12A–12B) in real rooms: create a room, pick Neon Spire, and play
 * the zones with ordinary keyboard input — a lift ride, a low-gravity jump, a
 * pad launch, a drop into the electrified floor, a laser sweep — then Follow
 * keepers, a phone guest in landscape, the zone switches and, with `sudden`,
 * a Hook score round's rising floor. No world state is injected.
 *
 *   node games/hook-havok/preview/spire-check.mjs http://localhost:PORT/ [evidence prefix] [sudden]
 */
const base = process.argv[2];
const evidence = process.argv[3] ?? "games/hook-havok/docs/evidence/neon-spire";
const sudden = process.argv.includes("sudden");
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
const started = Date.now();
const step = (name) =>
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s ${name}`);
const scene = (page, key) =>
  page.evaluate((key) => document.querySelector("#scene").dataset[key], key);
const json = async (page, key) =>
  JSON.parse((await scene(page, key)) || "null");
/** Hold keys for `ms`, sampling the local keeper's feet; returns the samples. */
async function hold(page, keys, ms, slot) {
  await page.locator("#scene").focus();
  for (const k of keys) await page.keyboard.down(k);
  const samples = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const k = (await json(page, "keepers")).find((k) => k.slot === slot);
    samples.push(k);
    await page.waitForTimeout(40);
  }
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  return samples;
}
/** A guest is seated once its status says so (hidden in phone landscape). */
async function joined(page) {
  try {
    await page
      .locator('#status[data-state="playing"]')
      .waitFor({ state: "attached", timeout: 60000 });
  } catch (error) {
    console.error(
      await page.evaluate(() => document.querySelector("#status").textContent),
    );
    throw error;
  }
}
const keeperAt = async (page, slot) =>
  (await json(page, "keepers")).find((k) => k.slot === slot);
/** Hold a key until the keeper in `slot` (as `watch` sees it) meets `done`. */
async function walkUntil(page, watch, key, slot, done, ms = 4000) {
  await page.locator("#scene").focus();
  await page.keyboard.down(key);
  const until = Date.now() + ms;
  let k;
  while (Date.now() < until && !done((k = await keeperAt(watch, slot))))
    await page.waitForTimeout(16);
  await page.keyboard.up(key);
  return k;
}
/** Steer the keeper in `slot` towards x with A and D, sampling it; returns the samples. */
async function steer(page, watch, slot, x, ms) {
  await page.locator("#scene").focus();
  let held = "";
  const samples = [];
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const k = await keeperAt(watch, slot),
      now = Date.now();
    samples.push({ ...k, at: now });
    // Input reaches the fold a few ticks late: steer on where it is heading.
    const old = samples.find((p) => now - p.at < 200) ?? k,
      v = old.at && now > old.at ? ((k.x - old.x) * 1000) / (now - old.at) : 0,
      ahead = k.x + v * 0.3;
    const want = ahead > x + 10 ? "KeyA" : ahead < x - 10 ? "KeyD" : "";
    if (want !== held) {
      if (held) await page.keyboard.up(held);
      if (want) await page.keyboard.down(want);
      held = want;
    }
    await page.waitForTimeout(16);
  }
  if (held) await page.keyboard.up(held);
  return samples;
}
/** Wait until laser gate `i` is idle with at least 3 s before its telegraph. */
const quietGate = (page, i) =>
  page.waitForFunction(
    (i) => {
      const l = JSON.parse(document.querySelector("#scene").dataset.zones)
        .lasers[i];
      return l.phase === "idle" && l.progress < 0.45;
    },
    i,
    { timeout: 10000, polling: 16 },
  );
async function rafSample(page, ms = 3000) {
  return page.evaluate(async (ms) => {
    const gaps = [];
    let last = performance.now();
    const end = last + ms;
    await new Promise((done) => {
      const tick = (now) => {
        gaps.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    const at = (p) =>
      gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))];
    return { frames: gaps.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  }, ms);
}
try {
  const make = async (url, viewport, phone = false) => {
    const page = await browser.newPage({
      viewport,
      ...(phone ? { isMobile: true, hasTouch: true } : {}),
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    return page;
  };
  const host = await make(base + "hook-havok/?mute", {
    width: 1920,
    height: 1080,
  });
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  await host.locator("#experiment").selectOption("movement");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.experiment === "movement",
  );
  step("host playing");
  const crossroads = await rafSample(host);
  // Room & match → Arena → Neon Spire.
  await host.locator("#map").selectOption("spire");
  await host.waitForFunction(() => {
    const s = document.querySelector("#scene");
    return (
      s.dataset.map === "spire" &&
      JSON.parse(s.dataset.terrain).length === 19 &&
      JSON.parse(s.dataset.camera).zoom < 0.72
    );
  });
  assert.equal(await host.locator("#match-map").textContent(), "NEON SPIRE");
  const camera = await json(host, "camera");
  assert.deepEqual(
    { x: camera.x, y: camera.y, zoom: camera.zoom },
    { x: 1120, y: 630, zoom: 0.714 },
    "the whole 2240 × 1260 arena is fitted",
  );
  const zones = await json(host, "zones");
  assert.equal(zones.pads.length, 2);
  assert.equal(zones.lifts.length, 2);
  assert.equal(zones.lasers.length, 2);
  assert.ok(zones.floor && zones.bonus);
  step("spire fitted");
  const spire = await rafSample(host);
  // Follow keepers, alone: one keeper frames at zoom 1 (1600 × 900 units).
  await host.locator("#follow-cam").check();
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.camera).zoom > 0.99,
    null,
    { timeout: 5000 },
  );
  await host.locator("#follow-cam").uncheck();
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.camera).zoom < 0.72,
    null,
    { timeout: 5000 },
  );
  const invite = await host.locator("#invite-url").inputValue();
  const low = await make(invite, { width: 1280, height: 800 });
  step("guests joining");
  await joined(low);
  const pad = await make(invite, { width: 1280, height: 800 });
  await joined(pad);
  const phone = await make(invite, { width: 844, height: 390 }, true);
  await joined(phone);
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).length === 4,
  );
  step("four keepers");
  await host.waitForTimeout(800);
  // Slot 0: walk right off the left mid tier into the left lift beam and
  // steer to stay in it (remote input lags, so it wobbles out and back): it
  // rises above the tier it walked off without a jump.
  await walkUntil(host, host, "KeyD", 0, (k) => k.x >= 600);
  const ride = await steer(host, host, 0, 660, 2600);
  const top = Math.min(...ride.map((k) => k.feet));
  assert.ok(
    top < 720,
    `the lift raised slot 0 above the tier it walked off (feet ${top}): ${ride
      .filter((_, i) => i % 5 === 0)
      .map((k) => `${Math.round(k.x)},${Math.round(k.feet)}`)
      .join(" ")}`,
  );
  step("lift ridden");
  // Slot 1: step out from under the right overhang, then jump in the
  // low-gravity wing: about 2.5× a normal jump.
  await walkUntil(low, host, "KeyA", 1, (k) => k.x < 1820);
  await low.waitForTimeout(500);
  const start1 = (await keeperAt(host, 1)).feet;
  const jump = await hold(low, ["Space"], 1600, 1);
  const rise = start1 - Math.min(...jump.map((k) => k.feet));
  assert.ok(rise > 330, `low-gravity jump rose ${rise}`);
  await low.waitForTimeout(800);
  step("low gravity");
  // Slot 2: with the lower laser idle, drop from the catwalk to the bottom
  // deck and walk left onto a pad.
  await quietGate(host, 1);
  await hold(pad, ["ArrowDown", "Space"], 250, 2);
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).find(
        (k) => k.slot === 2,
      ).feet > 1100,
    null,
    { timeout: 3000 },
  );
  await pad.waitForTimeout(300);
  const deck = await keeperAt(host, 2);
  assert.ok(
    Math.abs(deck.feet - 1110) < 2,
    `on the bottom deck (${deck.feet})`,
  );
  const launch = await hold(pad, ["KeyA"], 900, 2);
  const apex = Math.min(...launch.map((k) => k.feet));
  assert.ok(apex < 760, `pad launched slot 2 to feet ${apex}`);
  step("pad launched");
  await host.locator("#scene").screenshot({ path: `${evidence}-desktop.png` });
  // A laser sweep on screen: the lower gate early in its live half second.
  const box = await host.locator("#scene").boundingBox();
  await host.waitForFunction(
    () => {
      const l = JSON.parse(document.querySelector("#scene").dataset.zones)
        .lasers[1];
      return l.phase === "live" && l.progress > 0.2 && l.progress < 0.6;
    },
    null,
    { timeout: 10000, polling: 16 },
  );
  await host.screenshot({ path: `${evidence}-laser.png`, clip: box });
  // The phone guest (slot 3) in landscape, touch controls on.
  await phone
    .locator("#touch-toggle")
    .check()
    .catch(() => {});
  await phone.getByRole("button", { name: "Focus arena" }).click();
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: `${evidence}-phone.png` });
  assert.ok(await keeperAt(host, 3), "phone guest seated");
  // Slot 1 drops through the right mid tier and then the right deck into the
  // electrified floor: a hazard knockout in the feed.
  // Knockout events last half a second in the state; the tally keeps it.
  let zapped;
  for (let i = 0; i < 6 && !zapped; i++) {
    await hold(low, ["ArrowDown", "Space"], 200, 1);
    await low.waitForTimeout(1300);
    const k = await keeperAt(host, 1);
    if (k.tally.zapped) zapped = k.tally;
  }
  assert.ok(zapped, "a hazard knockout");
  step("zapped");
  const feed = await host.locator("#knockout-feed").textContent();
  assert.match(feed, /⚡/);
  // Follow keepers with everyone in: a local zoom only.
  await host.locator("#follow-cam").check();
  await host.waitForTimeout(1500);
  const followed = await json(host, "camera");
  assert.ok(followed.follow && followed.zoom >= 0.714 && followed.zoom <= 1);
  assert.ok((await json(low, "camera")).zoom < 0.72, "a guest keeps the fit");
  await host.locator("#scene").screenshot({ path: `${evidence}-follow.png` });
  await host.locator("#follow-cam").uncheck();
  // Zone switches (Development workshop) are shared settings; guests follow.
  await host.evaluate(() => {
    document.querySelector("#development-workshop").open = true;
  });
  await host.locator("#zone-lasers").scrollIntoViewIfNeeded();
  await host.screenshot({ path: `${evidence}-zones-panel.png` });
  await host.locator("#zone-lasers").uncheck();
  await low.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.zones).lasers
        .length === 0,
  );
  assert.equal(await low.locator("#zone-lasers").isChecked(), false);
  assert.equal(await low.locator("#zone-lasers").isDisabled(), true);
  await host.locator("#zone-lasers").check();
  await low.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.zones).lasers
        .length === 2,
  );
  if (sudden) {
    await host.locator("#rules").selectOption("score");
    let rising = false;
    for (let i = 0; i < 40 && !rising; i++) {
      await host.waitForTimeout(2000);
      const c = await json(host, "contest"),
        f = (await json(host, "zones")).floor;
      step(`round ${c?.phase} ${c?.seconds}s, floor ${f?.y}`);
      rising = !!f?.rising;
    }
    assert.ok(rising, "the floor rises in the last 20 s");
    await host.waitForTimeout(9000);
    await host
      .locator("#scene")
      .screenshot({ path: `${evidence}-sudden-death.png` });
    const floor = (await json(host, "zones")).floor;
    assert.ok(floor.y < floor.base - 100, `floor risen to ${floor.y}`);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      lift: top,
      lowGravityRise: rise,
      padApex: apex,
      hazard: zapped,
      frames: { crossroads, spire },
    }),
  );
} finally {
  await browser.close();
}
