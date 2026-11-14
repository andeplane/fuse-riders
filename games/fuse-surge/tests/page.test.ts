import test from "node:test";
import assert from "node:assert/strict";
import { DUCK, HIGH, toView } from "../src/engine/index.js";
import {
  settingsFrom,
  settingsQuery,
  settingsToSave,
} from "../src/app/session.js";
import { DEFAULT_SETTINGS, parseSettings } from "../src/online/game.js";
import { REWIND_STEPS, createCueWatch } from "../src/render/cues.js";
import { fresh, playing, steps, surge, until } from "./fixtures/world.js";

test("a page starts with what the browser last chose, and a link's values go on top", () => {
  assert.deepEqual(settingsFrom("", null), DEFAULT_SETTINGS);
  const chosen = {
    ...DEFAULT_SETTINGS,
    hits: 5,
    pace: 2 as const,
    bot: 0 as const,
  };
  const saved = settingsToSave({ ...chosen, display: true });
  assert.deepEqual(
    JSON.parse(saved),
    chosen,
    "the shared screen is a room's, not a browser's",
  );
  assert.deepEqual(settingsFrom("?mute", saved), chosen);
  // The link wins, field by field, and takes values the lobby's buttons do not offer.
  assert.deepEqual(settingsFrom("?hits=7&seconds=45&recover=0", saved), {
    ...chosen,
    hits: 7,
    seconds: 45,
    recover: false,
  });
  assert.equal(
    settingsFrom("?recover=1", settingsToSave({ ...chosen, recover: false }))
      .recover,
    true,
  );
  // What does not parse is dropped on its own; the rest still counts.
  assert.deepEqual(
    settingsFrom("?hits=99&seconds=abc&pace=&target=2&bot=7&recover=yes", null),
    { ...DEFAULT_SETTINGS, target: 2 },
  );
  for (const stale of [
    "{not json",
    "null",
    "[]",
    JSON.stringify({ hits: 3 }),
    JSON.stringify({ ...chosen, hits: 0 }),
  ])
    assert.deepEqual(settingsFrom("", stale), DEFAULT_SETTINGS, stale);
  // A solo link carries a choice whole.
  assert.equal(
    settingsQuery(chosen),
    "hits=5&seconds=60&pace=2&target=3&recover=1&bot=0",
  );
  assert.deepEqual(
    settingsFrom(`?solo=1&${settingsQuery(chosen)}`, null),
    chosen,
  );
  assert.deepEqual(
    settingsFrom(`?${settingsQuery({ ...chosen, recover: false })}`, null),
    { ...chosen, recover: false },
  );
  assert.ok(parseSettings(settingsFrom("?hits=1&seconds=300&target=5", null)));
});

test("cues survive a rewind: a corrected prediction replayed says nothing twice", () => {
  const world = playing();
  const watch = createCueWatch();
  assert.deepEqual(
    watch(toView(world)),
    [],
    "the first view has nothing before it",
  );
  // A surge strikes the first rider and passes over the second.
  surge(world, HIGH, 30);
  const before = toView(world);
  until(world, (w) => w.riders[0]!.taken === 1, 400, 0, DUCK);
  const struck = toView(world);
  assert.deepEqual(
    watch(struck).filter((cue) => cue.kind === "hit"),
    [
      {
        kind: "hit",
        slot: 0,
        x: struck.riders[0]!.x,
        y: struck.riders[0]!.y,
        out: false,
      },
    ],
  );
  // The screen steps back to before the hit (a correction), then forward through it again: silence both times.
  assert.deepEqual(watch(before), []);
  assert.deepEqual(watch(struck), [], "the same view again");
  steps(world, 1, 0, DUCK);
  assert.deepEqual(
    watch(toView(world)).filter((cue) => cue.kind === "hit"),
    [],
    "the replayed hit is not sounded again",
  );
  // The dodge that follows is new, and is said once.
  until(world, (w) => w.riders[1]!.dodges === 1, 400, 0, DUCK);
  const dodged = toView(world);
  assert.deepEqual(
    watch(dodged).filter((cue) => cue.kind === "dodge"),
    [{ kind: "dodge", slot: 1, streak: 1 }],
  );
  assert.deepEqual(watch(struck), []);
  steps(world, 2, 0, DUCK);
  assert.deepEqual(
    watch(toView(world)).filter((cue) => cue.kind === "dodge"),
    [],
  );
  // A hit that knocks a rider out is always said: the fall must never go unheard.
  const last = playing({ hits: 1 }, ["a", "b", "c"]);
  const falls = createCueWatch();
  falls(toView(last));
  surge(last, HIGH, 30);
  until(last, (w) => w.riders[2]!.out, 400, DUCK, DUCK, 0);
  const fell = falls(toView(last));
  assert.ok(
    fell.some((cue) => cue.kind === "hit" && cue.out && cue.slot === 2),
  );
  // A view from long before is a new match: the marks start over and nothing is said about the jump back.
  const next = fresh();
  steps(world, REWIND_STEPS);
  watch(toView(world));
  assert.deepEqual(watch(toView(next)), []);
  steps(next, 1);
  assert.deepEqual(watch(toView(next)), []);
});
