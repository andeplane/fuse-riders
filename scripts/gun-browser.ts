import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createGameServer } from "../src/server/index.js";
import { COUNTDOWN_TICKS, startMatch } from "../src/shared/game.js";

// Isolated manual-tick LAN flow: real phone pointer press -> socket -> simulation -> TV tracer.
const app = await createGameServer({
  port: 0,
  hostname: "127.0.0.1",
  lanAddress: "127.0.0.1",
  manualTicks: true,
});
const browser =
  process.env.BROWSER === "webkit"
    ? await webkit.launch()
    : await chromium.launch({ channel: "chrome" });
const errors: string[] = [];
const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "browser/server condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
try {
  const origin = `http://127.0.0.1:${app.port}`;
  const tv = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  tv.on("pageerror", (error) => errors.push(error.message));
  let deliveredTick = -1;
  let tracerDelivered = false;
  tv.on("websocket", (socket) =>
    socket.on("framereceived", (frame) => {
      const message = JSON.parse(frame.payload.toString()) as {
        type: string;
        tick?: number;
        state?: { bombs: { shell?: { gun?: boolean } }[] };
      };
      if (message.state?.bombs.some((bomb) => bomb.shell?.gun))
        tracerDelivered = true;
      if (message.type === "snapshot") deliveredTick = message.tick!;
    }),
  );
  console.log("Loading TV");
  await tv.goto(`${origin}/display#${app.hostToken}`);
  await tv.getByText("HOST ONLINE", { exact: true }).waitFor();
  const phones = [];
  for (let slot = 0; slot < 3; slot++) {
    const phone = await browser.newPage({
      viewport: { width: 844, height: 390 },
      isMobile: true,
      hasTouch: true,
    });
    phone.on("pageerror", (error) => errors.push(error.message));
    await phone.goto(`${origin}/controller`);
    await phone.getByPlaceholder("Rider name").fill(`Gun test ${slot}`);
    await phone.getByRole("button", { name: "JOIN THE GRID" }).click();
    await phone.locator(".controls:not(.hidden)").waitFor();
    phones.push(phone);
  }
  console.log("Joined phones");
  startMatch(app.game);
  app.advance(COUNTDOWN_TICKS);
  const [shooter, target, spare] = [...app.game.players.values()].sort(
    (a, b) => a.slot - b.slot,
  );
  Object.assign(shooter!, {
    x: 200,
    y: 450,
    angle: 0,
    trail: [],
    gunArmed: true,
  });
  Object.assign(target!, { x: 900, y: 450, angle: Math.PI, trail: [] });
  Object.assign(spare!, { x: 1200, y: 150, angle: 0, trail: [] });
  app.advance(2);
  console.log("Waiting for Gun button");
  await phones[0]!.getByText("GUN · TAP TO FIRE", { exact: true }).waitFor();
  const button = phones[0]!.getByRole("button", { name: "Drop bomb" });
  const bounds = await button.boundingBox();
  assert.ok(bounds);
  await phones[0]!.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await phones[0]!.mouse.down();
  await button.locator('xpath=self::*[contains(@class,"active")]').waitFor();
  await waitFor(() => {
    app.advance(1);
    return app.game.shots.length > 0;
  });
  assert.equal(
    target!.alive,
    false,
    "headshot resolved while the pointer remains down",
  );
  assert.equal(app.game.shots.length, 1);
  assert.equal(app.game.blasts.length, 0);
  if (app.game.tick % 2) app.advance(1);
  await waitFor(() => deliveredTick >= app.game.tick);
  assert.equal(
    tracerDelivered,
    true,
    "authenticated TV receives the gun tracer",
  );
  await tv.locator("canvas.arena[data-renderer-status=ready]").waitFor();
  await mkdir("artifacts", { recursive: true });
  await tv.screenshot({
    path: `artifacts/gun-${process.env.BROWSER ?? "chrome"}.png`,
  });
  await phones[0]!.mouse.up();
  app.advance(4);
  assert.equal(app.game.shots.length, 1, "release does not fire again");
  assert.equal(app.game.bombs.size, 0, "tracer expired");
  assert.deepEqual(errors, []);
  console.log(
    "Gun browser passed: pointer-down headshot, one shot, no blast, snapshot delivered, screenshot captured, tracer expired.",
  );
} finally {
  console.log("Closing gun browser");
  await browser.close();
  await app.close();
}
