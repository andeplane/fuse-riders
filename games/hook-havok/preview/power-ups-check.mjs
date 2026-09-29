import { chromium } from "playwright";
import assert from "node:assert/strict";
// 11D real-room smoke: the pool setting, random pads, and every power-up
// taken on both maps with ordinary keyboard input (Space jumps, D/A move).
const base = process.argv[2];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base))
  throw new Error("Pass local service URL");
const evidence = (name) => `games/hook-havok/docs/evidence/${name}.png`;
const debug = process.env.DEBUG ? console.log : () => {};
const KINDS = ["triple", "shield", "cluster", "harpoon", "dash"];
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
try {
  const make = async (url) => {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
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
  await guest.locator('#status[data-state="playing"]').waitFor();
  const data = (page) =>
    page.locator("#scene").evaluate((e) => ({ ...e.dataset }));
  const me = async (page = host) => {
    const d = await data(page);
    return JSON.parse(d.keepers).find((k) => k.id === d.playerId);
  };
  const pads = async (page = host) => JSON.parse((await data(page)).pickups);
  const pos = async () => {
    const d = await data(host);
    return {
      x: Number(d.actorX),
      feet: Number(d.feet),
      grounded: d.grounded === "true",
    };
  };
  const wait = (ms) => host.waitForTimeout(ms);
  const landed = async () => {
    for (let i = 0; i < 200 && !(await pos()).grounded; i++) await wait(16);
    await wait(120);
  };
  // Hold a direction until close, coast, then nudge.
  const walkTo = async (x) => {
    for (let round = 0; round < 6; round++) {
      const from = await pos();
      if (Math.abs(from.x - x) <= 10) return;
      const key = from.x < x ? "d" : "a",
        far = Math.abs(from.x - x) > 60;
      await host.keyboard.down(key);
      for (let i = 0; i < 300; i++) {
        const p = await pos();
        if (Math.abs(p.x - x) <= (far ? 45 : 14) || p.x < x !== from.x < x)
          break;
        await wait(16);
      }
      await host.keyboard.up(key);
      await wait(350);
    }
  };
  /** Release and press Space again; the release must span a 20 Hz log tick. */
  const again = async (hold) => {
    await host.keyboard.up("Space");
    await wait(80);
    await host.keyboard.down("Space");
    await wait(hold);
  };
  const mine = (field, value) =>
    host.waitForFunction(
      ([f, v]) => {
        const d = document.querySelector("#scene").dataset;
        return JSON.parse(d.keepers).some(
          (p) => p.id === d.playerId && p[f] === v,
        );
      },
      [field, value],
      { timeout: 5000 },
    );
  /** A jump from standing; `double` jumps again at the top. */
  const jump = async (double = false) => {
    const start = (await pos()).feet;
    await host.keyboard.down("Space");
    let top = start;
    for (let i = 0; i < 80; i++) {
      const f = (await pos()).feet;
      if (f < top) top = f;
      else if (top < start - 40 && f > top + 1) break;
      await wait(16);
    }
    if (double) await again(450);
    await host.keyboard.up("Space");
    await landed();
  };
  const holding = (kind) =>
    host.waitForFunction(
      (k) => {
        const d = document.querySelector("#scene").dataset;
        return JSON.parse(d.keepers).some(
          (p) => p.id === d.playerId && p.power === k,
        );
      },
      kind,
      { timeout: 8000 },
    );
  const openWorkshop = async () => {
    const workshop = host.locator("#development-workshop");
    if (!(await workshop.evaluate((e) => e.open)))
      await workshop.locator("summary").first().click();
    await host
      .locator("#power-ups")
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(async (error) => {
        console.error(
          "room state:",
          await host
            .locator("#status")
            .evaluate((e) => [e.dataset.state, e.textContent]),
          errors,
        );
        throw error;
      });
  };
  /** Pool through the workshop: Off, then the one box. */
  const only = async (kind) => {
    await openWorkshop();
    await host.locator("#power-ups").selectOption("0");
    await host.waitForFunction(
      () =>
        JSON.parse(document.querySelector("#scene").dataset.pickups).length ===
        0,
    );
    await host.locator(`#power-${kind}`).check();
    await host.waitForFunction((k) => {
      const p = JSON.parse(document.querySelector("#scene").dataset.pickups);
      return p.length && p.every((pad) => pad.kind === k);
    }, kind);
    await host.locator("#scene").focus();
    await wait(900); // the restarted keeper lands and its spawn guard ends
  };
  const routes = {
    // Crossroads P1 (180, 810): double jump to the left ledge, walk to its
    // tip, jump through the upper-left ledge past the pad at (370, 332).
    crossroads: async () => {
      debug("start", await pos());
      await jump(true);
      debug("on the left ledge", await pos());
      await walkTo(362);
      debug("at its tip", await pos());
      await jump();
      debug("up", await pos());
    },
    // Belfry P1 (310, 810): up to the low ledge, a running jump to the
    // middle ledge, and along it to the pad on its lip at (790, 582).
    belfry: async () => {
      await jump();
      await host.keyboard.down("d");
      for (let i = 0; i < 200 && (await pos()).x < 405; i++) await wait(16);
      await host.keyboard.down("Space");
      await wait(400);
      await host.keyboard.up("Space");
      for (let i = 0; i < 300 && (await pos()).x < 770; i++) await wait(16);
      await host.keyboard.up("d");
      await landed();
    },
  };

  // Defaults: every kind in the pool, pads drawing from it, manager-only.
  if (!(await host.locator("#development-workshop").evaluate((e) => e.open)))
    await host.locator("#development-workshop > summary").click();
  assert.equal(await host.locator("#power-ups").inputValue(), "31");
  assert.equal((await pads()).length, 4);
  assert.ok((await pads()).every((p) => KINDS.includes(p.kind)));
  assert.equal(await guest.locator("#power-ups").isDisabled(), true);
  assert.equal(await guest.locator("#power-dash").isDisabled(), true);
  assert.equal(await guest.locator("#power-dash").isChecked(), true);
  await host.locator("#experiment").selectOption("movement");
  await host.waitForFunction(
    () => document.querySelector("#scene").dataset.experiment === "movement",
  );
  await host.locator("#scene").scrollIntoViewIfNeeded();
  await host.locator("#scene").screenshot({ path: evidence("powers-pads") });

  const shots = new Set();
  for (const map of ["crossroads", "belfry"]) {
    await host.locator("#map").selectOption(map);
    await host.waitForFunction(
      (m) => document.querySelector("#scene").dataset.map === m,
      map,
    );
    for (const kind of KINDS) {
      await only(kind);
      await routes[map]();
      await holding(kind);
      const held = await me();
      assert.equal(held.power, kind, `${map}: took ${kind}`);
      assert.equal(held.tally.powerUps, 1);
      // The guest sees the same power on the host.
      await guest.waitForFunction(
        (k) =>
          JSON.parse(document.querySelector("#scene").dataset.keepers).some(
            (p) => p.slot === 0 && p.power === k,
          ),
        kind,
      );
      // The roster paints on published frames, the scene every animation frame.
      await host.waitForFunction(
        (k) =>
          document.querySelectorAll(".keeper-card .power-chip:not([hidden])")
            .length === 1 &&
          document.querySelector(`.keeper-card .power-chip[data-power="${k}"]`),
        kind,
        { timeout: 5000 },
      );
      const pad = (await pads()).find((p) => p.cooldown > 0);
      assert.ok(pad && pad.kind === "", `${map}: the pad recharges`);
      if (kind === "triple") {
        await landed();
        await mine("airJumps", 2);
        await host.keyboard.down("Space");
        await wait(200);
        await again(0);
        await mine("airJumps", 1);
        await again(0);
        await mine("airJumps", 0);
        if (!shots.has(kind))
          await host
            .locator("#scene")
            .screenshot({ path: evidence("powers-triple") });
        await host.keyboard.up("Space");
        await landed();
        await mine("airJumps", 2);
      } else if (kind === "shield") {
        if (!shots.has(kind))
          await host
            .locator("#scene")
            .screenshot({ path: evidence("powers-shield") });
        // Throw straight down at your own feet: the Shield takes the blast.
        await host.keyboard.press("s");
        await host.keyboard.press("k");
        await host.waitForFunction(
          () =>
            JSON.parse(document.querySelector("#scene").dataset.shieldPops)
              .length > 0,
          undefined,
          { timeout: 4000 },
        );
        const after = await me();
        assert.equal(after.respawn, 0, "survived its own bomb");
        assert.equal(after.power, "", "the Shield popped");
        await wait(1200);
      } else if (kind === "cluster") {
        // A lob along the ledge the keeper stands on, so it lands and splits.
        // The eight-way aim keeps the last pair held, and the throw reads it
        // on the release, so the keys stay down a log tick past it.
        const side = map === "crossroads" ? "d" : "a";
        await host.keyboard.down("w");
        await host.keyboard.down(side);
        await host.keyboard.press("k");
        await wait(120);
        await host.keyboard.up(side);
        await host.keyboard.up("w");
        await host.waitForFunction(() =>
          JSON.parse(document.querySelector("#scene").dataset.bombs).some(
            (b) => b.kind === "cluster",
          ),
        );
        await host.waitForFunction(
          () =>
            JSON.parse(document.querySelector("#scene").dataset.bombs).filter(
              (b) => b.kind === "bomblet",
            ).length === 3,
          undefined,
          { timeout: 4000 },
        );
        await wait(200); // spread out
        if (!shots.has(kind))
          await host
            .locator("#scene")
            .screenshot({ path: evidence("powers-cluster") });
        assert.equal((await me()).charges, 2);
        await wait(1500);
      } else if (kind === "harpoon") {
        if (!shots.has(kind))
          await host.screenshot({
            path: evidence("powers-hud"),
            fullPage: true,
          });
      } else {
        await landed();
        await host.keyboard.press(map === "crossroads" ? "d" : "a");
        await host.keyboard.down("Space");
        await wait(200);
        await again(0);
        await host.waitForFunction(() => {
          const d = document.querySelector("#scene").dataset;
          return JSON.parse(d.keepers).some(
            (p) => p.id === d.playerId && p.dash > 0,
          );
        });
        if (!shots.has(kind))
          await host
            .locator("#scene")
            .screenshot({ path: evidence("powers-dash") });
        await host.keyboard.up("Space");
        await landed();
      }
      shots.add(kind);
    }
  }
  // A refreshed guest recovers the room's mixed pool (Dash bump alone now).
  await guest.reload();
  await guest.locator('#status[data-state="playing"]').waitFor();
  await guest.waitForFunction(() => {
    const p = JSON.parse(document.querySelector("#scene").dataset.pickups);
    return p.length === 4 && p.every((pad) => pad.kind === "dash");
  });
  await guest.waitForFunction(
    () => document.querySelector("#power-ups").value === "custom",
  );
  for (const kind of KINDS)
    assert.equal(
      await guest.locator(`#power-${kind}`).isChecked(),
      kind === "dash",
      `guest box ${kind}`,
    );
  await host.locator("#power-ups").selectOption("31");
  await guest.waitForFunction(
    () => document.querySelector("#power-ups").value === "31",
  );
  await host.locator(".power-pool").scrollIntoViewIfNeeded();
  await host.screenshot({ path: evidence("powers-workshop") });
  await host.locator("#power-ups").selectOption("0");
  await guest.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.pickups).length === 0,
  );
  await host.locator("#power-ups").selectOption("31");
  await guest.setViewportSize({ width: 390, height: 844 });
  if (!(await guest.locator("#development-workshop").evaluate((e) => e.open)))
    await guest.locator("#development-workshop > summary").click();
  assert.equal(
    await guest.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await guest.screenshot({ path: evidence("powers-phone"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: default pool, manager-only settings, every power-up taken on Crossroads and Belfry, triple jumps, a self-blast Shield pop, cluster bomblets, a dash, card chips, guest refresh into a mixed pool, off, narrow viewport; no page errors",
  );
} finally {
  await browser.close();
}
