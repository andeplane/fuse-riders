import { chromium } from "playwright";
import assert from "node:assert/strict";

// Combined rules: real menu choices, ordinary keys, and rendered state only.
const base = process.argv[2];
const evidence = process.argv[3];
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base) || !evidence)
  throw new Error(
    "Pass the local service URL and an existing evidence directory",
  );
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}hook-havok/?mute&play`);
  await page.locator('#status[data-state="ready"]').waitFor();
  await page.locator("#start").click();
  await page.locator('#status[data-state="playing"]').waitFor();
  const scene = page.locator("#scene");
  const keepers = () =>
    scene.evaluate((element) => JSON.parse(element.dataset.keepers));
  await page.locator("#experiment").selectOption("movement");
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.experiment === "movement",
  );
  await page.locator("#map").selectOption("spire");
  await page.waitForFunction(() => {
    const d = document.querySelector("#scene").dataset;
    return d.map === "spire" && JSON.parse(d.terrain).length === 19;
  });
  assert.equal(await page.locator("#match-map").textContent(), "NEON SPIRE");
  assert.equal(await page.locator("#power-ups").inputValue(), "31");
  assert.equal(
    await scene.evaluate(
      (element) => JSON.parse(element.dataset.pickups).length,
    ),
    4,
  );
  await page.locator("#bot-count").selectOption("2");
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).filter(
        (keeper) => keeper.bot,
      ).length === 2,
  );
  assert.equal(await page.locator("#roster .bot-badge").count(), 2);
  const start = await keepers();
  await page
    .locator("#room-lounge")
    .screenshot({ path: `${evidence}/spire-bots-menu.png` });
  await page.waitForFunction((initial) => {
    const now = JSON.parse(document.querySelector("#scene").dataset.keepers);
    return now
      .filter((keeper) => keeper.bot)
      .every((keeper) => {
        const before = initial.find((candidate) => candidate.id === keeper.id);
        return (
          Math.abs(keeper.x - before.x) > 30 ||
          Math.abs(keeper.feet - before.feet) > 30
        );
      });
  }, start);
  assert.ok(
    (await keepers())
      .filter((keeper) => keeper.bot)
      .every((keeper) => Number.isFinite(keeper.x)),
  );
  await scene.screenshot({ path: `${evidence}/spire-bots-arena.png` });
  console.log(
    "PASS Neon Spire selected through menus: 19 surfaces, four seeded pads, two visible bots moving",
  );

  // Keep the pickup path free of rival attacks, using the manager's real menu.
  await page.locator("#bot-count").selectOption("0");
  await page.waitForFunction(
    () =>
      JSON.parse(document.querySelector("#scene").dataset.keepers).length === 1,
  );
  if (
    !(await page
      .locator("#development-workshop")
      .evaluate((element) => element.open))
  )
    await page.locator("#development-workshop > summary").click();
  await page.locator("#bomb-mode").selectOption("off");
  await page.waitForFunction(
    () => document.querySelector("#scene").dataset.bombMode === "off",
  );
  await page.locator('#status[data-state="playing"]').waitFor();
  await scene.scrollIntoViewIfNeeded();
  await scene.focus();
  await page.keyboard.down("d");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.actorX) >= 320,
  );
  await page.keyboard.up("d");
  await page.keyboard.down("s");
  await page.keyboard.down("Space");
  await page.waitForFunction(
    () => Number(document.querySelector("#scene").dataset.feet) >= 1099,
  );
  await page.keyboard.up("Space");
  await page.keyboard.up("s");
  // The fall preserves horizontal momentum; walk back across the pad on
  // the lower deck rather than assuming the keeper falls straight down.
  await page.keyboard.down("a");
  const pickup = await page
    .waitForFunction(() => {
      const d = document.querySelector("#scene").dataset;
      const keeper = JSON.parse(d.keepers).find(
        (candidate) => candidate.id === d.playerId,
      );
      return keeper.power
        ? { kind: keeper.power, left: keeper.powerLeft }
        : false;
    })
    .catch(async (error) => {
      await page.keyboard.up("Space");
      await page.keyboard.up("s");
      await page.keyboard.up("a");
      console.error(
        "Pickup route",
        await scene.evaluate((element) => ({
          x: element.dataset.actorX,
          feet: element.dataset.feet,
          keepers: JSON.parse(element.dataset.keepers),
          pads: JSON.parse(element.dataset.pickups),
        })),
      );
      await page.screenshot({
        path: `${evidence}/spire-pickup-failure.png`,
        fullPage: true,
      });
      throw error;
    });
  await page.keyboard.up("Space");
  await page.keyboard.up("s");
  await page.keyboard.up("a");
  const power = await pickup.jsonValue();
  assert.ok(["triple", "dash", "harpoon"].includes(power.kind));
  const chip = page.locator('.keeper-card[data-slot="0"] .power-chip');
  await chip.waitFor();
  assert.equal(await chip.getAttribute("data-power"), power.kind);
  assert.ok(await chip.getAttribute("aria-label"));
  await page.screenshot({
    path: `${evidence}/spire-power-pickup.png`,
    fullPage: true,
  });
  console.log(
    `PASS ordinary movement and Down+Space collect the left bottom pad: ${power.kind}, visible power chip`,
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
