import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARGE_TICKS,
  CRACKLES,
  CRACKLE_CYCLE,
  CueTracker,
  ECHO_STEPS,
  type Heard,
} from "../src/app/audio/cues.js";
import { AxeAudio, type AudioBackend } from "../src/app/audio/director.js";
import {
  AHEAD,
  Mixer,
  PUMP_MS,
  type Bus,
  type Repeat,
  type Synth,
} from "../src/app/audio/mixer.js";
import { MARCH, Sequencer, song, type Song } from "../src/app/audio/music.js";
import {
  CUES,
  MAX_VOICES,
  SOUNDS,
  fits,
  hz,
  melody,
  type Sound,
  type Voice,
} from "../src/app/audio/sounds.js";
import { keys } from "../src/app/session.js";
import { BACK_ATTACK, COMBO, DASH, THROW_STEPS } from "../src/engine/tuning.js";
import {
  CLAWBEAK_STEPS,
  DRAKE_STEPS,
  OGRE_STEPS,
  SIGIL,
  SPELL_STEPS,
} from "../src/engine/view-kit.js";
import type * as V from "../src/engine/view.js";

const hero = (extra: Partial<V.HeroView> = {}): V.HeroView => ({
  ...{ id: 1, seat: 0, kind: "brakka", x: 100, y: 140, z: 0, facing: 1 },
  ...{ anim: "idle", animStep: 0, hp: 60, maxHp: 60, lives: 3 },
  ...{ invulnerable: false, pots: 0, maxPots: 3, charge: 0, mounted: false },
  ...extra,
});
const enemy = (extra: Partial<V.EnemyView> = {}): V.EnemyView => ({
  ...{ id: 9, kind: "ravager", tier: 0, x: 200, y: 140, z: 0, facing: -1 },
  ...{ anim: "idle", animStep: 0, hp: 30, maxHp: 30, flash: false },
  ...{ boss: false, enraged: false, mounted: false, ...extra },
});
const mount = (
  kind: V.MountKind,
  anim: V.MountAnim,
  animStep: number,
  extra: Partial<V.MountView> = {},
): V.MountView => ({
  ...{ id: 7, kind, x: 200, y: 140, z: 0, facing: -1, anim, animStep },
  ...{ rider: { kind: "enemy", id: 9 }, ...extra },
});
const spark = (age: number, extra: Partial<V.FxView> = {}): V.FxView => ({
  ...{ kind: "hit", x: 150, y: 140, z: 20, age, ...extra },
});
const world = (
  step: number,
  extra: Partial<V.WorldView> = {},
): V.WorldView => ({
  ...{ step, camX: 0, heroes: [hero()], enemies: [], fx: [], items: [] },
  ...{ spells: [], mounts: [], stage: 1, camp: false, wave: 1 },
  ...{ waves: 4, locked: false, go: false, cleared: false, defeated: false },
  boss: null,
  sigils: [],
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

test("a real second swing is never taken for a rollback's echo: no move takes less than the echo window to repeat", () => {
  // The fewest steps a hero is busy with one swing, dash or throw before it can begin the same again.
  const busy = [
    ...Object.values(COMBO).flat(),
    ...Object.values(BACK_ATTACK),
  ].map((move) => move.startup + move.active + move.recovery);
  busy.push(...Object.values(DASH).map((dash) => dash.active + dash.recovery));
  busy.push(THROW_STEPS);
  assert.ok(Math.min(...busy) >= ECHO_STEPS, `${Math.min(...busy)} steps`);
  // And a swing's second sounds even with the first heard a window and a step before.
  const at = (step: number, anim: V.HeroAnim, animStep: number) =>
    heroes(step, hero({ anim, animStep }));
  assert.deepEqual(
    hear([
      at(30, "idle", 9),
      at(33, "attack1", 0),
      at(33 + ECHO_STEPS, "idle", 9),
      at(36 + ECHO_STEPS, "attack1", 0),
    ]),
    [[], ["swing-brakka"], [], ["swing-brakka"]],
  );
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

test("a beast's tail winds up with the mace's wind-up cue and lashes round where it lands, once each; its walk and its rider are silent", () => {
  const beast = (anim: V.MountAnim, animStep: number): V.MountView => ({
    ...{ id: 7, kind: "clawbeak", x: 200, y: 140, z: 0, facing: -1 },
    ...{ anim, animStep, rider: { kind: "enemy", id: 9 } },
  });
  const at = (step: number, mount: V.MountView) =>
    frame(
      world(step, {
        enemies: [enemy({ anim: "ride", animStep: 40, mounted: true })],
        mounts: [mount],
      }),
    );
  assert.deepEqual(
    hear([
      at(30, beast("walk", 40)),
      at(33, beast("sweep", 1)), // the wind-up begins
      at(36, beast("sweep", 4)),
      at(50, beast("sweep", CLAWBEAK_STEPS.windup - 2)),
      at(53, beast("sweep", CLAWBEAK_STEPS.windup + 1)), // the tail lands
      at(56, beast("sweep", CLAWBEAK_STEPS.windup - 1)), // a rollback: not yet
      at(59, beast("sweep", CLAWBEAK_STEPS.windup + 2)), // and landed again
      at(70, beast("idle", 3)),
      at(73, beast("sweep", 1)), // another
      at(76, beast("sweep", 4)),
      at(90, beast("flee", 2)),
      at(93, beast("sweep", 30)), // first seen well into its sweep: history
    ]),
    [[], ["windup"], [], [], ["lash"], [], [], [], ["windup"], [], [], []],
  );
});

test("a hero climbs on, its beast hops and its tail winds up, it climbs off and is thrown off: each once", () => {
  const at = (step: number, me: Partial<V.HeroView>, anim: V.MountAnim) =>
    frame(
      world(step, {
        heroes: [hero({ animStep: 1, mounted: me.anim === "ride", ...me })],
        mounts: [
          mount("clawbeak", anim, 1, {
            rider: me.anim === "ride" ? { kind: "hero", id: 1 } : null,
          }),
        ],
      }),
    );
  const ride = { anim: "ride" } as const;
  assert.deepEqual(
    hear([
      at(30, { anim: "walk" }, "wander"),
      at(33, ride, "idle"), // climbs on
      at(36, ride, "hop"),
      at(39, ride, "hop"), // the same hop drawn again
      at(60, ride, "sweep"),
      at(90, { anim: "jump" }, "wander"), // Down and Jump: off the saddle
      at(120, ride, "idle"),
      at(150, { anim: "knockdown", hp: 40 }, "flee"), // thrown off
    ]),
    [
      [],
      ["board"],
      ["hop"],
      [],
      ["windup"],
      ["dismount"],
      ["board"],
      ["knocked"],
    ],
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

test("the stage flow: GO, the continue clock's seconds, game over, a cleared stage's fanfare and the won run's victory", () => {
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
      ["victory"],
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
    "a run's one-off moments are forgotten with it",
  );
});

test("a run's one-off moments are never heard twice, however many runs came before it", () => {
  const ears = new CueTracker();
  /** Lobby, the stage's GO, four waves locking, clearing and calling GO, and the last wave's fanfare. */
  const script = (matchId: string): Heard[] => {
    const at = (step: number, extra: Partial<V.WorldView>, stage = "running") =>
      frame(world(step, extra), { matchId, stage: stage as Heard["stage"] });
    const waves = [1, 2, 3, 4].flatMap((wave) => [
      at(10 * wave, { wave, locked: true }),
      at(10 * wave + 3, { wave }),
      at(10 * wave + 6, { wave, go: true }),
    ]);
    return [
      frame(null, { matchId, round: 0, stage: "lobby" }),
      at(0, {}),
      ...waves,
      at(60, { wave: 4, cleared: true }, "between"),
    ];
  };
  for (let i = 0; i < 40; i++) {
    const [lobby, ...run] = script(`m${i}`);
    ears.next(lobby!);
    const first = run.flatMap((each) => ears.next(each));
    assert.equal(first.length, 14, `run ${i}: GO, 4 × 3 wave cues, fanfare`);
    // A rollback runs the same frames again: every moment has been heard.
    assert.deepEqual(
      run.flatMap((each) => ears.next(each)),
      [],
      `run ${i} again`,
    );
  }
});

test("a page that opens mid-fight does not hear the sparks already flying; the next blow sounds", () => {
  assert.deepEqual(
    hear([
      frame(world(300, { fx: [spark(2)] })),
      frame(world(303, { fx: [spark(5)] })),
      frame(world(306, { fx: [spark(8)] })),
      frame(world(309, { fx: [spark(11), spark(0, { x: 400 })] })),
    ]),
    [[], [], [], ["hit"]],
  );
});

test("two blows on one hero in quick succession each grunt; a blow a rollback shows again grunts once", () => {
  const at = (step: number, hp: number) =>
    heroes(step, hero({ anim: "hurt", animStep: 1, hp }));
  assert.deepEqual(
    hear([
      at(30, 60),
      at(33, 50), // a blow
      at(36, 44), // another, a tick later
      at(39, 60), // both corrected away
      at(42, 50), // the first again
      at(45, 44), // and the second
    ]),
    [[], ["hurt"], ["hurt"], [], [], []],
  );
});

test("camp starts from what it shows, meat eaten there munches, and its fire crackles once on each of its steps", () => {
  const between = (step: number, hp: number, camp: boolean) =>
    frame(world(step, { camp, heroes: [hero({ hp })] }), { stage: "between" });
  const camp = (step: number, hp = 60) => between(step, hp, true);
  assert.deepEqual(
    hear([
      between(900, 60, false), // the stage's tally
      camp(0, 30), // a new world, its step and health and all: no news
      camp(3, 45), // meat
      camp(6, 45),
    ]),
    [[], [], ["munch"], []],
  );
  const ears = new CueTracker(),
    crackled: number[] = [];
  for (let step = 0; step <= 2 * CRACKLE_CYCLE; step += 3)
    if (ears.next(camp(step)).includes("crackle")) crackled.push(step);
  // Each crackle after the first frame, heard on the frame that steps past it.
  const due = [...CRACKLES, ...CRACKLES.map((at) => at + CRACKLE_CYCLE)]
    .concat(2 * CRACKLE_CYCLE)
    .filter((at) => at > 0)
    .map((at) => 3 * Math.ceil(at / 3));
  assert.deepEqual(crackled, due);
  // A rollback steps back over one and shows it again: heard once. Off the road there is no fire.
  const back = CRACKLE_CYCLE + CRACKLES[2]!;
  assert.deepEqual(
    hear([camp(back - 4), camp(back - 1), camp(back + 2)], ears),
    [[], [], []],
  );
  assert.deepEqual(
    hear([0, 3, 6, 9, 12, 15].map((step) => frame(world(step)))),
    [[], [], [], [], [], []],
  );
});

const foes = (step: number, ...list: V.EnemyView[]) =>
  frame(world(step, { enemies: list }));

test("a lancer thrusts, leaps (one leaping in sounds as it first shows) and plunges, each once; one first seen mid-leap is history", () => {
  const lancer = (anim: V.EnemyAnim, animStep: number, id = 9) =>
    enemy({ id, kind: "lancer", anim, animStep });
  assert.deepEqual(
    hear([
      foes(30, lancer("idle", 9)),
      foes(33, lancer("windup", 1)),
      foes(36, lancer("thrust", 1)),
      foes(39, lancer("recover", 2)),
      foes(42, lancer("thrust", 7)), // a rollback shows the thrust again
      foes(45, lancer("recover", 2), lancer("leap", 2, 10)), // in from the edge
      foes(48, lancer("recover", 5), lancer("plunge", 1, 10)),
      foes(
        51,
        lancer("idle", 1),
        lancer("plunge", 4, 10),
        lancer("leap", 20, 11),
      ),
    ]),
    [[], ["windup"], ["thrust"], [], [], ["leap"], ["plunge"], []],
  );
});

test("an ember drake draws breath, then its flame catches; the captain's saddle thrust winds up and lands: each once", () => {
  const { inhale, lanceWindup } = DRAKE_STEPS;
  const at = (step: number, anim: V.MountAnim, animStep: number) =>
    frame(
      world(step, {
        enemies: [enemy({ kind: "captain", anim: "ride", mounted: true })],
        mounts: [mount("drake", anim, animStep)],
      }),
    );
  assert.deepEqual(
    hear([
      at(30, "walk", 10),
      at(33, "breathe", 1),
      at(36, "breathe", 4),
      at(60, "breathe", inhale - 2),
      at(63, "breathe", inhale + 1), // the flame
      at(66, "breathe", inhale - 1), // a rollback: not yet
      at(69, "breathe", inhale + 2), // caught again
      at(100, "lance", 1),
      at(120, "lance", lanceWindup - 1),
      at(123, "lance", lanceWindup + 2), // the spear lands
    ]),
    [[], ["inhale"], [], [], ["flame"], [], [], ["windup"], [], ["thrust"]],
  );
});

test("the Ogre twins: the slam, the sweep drawn back and heaved round, and the twin left standing bellowing once", () => {
  const ogre = (
    id: number,
    anim: V.EnemyAnim,
    animStep: number,
    enraged = false,
  ) => enemy({ id, kind: "ogre", boss: true, anim, animStep, enraged });
  const { sweepWindup } = OGRE_STEPS;
  assert.deepEqual(
    hear([
      foes(30, ogre(9, "windup", 20), ogre(10, "walk", 5)),
      foes(33, ogre(9, "slam", 1), ogre(10, "walk", 8)),
      foes(36, ogre(9, "slam", 4), ogre(10, "sweep", 1)),
      foes(48, ogre(9, "recover", 2), ogre(10, "sweep", sweepWindup - 2)),
      foes(51, ogre(9, "recover", 5), ogre(10, "sweep", sweepWindup + 1)),
      foes(54, ogre(9, "dead", 1), ogre(10, "sweep", sweepWindup + 4, true)),
      foes(57, ogre(9, "dead", 4), ogre(10, "sweep", sweepWindup + 7)), // a rollback
      foes(60, ogre(9, "dead", 7), ogre(10, "sweep", sweepWindup + 10, true)),
    ]),
    [[], ["slam"], ["windup"], [], ["heave"], ["enrage"], [], []],
  );
  // An ogre first seen enraged (a page opened late) is not news.
  assert.deepEqual(
    hear([
      foes(30, ogre(10, "walk", 5, true)),
      foes(33, ogre(10, "walk", 8, true)),
    ]),
    [[], []],
  );
});

test("bonewalkers claw up, fall to a pile, pull themselves together and shatter, each once; a second fall to dead is silent", () => {
  const bones = (anim: V.EnemyAnim, animStep: number, id = 9) =>
    enemy({ id, kind: "bonewalker", anim, animStep });
  assert.deepEqual(
    hear([
      foes(30, bones("walk", 5)),
      foes(33, bones("walk", 8), bones("rise", 2, 10)), // claws up
      foes(36, bones("knockdown", 1), bones("rise", 5, 10)),
      foes(60, bones("pile", 1), bones("idle", 3, 10), bones("rise", 30, 11)),
      foes(63, bones("pile", 4), bones("idle", 6, 10), bones("rise", 33, 11)),
      foes(90, bones("reassemble", 2), bones("walk", 9, 10)),
      foes(120, bones("walk", 9), bones("pile", 1, 10)),
      foes(123, bones("knockdown", 1), bones("dead", 1, 10)), // a blow shatters it
      foes(150, bones("dead", 1), bones("dead", 28, 10)), // the second fall
    ]),
    [
      [],
      ["rise"],
      [],
      ["collapse"],
      [],
      ["reassemble"],
      ["collapse"],
      ["shatter"],
      [],
    ],
  );
});

test("Vorhal: wind-up and two cuts, the spell, its sigils and their pillars, the summons, the leap, the roar and the fall, each once", () => {
  const sigil = (age: number, x = 100): V.SigilView => ({ x, y: 140, age });
  const at = (
    step: number,
    anim: V.EnemyAnim,
    animStep: number,
    sigils: V.SigilView[] = [],
  ) =>
    frame(
      world(step, {
        enemies: [enemy({ kind: "vorhal", boss: true, anim, animStep })],
        sigils,
      }),
    );
  const erupt = SIGIL.delay;
  assert.deepEqual(
    hear([
      at(30, "idle", 9),
      at(33, "windup", 1),
      at(60, "cut1", 1),
      at(75, "cut2", 1),
      at(100, "cast", 1),
      at(120, "cast", 21, [sigil(1), sigil(1, 200)]), // two sigils, one glint
      at(123, "cast", 24, [sigil(4), sigil(4, 200)]),
      at(126, "cast", 27, [sigil(5, 104), sigil(7, 200)]), // a rollback moved one
      at(170, "idle", 30, [sigil(erupt - 2), sigil(erupt - 2, 200)]),
      at(173, "idle", 33, [sigil(erupt + 1), sigil(erupt + 1, 200)]), // the pillars
      at(176, "idle", 36, [sigil(erupt + 4), sigil(erupt + 4, 200)]),
      at(200, "summon", 1),
      at(260, "leap", 1),
      at(300, "roar", 1),
      at(303, "roar", 4),
      at(400, "dead", 1),
    ]),
    [
      ...[[], ["windup"], ["cut"], ["cut"], ["hex"], ["sigil"], [], []],
      ...[[], ["pillar"], [], ["summon"], ["leap"], ["roar"], []],
      ["vorhal-falls"],
    ],
  );
  // A page that opens on sigils already marked hears neither them nor pillars already burning, nor pillars of sigils
  // it never saw glow.
  assert.deepEqual(
    hear([
      at(500, "cast", 25, [sigil(5)]),
      at(503, "cast", 28, [sigil(8)]),
      at(600, "idle", 9, [sigil(erupt + 2, 300)]),
    ]).concat(
      hear([
        at(600, "idle", 9, [sigil(erupt + 2)]),
        at(603, "idle", 12, [sigil(erupt + 5)]),
      ]),
    ),
    [[], [], [], [], []],
  );
});

test("Magic: each level of the charge chimes a step higher, once; the spell's cast and its blow sound its kind, once each", () => {
  const spell = (kind: V.SpellKind, age: number): V.SpellView => ({
    ...{ hero: 1, kind, level: 2, age },
  });
  const at = (
    step: number,
    me: Partial<V.HeroView>,
    spells: V.SpellView[] = [],
  ) => frame(world(step, { heroes: [hero({ pots: 3, ...me })], spells }));
  const charging = (animStep: number, charge: number) =>
    ({ anim: "charge", animStep, charge }) as const;
  assert.deepEqual(
    hear([
      at(30, {}),
      at(33, charging(1, 1)),
      at(36, charging(4, 1)),
      at(57, charging(25, 2)),
      at(60, charging(28, 1)), // a rollback: not yet
      at(63, charging(31, 2)), // and again
      at(80, charging(48, 3)),
    ]),
    [[], ["charge1"], [], ["charge2"], [], [], ["charge3"]],
  );
  const pitches = CHARGE_TICKS.map((cue) => SOUNDS[cue].voices[0]!.freq);
  assert.deepEqual(
    pitches,
    [...new Set(pitches)].sort((a, b) => a - b),
  );
  assert.deepEqual(
    hear([at(30, charging(48, 9))]).concat(
      hear([at(30, {}), at(33, charging(1, 9))]),
    ),
    [[], [], ["charge6"]],
    "a first frame mid-charge is not news; Rhea's sixth level is the top chime",
  );
  const blows = { storm: "thunder", fire: "blaze", earth: "tremor" } as const;
  for (const kind of ["storm", "fire", "earth"] as const) {
    const { hit } = SPELL_STEPS[kind][1]!,
      cast = { anim: "cast", animStep: 1, pots: 1 } as const;
    assert.deepEqual(
      hear([
        at(30, {}),
        at(33, cast, [spell(kind, 1)]),
        at(36, cast, [spell(kind, 4)]),
        at(30 + hit, cast, [spell(kind, hit - 2)]),
        at(33 + hit, cast, [spell(kind, hit + 1)]),
        at(36 + hit, cast, [spell(kind, hit - 1)]), // a rollback: not yet
        at(39 + hit, cast, [spell(kind, hit + 2)]),
      ]),
      [[], [`cast-${kind}`], [], [], [blows[kind]], [], []],
      kind,
    );
    // Opened mid-spell, or first shown past its blow: neither is news.
    assert.deepEqual(
      hear([
        at(30, cast, [spell(kind, 5)]),
        at(33, cast, [spell(kind, 8)]),
        at(30 + hit, { pots: 1 }),
        at(33 + hit, cast, [spell(kind, hit + 1)]),
      ]),
      [[], [], [], []],
      kind,
    );
  }
});

test("stages 2 to 4 open on a horn of their own, a boss's bar on a sting once a wave, and the run's win on the victory after the stage's fanfare", () => {
  const boss: V.BossView = { kind: "captain", hp: 300, maxHp: 300 };
  const at = (
    step: number,
    round: number,
    extra: Partial<V.WorldView> = {},
    stage: Heard["stage"] = "running",
  ) => frame(world(step, { stage: round, ...extra }), { round, stage });
  const fight = { locked: true, wave: 4 };
  assert.deepEqual(
    hear([
      frame(null, { stage: "lobby" }),
      at(0, 1),
      at(3, 1, { cleared: true }, "between"),
      at(0, 2),
      at(30, 2, fight),
      at(33, 2, { ...fight, boss }),
      at(36, 2, fight), // a rollback's flicker
      at(39, 2, { ...fight, boss }),
      at(42, 2, { ...fight, locked: false, cleared: true }, "between"),
      at(0, 3),
      at(3, 3, { cleared: true }, "between"),
      at(0, 4),
      at(3, 4, { cleared: true }, "between"),
      frame(world(6, { stage: 4 }), {
        round: 4,
        stage: "over",
        outcome: "victory",
      }),
    ]),
    [
      ...[[], ["go"], ["fanfare"], ["stage2"], ["locked"], ["boss"], [], []],
      ...[["fanfare"], ["stage3"], ["fanfare"], ["stage4"], ["fanfare"]],
      ["victory"],
    ],
  );
  const length = (sound: Sound) =>
    Math.max(...sound.voices.map((one) => (one.at ?? 0) + one.dur));
  assert.ok(length(SOUNDS.victory) > length(SOUNDS.fanfare));
});

test("the mix: no cue peaks louder than the heavy hit, and every effect is a handful of voices", () => {
  const peak = (sound: Sound) =>
    Math.max(
      ...sound.voices.map(({ at = 0 }) =>
        sound.voices
          .filter((one) => (one.at ?? 0) <= at && at < (one.at ?? 0) + one.dur)
          .reduce((sum, one) => sum + one.vol, 0),
      ),
    );
  for (const cue of CUES)
    assert.ok(peak(SOUNDS[cue]) <= peak(SOUNDS.heavy) + 1e-9, cue);
  for (const cue of CUES)
    if (SOUNDS[cue].channel === "effects")
      assert.ok(SOUNDS[cue].voices.length <= 6, cue);
});

test("a crowded fight sounds only so many voices: an effect past the cap is dropped, a jingle never", () => {
  assert.ok(fits(SOUNDS.hit, 0));
  assert.ok(fits(SOUNDS.hit, MAX_VOICES - SOUNDS.hit.voices.length));
  assert.ok(!fits(SOUNDS.hit, MAX_VOICES - SOUNDS.hit.voices.length + 1));
  assert.ok(fits(SOUNDS.fanfare, MAX_VOICES * 2));
  assert.ok(
    CUES.every((cue) => SOUNDS[cue].voices.length <= MAX_VOICES / 2),
    "no one cue needs more than half the cap",
  );
});

class FakeBackend implements AudioBackend {
  calls: string[] = [];
  unlock = () => this.calls.push("unlock");
  play = (sound: Sound) =>
    this.calls.push(`play:${CUES.find((cue) => SOUNDS[cue] === sound)}`);
  music = (tune: Song | null) =>
    this.calls.push(`music:${tune?.name ?? "none"}`);
  duck = (seconds: number) => this.calls.push(`duck:${seconds}`);
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

test("nothing sounds before a gesture; the first starts the stage's loop and the cues after it play", () => {
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
  assert.deepEqual(backend.take(), [
    "unlock",
    "music:march",
    "play:swing-brakka",
    "unlock",
  ]);
  assert.equal(audio.state, "on");
  audio.frame(frame(world(30)), true);
  audio.frame(swing(60), true);
  assert.deepEqual(backend.take(), ["music:none"], "a controller is quiet");
  assert.equal(audio.heard, 3);
});

test("the loop follows the stage, ducks under the fanfare and stops in the lobby and at the run's end", () => {
  const { backend, audio } = setUp(),
    go = ["music:march", "play:go", "duck:0.9"];
  audio.unlock();
  audio.frame(LOBBY);
  assert.deepEqual(backend.take(), ["unlock"]);
  audio.frame(frame(world(0)));
  audio.frame(frame(world(3), { stage: "between" }));
  audio.frame(frame(world(6), { stage: "over", outcome: "victory" }));
  audio.frame(LOBBY);
  // The victory comes once the loop has stopped: there is nothing to duck.
  assert.deepEqual(backend.take(), [
    ...go,
    "play:fanfare",
    "duck:2.2",
    "music:none",
    "play:victory",
  ]);
  audio.frame(frame(world(0), { matchId: "m2" }));
  audio.frame(
    frame(world(3), { matchId: "m2", stage: "over", outcome: "defeat" }),
  );
  audio.frame(frame(world(0), { matchId: "m3" }));
  audio.stop();
  assert.deepEqual(backend.take(), [
    ...go,
    "music:none",
    "play:gameover",
    ...go,
    "music:none",
  ]);
});

test("?mute: nothing reaches the backend (no context is built, no loop starts), the kept choices are never read or written, the toggles do nothing", () => {
  const { backend, store, audio } = setUp(
    true,
    fakeStore({ [NAMES.music]: "1" }),
  );
  audio.unlock();
  for (const each of [LOBBY, swing(0), swing(30)]) audio.frame(each);
  audio.hide(false);
  audio.stop();
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

test("a boss's loud moments duck the loop; muted, none of them reaches the backend, though each is heard", () => {
  const vorhal = (step: number, anim: V.EnemyAnim) =>
    frame(
      world(step, { enemies: [enemy({ kind: "vorhal", anim, animStep: 1 })] }),
    );
  for (const muted of [false, true]) {
    const { backend, store, audio } = setUp(muted);
    audio.unlock();
    for (const each of [
      LOBBY,
      vorhal(0, "idle"),
      vorhal(30, "roar"),
      vorhal(90, "summon"),
    ])
      audio.frame(each);
    assert.deepEqual(
      [backend.take(), store.log],
      [
        muted
          ? []
          : [
              ...["unlock", "music:march", "play:go", "duck:0.9", "play:roar"],
              ...[`duck:${SOUNDS.roar.duck}`, "play:summon", "duck:1.2"],
            ],
        muted ? [] : ["get fuse-axe-music", "get fuse-axe-effects"],
      ],
    );
    assert.equal(audio.heard, 3);
  }
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
  assert.deepEqual(backend.take(), [
    "unlock",
    "music:march",
    "music:none",
    "play:swing-brakka",
  ]);
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
    "music:march",
    "play:go",
    "duck:0.9",
    "play:fanfare",
    "duck:2.2",
    "play:go",
    "duck:0.9",
    "music:none",
    "play:gameover",
  ]);
  assert.equal(store.data.get(NAMES.effects), "1");
});

test("a backend that fails costs a sound or the loop, never the frame", () => {
  const { backend, audio } = setUp();
  audio.unlock();
  const tried: string[] = [];
  const fail = (what: string) => () => {
    tried.push(what);
    throw new Error("the audio graph is gone");
  };
  backend.play = fail("play");
  backend.music = fail("music");
  backend.duck = fail("duck");
  audio.frame(LOBBY);
  assert.doesNotThrow(() => audio.frame(frame(world(0))));
  assert.doesNotThrow(() => audio.frame(swing(3)));
  assert.doesNotThrow(() => audio.frame(LOBBY));
  assert.deepEqual(tried, ["music", "play", "duck", "play", "music"]);
  assert.equal(audio.heard, 2, "the page heard GO and the swing");
});

test("a hidden tab is silent, and shown again comes back to the loop the stage wants", () => {
  const { backend, audio } = setUp();
  audio.unlock();
  audio.frame(frame(world(0)));
  audio.hide(true);
  audio.unlock();
  audio.frame(swing(3));
  audio.frame(LOBBY);
  assert.equal(audio.state, "hidden");
  audio.hide(false);
  audio.frame(frame(world(30)));
  audio.frame(swing(60));
  assert.deepEqual(backend.take(), [
    ...["unlock", "music:march", "hide:true", "hide:false", "music:none"],
    ...["music:march", "play:go", "duck:0.9", "play:swing-brakka"],
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
    ["fanfare", "gameover", "victory", "boss", "stage2", "stage3", "stage4"],
  );
  assert.ok(CUES.every((cue) => SOUNDS[cue].voices.length > 0));
  // Only what is heard over the loop ducks it, and of the effects only the long and loud: the game over and the
  // victory come after the loop has stopped.
  assert.deepEqual(
    CUES.filter((cue) => {
      const sound: Sound = SOUNDS[cue];
      return sound.duck !== undefined;
    }),
    [
      ...["go", "fanfare", "boss", "stage2", "stage3", "stage4", "slam"],
      ...["enrage", "pillar", "summon", "roar", "vorhal-falls", "thunder"],
      ...["blaze", "tremor"],
    ],
  );
});

test("the march: a 30 to 60 second loop in A minor whose bass never rests", () => {
  const seconds = MARCH.steps.length * MARCH.step;
  assert.ok(seconds >= 30 && seconds <= 60, `${seconds} s`);
  const tones = MARCH.steps
    .flat()
    .filter((one) => one.wave !== "noise" && one.wave !== "sine");
  const pitches = new Set(
    tones.map((one) => (Math.round(12 * Math.log2(one.freq / 440)) + 120) % 12),
  );
  // A B C D E F G and the leading note G#, in semitones above A.
  assert.deepEqual(
    [...pitches].sort((a, b) => a - b),
    [0, 2, 3, 5, 7, 8, 10, 11],
  );
  assert.ok(
    MARCH.steps.every((voices) =>
      voices.some((one) => one.wave === "triangle"),
    ),
  );
  assert.throws(
    () => song("short", "a4 a4", "a", "k ."),
    /short: lead 2, bass 4, drums 2/,
  );
});

test("the sequencer hands out each step once, a little ahead, loops, and skips a stall's backlog", () => {
  const tune = song("t", "a4 c5 e5 a5", "a", "k . s ."),
    seq = new Sequencer(tune, 0.05),
    step = tune.step;
  const times = (list: { at: number }[]) => [
    ...new Set(list.map((one) => one.at)),
  ];
  assert.deepEqual(times(seq.due(0, step + 0.06)), [0.05, 0.05 + step]);
  assert.deepEqual(seq.due(0.01, step + 0.06), []);
  assert.deepEqual(times(seq.due(3 * step, step)), [0.05 + 3 * step]);
  assert.equal(seq.due(4 * step, step)[0]!.voice.freq, 440, "round again");
  const late = seq.due(100, step);
  assert.ok(
    late.length > 0 &&
      late.every((one) => one.at >= 100 && one.at < 100 + step),
    "no backlog",
  );
});

/** An audio graph that records each voice it is handed and ends one only when told to. */
class FakeSynth implements Synth {
  time = 0;
  running = true;
  voices: { at: number; bus: Bus; voice: Voice; end: () => void }[] = [];
  /** The moments each duck was asked to lift at. */
  ducks: number[] = [];
  voice = (voice: Voice, at: number, bus: Bus, ended: () => void) => {
    this.voices.push({ at, bus, voice, end: ended });
  };
  duck = (until: number) => this.ducks.push(until);
  on = (bus: Bus) => this.voices.filter((one) => one.bus === bus);
  /** Ends every voice handed out so far. */
  endAll = () => this.voices.splice(0).forEach((one) => one.end());
}
/** A repeating timer driven by hand: `tick` runs each pump started and not yet stopped. */
function fakeRepeat() {
  const pumps = new Set<() => void>(),
    periods: number[] = [];
  const repeat: Repeat = (tick, ms) => {
    const pump = () => tick();
    periods.push(ms);
    pumps.add(pump);
    return () => pumps.delete(pump);
  };
  return { repeat, pumps, periods, tick: () => pumps.forEach((p) => p()) };
}
const mixing = () => {
  const synth = new FakeSynth(),
    timer = fakeRepeat();
  return { synth, timer, mixer: new Mixer(synth, timer.repeat) };
};

test("the loop's voices go to the loop a little ahead of time, and each is released as it ends", () => {
  const { synth, timer, mixer } = mixing();
  synth.time = 1;
  mixer.music(MARCH);
  mixer.music(MARCH);
  assert.deepEqual(
    [timer.pumps.size, timer.periods],
    [1, [PUMP_MS, PUMP_MS]],
    "one pump",
  );
  timer.tick();
  const first = synth.on("loop");
  assert.equal(first.length, MARCH.steps[0]!.length, "the first step, once");
  assert.ok(first.every((one) => one.at >= 1 && one.at < 1 + AHEAD));
  assert.equal(mixer.sounding, first.length);
  for (let t = 1; t < 3; t += PUMP_MS / 1000) {
    synth.time = t;
    timer.tick();
  }
  assert.ok(mixer.sounding > first.length, "the loop goes on");
  assert.ok(synth.voices.every((one) => one.bus === "loop"));
  synth.voices[0]!.end();
  synth.voices[0]!.end(); // an ended voice is released once
  assert.equal(mixer.sounding, synth.voices.length - 1);
  synth.endAll();
  assert.equal(mixer.sounding, 0, "every voice released");
  mixer.music(null);
  assert.equal(timer.pumps.size, 0, "the loop stops");
  timer.tick();
  assert.deepEqual(synth.voices, []);
});

test("the loop's voices count toward the cap, which drops effects but never holds the loop back", () => {
  const { synth, timer, mixer } = mixing();
  mixer.music(MARCH);
  for (let t = 0; mixer.sounding <= MAX_VOICES; t += MARCH.step) {
    synth.time = t;
    timer.tick();
  }
  assert.ok(mixer.sounding > MAX_VOICES, "the pump ignores the cap");
  mixer.play(SOUNDS.hit);
  assert.deepEqual(
    synth.on("effects"),
    [],
    "an effect with no room is dropped",
  );
  mixer.play(SOUNDS.fanfare);
  assert.equal(
    synth.on("effects").length,
    SOUNDS.fanfare.voices.length,
    "a jingle always sounds",
  );
  synth.endAll();
  mixer.play(SOUNDS.hit);
  const hits = synth.on("effects");
  assert.equal(hits.length, SOUNDS.hit.voices.length, "room again");
  assert.deepEqual(
    hits.map((one) => one.at),
    SOUNDS.hit.voices.map((one) => synth.time + (one.at ?? 0)),
  );
});

test("a suspended clock is handed nothing, and picks the loop up where it stopped, with no backlog", () => {
  const { synth, timer, mixer } = mixing();
  synth.time = 2;
  synth.running = false; // the first gesture's resume is still pending
  mixer.music(MARCH);
  for (let i = 0; i < 50; i++) timer.tick();
  mixer.play(SOUNDS.hit);
  assert.deepEqual([synth.voices, mixer.sounding], [[], 0]);
  synth.running = true;
  timer.tick();
  const steps = new Set(synth.voices.map((one) => one.at));
  assert.deepEqual([...steps], [2.05], "one step, not a pile");
  synth.time = 2.5;
  timer.tick();
  const before = synth.voices.length;
  synth.running = false; // the tab is hidden: the clock stands still
  for (let i = 0; i < 50; i++) timer.tick();
  assert.equal(synth.voices.length, before, "nothing while suspended");
  synth.running = true;
  timer.tick();
  assert.equal(synth.voices.length, before, "nothing new is due yet");
  synth.time = 2.5 + MARCH.step;
  timer.tick();
  assert.ok(synth.voices.length > before, "and on it goes");
  assert.ok(synth.voices.every((one) => one.at < synth.time + AHEAD));
});

test("a voice the graph fails to render never holds a place under the cap", () => {
  const { synth, mixer } = mixing();
  synth.voice = () => {
    throw new Error("the context is closed");
  };
  assert.throws(() => mixer.play(SOUNDS.hit), /closed/);
  assert.equal(mixer.sounding, 0);
});

test("a voice of the loop the graph will not take costs that voice, never the timer's tick or the voices beside it", () => {
  const { synth, timer, mixer } = mixing(),
    refused: Voice[] = [],
    render = synth.voice;
  // The first voice of the first step fails, the way a node on a closing context would.
  synth.voice = (voice, at, bus, ended) => {
    if (refused.length === 0) {
      refused.push(voice);
      throw new Error("the context is closed");
    }
    render(voice, at, bus, ended);
  };
  mixer.music(MARCH);
  assert.doesNotThrow(() => timer.tick());
  const step = MARCH.steps[0]!;
  assert.deepEqual(
    synth.voices.map((one) => one.voice),
    step.slice(1),
    "the others of the step still sound",
  );
  assert.equal(
    mixer.sounding,
    step.length - 1,
    "the failed one holds no place",
  );
  synth.time = MARCH.step;
  timer.tick();
  assert.ok(synth.voices.length > step.length - 1, "the loop goes on");
});

test("through two loops at a jittery pump every step sounds exactly once, on the grid: no drift, none doubled at the loop's end", () => {
  const { synth, timer, mixer } = mixing(),
    start = 0.05,
    steps = MARCH.steps.length * 2;
  mixer.music(MARCH);
  // Each pump comes a little early or late, never so late as to miss the lookahead.
  const gaps = [0.04, 0.07, 0.03, 0.1, 0.04];
  for (
    let i = 0, t = 0;
    t < steps * MARCH.step;
    t += gaps[i++ % gaps.length]!
  ) {
    synth.time = t;
    timer.tick();
  }
  // The last pump hands out a step or two of the third time round, a little ahead: those are not counted.
  const heard = synth.voices
    .filter((one) => one.at < start + steps * MARCH.step)
    .map((one) => [one.at, one.voice]);
  const due = [];
  for (let i = 0; i < steps; i++)
    for (const voice of MARCH.steps[i % MARCH.steps.length]!)
      due.push([start + i * MARCH.step, voice]);
  assert.deepEqual(heard, due);
});

test("a duck lasts until the longest cue under it is over: a shorter one inside it never lifts it early", () => {
  const { synth, mixer } = mixing();
  synth.time = 10;
  mixer.duck(SOUNDS.fanfare.duck);
  synth.time = 11; // GO, inside the fanfare's duck
  mixer.duck(SOUNDS.go.duck);
  synth.time = 20; // and on its own, long after
  mixer.duck(SOUNDS.go.duck);
  assert.deepEqual(synth.ducks, [
    10 + SOUNDS.fanfare.duck,
    10 + SOUNDS.fanfare.duck,
    20 + SOUNDS.go.duck,
  ]);
});
