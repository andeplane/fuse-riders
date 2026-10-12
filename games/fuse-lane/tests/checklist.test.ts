import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLEGE,
  FRESHCO,
  GADGET,
  JOBHUB,
  JOBS,
  MONO,
  NEOBANK,
  RELAXED,
  ROOMSHARE,
  TOWER,
  createPlayer,
  defaultGoals,
  type PlayerState,
} from "../src/game/index.js";
import {
  CHECKLIST_KEY,
  STEPS,
  advance,
  checklistModel,
  hideChecklist,
  loadChecklist,
  reached,
  saveChecklist,
  stepPlace,
} from "../src/app/checklist.js";
import { safeStore } from "../src/app/session.js";

const fresh = (): PlayerState => createPlayer(defaultGoals());
const memory = () =>
  safeStore(() => {
    throw new Error("no storage");
  });

test("a new player has done none of the first steps", () => {
  assert.deepEqual(reached(fresh()), []);
  assert.equal(STEPS.length, 8);
});

test("each step reads from the player's state", () => {
  const me = fresh();
  me.job = JOBS.findIndex((job) => job.title === "Line Cook");
  me.shifts = 1;
  me.meal = 1;
  me.courses[0] = 1;
  me.flags |= RELAXED;
  me.bank = 10;
  me.durables.tv = { n: 1, paid: 300, cheap: false };
  assert.deepEqual(
    reached(me),
    STEPS.map((step) => step.id),
  );
  const enrolled = fresh();
  enrolled.courses[2] = 0;
  assert.deepEqual(reached(enrolled), ["enroll"]);
  const quit = fresh();
  quit.shifts = 3;
  assert.deepEqual(reached(quit), ["job", "shift"], "a job once held counts");
});

test("every step sends you where it is done", () => {
  const me = fresh();
  assert.equal(stepPlace("job", me), JOBHUB);
  assert.equal(stepPlace("shift", me), JOBHUB, "no job yet: find one");
  me.job = JOBS.findIndex((job) => job.title === "Line Cook");
  assert.equal(stepPlace("shift", me), MONO);
  assert.equal(stepPlace("food", me), MONO);
  me.durables.fridge = { n: 1, paid: 600, cheap: false };
  assert.equal(stepPlace("food", me), FRESHCO);
  assert.equal(stepPlace("enroll", me), COLLEGE);
  assert.equal(stepPlace("class", me), COLLEGE);
  assert.equal(stepPlace("rest", me), ROOMSHARE);
  me.home = 1;
  assert.equal(stepPlace("rest", me), TOWER);
  assert.equal(stepPlace("save", me), NEOBANK);
  assert.equal(stepPlace("treat", me), GADGET);
});

test("steps stay ticked once done, per player, and save on the device per match", () => {
  const store = memory();
  const save = loadChecklist(store, "lane-a");
  const me = fresh();
  assert.equal(advance(save, "p1", me), false, "nothing new");
  me.meal = 1;
  assert.equal(advance(save, "p1", me), true);
  me.meal = 0; // eaten on Monday
  assert.equal(advance(save, "p1", me), false);
  assert.deepEqual(save.done.p1, ["food"]);
  assert.equal(save.done.p2, undefined);
  saveChecklist(store, save);
  assert.deepEqual(loadChecklist(store, "lane-a").done, { p1: ["food"] });
  assert.deepEqual(
    loadChecklist(store, "lane-b").done,
    {},
    "another match starts over",
  );
  store.setItem(CHECKLIST_KEY, "{not json");
  assert.deepEqual(loadChecklist(store, "lane-a").done, {});
  store.setItem(CHECKLIST_KEY, JSON.stringify({ match: "lane-a", open: 3 }));
  assert.deepEqual(loadChecklist(store, "lane-a").done, {});
});

test("the model lists every step with its place, and the player can hide it any time", () => {
  const save = loadChecklist(memory(), "lane-a");
  const me = fresh();
  me.bank = 5;
  advance(save, "p1", me);
  const model = checklistModel(save, "p1", me);
  assert.equal(model.owner, "p1");
  assert.equal(model.done, 1);
  assert.equal(model.total, 8);
  assert.equal(model.open, undefined, "the screen picks until the player does");
  assert.equal(model.complete, false);
  assert.equal(model.hidden, false);
  assert.deepEqual(
    model.items.find((item) => item.id === "save"),
    { id: "save", label: "Save money at Neobank", done: true, place: NEOBANK },
  );
  save.open = false;
  save.done.p1 = STEPS.map((step) => step.id);
  const finished = checklistModel(save, "p1", me);
  assert.equal(finished.open, false);
  assert.equal(finished.complete, true);
});

test("hiding the list is per player, survives a reload and can be undone", () => {
  const store = memory();
  const save = loadChecklist(store, "lane-a");
  const me = fresh();
  hideChecklist(save, "p1", true);
  hideChecklist(save, "p1", true);
  assert.deepEqual(save.closed, ["p1"], "hiding twice keeps one entry");
  saveChecklist(store, save);
  const again = loadChecklist(store, "lane-a");
  assert.equal(
    checklistModel(again, "p1", me).hidden,
    true,
    "unfinished, but hidden",
  );
  assert.equal(
    checklistModel(again, "p2", me).hidden,
    false,
    "p2 keeps theirs",
  );
  hideChecklist(again, "p1", false);
  assert.equal(checklistModel(again, "p1", me).hidden, false);
});
