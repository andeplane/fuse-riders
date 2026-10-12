import test from "node:test";
import assert from "node:assert/strict";
import {
  CITY,
  GADGET,
  JOBHUB,
  NEOBANK,
  PLACES,
  WEEK_HOURS,
} from "../src/game/index.js";
import { bounds } from "../src/app/layout.js";
import { LocalMatch, type LocalSetup } from "../src/app/local.js";
import { safeStore } from "../src/app/session.js";
import {
  TOUR_KEY,
  markToured,
  owesTour,
  tourArea,
  tourFocus,
  tourSteps,
} from "../src/app/tour.js";

const setup = (humans: number, bots: number): LocalSetup => ({
  humans: ["Ada", "Bo"]
    .slice(0, humans)
    .map((name, index) => ({ name, avatar: ["fox", "cat"][index]! })),
  bots,
  level: 2,
  goals: [60, 40, 30, 70],
  weekSeconds: 45,
  seed: "tour-1",
});

test("the tour greets you with your goals and rivals, and states this match's week", () => {
  const steps = tourSteps(LocalMatch.create(setup(1, 2)).view());
  assert.equal(steps[0]!.title, "Welcome to Fusetown");
  assert.match(steps[0]!.body, /You and 2 rivals/);
  assert.match(
    steps[0]!.body,
    /Wealth 60, Happiness 40, Education 30 and Career 70/,
  );
  const week = steps.find((step) => step.hud === "clock")!;
  assert.match(
    week.body,
    new RegExp(`${WEEK_HOURS} hours and 45 real seconds`),
  );
  assert.equal(steps.at(-1)!.hud, undefined);
  assert.equal(steps.at(-1)!.places, undefined, "the last card is a send-off");
});

test("alone, the tour has no rivals to mention; one rival is a rival", () => {
  const alone = tourSteps(LocalMatch.create(setup(1, 0)).view());
  assert.doesNotMatch(alone[0]!.body, /rival/);
  assert.match(alone[0]!.body, /all four of your goals to win/);
  const duel = tourSteps(LocalMatch.create(setup(1, 1)).view());
  assert.match(duel[0]!.body, /You and 1 rival live/);
});

test("on a shared device the tour is for whoever's turn it is", () => {
  const match = LocalMatch.create(setup(2, 0));
  for (let n = 0; n < 50 && match.view().part !== "handoff"; n++) match.step();
  const view = match.view();
  assert.ok(view.current);
  const mine = tourSteps(view);
  assert.deepEqual(mine, tourSteps(view, view.current));
  assert.match(mine[0]!.body, /You and 1 rival/);
});

test("a tour for nobody here still reads: no goals yet, everyone else a rival", () => {
  const view = LocalMatch.create(setup(1, 1)).view();
  const steps = tourSteps(view, "nobody");
  assert.match(steps[0]!.body, /You and 2 rivals/);
  assert.match(
    steps[0]!.body,
    /Wealth 0, Happiness 0, Education 0 and Career 0/,
  );
  const empty = { ...view, current: "", players: [] };
  assert.match(tourSteps(empty)[0]!.body, /all four of your goals to win/);
});

test("every card points at the HUD, at places it names, or at nothing", () => {
  const steps = tourSteps(LocalMatch.create(setup(1, 2)).view());
  assert.deepEqual(
    steps.filter((step) => step.hud).map((step) => step.hud),
    ["clock", "goals", "money", "end"],
  );
  const framed = steps.flatMap((step) => step.places ?? []);
  assert.ok(framed.includes(JOBHUB), "the Job Hub is on the tour");
  for (const step of steps)
    for (const place of step.places ?? [])
      assert.ok(
        `${step.title} ${step.body}`.includes(
          PLACES[place]!.name.replace("Fusetown ", ""),
        ),
        `${step.title} names ${PLACES[place]!.name}`,
      );
});

test("tourArea frames the places' buildings and labels; tourFocus is its middle", () => {
  assert.equal(tourArea([]), undefined);
  assert.equal(tourFocus([]), undefined);
  const area = tourArea([NEOBANK, GADGET])!;
  for (const place of [NEOBANK, GADGET]) {
    const box = bounds(CITY.places[place]!.tap),
      label = CITY.places[place]!.label;
    assert.ok(area.x <= box.x && area.y <= box.y);
    assert.ok(area.x + area.w >= box.x + box.w);
    assert.ok(area.y + area.h >= box.y + box.h);
    assert.ok(area.x < label[0] && label[0] < area.x + area.w);
    assert.ok(area.y < label[1] && label[1] < area.y + area.h);
  }
  assert.deepEqual(tourFocus([NEOBANK, GADGET]), [
    area.x + area.w / 2,
    area.y + area.h / 2,
  ]);
});

test("the tour is owed once per device", () => {
  const store = safeStore(() => {
    throw new Error("no storage");
  });
  assert.equal(owesTour(store), true);
  markToured(store);
  assert.equal(owesTour(store), false);
  assert.equal(store.getItem(TOUR_KEY), "1");
});
