import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.argv[2];
if (
  !/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}):\d+\/$/.test(
    base,
  )
)
  throw new Error("Pass local service URL");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
try {
  const errors = [],
    music = [];
  const makePage = async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.connectionTrace = [];
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(...args) {
          super(...args);
          for (const event of [
            "connectionstatechange",
            "iceconnectionstatechange",
            "signalingstatechange",
          ])
            this.addEventListener(event, () =>
              window.connectionTrace.push([
                event,
                this.connectionState,
                this.iceConnectionState,
                this.signalingState,
              ]),
            );
        }
      };
      new MutationObserver(() => {
        const text = document.querySelector("#status")?.textContent;
        if (text && window.connectionTrace.at(-1) !== text)
          window.connectionTrace.push(text);
      }).observe(document, { subtree: true, childList: true });
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    page.on("request", (r) => {
      if (r.url().includes("/music/")) music.push(r.url());
    });
    return page;
  };
  const host = await makePage();
  await host.goto(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#keeper-name").fill("Amber");
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  await host.locator("#development-workshop > summary").click();
  await host.locator('input[name="speed"]').fill("400");
  await host.locator("#tuning button").click();
  const invite = await host.locator("#invite-url").inputValue();
  assert.ok(new URL(invite).searchParams.has("room"));
  assert.ok(!/token|secret/.test(invite));
  const guest = await makePage();
  await guest.goto(invite);
  try {
    await guest
      .locator('#status[data-state="playing"]')
      .waitFor({ timeout: 20000 });
  } catch (error) {
    console.error({
      hostTrace: await host.evaluate(() => window.connectionTrace),
      guestTrace: await guest.evaluate(() => window.connectionTrace),
    });
    console.error({
      host: await host.locator("#status").innerText(),
      guest: await guest.locator("#status").innerText(),
      hostPlayers: await host.locator("#roster").innerText(),
      guestPlayers: await guest.locator("#roster").innerText(),
      errors,
    });
    throw error;
  }
  const count = (page, n) =>
    page.waitForFunction(
      (n) =>
        JSON.parse(document.querySelector("#scene").dataset.keepers || "[]")
          .length === n,
      n,
    );
  await count(host, 2);
  await count(guest, 2);
  assert.equal(await guest.locator('input[name="speed"]').inputValue(), "400");
  const players = (page) =>
    page.locator("#scene").evaluate((e) => JSON.parse(e.dataset.keepers));
  const hostId = await host.locator("#scene").getAttribute("data-player-id"),
    guestId = await guest.locator("#scene").getAttribute("data-player-id");
  assert.notEqual(hostId, guestId);
  await host.locator("#scene").focus();
  await host.keyboard.down("Space");
  await host.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.feet) < 665,
  );
  await host.waitForFunction(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 670) < 1,
  );
  await host.keyboard.up("Space");
  await guest.waitForFunction(
    (id) =>
      Math.abs(
        JSON.parse(document.querySelector("#scene").dataset.keepers).find(
          (k) => k.id === id,
        ).feet - 670,
      ) < 1,
    hostId,
  );
  await host.keyboard.down("ArrowDown");
  await host.waitForFunction(
    () =>
      document.querySelector("#scene").dataset.grounded === "true" &&
      Math.abs(Number(document.querySelector("#scene").dataset.feet) - 810) < 1,
  );
  await host.keyboard.up("ArrowDown");
  await guest.waitForFunction(
    (id) =>
      Math.abs(
        JSON.parse(document.querySelector("#scene").dataset.keepers).find(
          (k) => k.id === id,
        ).feet - 810,
      ) < 1,
    hostId,
  );
  await guest.locator("#scene").focus();
  await guest.keyboard.down("d");
  await host.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).find(
        (k) => k.id === id,
      ).x > 215,
    guestId,
  );
  await guest.keyboard.up("d");
  assert.ok(
    Math.abs((await players(host)).find((k) => k.id === hostId).x - 310) < 1,
  );
  await guest.locator("#reset").click();
  await host.waitForFunction(
    (id) =>
      Math.abs(
        JSON.parse(document.querySelector("#scene").dataset.keepers).find(
          (k) => k.id === id,
        ).x - 170,
      ) < 1,
    guestId,
  );
  const t = Number(await host.locator("#scene").getAttribute("data-tick"));
  await host.waitForFunction(
    (tick) => Number(document.querySelector("#scene").dataset.tick) > tick + 35,
    t,
  );
  const box = await host.locator("#scene canvas").boundingBox();
  await host.mouse.move(
    box.x + (170 / 1600) * box.width,
    box.y + (782 / 900) * box.height,
  );
  await host.mouse.down();
  await host.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).find(
        (k) => k.id === id,
      ).hits === 1,
    hostId,
  );
  await host.mouse.up();
  await guest.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).find(
        (k) => k.id === id,
      ).hits === 1,
    hostId,
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/multiplayer-desktop.png",
    fullPage: true,
  });
  await guest.reload();
  await guest
    .locator('#status[data-state="playing"]')
    .waitFor({ timeout: 20000 });
  assert.equal(
    await guest.locator("#scene").getAttribute("data-player-id"),
    guestId,
  );
  assert.equal(await guest.locator('input[name="speed"]').inputValue(), "400");
  await count(host, 2);
  await count(guest, 2);
  const tv = await makePage();
  await tv.goto(await host.locator("#display-link").getAttribute("href"));
  await tv.locator('#status[data-state="playing"]').waitFor({ timeout: 20000 });
  await count(tv, 2);
  await count(host, 2);
  assert.equal(await tv.locator("#reset").isDisabled(), true);
  const late = await makePage();
  await late.goto(invite);
  await late
    .locator('#status[data-state="playing"]')
    .waitFor({ timeout: 20000 });
  await count(host, 3);
  await count(guest, 3);
  await count(tv, 3);
  await host.locator("#restart-room").click();
  await guest.waitForFunction(() =>
    JSON.parse(document.querySelector("#scene").dataset.keepers).every(
      (k) => k.hits === 0,
    ),
  );
  await host.close();
  await guest.locator("#restart-room").waitFor();
  // Creator departure is handled by the shared room manager, without starting a replacement room.
  const manager = await Promise.any(
    [guest, late].map(async (page) => {
      await page.waitForFunction(
        () => !document.querySelector("#restart-room").disabled,
        undefined,
        { timeout: 25000 },
      );
      return page;
    }),
  );
  await manager.locator("#experiment").selectOption("ball");
  assert.equal(
    await manager.locator('input[name="speed"]').inputValue(),
    "400",
  );
  await (manager === guest ? late : guest).waitForFunction(
    () => document.querySelector("#scene").dataset.experiment === "ball",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(music, []);
  console.log(
    "PASS real WebRTC: independent keepers, player hit ownership, refresh identity/recovery, seatless display, late join, manager restart and creator departure",
  );
} finally {
  await browser.close();
}
