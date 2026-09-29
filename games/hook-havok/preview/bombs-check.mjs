import { chromium } from "playwright";
import assert from "node:assert/strict";
// 11A–11B real-room smoke: short and full keyboard throws, the arc preview,
// cooldown, a self-knockout, a right-click bomb and a touch bomb button.
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const evidence = (name) => `games/hook-havok/docs/evidence/${name}.png`;
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
try {
  const errors = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "hook-havok/?mute");
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const scene = page.locator("#scene");
  const data = () => scene.evaluate((e) => ({ ...e.dataset }));
  const me = async () => {
    const d = await data();
    return JSON.parse(d.keepers).find((k) => k.id === d.playerId);
  };
  const ticks = async (n) => {
    const tick = Number((await data()).tick);
    await page.waitForFunction(
      (t) => Number(document.querySelector("#scene").dataset.tick) >= t,
      tick + n,
    );
  };
  assert.equal(await page.locator("#bomb-mode").inputValue(), "fuse");
  assert.equal(await page.locator("#wire-mode").inputValue(), "spiked");
  assert.equal((await data()).bombMode, "fuse");
  // The Belfry's wide starting terrace catches both a short and a full throw.
  await page.locator("#map").selectOption("belfry");
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.map === "belfry",
  );
  await scene.scrollIntoViewIfNeeded();
  await scene.focus();
  await ticks(40); // spawn protection over, standing on the start ledge

  // A throw's range: how far from the keeper it first lands.
  const landing = async () => {
    await page.waitForFunction(
      () => JSON.parse(document.querySelector("#scene").dataset.bombs).length,
    );
    const start = Number((await data()).actorX);
    let falling = false;
    for (;;) {
      const [bomb] = JSON.parse((await data()).bombs);
      assert.ok(bomb, "the bomb lands before it goes off");
      if (bomb.vy > 0) falling = true;
      else if (falling) return Math.abs(bomb.x - start);
      await page.waitForTimeout(16);
    }
  };
  // Aim right (D is retained once released), then tap K: a short throw.
  await page.keyboard.press("d");
  await page.keyboard.press("k");
  const short = await landing();
  const cooling = await me();
  assert.ok(
    cooling.cooldown > 0.8,
    `cooldown after the throw ${cooling.cooldown}`,
  );
  assert.equal(cooling.tally.thrown, 1);
  // Held during the cooldown: nothing charges.
  await page.keyboard.down("k");
  await ticks(20);
  assert.equal((await me()).charge, 0, "no charge while recharging");
  await page.keyboard.up("k");
  await page.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return (
      JSON.parse(d.keepers).find((k) => k.id === d.playerId).cooldown === 0
    );
  });
  await page.waitForFunction(
    () => !JSON.parse(document.querySelector("#scene").dataset.bombs).length,
  );
  // Full charge along the same aim, standing still: the arc shows while charging.
  await page.keyboard.down("k");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.charge) >= 1,
  );
  await scene.screenshot({ path: evidence("bombs-charge-arc") });
  await page.keyboard.up("k");
  const full = await landing();
  // Level from the chest the ranges scale with speed: 950 / 450.
  assert.ok(full > short * 1.7, `full ${full} vs short ${short}`);
  console.log(
    `PASS keyboard throws: tap ${short.toFixed(0)} u, full ${full.toFixed(0)} u; cooldown ring and no charge while recharging`,
  );

  // Self-knockout: throw straight down at your own feet.
  await page.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return (
      JSON.parse(d.keepers).find((k) => k.id === d.playerId).cooldown === 0 &&
      !JSON.parse(d.bombs).length
    );
  });
  await page.keyboard.down("s");
  await page.keyboard.press("k");
  await page.keyboard.up("s");
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.bombs)[0]?.fuse <= 24,
  );
  await scene.screenshot({ path: evidence("bombs-fuse-ring") });
  await page.waitForFunction(
    () => JSON.parse(document.querySelector("#scene").dataset.blasts).length,
  );
  await page.waitForTimeout(60);
  await scene.screenshot({ path: evidence("bombs-blast") });
  const down = await me();
  assert.equal(down.tally.selfKnockouts, 1);
  assert.equal(down.tally.fate, "self");
  assert.ok(down.respawn > 0, "knocked out by their own bomb");
  assert.ok(await page.locator("#knockout-feed li").count());
  await page.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return JSON.parse(d.keepers).find((k) => k.id === d.playerId).respawn === 0;
  });
  const back = await me();
  assert.ok(back.shield > 40, `a second of protection, ${back.shield}`);
  console.log(
    "PASS self-knockout, fuse ring, blast, feed and 1 s return with protection",
  );

  // A diagonal charge whose keys lift one at a time still throws diagonally,
  // up and to the right against the ledge above the terrace.
  await page.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return (
      JSON.parse(d.keepers).find((k) => k.id === d.playerId).cooldown === 0 &&
      !JSON.parse(d.bombs).length
    );
  });
  await page.keyboard.down("w");
  await page.keyboard.down("d");
  await page.keyboard.down("k");
  await page.waitForTimeout(120);
  await page.keyboard.up("d");
  await page.waitForTimeout(20);
  await page.keyboard.up("k");
  await page.keyboard.up("w");
  await page.waitForFunction(
    () => JSON.parse(document.querySelector("#scene").dataset.bombs).length,
  );
  const diagonal = JSON.parse((await data()).bombs)[0];
  // Straight up would carry only half the walk (at most 180 units/s)
  // sideways; a diagonal keeps over 300 even after a ceiling bounce.
  assert.ok(diagonal.vx > 250, `diagonal throw, vx ${diagonal.vx}`);
  await page.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return (
      !JSON.parse(d.bombs).length &&
      JSON.parse(d.keepers).find((k) => k.id === d.playerId).respawn === 0
    );
  });
  console.log("PASS a diagonal keeps its aim while its keys are lifted");

  // Right click in the classic mouse scheme, with no context menu.
  await page.locator("#keyboard-mode").selectOption("mouse");
  await scene.scrollIntoViewIfNeeded();
  const prevented = page.evaluate(
    () =>
      new Promise((resolve) =>
        document
          .querySelector("#scene")
          .addEventListener("contextmenu", (e) => resolve(e.defaultPrevented), {
            once: true,
          }),
      ),
  );
  await page.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return (
      JSON.parse(d.keepers).find((k) => k.id === d.playerId).cooldown === 0
    );
  });
  const box = await page.locator("#scene canvas").boundingBox();
  const at = (x, y) => [
    box.x + (x / 1600) * box.width,
    box.y + (y / 900) * box.height,
  ];
  // Step out from under the lower-left ledge, then charge up and to the right.
  await page.keyboard.down("d");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.actorX) > 450,
  );
  await page.keyboard.up("d");
  await ticks(6);
  const self = await me();
  await page.mouse.move(...at(self.x + 300, self.feet - 330));
  await page.mouse.down({ button: "right" });
  await ticks(12);
  assert.ok((await me()).charge > 0, "right button charges");
  assert.equal((await data()).hook, "ready", "a right click never hooks");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.charge) >= 1,
  );
  await scene.screenshot({ path: evidence("bombs-mouse-arc") });
  await page.mouse.up({ button: "right" });
  assert.equal(await prevented, true, "context menu suppressed");
  await page.waitForFunction(
    () => JSON.parse(document.querySelector("#scene").dataset.bombs).length,
  );
  const thrown = JSON.parse((await data()).bombs)[0];
  assert.ok(thrown.vx > 0 && thrown.vy < 0, "thrown toward the pointer");
  await page.waitForTimeout(260);
  await scene.screenshot({ path: evidence("bombs-flight") });
  assert.equal((await data()).hook, "ready");
  assert.equal((await me()).tally.thrown, 5);
  console.log(
    "PASS right-click bomb toward the pointer, context menu suppressed",
  );

  // Touch: the bomb button throws along the aim pad's last direction.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const guest = await phone.newPage(),
    cdp = await phone.newCDPSession(guest);
  guest.on("pageerror", (e) => errors.push(e.message));
  await guest.goto(await page.locator("#invite-url").inputValue());
  await guest.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await guest.locator("#touch-toggle").isChecked(), true);
  const guestData = () =>
    guest.locator("#scene").evaluate((e) => ({ ...e.dataset }));
  const guestMe = async () => {
    const d = await guestData();
    return JSON.parse(d.keepers).find((k) => k.id === d.playerId);
  };
  await guest.waitForTimeout(800);
  await guest.locator("#touch-deck").scrollIntoViewIfNeeded();
  assert.ok(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "three touch controls fit a phone width",
  );
  const pad = async (name) =>
    guest.locator(`[data-pad="${name}"]`).boundingBox();
  const point = (id, b, x = 0, y = 0) => ({
    id,
    x: b.x + (b.width / 2) * (1 + x),
    y: b.y + (b.height / 2) * (1 + y),
    radiusX: 5,
    radiusY: 5,
    force: 1,
  });
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const aimPad = await pad("aim"),
    bombPad = await pad("bomb");
  const canvas = await guest.locator("#scene canvas").boundingBox();
  assert.ok(
    bombPad.x >= canvas.x + canvas.width - 2 ||
      bombPad.y >= canvas.y + canvas.height - 2,
    "bomb button outside the arena",
  );
  // Aim once to the left (up-left), release, then hold and release the bomb.
  await touch("touchStart", [point(1, aimPad)]);
  await touch("touchMove", [point(1, aimPad, -0.7, -0.7)]);
  await touch("touchEnd", [point(1, aimPad, -0.7, -0.7)]);
  // Let the hook come back and the keeper settle, so no swing carries the throw.
  await guest.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return d.hook === "ready" && d.grounded === "true";
  });
  await touch("touchStart", [point(2, bombPad)]);
  await guest.waitForFunction(
    () => document.querySelector("#touch-deck").dataset.bomb === "true",
  );
  await guest.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.charge) > 0.3,
  );
  await guest.screenshot({ path: evidence("bombs-touch"), fullPage: false });
  await touch("touchEnd", [point(2, bombPad)]);
  await guest.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return JSON.parse(d.bombs).some((b) => b.owner === d.playerId);
  });
  const touched = await guestData();
  const bomb = JSON.parse(touched.bombs).find(
    (b) => b.owner === touched.playerId,
  );
  assert.ok(bomb.vx < 0 && bomb.vy < 0, "thrown up-left along the last aim");
  assert.equal((await guestMe()).tally.thrown, 1);
  console.log(
    "PASS touch bomb button: hold to charge, release along the aim pad direction",
  );

  // Narrow and short phones: nothing scrolls sideways, and no control covers
  // another or the arena, with the room's controls shown or the arena focused.
  for (const viewport of [
    { width: 360, height: 740 },
    { width: 740, height: 360 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const phonePage = await context.newPage();
    phonePage.on("pageerror", (e) => errors.push(e.message));
    await phonePage.goto(await page.locator("#invite-url").inputValue());
    await phonePage.locator('#status[data-state="playing"]').waitFor();
    for (const focused of [false, true]) {
      if (focused) await phonePage.locator("#arena-focus").click();
      await phonePage.waitForTimeout(200);
      const layout = await phonePage.evaluate(() => {
        const box = (selector) => {
          const b = document.querySelector(selector).getBoundingClientRect();
          return {
            selector,
            left: b.left,
            top: b.top,
            right: b.right,
            bottom: b.bottom,
          };
        };
        return {
          scroll: document.documentElement.scrollWidth,
          width: innerWidth,
          boxes: [
            box("#scene canvas"),
            box('[data-pad="move"]'),
            box('[data-pad="bomb"]'),
            box('[data-pad="aim"]'),
          ],
        };
      });
      const name = `${viewport.width}×${viewport.height}${focused ? " focused" : ""}`;
      assert.ok(
        layout.scroll <= layout.width,
        `${name}: no sideways scroll (${layout.scroll} > ${layout.width})`,
      );
      for (const [i, a] of layout.boxes.entries())
        for (const b of layout.boxes.slice(i + 1))
          assert.ok(
            a.right <= b.left ||
              b.right <= a.left ||
              a.bottom <= b.top ||
              b.bottom <= a.top,
            `${name}: ${a.selector} overlaps ${b.selector}`,
          );
    }
    await context.close();
  }
  console.log(
    "PASS 360×740 and 740×360: no sideways scroll, pads and arena apart",
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
