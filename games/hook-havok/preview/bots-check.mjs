import { chromium } from "playwright";
import assert from "node:assert/strict";
// 11C real-room smoke: add four bots from Room & match, watch them play free
// play at every level, an elimination round and a score round, and take two
// away again. The local keeper stands still throughout.
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
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log(`PAGE ERROR ${e.message}`);
  });
  await page.goto(base + "hook-havok/?mute");
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const scene = page.locator("#scene");
  const data = () => scene.evaluate((e) => ({ ...e.dataset }));
  const keepers = async () => JSON.parse((await data()).keepers ?? "[]");
  const bots = async () => (await keepers()).filter((k) => k.bot);
  const seconds = (s) => page.waitForTimeout(s * 1000);
  const round = async () => Number((await data()).round);
  const restarted = async (before) =>
    page.waitForFunction(
      (r) => Number(document.querySelector("#scene").dataset.round) > r,
      before,
    );

  assert.equal(await page.locator("#bot-count").inputValue(), "0");
  assert.equal(await page.locator("#bot-level").inputValue(), "normal");
  await page.locator("#bot-count").selectOption("4");
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.keepers || "[]")
        .length === 5,
  );
  assert.equal((await bots()).length, 4);
  assert.equal(await page.locator("#roster .bot-badge").count(), 4);
  assert.equal(await page.locator("#bot-count").inputValue(), "4");
  const names = await page.locator("#roster .keeper-name").allTextContents();
  assert.deepEqual(
    names.slice(1),
    ["BOTWick", "BOTRook", "BOTTallow", "BOTGargoyle"],
    names.join(" | "),
  );
  await page
    .locator("#room-lounge")
    .screenshot({ path: evidence("bots-room") });
  console.log("PASS four bots seated from Room & match, BOT badges on cards");

  // Free play at every level: bots leave their spawns, throw and hook.
  for (const level of ["easy", "normal", "hard"]) {
    const before = await round();
    if (level !== "normal") {
      await page.locator("#bot-level").selectOption(level);
      await restarted(before);
    }
    const start = await bots();
    await seconds(12);
    const now = await bots();
    const thrown = now.reduce((n, k) => n + k.tally.thrown, 0),
      moved = now.filter(
        (k) => Math.abs(k.x - start.find((s) => s.id === k.id).x) > 40,
      ).length,
      hits = now.reduce((n, k) => n + k.hits, 0);
    console.log(
      `PASS free play, ${level}: ${thrown} bombs, ${hits} hook hits, ${moved}/4 moved in 12 s`,
    );
    assert.ok(thrown > 0, `${level} bots throw`);
    assert.ok(moved >= 3, `${level} bots move`);
    if (level === "normal") {
      await page.locator("#arena-focus").click();
      await seconds(1);
      await page.screenshot({ path: evidence("bots-free-play") });
      await page.locator("#arena-focus").click();
    }
  }

  // An elimination round at normal, then a score round at hard.
  const contest = async () => JSON.parse((await data()).contest);
  let asked = false;
  const playRound = async (rules, level, shot) => {
    const before = await round();
    await page.locator("#bot-level").selectOption(level);
    await restarted(before);
    const again = await round();
    await page.locator("#rules").selectOption(rules);
    await restarted(again);
    await page.waitForFunction(
      () =>
        JSON.parse(document.querySelector("#scene").dataset.contest).phase ===
        "active",
      undefined,
      { timeout: 10000 },
    );
    if (rules === "elimination" && !asked) {
      // Removing bots mid-round asks first; keeping them leaves the round be.
      asked = true;
      const live = await round();
      await page.locator("#bot-count").selectOption("2");
      await page.locator("#bot-confirm").waitFor();
      await page.locator("#bot-confirm-cancel").click();
      await page.locator("#bot-confirm").waitFor({ state: "hidden" });
      await seconds(1);
      assert.equal(await page.locator("#bot-count").inputValue(), "4");
      assert.equal(await round(), live, "keeping the bots keeps the round");
      assert.equal((await bots()).length, 4);
      console.log("PASS removing bots mid-round asks; Keep playing keeps them");
    }
    await page
      .waitForFunction(
        () =>
          JSON.parse(document.querySelector("#scene").dataset.contest).phase ===
          "over",
        undefined,
        // A round is 60 s of game time; a loaded machine renders slower.
        { timeout: 100000 },
      )
      .catch(async (e) => {
        const d = await data();
        console.log(
          `STUCK ${rules}: tick ${d.tick}, round ${d.round}, contest ${d.contest.slice(0, 300)}, status ${await page.locator("#status").textContent()}`,
        );
        throw e;
      });
    const c = await contest(),
      all = await keepers();
    await page.locator("#result-card").waitFor();
    assert.equal(
      await page.locator("#result-tally .bot-badge").count(),
      4,
      "results mark the bots",
    );
    await seconds(1.5); // the results card fades in
    await page.locator(".stage").screenshot({ path: evidence(shot) });
    const thrown = all.reduce((n, k) => n + k.tally.thrown, 0),
      ko = all.reduce(
        (n, k) => n + k.tally.knockouts + k.tally.selfKnockouts,
        0,
      );
    console.log(
      `PASS ${rules} round, ${level}: ${Math.ceil(c.elapsed / 60)} s, winners ${c.winners.join(", ") || "none"}, ${thrown} bombs, ${ko} knockouts, out: ${c.entries.filter((e) => e.out).length}`,
    );
    assert.ok(thrown > 0);
    return c;
  };
  await playRound("elimination", "normal", "bots-results");
  // Play again from the results: a second elimination round with the same bots.
  const beforeAgain = await round();
  await page.locator("#rematch").click();
  await page.waitForFunction(
    (r) =>
      Number(document.querySelector("#scene").dataset.round) > r ||
      JSON.parse(document.querySelector("#scene").dataset.contest).phase !==
        "over",
    beforeAgain,
  );
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.contest).phase ===
      "over",
    undefined,
    { timeout: 105000 },
  );
  assert.equal((await bots()).length, 4, "the bots stay for another round");
  console.log("PASS a second elimination round with the same bots");
  await page.locator("#dismiss-results").click();
  await playRound("score", "hard", "bots-score");
  await page.locator("#dismiss-results").click();

  // Taking two away during a round, confirmed, restarts the room (a new
  // match) with two bots left.
  const beforeRules = await round();
  await page.locator("#rules").selectOption("elimination");
  await restarted(beforeRules);
  await page.waitForFunction(() =>
    ["countdown", "active"].includes(
      JSON.parse(document.querySelector("#scene").dataset.contest).phase,
    ),
  );
  await page.locator("#bot-count").selectOption("2");
  await page.locator("#bot-confirm").waitFor();
  await page.screenshot({ path: evidence("bots-confirm") });
  await page.locator("#bot-confirm-yes").click();
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.keepers || "[]")
        .length === 3,
    undefined,
    { timeout: 10000 },
  );
  assert.equal(await round(), 1, "removal restarts the shared trial");
  assert.deepEqual(
    (await bots()).map((k) => k.slot),
    [1, 2],
    "the last seats go first",
  );
  await page.waitForFunction(
    () =>
      document.querySelector("#status").dataset.state === "playing" &&
      document.querySelector("#bot-count").value === "2",
  );
  console.log("PASS removing two bots restarts the room with two left");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
