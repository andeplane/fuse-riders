import test from "node:test";
import assert from "node:assert/strict";
import {
  ACT,
  APPLY,
  DOCKS,
  END_WEEK,
  HOURS,
  JOBHUB,
  JOBS,
  READY,
  ROOMSHARE,
  WALK,
  type FuseLaneView,
} from "../src/game/index.js";
import { LocalMatch, validSetup, type LocalSetup } from "../src/app/local.js";
import {
  DEFAULT_CHOICE,
  chooseSetup,
  maxBots,
  normalizeChoice,
  parseStoredSetup,
} from "../src/app/menu.js";
import { present, sparkline, type Viewer } from "../src/app/presenter.js";
import { dueReports } from "../src/app/reports.js";
import { siteBase } from "../src/app/art.js";

const LOCAL: Viewer = {
  me: "",
  host: true,
  solo: true,
  display: false,
  shared: false,
  local: true,
};
const setup = (humans: number, bots: number): LocalSetup => ({
  humans: ["Ada", "Bo", "Cy"]
    .slice(0, humans)
    .map((name, index) => ({ name, avatar: ["fox", "cat", "owl"][index]! })),
  bots,
  level: 2,
  goals: [50, 50, 50, 50],
  weekSeconds: 45,
  seed: "app-1",
});
function until(match: LocalMatch, done: () => boolean, most = 2000): void {
  for (let n = 0; n < most && !done(); n++) match.step();
}

test("solo: the HUD is yours, no handoff, and a walk entry names this week", () => {
  const match = LocalMatch.create(setup(1, 2));
  const model = present(match.view(), LOCAL);
  assert.equal(model.screen, "game");
  assert.equal(model.handoff, undefined);
  assert.ok(model.hud);
  assert.equal(model.hud.hoursLeft, 60);
  assert.equal(model.hud.cash, 200);
  assert.deepEqual(model.walk?.(JOBHUB), [WALK, 1, JOBHUB]);
  assert.deepEqual(model.endWeekEntry, [END_WEEK, 1]);
  assert.equal(model.scores.length, 3);
  assert.equal(model.scores.find((row) => row.you)?.turn, "Playing");
});

test("the Job Hub panel offers the sure-thing job as a card that logs APPLY", () => {
  const match = LocalMatch.create(setup(1, 0));
  match.play([WALK, 1, JOBHUB]);
  until(match, () => match.room.players.p1!.inside === JOBHUB);
  const panel = present(match.view(), LOCAL).panel!;
  assert.equal(panel.name, "Job Hub");
  const cook = panel.sections
    .flatMap((section) => section.cards)
    .find((card) => card.title.startsWith("Line Cook"))!;
  assert.ok(cook.enabled);
  assert.equal(cook.note, "Sure thing");
  assert.deepEqual(cook.entry, [ACT, 1, JOBHUB, APPLY, 3, 0]);
  match.play(cook.entry!);
  match.step();
  const after = present(match.view(), LOCAL);
  assert.match(after.hud!.job, /Line Cook/);
  assert.match(after.toast!.text, /Hired/);
});

test("the docks panel lists Fusetown Port's ladder with apply cards; the board shows walking hours", () => {
  const match = LocalMatch.create(setup(1, 0));
  const board = present(match.view(), LOCAL).board;
  const docks = board.places[DOCKS]!;
  assert.equal(docks.name, "Fusetown Docks");
  assert.ok(docks.hours > 2, "a walk across town and the door");
  assert.equal(board.places[ROOMSHARE]!.hours, HOURS.enter, "home is the door");
  match.play([WALK, 1, DOCKS]);
  until(match, () => match.room.players.p1!.inside === DOCKS);
  const panel = present(match.view(), LOCAL).panel!;
  assert.equal(panel.name, "Fusetown Docks");
  const gate = panel.sections.find(
    (section) => section.title === "Jobs at Fusetown Port",
  )!;
  for (const title of [
    "Deckhand",
    "Forklift Driver",
    "Crane Operator",
    "Harbour Master",
  ])
    assert.ok(
      gate.cards.some((card) => card.title.startsWith(title)),
      title,
    );
  const deckhand = gate.cards.find((card) =>
    card.title.startsWith("Deckhand"),
  )!;
  const index = JOBS.findIndex((job) => job.title === "Deckhand");
  assert.ok(deckhand.enabled);
  assert.deepEqual(deckhand.entry, [ACT, 1, DOCKS, APPLY, index, 0]);
  assert.equal(gate.cards.length, 4);
});

test("hot-seat: the handoff hides the HUD and the panel, names who is next and its tap starts their week", () => {
  const match = LocalMatch.create(setup(2, 1));
  until(match, () => match.view().part === "handoff", 10);
  const view = match.view();
  const model = present(view, LOCAL);
  assert.ok(model.handoff);
  assert.equal(model.handoff.id, view.current);
  assert.match(model.handoff.step, /^Turn \d of 3$/);
  assert.equal(model.hud, undefined, "nothing private shows on the handoff");
  assert.equal(model.panel, undefined);
  assert.equal(model.walk, undefined);
  assert.deepEqual(model.readyEntry, [READY, 1, view.turn]);
  assert.equal(
    model.scores.find((row) => row.id === view.current)?.turn,
    "Up next",
  );
  match.play(model.readyEntry!);
  match.step();
  const playing = present(match.view(), LOCAL);
  assert.equal(playing.handoff, undefined);
  assert.equal(playing.hud?.name, model.handoff.name);
});

test("hot-seat: Monday's private news waits for its owner's turn; the briefing READY is the whole device's", () => {
  const match = LocalMatch.create(setup(2, 0));
  for (let turn = 0; turn < 2; turn++) {
    until(match, () => match.view().part === "handoff", 10);
    match.play(present(match.view(), LOCAL).readyEntry!);
    match.step();
    match.play([END_WEEK, 1]);
    match.step();
  }
  const view: FuseLaneView = match.view();
  assert.equal(view.part, "briefing");
  const model = present(view, LOCAL);
  assert.ok(model.briefing);
  assert.deepEqual(
    model.briefing.notices,
    [],
    "no one's news on the shared briefing",
  );
  assert.deepEqual(model.readyEntry, [READY, 2]);
  match.play(model.readyEntry!);
  match.step();
  until(match, () => match.view().part === "handoff", 10);
  match.play(present(match.view(), LOCAL).readyEntry!);
  match.step();
  const turn = present(match.view(), LOCAL);
  assert.ok(turn.hud!.notices.length > 0, "slept-off hours are your own news");
});

test("solo briefing shows your news", () => {
  const match = LocalMatch.create(setup(1, 0));
  match.play([END_WEEK, 1]);
  match.step();
  const model = present(match.view(), LOCAL);
  assert.ok(model.briefing!.notices.length > 0);
  assert.equal(model.briefing!.ready, false);
});

test("the menu keeps choices in range: seats, bots, names, presets", () => {
  assert.equal(maxBots(1), 3);
  assert.equal(maxBots(3), 2);
  assert.equal(maxBots(4), 1);
  const wild = normalizeChoice({
    humans: [
      { name: "  Ada ", avatar: "fox" },
      { name: "Ada", avatar: "nope" },
      { name: "", avatar: "cat" },
      { name: "Di", avatar: "owl" },
      { name: "Extra", avatar: "owl" },
    ],
    bots: 9,
    level: 7,
    goal: 55,
    weekSeconds: 10,
  });
  assert.equal(wild.humans.length, 4);
  assert.deepEqual(
    wild.humans.map((human) => human.name),
    ["Ada", "Ada 2", "Player 3", "Di"],
  );
  assert.equal(wild.bots, 1);
  assert.equal(wild.level, 1);
  assert.equal(wild.goal, 50);
  assert.equal(wild.weekSeconds, 60);
  const start = chooseSetup(wild, "seed-1");
  assert.deepEqual(start.goals, [50, 50, 50, 50]);
  // A duplicate name is cut by code points: never half an emoji, so START still makes a valid setup.
  const emoji = "Ab" + "😀".repeat(16);
  const twins = normalizeChoice({
    ...DEFAULT_CHOICE,
    humans: [
      { name: emoji, avatar: "fox" },
      { name: emoji, avatar: "cat" },
    ],
  });
  assert.equal(twins.humans[1]!.name, "Ab" + "😀".repeat(11) + " 2");
  const twinSetup = chooseSetup(twins, "seed-2");
  assert.ok(validSetup(twinSetup));
  assert.equal(twinSetup.humans.length, 2);
  assert.equal(parseStoredSetup("{bad json"), DEFAULT_CHOICE);
  assert.equal(parseStoredSetup(null), DEFAULT_CHOICE);
  assert.equal(
    parseStoredSetup(JSON.stringify({ ...DEFAULT_CHOICE, bots: 3 })).bots,
    3,
  );
});

test("sparkline scales the index history into its box", () => {
  assert.equal(sparkline([100], 300, 60), "");
  assert.equal(
    sparkline([100, 110, 105], 300, 60),
    "0.0,60.0 150.0,0.0 300.0,30.0",
  );
});

test("a finished match is reported once confirmed; a bot id or an unconfirmed end owes nothing", () => {
  const match = LocalMatch.create({ ...setup(1, 1), goals: [10, 10, 10, 10] });
  const room = match.room;
  for (let week = 0; week < 60 && room.stage === "running"; week++) {
    until(
      match,
      () =>
        match.current() === "p1" ||
        room.stage !== "running" ||
        room.phase === 1,
      100,
    );
    match.play([END_WEEK, room.week]);
    match.step();
    match.play([READY, room.week]);
    match.step();
  }
  assert.equal(room.stage, "over");
  assert.deepEqual(dueReports(room, "p1", room.phaseEnd - 1, new Set()), []);
  const due = dueReports(room, "p1", room.phaseEnd, new Set());
  assert.equal(due.length, 1);
  assert.equal(due[0]!.result.players.length, 2);
  assert.deepEqual(dueReports(room, "bot:1", room.phaseEnd, new Set()), []);
  assert.deepEqual(
    dueReports(room, "p1", room.phaseEnd, new Set([due[0]!.key])),
    [],
  );
  const view = present(match.view(), LOCAL);
  assert.equal(view.screen, "over");
  assert.ok(view.result!.title.length > 0);
});

test("art and links resolve from the site root, also under a relative base", () => {
  assert.equal(siteBase("/", "http://x/assets/a.js"), "/");
  assert.equal(siteBase("/fuse/", "http://x/fuse/assets/a.js"), "/fuse/");
  assert.equal(
    siteBase("https://cdn.example/", "http://x/assets/a.js"),
    "https://cdn.example/",
  );
  // `vite build --base ./`: the script sits in <root>/assets/, wherever <root> is served from.
  assert.equal(
    siteBase("./", "http://x/previews/pr-505/assets/fuse-lane-1.js"),
    "/previews/pr-505/",
  );
  assert.equal(siteBase("", "http://x/assets/a.js"), "/");
});
