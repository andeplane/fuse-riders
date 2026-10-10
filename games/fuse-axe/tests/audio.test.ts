import test from "node:test";
import assert from "node:assert/strict";
import { CueTracker, type Heard } from "../src/app/audio/cues.js";
import { AxeAudio, type AudioBackend } from "../src/app/audio/director.js";
import {
  CUES,
  SOUNDS,
  hz,
  melody,
  type Sound,
} from "../src/app/audio/sounds.js";
import { keys } from "../src/app/session.js";
import type * as V from "../src/engine/view.js";

const hero = (extra: Partial<V.HeroView> = {}): V.HeroView => ({
  ...{ id: 1, seat: 0, kind: "brakka", x: 100, y: 140, z: 0, facing: 1 },
  ...{ anim: "idle", animStep: 0, hp: 60, maxHp: 60, lives: 3 },
  ...{ invulnerable: false, pots: 0, maxPots: 3, ...extra },
});
const enemy = (extra: Partial<V.EnemyView> = {}): V.EnemyView => ({
  ...{ id: 9, kind: "ravager", tier: 0, x: 200, y: 140, z: 0, facing: -1 },
  ...{ anim: "idle", animStep: 0, hp: 30, maxHp: 30, flash: false, ...extra },
});
const spark = (age: number, extra: Partial<V.FxView> = {}): V.FxView => ({
  ...{ kind: "hit", x: 150, y: 140, z: 20, age, ...extra },
});
const world = (
  step: number,
  extra: Partial<V.WorldView> = {},
): V.WorldView => ({
  ...{ step, camX: 0, heroes: [hero()], enemies: [], fx: [], items: [] },
  wave: 1,
  ...{ waves: 4, locked: false, go: false, cleared: false, defeated: false },
  ...extra,
});
const frame = (w: V.WorldView | null, extra: Partial<Heard> = {}): Heard => ({
  ...{ stage: "running", matchId: "m1", round: 1, logTick: 0, countdown: 0 },
  ...{ outcome: "", world: w, ...extra },
});
/** Brakka, Rhea and Gorm in one anim. */
const party = (anim: V.HeroAnim, animStep: number) =>
  (["brakka", "rhea", "gorm"] as const).map((kind, seat) =>
    hero({ id: seat + 1, seat, kind, anim, animStep }),
  );
/** Each frame's cues, heard in order by one tracker. */
const hear = (frames: Heard[], ears = new CueTracker()) =>
  frames.map((each) => ears.next(each));
const heroes = (step: number, ...list: V.HeroView[]) =>
  frame(world(step, { heroes: list }));

test("each hero swings with its own whoosh, once across the frames that show it", () => {
  const swings = ["swing-brakka", "swing-rhea", "swing-gorm"];
  const at = (step: number, anim: V.HeroAnim, animStep: number) =>
    heroes(step, ...party(anim, animStep));
  assert.deepEqual(
    hear([
      at(30, "idle", 5),
      at(33, "attack1", 2),
      at(36, "attack1", 5),
      at(36, "attack1", 5), // the same frame drawn again
      at(42, "attack2", 1), // the combo's next slash
    ]),
    [[], swings, [], [], swings],
  );
  const [rhea, brakka, gorm] = (
    ["swing-rhea", "swing-brakka", "swing-gorm"] as const
  ).map((cue) => SOUNDS[cue].voices[0]!);
  assert.ok(rhea!.freq > brakka!.freq && brakka!.freq > gorm!.freq);
  assert.ok(rhea!.dur < brakka!.dur && brakka!.dur < gorm!.dur);
});

test("a swing a rollback corrects away and shows again sounds once; one begun long ago is history", () => {
  const at = (step: number, anim: V.HeroAnim, animStep: number) =>
    heroes(step, hero({ anim, animStep }));
  assert.deepEqual(
    hear([
      at(30, "idle", 9),
      at(33, "attack1", 1),
      at(36, "idle", 0), // corrected away
      at(39, "attack1", 1), // shown again, begun 6 steps later
      at(60, "idle", 4),
      at(63, "attack1", 0), // a new swing
      at(90, "idle", 4),
      at(93, "attack1", 20), // first seen 20 steps in
    ]),
    [[], ["swing-brakka"], [], [], [], ["swing-brakka"], [], []],
  );
});

test("every moment of a hero and the mace's wind-up have their cues", () => {
  const rows: [Partial<V.HeroView>, Partial<V.EnemyView>, number, string[]][] =
    [
      [{}, {}, 0, []],
      [{ anim: "jump", animStep: 1 }, {}, 0, ["jump"]],
      [{ anim: "jumpattack", animStep: 1 }, {}, 0, ["swing-brakka"]],
      [{ anim: "land", animStep: 2 }, {}, 0, ["land"]],
      [{ anim: "run", animStep: 1 }, {}, 0, []],
      [{ anim: "dash", animStep: 1 }, {}, 0, ["dash"]],
      [{ anim: "hurt", animStep: 1, hp: 50 }, {}, 0, ["hurt"]],
      [{ anim: "hurt", animStep: 0, hp: 44 }, {}, 0, ["hurt"]],
      [{ anim: "grab", animStep: 1, hp: 44 }, {}, 0, []],
      [{ anim: "throw", animStep: 1, hp: 44 }, {}, 0, ["throw"]],
      [{ anim: "knockdown", animStep: 1, hp: 30 }, {}, 0, ["knocked"]],
      [{ anim: "down", animStep: 1, hp: 30 }, {}, 0, []],
      [{ anim: "respawn", animStep: 1 }, {}, 0, ["respawn"]],
      [{}, {}, 1, ["pot"]],
      [{}, { anim: "windup", animStep: 2 }, 1, ["windup"]],
      [{}, { anim: "attack", animStep: 2 }, 0, []],
    ];
  const frames = rows.map(([me, foe, pots], i) =>
    frame(
      world(20 * i, {
        heroes: [hero({ ...me, pots })],
        enemies: [enemy(foe)],
      }),
    ),
  );
  assert.deepEqual(
    hear(frames),
    rows.map((row) => row[3]),
  );
});

test("sparks: each is heard once, a combo's second too, one a rollback moved is not", () => {
  const at = (step: number, ...fx: V.FxView[]) => frame(world(step, { fx }));
  const ko = (age: number, x: number) => spark(age, { kind: "ko", x });
  assert.deepEqual(
    hear([
      at(30),
      at(33, spark(1)),
      at(36, spark(4)),
      at(42, spark(10), spark(1)), // the next slash, same place
      at(45, spark(13), spark(2, { x: 151 })), // that one corrected: later, a pixel over
      at(48, spark(0, { kind: "heavy" }), ko(15, 400)), // first seen 15 steps old
      at(51, ko(0, 400), ko(0, 60)), // one cue a frame
    ]),
    [[], ["hit"], [], ["hit"], [], ["heavy"], ["ko"]],
  );
});

test("waves lock, clear and call GO once each; the last wave's end is the stage's fanfare", () => {
  const at = (step: number, extra: Partial<V.WorldView>, stage = "running") =>
    frame(world(step, extra), { stage: stage as Heard["stage"] });
  assert.deepEqual(
    hear([
      at(30, {}),
      at(33, { locked: true }),
      at(36, { go: true }),
      at(39, { locked: true }), // a rollback's flicker
      at(42, { go: true }),
      at(60, { wave: 4, locked: true }),
      at(63, { wave: 4, cleared: true }, "between"),
    ]),
    [[], ["locked"], ["cleared", "go"], [], [], ["locked"], ["fanfare"]],
  );
});

test("the stage flow: GO, the continue clock's seconds, game over, and a won run's fanfare once", () => {
  const at = (step: number, extra: Partial<Heard> = {}) =>
    frame(world(step), extra);
  const over = (outcome: Heard["outcome"], matchId = "m1") =>
    at(15, { stage: "over", outcome, matchId });
  assert.deepEqual(
    hear([
      frame(null, { stage: "lobby", matchId: "" }),
      at(0),
      ...[200, 199, 180, 181].map((countdown) => at(3, { countdown })),
      over("defeat"),
      at(0, { matchId: "m2" }),
      at(3, { matchId: "m2", stage: "between" }),
      over("victory", "m2"),
    ]),
    [
      [],
      ["go"],
      ["tick"],
      [],
      ["tick"],
      [],
      ["gameover"],
      ["go"],
      ["fanfare"],
      [],
    ],
  );
  const late = new CueTracker();
  const opened = { heroes: party("attack1", 1), fx: [spark(0)], locked: true };
  assert.deepEqual(late.next(frame(world(300, opened))), [], "opened mid-run");
  for (let i = 0; i < 300; i++)
    late.next(
      frame(null, {
        stage: i % 2 ? "over" : "running",
        matchId: `r${i}`,
        outcome: "defeat",
      }),
    );
  assert.deepEqual(
    late.next(frame(null, { matchId: "r2" })),
    ["go"],
    "memory is bounded: the oldest run's GO is forgotten",
  );
});

class FakeBackend implements AudioBackend {
  calls: string[] = [];
  unlock = () => this.calls.push("unlock");
  play = (sound: Sound) =>
    this.calls.push(`play:${CUES.find((cue) => SOUNDS[cue] === sound)}`);
  hide = (hidden: boolean) => this.calls.push(`hide:${hidden}`);
  take = () => this.calls.splice(0);
}
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial)),
    log: string[] = [];
  const getItem = (key: string) => (
    log.push(`get ${key}`),
    data.get(key) ?? null
  );
  const setItem = (key: string, value: string) =>
    log.push(`set ${key}=${value}`) && data.set(key, value);
  return { data, log, getItem, setItem };
}
const NAMES = keys("fuse-axe");
const setUp = (muted = false, store = fakeStore()) => {
  const backend = new FakeBackend();
  return { backend, store, audio: new AxeAudio(backend, store, NAMES, muted) };
};
const swing = (step: number, extra: Partial<Heard> = {}) =>
  frame(
    world(step, { heroes: [hero({ anim: "attack1", animStep: 1 })] }),
    extra,
  );
const LOBBY = frame(null, { stage: "lobby" });

test("nothing sounds before a gesture; the cues after it play", () => {
  const { backend, audio } = setUp();
  audio.frame(LOBBY);
  audio.frame(frame(world(0)));
  audio.hide(true);
  audio.hide(false);
  assert.deepEqual(backend.calls, []);
  assert.deepEqual(
    [audio.heard, audio.state],
    [1, "waiting"],
    "GO heard, not played",
  );
  audio.unlock();
  audio.frame(swing(3));
  audio.unlock();
  assert.deepEqual(backend.take(), ["unlock", "play:swing-brakka", "unlock"]);
  assert.equal(audio.state, "on");
  audio.frame(frame(world(30)), true);
  audio.frame(swing(60), true);
  assert.deepEqual(backend.take(), [], "a controller phone hears, quietly");
  assert.equal(audio.heard, 3);
});

test("?mute: nothing reaches the backend, the kept choices are never read or written, the toggles do nothing", () => {
  const { backend, store, audio } = setUp(
    true,
    fakeStore({ [NAMES.music]: "1" }),
  );
  audio.unlock();
  for (const each of [LOBBY, swing(0), swing(30)]) audio.frame(each);
  audio.setMusic(false);
  audio.setEffects(true);
  audio.hide(true);
  assert.deepEqual([backend.calls, store.log], [[], []]);
  assert.equal(
    audio.heard,
    1,
    "cues are still heard, for a smoke test to count",
  );
  assert.deepEqual(
    [audio.music, audio.effects, audio.state],
    [false, false, "muted"],
  );
});

test("MUSIC and EFFECTS are kept for the next page, and each silences only its own channel", () => {
  const { backend, store, audio } = setUp();
  audio.unlock();
  audio.frame(frame(world(0)));
  audio.setMusic(false);
  audio.setMusic(false);
  audio.frame(swing(3, { stage: "between" })); // no fanfare with the music off
  audio.setEffects(false);
  audio.frame(frame(world(30), { stage: "between" }));
  audio.frame(swing(60, { stage: "between" }));
  assert.deepEqual(backend.take(), ["unlock", "play:swing-brakka"]);
  assert.deepEqual(
    store.log.filter((line) => line.startsWith("set")),
    ["set fuse-axe-music=0", "set fuse-axe-effects=0"],
  );
  const next = new AxeAudio(new FakeBackend(), store, NAMES, false);
  assert.deepEqual([next.music, next.effects], [false, false]);
  audio.setMusic(true);
  audio.setEffects(true);
  audio.frame(frame(world(0), { matchId: "m2" }));
  audio.frame(frame(world(3), { matchId: "m2", stage: "between" }));
  audio.frame(frame(world(0), { matchId: "m3" }));
  audio.frame(
    frame(world(3), { matchId: "m3", stage: "over", outcome: "defeat" }),
  );
  assert.deepEqual(backend.take(), [
    "play:go",
    "play:fanfare",
    "play:go",
    "play:gameover",
  ]);
  assert.equal(store.data.get(NAMES.effects), "1");
});

test("a hidden tab is silent until it is shown again", () => {
  const { backend, audio } = setUp();
  audio.unlock();
  audio.frame(frame(world(0)));
  audio.hide(true);
  audio.unlock();
  audio.frame(swing(3));
  assert.equal(audio.state, "hidden");
  audio.hide(false);
  audio.frame(frame(world(30)));
  audio.frame(swing(60));
  assert.deepEqual(backend.take(), [
    "unlock",
    "hide:true",
    "hide:false",
    "play:swing-brakka",
  ]);
});

test("notes and melodies: the jingles play on the music channel, every other cue on the effects channel", () => {
  assert.deepEqual([hz("a4"), Math.round(hz("c#5"))], [440, 554]);
  assert.throws(() => hz("h2"), /not a note/);
  const beats = melody("a4 - . | c5", (freq, dur) => ({
    wave: "sine",
    freq,
    dur,
    vol: 1,
  }));
  assert.deepEqual(
    beats.map((one) => one?.dur ?? null),
    [2, null, null, 1],
  );
  assert.deepEqual(
    CUES.filter((cue) => SOUNDS[cue].channel === "music"),
    ["fanfare", "gameover"],
  );
  assert.ok(CUES.every((cue) => SOUNDS[cue].voices.length > 0));
});
