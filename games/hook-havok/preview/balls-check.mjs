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
      viewport: { width: 1440, height: 1400 },
    });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    return p;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const guest = await make(await host.locator("#invite-url").inputValue());
  const display = await make(
    await host.locator("#display-link").getAttribute("href"),
  );
  for (const p of [guest, display])
    await p.locator('#status[data-state="playing"]').waitFor();
  const state = (p) => p.locator("#scene").evaluate((e) => ({ ...e.dataset }));
  const waitMode = async (mode) => {
    for (const p of [host, guest, display])
      await p.waitForFunction(
        (mode) => document.querySelector("#scene").dataset.experiment === mode,
        mode,
      );
  };
  const ticks = async (n) => {
    const t = Number((await state(host)).tick);
    await host.waitForFunction(
      (t) => Number(document.querySelector("#scene").dataset.tick) >= t,
      t + n,
    );
  };
  await host.locator("#map").selectOption("crossroads");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.map === "crossroads",
  );
  await host.locator("#experiment").selectOption("ricochet");
  await waitMode("ricochet");
  assert.equal(await guest.locator("#experiment").isDisabled(), true);
  await ticks(160);
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/balls-gentle.png",
    fullPage: true,
  });
  await host.locator("#experiment").selectOption("surge");
  await waitMode("surge");
  await ticks(90);
  await guest.reload();
  await guest.locator('#status[data-state="playing"]').waitFor();
  await waitMode("surge");
  assert.equal(JSON.parse((await state(guest)).balls).length, 1);
  console.log(
    "PASS shared presets, manager-only settings and peer refresh with moving arena ball",
  );
  await host.locator("#experiment").selectOption("ricochet");
  await waitMode("ricochet");
  // Ordinary shots from the spawn ledge; aim only from publicly rendered snapshots.
  for (
    let shot = 0;
    shot < 90 && Number((await state(host)).hits) < 1;
    shot++
  ) {
    const s = await state(host),
      balls = JSON.parse(s.balls);
    const ball = balls[0];
    const flight = Math.min(
      22,
      Math.hypot(ball.x - Number(s.actorX), ball.y - Number(s.feet)) / 20,
    );
    const box = await host.locator("#scene canvas").boundingBox();
    await host.mouse.move(
      box.x +
        (Math.max(0, Math.min(1600, ball.x + ball.vx * flight)) / 1600) *
          box.width,
      box.y +
        (Math.max(0, Math.min(900, ball.y + ball.vy * flight)) / 900) *
          box.height,
    );
    await host.mouse.down();
    await ticks(30);
    await host.mouse.up();
    await ticks(9);
  }
  assert.ok(
    Number((await state(host)).hits) >= 1,
    "ordinary input splits an arena ball",
  );
  for (const p of [guest, display])
    await p.waitForFunction(
      () => Number(document.querySelector("#scene").dataset.hits) >= 1,
    );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/balls-split.png",
    fullPage: true,
  });
  console.log(
    "PASS ordinary hook splits colored arena balls across peers and shared display",
  );
  await host.emulateMedia({ reducedMotion: "reduce" });
  await host.setViewportSize({ width: 390, height: 844 });
  await host.locator("#arena-focus").click();
  await ticks(30);
  assert.ok(
    await host.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/balls-phone.png",
    fullPage: true,
  });
  await host.locator("#arena-focus").click();
  await host.locator("#experiment").selectOption("ball");
  await waitMode("ball");
  assert.equal(JSON.parse((await state(host)).balls).length, 1);
  await host.locator("#experiment").selectOption("movement");
  await waitMode("movement");
  assert.equal(JSON.parse((await state(host)).balls).length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS phone layout, reduced-motion flow, bounded comparison and prop cleanup",
  );
} finally {
  await browser.close();
}
