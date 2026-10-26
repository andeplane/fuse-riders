import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAW,
  ITEMS,
  NO_WINNER,
  SPELL_EFFECTS,
  STEPS_PER_SECOND,
  SURGE_AFTER,
  WAVE_EVERY,
  WAVE_FIRST,
  SUB,
  TILE_PX,
  createWorld,
  viewOf,
  type CombatEvent,
  type Mark,
  type WorldView,
} from "../src/engine/index.js";
import { mapById } from "../src/online/maps.js";
import {
  CueGate,
  LATE_STEPS,
  Limiter,
  MAX_VOICES,
  cuesOf,
  spatial,
} from "../src/app/audio/cues.js";
import {
  FrontAudio,
  type AudioBackend,
  type AudioStore,
  type Repeat,
} from "../src/app/audio/director.js";
import {
  SOUNDS,
  type CueKind,
  type Sound,
  type Voice,
} from "../src/app/audio/sounds.js";

const TILE = SUB * TILE_PX;
const MAP = mapById("neon-duel");
const view = (): WorldView => viewOf(MAP, createWorld(MAP, [0, 1], 1));
const KEYS = { music: "m", effects: "e" };
const ourTurret = (world: WorldView) =>
  world.buildings.find((b) => b.kind === "turret" && b.team === 0)!.id;
const kindOf = (sound: Sound) =>
  (Object.keys(SOUNDS) as CueKind[]).find((kind) => SOUNDS[kind] === sound)!;

/** The backend as the director sees it: records what it was asked to play, on a clock the test moves. */
class FakeBackend implements AudioBackend {
  clock = 0;
  readonly played: { kind: CueKind; gain: number; pan: number }[] = [];
  readonly calls: string[] = [];
  now = () => this.clock;
  unlock = () => void this.calls.push("unlock");
  ready = () => true;
  play = (sound: Sound, gain: number, pan: number) =>
    void this.played.push({ kind: kindOf(sound), gain, pan });
  hide = (hidden: boolean) => void this.calls.push(`hide ${hidden}`);
  duck = (seconds: number) => void this.calls.push(`duck ${seconds}`);
  /** The audio clock: none until a context runs. */
  audioTime: number | undefined = 0;
  readonly scheduled: { voice: Voice; at: number }[] = [];
  time = () => this.audioTime;
  schedule = (voice: Voice, at: number) =>
    void this.scheduled.push({ voice, at });
  count = (kind: CueKind) => this.played.filter((p) => p.kind === kind).length;
}
class FakeStore implements AudioStore {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) =>
    void (this.writes++, this.items.set(key, value));
}
/** The music's timer, ticked by hand. */
class FakeRepeat {
  readonly ticks: (() => void)[] = [];
  readonly repeat: Repeat = (tick) => void this.ticks.push(tick);
  pump = () => this.ticks.forEach((tick) => tick());
}
const setup = (muted = false, unlock = true) => {
  const [backend, store, timer] = [
    new FakeBackend(),
    new FakeStore(),
    new FakeRepeat(),
  ];
  const audio = new FrontAudio(backend, store, KEYS, muted, timer.repeat);
  if (unlock) audio.unlock();
  return { backend, store, audio, timer };
};
const at = (x: number, y: number) => ({ x: x * TILE, y: y * TILE });
// prettier-ignore
const mark = (of: Mark["of"], id: number, x = 5, y = 5): Mark => ({ of, id, ...at(x, y) });
// prettier-ignore
const shot = (from: Mark, to = mark("unit", 999), damage = 1): CombatEvent => ({ type: "shot", from, to, damage });

test("events map to their cues: guns by shooter, deaths, ruins, this seat's moments and every spell", () => {
  const world = view();
  const turret = ourTurret(world);
  const kinds = (event: CombatEvent, seat = 0) =>
    cuesOf(event, world, seat).map((cue) => cue.kind);
  const siege = shot(mark("hero", 1), mark("building", turret));
  // prettier-ignore
  const ruin: CombatEvent = { type: "destroyed", building: turret, kind: "turret" };
  const death = { type: "death", id: 1, owner: 1, ...at(3, 3) } as const;
  const owners = world.sectorOwners;
  const ours = owners.findIndex((o) => o >= 0 && o % 2 === 0);
  const neutral = owners.indexOf(-1);
  assert.ok(ours >= 0 && neutral >= 0);
  // prettier-ignore
  const use = { type: "item", seat: 0, slot: 0, ...at(1, 1), toX: 0, toY: 0 } as const;
  // prettier-ignore
  const cases: [CombatEvent, number, CueKind[]][] = [
    [shot(mark("hero", 1)), 0, ["heroShot"]],
    [shot(mark("building", turret)), 0, ["tower"]],
    [siege, 0, ["heroShot", "underAttack"]],
    [siege, 1, ["heroShot"]],
    [{ ...death, kind: "grunt" }, 0, ["robotDeath"]],
    [{ ...death, kind: "lightTank" }, 0, ["tankDeath"]],
    [ruin, 0, ["structure", "structureLost"]],
    [ruin, 1, ["structure"]],
    [{ type: "heroDeath", seat: 0, killer: 1, ...at(1, 1) }, 0, ["myDeath"]],
    [{ type: "heroDeath", seat: 1, killer: 0, ...at(1, 1) }, 0, ["heroDeath"]],
    [{ type: "levelUp", seat: 0, level: 2 }, 0, ["levelUp"]],
    [{ type: "levelUp", seat: 1, level: 2 }, 0, []],
    [{ type: "capture", sector: neutral, seat: 2 }, 0, ["flagTaken"]],
    [{ type: "capture", sector: ours, seat: 1 }, 0, ["flagLost"]],
    [{ type: "capture", sector: neutral, seat: 1 }, 0, []],
    [{ type: "capture", sector: ours, seat: 1 }, -1, []],
    [{ type: "won", winner: 0 }, 0, ["victory"]],
    [{ type: "won", winner: 1 }, 0, ["defeat"]],
    [{ type: "won", winner: 1 }, -1, ["victory"]],
    [{ type: "won", winner: DRAW }, 0, ["defeat"]],
    [{ type: "won", winner: NO_WINNER }, 0, []],
    [{ type: "respawn", seat: 0, ...at(1, 1) }, 0, ["respawn"]],
    [{ type: "mine", seat: 1, ...at(1, 1) }, 0, ["mineBlast"]],
    [{ ...use, item: ITEMS.findIndex((i) => i.active === "shield") }, 0, ["shield"]],
    [{ ...use, item: ITEMS.findIndex((i) => i.active === "blink") }, 0, ["blink"]],
    [{ ...use, item: 0 }, 0, ["item"]],
  ];
  for (const [event, seat, expected] of cases)
    assert.deepEqual(kinds(event, seat), expected, JSON.stringify(event));
  assert.ok(SPELL_EFFECTS.length >= 12);
  for (const effect of SPELL_EFFECTS) {
    const cast = { type: "cast", seat: 0, slot: 0, effect, toX: 0, toY: 0 };
    assert.deepEqual(kinds({ ...cast, ...at(1, 1) } as CombatEvent), [effect]);
  }
});

test("a sound is full and panned on screen and fades past its edge, more so zoomed in", () => {
  const camera = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const hear = (x: number, box = camera) =>
    spatial(at(x, 50), box, { width: 100, height: 100 });
  assert.deepEqual(hear(50), { gain: 1, pan: 0 });
  assert.equal(hear(74).gain, 1);
  assert.ok(hear(74).pan > 0.6 && hear(26).pan < -0.6);
  const off = hear(99);
  assert.ok(off.gain < 0.5 && off.gain > 0, String(off.gain));
  assert.equal(off.pan, 0.7);
  assert.ok(hear(99, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }).gain < off.gain);
});

test("each event sounds once across a rollback re-run, and late events never", () => {
  const gate = new CueGate();
  const event = shot(mark("hero", 0));
  const accept = (step: number, e = event, shown?: number, match = "m1") =>
    gate.accept(match, { step, event: e }, shown);
  assert.equal(accept(100), true);
  // The rollback re-runs step 100 and delivers the same event again: silent. A re-run that changed it plays.
  assert.equal(accept(100), false);
  assert.equal(accept(100, shot(mark("hero", 0), undefined, 2)), true);
  assert.equal(accept(300), true);
  // Behind the newest by more than the window: too late to matter.
  assert.equal(accept(300 - LATE_STEPS - 1), false);
  assert.equal(accept(300 - LATE_STEPS), true);
  // A device catching up on a shown world far ahead plays nothing stale; a new match starts over.
  assert.equal(accept(400, event, 400 + 3 * STEPS_PER_SECOND), false);
  assert.equal(accept(100, event, undefined, "m2"), true);
});

test("the director plays a rollback's events once, placed against the camera", () => {
  const { backend, audio } = setup();
  const world = view();
  audio.camera = { x: 0, y: 0, w: 0.5, h: 0.5 };
  const stamped = { step: world.step, event: shot(mark("hero", 1, 1, 1)) };
  for (let replay = 0; replay < 3; replay++)
    audio.event("m", stamped, world, 0);
  assert.equal(backend.played.length, 1);
  assert.equal(backend.played[0]!.kind, "heroShot");
  assert.ok(backend.played[0]!.pan < 0);
  // Across the map from the camera: below the floor, so no voice at all.
  const far = at(world.width - 1, world.height - 1);
  const mine: CombatEvent = { type: "mine", seat: 1, ...far };
  audio.event("m", { step: world.step, event: mine }, world, 0);
  assert.deepEqual([backend.played.length, audio.heard], [1, 2]);
});

test("rate limits and the voice cap hold a 300-unit fight to a few voices; alerts still sound", () => {
  const { backend, audio } = setup();
  const world = view();
  const event = (step: number, e: CombatEvent) =>
    audio.event("m", { step, event: e }, world, 0);
  for (let i = 0; i < 300; i++)
    event(world.step, shot(mark("unit", i), undefined, i));
  const n = backend.played.length;
  assert.ok(n >= 1 && n <= 4, String(n));
  // Every effect at once: the mix takes `MAX_VOICES` of them; an alert still sounds over the lot.
  const limiter = new Limiter();
  // prettier-ignore
  const effects = (Object.keys(SOUNDS) as CueKind[]).filter((kind) => SOUNDS[kind].bus === "effects");
  assert.ok(effects.length > MAX_VOICES);
  const allowed = effects.filter((kind) => limiter.allow(kind, 0));
  assert.equal(allowed.length, MAX_VOICES);
  assert.equal(limiter.allow("myDeath", 0), true);
  backend.clock = 10;
  event(world.step + 1, { type: "won", winner: 0 });
  assert.equal(backend.played.at(-1)!.kind, "victory");
  assert.ok(backend.calls.includes(`duck ${SOUNDS.victory.duck}`));
  // The under-attack alert sounds once, then holds off however long the siege.
  const siege = mark("building", ourTurret(world));
  for (let i = 0; i < 50; i++) {
    backend.clock = 20 + i * 0.1;
    event(world.step + 2, shot(mark("unit", 7), siege, i));
  }
  assert.equal(backend.count("underAttack"), 1);
});

test("?mute plays nothing, touches no backend and neither reads nor writes the stored choices", () => {
  const { backend, store, audio } = setup(true);
  audio.hide(true);
  audio.set("effects", false);
  audio.set("music", false);
  audio.ui("click");
  audio.event("m", { step: 1, event: { type: "won", winner: 0 } }, view(), 0);
  const touched = [backend.played.length, backend.calls.length, store.writes];
  assert.deepEqual(touched, [0, 0, 0]);
  assert.deepEqual([audio.state, audio.heard], ["muted", 2]);
});

test("the choices persist, effects off silences cues, and nothing plays before a gesture or while hidden", () => {
  const { backend, store, audio } = setup(false, false);
  audio.ui("click");
  assert.deepEqual([backend.played.length, audio.state], [0, "waiting"]);
  audio.unlock();
  audio.ui("click");
  assert.equal(backend.played.length, 1);
  audio.hide(true);
  backend.clock = 1;
  audio.ui("click");
  assert.equal(backend.played.length, 1);
  audio.hide(false);
  audio.set("effects", false);
  audio.ui("buy");
  assert.equal(backend.played.length, 1);
  assert.equal(store.items.get(KEYS.effects), "0");
  const again = new FrontAudio(backend, store, KEYS, false, () => {});
  assert.equal(again.enabled("effects"), false);
  assert.deepEqual(backend.calls, ["unlock", "hide true", "hide false"]);
});

test("a stale gold pop never sounds", () => {
  const { backend, audio } = setup();
  const nobody: CombatEvent = { type: "won", winner: NO_WINNER };
  audio.event("m", { step: 500, event: nobody }, undefined, 0);
  audio.gold(500 - LATE_STEPS - 1);
  audio.gold(500);
  assert.equal(backend.count("gold"), 1);
});

test("a button's click gives way to the sound of its press", () => {
  const { backend, audio } = setup();
  audio.ui("buy");
  audio.ui("click");
  backend.clock = 1;
  audio.ui("click");
  assert.deepEqual(
    backend.played.map((p) => p.kind),
    ["buy", "click"],
  );
});

test("a lane wave sounds its horn once as it leaves; not for a late joiner, nor after the match is decided", () => {
  const { backend, audio } = setup();
  const base = view();
  assert.ok(base.lanes.length > 0);
  const frame = (step: number, winner = NO_WINNER) =>
    audio.frame("m", { ...base, step, winner });
  frame(WAVE_FIRST + WAVE_EVERY + LATE_STEPS + 5);
  assert.equal(backend.count("wave"), 0);
  backend.clock = 10;
  frame(WAVE_FIRST + 2 * WAVE_EVERY);
  frame(WAVE_FIRST + 2 * WAVE_EVERY + 1);
  assert.equal(backend.count("wave"), 1);
  backend.clock = 20;
  frame(WAVE_FIRST + 3 * WAVE_EVERY, 0);
  assert.equal(backend.count("wave"), 1);
});

test("the music pump schedules ahead on the audio clock, follows the mood and plays an outro once", () => {
  const { backend, audio, timer } = setup();
  const world = view();
  const hero = world.heroes.find((h) => h.seat === 0)!;
  const step = (seconds: number) => {
    backend.clock = backend.audioTime = seconds;
    timer.pump();
  };
  audio.scene({ kind: "menu" });
  step(0);
  assert.equal(audio.moodNow, "menu");
  assert.ok(backend.scheduled.length > 0);
  assert.ok(backend.scheduled.every(({ at }) => at >= 0 && at < 0.3));
  const before = backend.scheduled.length;
  step(0.01);
  assert.equal(backend.scheduled.length, before, "nothing handed out twice");
  // A fight around this seat's hero heats the match's calm into a fight.
  audio.scene({ kind: "match", step: 100 });
  step(1);
  assert.equal(audio.moodNow, "calm");
  const near = mark("unit", 1, hero.x / TILE, hero.y / TILE);
  backend.clock = 7.5; // after calm's dwell
  for (let i = 0; i < 20; i++)
    audio.event(
      "m",
      { step: 100, event: shot(mark("unit", 2), near, i) },
      world,
      0,
    );
  step(8);
  assert.equal(audio.moodNow, "fight");
  audio.scene({ kind: "match", step: SURGE_AFTER });
  step(15);
  assert.equal(audio.moodNow, "tension");
  audio.scene({ kind: "over", won: true });
  step(16);
  const outro = backend.scheduled.length;
  step(17);
  assert.equal(audio.moodNow, "victory");
  assert.equal(backend.scheduled.length, outro, "the outro plays once");
});

test("music off, a hidden tab, no running clock or ?mute schedule no music", () => {
  const { backend, audio, timer } = setup();
  audio.set("music", false);
  timer.pump();
  audio.set("music", true);
  audio.hide(true);
  timer.pump();
  audio.hide(false);
  backend.audioTime = undefined;
  timer.pump();
  assert.equal(backend.scheduled.length, 0);
  const muted = setup(true);
  assert.equal(muted.timer.ticks.length, 0);
});
