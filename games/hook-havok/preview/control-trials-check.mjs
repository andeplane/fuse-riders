import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const errors = [];
  const make = async (url) => {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
    });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    return p;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#menu-settings").click();
  await host.locator("#keyboard-mode").selectOption("keyboard");
  await host.locator("#entrance-settings .dialog-close").click();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const guest = await make(await host.locator("#invite-url").inputValue());
  await guest.locator('#status[data-state="playing"]').waitFor();
  const state = (p) => p.locator("#scene").evaluate((e) => ({ ...e.dataset }));
  const ticks = async (n) => {
    const tick = Number((await state(host)).tick);
    await host.waitForFunction(
      (t) => Number(document.querySelector("#scene").dataset.tick) >= t,
      tick + n,
    );
  };
  await host.locator("#jump-mode").selectOption("double");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.airJump === "true",
  );
  await guest.waitForFunction(
    () => document.querySelector("#jump-mode").value === "double",
  );
  assert.equal(await guest.locator("#jump-mode").isDisabled(), true);
  await ticks(12);
  await host.locator("#scene").focus();
  await host.keyboard.down("j");
  await ticks(12);
  await host.keyboard.up("j");
  await ticks(3);
  assert.equal((await state(host)).airJump, "true");
  await host.keyboard.down("j");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.airJump === "false",
  );
  const secondFeet = Number((await state(host)).feet);
  await ticks(7);
  assert.ok(Number((await state(host)).feet) < secondFeet - 20);
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/controls-air-jump.png",
    fullPage: true,
  });
  await host.keyboard.up("j");
  const restart = async () => {
    const round = (await state(host)).round;
    await host.locator("#restart-room").click();
    await host.waitForFunction(
      (r) => document.querySelector("#scene").dataset.round !== r,
      round,
    );
    await ticks(12);
  };
  await restart();
  await host.locator("#scene").focus();
  await host.keyboard.down("s");
  await ticks(8);
  assert.equal(
    (await state(host)).grounded,
    "true",
    "down aims without dropping",
  );
  await host.keyboard.down("Shift");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.grounded === "false",
  );
  await host.keyboard.up("s");
  await host.keyboard.up("Shift");
  await host.keyboard.down("j");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.airJump === "false",
  );
  await host.keyboard.up("j");
  console.log(
    "PASS J double jump, hold/release and down-aim versus deliberate drop with air recovery",
  );
  await restart();
  await host.locator("#wire-mode").selectOption("spiked");
  await guest.waitForFunction(
    () => document.querySelector("#wire-mode").value === "spiked",
  );
  await ticks(12);
  await host.locator("#scene").focus();
  await host.keyboard.down("w");
  await host.keyboard.down("k");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "attached",
  );
  assert.ok(JSON.parse((await state(host)).wire));
  assert.deepEqual(JSON.parse((await state(host)).aimDirection), {
    x: 0,
    y: -1,
  });
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/controls-spiked-wire.png",
    fullPage: true,
  });
  await host.keyboard.up("k");
  await host.keyboard.up("w");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "ready",
  );
  await restart();
  await host.locator("#scene").focus();
  await host.keyboard.down("w");
  await host.keyboard.down("d");
  await host.keyboard.down("k");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "flying",
  );
  const diagonal = await state(host);
  assert.deepEqual(JSON.parse(diagonal.aimDirection), { x: 1, y: -1 });
  assert.ok(Number(diagonal.hookX) > Number(diagonal.actorX));
  assert.ok(Number(diagonal.hookY) < Number(diagonal.feet) - 31);
  await host.waitForFunction(() => {
    const wire = JSON.parse(document.querySelector("#scene").dataset.wire);
    return wire && Math.hypot(wire.endX - wire.x, wire.endY - wire.y) > 80;
  });
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/controls-spiked-wire.png",
    fullPage: true,
  });
  await host.locator("#keyboard-mode").focus();
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "ready",
  );
  await host.keyboard.up("k");
  await host.keyboard.up("w");
  await host.keyboard.up("d");
  await guest.reload();
  await guest.locator('#status[data-state="playing"]').waitFor();
  assert.equal(await guest.locator("#wire-mode").inputValue(), "spiked");
  assert.equal(await guest.locator("#jump-mode").inputValue(), "double");
  console.log(
    "PASS up/diagonal K hooks, spiked presentation, blur cancellation, shared options and peer refresh",
  );
  await host.locator("#keyboard-mode").selectOption("mouse");
  await restart();
  const box = await host.locator("#scene canvas").boundingBox();
  await host.mouse.move(
    box.x + (310 / 1600) * box.width,
    box.y + (650 / 900) * box.height,
  );
  await host.mouse.down();
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.hook === "attached",
  );
  await host.mouse.up();
  await host.locator("#jump-mode").selectOption("single");
  await host.locator("#wire-mode").selectOption("tip");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.airJump === "false",
  );
  await host.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await host.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/controls-phone.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log("PASS return to mouse/single/tip baseline and phone layout");
} finally {
  await browser.close();
}
