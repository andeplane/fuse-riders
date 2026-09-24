import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const errors = [];
  const make = async (url) => {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1400 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    return page;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const guest = await make(await host.locator("#invite-url").inputValue());
  await guest.locator('#status[data-state="playing"]').waitFor();
  const guestId = await guest.locator("#scene").getAttribute("data-player-id");
  const hostId = await host.locator("#scene").getAttribute("data-player-id");
  await host.waitForFunction(() => {
    const keepers = JSON.parse(
      document.querySelector("#scene").dataset.keepers,
    );
    return (
      keepers.length === 2 && keepers.every((keeper) => keeper.shield === 0)
    );
  });
  const box = await host.locator("#scene canvas").boundingBox();
  await host.mouse.move(
    box.x + (box.width * 170) / 1600,
    box.y + (box.height * 782) / 900,
  );
  await host.mouse.down();
  await guest.waitForFunction(
    () => document.querySelector("#scene").dataset.motion === "hit",
  );
  await host.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).find(
        (k) => k.id === id,
      )?.motion === "hit",
    guestId,
  );
  assert.notEqual(
    await host.locator("#scene").getAttribute("data-motion"),
    "hit",
  );
  await guest.screenshot({
    path: "games/hook-havok/docs/evidence/character-hit.png",
    fullPage: true,
  });
  await host.mouse.up();
  console.log("PASS target-only local and remote hit reaction");

  const oldRound = await host.locator("#scene").getAttribute("data-round");
  await host.locator("#restart-room").click();
  await host.waitForFunction(
    (round) => document.querySelector("#scene").dataset.round !== round,
    oldRound,
  );
  await host.waitForFunction(
    () =>
      Number(document.querySelector("#scene").dataset.actorX) === 310 &&
      Number(document.querySelector("#scene").dataset.deaths) === 0,
  );
  const restartedTick = await host.locator("#scene").getAttribute("data-tick");
  await host.waitForFunction(
    (tick) =>
      Number(document.querySelector("#scene").dataset.tick) > Number(tick) + 9,
    restartedTick,
  );
  await host.locator("#scene").focus();
  await host.keyboard.down("d");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.atlas === "run",
  );
  await guest.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).find(
        (k) => k.id === id,
      )?.atlas === "run",
    hostId,
  );
  // Read-only animation observation; never inject a pose or change the world.
  const frames = await host.evaluate(
    () =>
      new Promise((resolve) => {
        const observed = new Set();
        const start = performance.now();
        const sample = () => {
          const scene = document.querySelector("#scene");
          if (scene.dataset.atlas === "run") observed.add(scene.dataset.frame);
          if (performance.now() - start > 240) resolve([...observed]);
          else requestAnimationFrame(sample);
        };
        sample();
      }),
  );
  assert.ok(frames.length >= 3, `run cycle advanced through ${frames}`);
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/character-run.png",
    fullPage: true,
  });
  await host.keyboard.up("d");
  console.log("PASS local and remote run atlas", frames);
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.motion === "idle",
  );
  await host.keyboard.down("Space");
  await host.waitForFunction(
    () =>
      document.querySelector("#scene").dataset.motion === "rise" &&
      Number(document.querySelector("#scene").dataset.echoes) === 2,
  );
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/character-jump.png",
    fullPage: true,
  });
  await host.keyboard.up("Space");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.grounded === "true",
  );

  await host.keyboard.down("r");
  await host.waitForFunction(() => {
    const scene = document.querySelector("#scene");
    return (
      Number(scene.dataset.actorX) === 310 &&
      Math.abs(Number(scene.dataset.feet) - 810) < 1
    );
  });
  await host.keyboard.up("r");
  const hookBox = await host.locator("#scene canvas").boundingBox();
  await host.mouse.move(
    hookBox.x + (hookBox.width * 310) / 1600,
    hookBox.y + (hookBox.height * 650) / 900,
  );
  await host.mouse.down();
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.motion === "pull",
  );
  assert.equal(await host.locator("#scene").getAttribute("data-frame"), "8");
  await host.screenshot({
    path: "games/hook-havok/docs/evidence/character-pull.png",
    fullPage: true,
  });
  await host.mouse.up();
  await host.waitForFunction(() =>
    document.querySelector("#scene").dataset.feedback.includes("release"),
  );
  assert.notEqual(
    await host.locator("#scene").getAttribute("data-rotation"),
    "0",
  );
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.grounded === "true",
  );

  await host.emulateMedia({ reducedMotion: "reduce" });
  await host.keyboard.down("a");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.atlas === "run",
  );
  const reduced = await host.locator("#scene").evaluate((e) => ({
    frame: e.dataset.frame,
    rotation: e.dataset.rotation,
    echoes: e.dataset.echoes,
  }));
  assert.deepEqual(reduced, { frame: "0", rotation: "0", echoes: "0" });
  await host.keyboard.up("a");
  await host.emulateMedia({ reducedMotion: "no-preference" });

  await guest.locator("#scene").focus();
  await guest.keyboard.down("a");
  await guest.waitForFunction(() =>
    document.querySelector("#scene").dataset.feedback.includes("vanish"),
  );
  await guest.keyboard.up("a");
  await guest.waitForFunction(
    () => document.querySelector("#scene").dataset.motion === "arrive",
  );
  await guest.screenshot({
    path: "games/hook-havok/docs/evidence/character-arrival.png",
    fullPage: true,
  });

  await host.locator("#rules").selectOption("elimination");
  for (const page of [host, guest])
    await page.waitForFunction(() => {
      const contest = JSON.parse(
        document.querySelector("#scene").dataset.contest,
      );
      return contest.rules === "elimination" && contest.phase === "active";
    });
  await guest.locator("#scene").focus();
  await guest.keyboard.down("a");
  await host.waitForFunction(
    (id) =>
      JSON.parse(document.querySelector("#scene").dataset.keepers)
        .find((k) => k.id === id)
        ?.feedback.includes("vanish"),
    guestId,
  );
  await guest.keyboard.up("a");
  await host.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.contest).phase ===
      "over",
  );

  await host.route("**/lantern-keeper-run-source-*.png", (route) =>
    route.abort(),
  );
  await host.goto(base + "hook-havok/?showcase=1&mute");
  await host.locator('#status[data-state="error"]').waitFor();
  await host.unroute("**/lantern-keeper-run-source-*.png");
  await host.locator("#retry").click();
  await host.locator('#status[data-state="ready"]').waitFor();
  assert.equal(await host.locator("#scene canvas").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS local/remote run atlas, target-only hit reaction, takeoff echoes, reduced motion, fall/arrival, elimination and run-source retry",
  );
} finally {
  await browser.close();
}
