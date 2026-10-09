import test from "node:test";
import assert from "node:assert/strict";
import {
  createRound,
  view,
  type RoundView,
  type TickEvent,
} from "../src/engine/index.js";
import {
  CUE_SPECS,
  CueLimiter,
  planCues,
  type Cue,
} from "../src/app/audio/cues.js";
import {
  AudioDirector,
  MUTE_KEY,
  mutedByQuery,
  type AudioBackend,
  type MusicKind,
  type StorageLike,
} from "../src/app/audio/director.js";

class FakeBackend implements AudioBackend {
  time = 0;
  calls: string[] = [];
  played: Cue[] = [];
  now = (): number => this.time;
  unlock(): void {
    this.calls.push("unlock");
  }
  play(cue: Cue): void {
    this.played.push(cue);
  }
  music(kind: MusicKind | null): void {
    this.calls.push(`music:${kind}`);
  }
  sizzle(level: number): void {
    this.calls.push(`sizzle:${level.toFixed(2)}`);
  }
  setMuted(muted: boolean): void {
    this.calls.push(`muted:${muted}`);
  }
  suspend = (): number => this.calls.push("suspend");
  resume = (): number => this.calls.push("resume");
}

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  let writes = 0;
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      writes++;
      data.set(key, value);
    },
  };
  return { storage, data, writes: () => writes };
}

const crater = (radius: number, tick = 1): TickEvent => ({
  type: "crater",
  tick,
  owner: 0,
  x: 100,
  y: 500,
  radius,
  x0: 90,
  x1: 110,
});
const roundView = (): RoundView =>
  view(createRound({ seed: 5, playerCount: 2 }));

test("a frame of hundreds of events becomes at most one cue per kind", () => {
  const events: TickEvent[] = [];
  for (let i = 0; i < 500; i++) events.push(crater(i === 7 ? 46 : 11));
  events.push({
    type: "gate-split",
    tick: 1,
    gateId: 1,
    multiplier: 3,
    owner: 0,
    x: 0,
    y: 0,
    created: 2,
  });
  events.push({
    type: "gate-split",
    tick: 1,
    gateId: 2,
    multiplier: 10,
    owner: 0,
    x: 0,
    y: 0,
    created: 9,
  });
  const cues = planCues(events);
  assert.deepEqual(cues.map((cue) => cue.kind).sort(), ["explosion", "split"]);
  const boom = cues.find((cue) => cue.kind === "explosion")!;
  assert.equal(boom.size, 1); // the castle wreck crater sets the size
  assert.equal(cues.find((cue) => cue.kind === "split")!.pitch, 10);
  assert.ok(planCues([crater(11)])[0]!.size < 0.3);
});

test("ghosts sound when they appear and when they drop a bomb", () => {
  const cues = planCues([
    { type: "ghost-spawned", tick: 1, owner: 2, x: 400, y: 64 },
    ...[1, 2].map((rocketId): TickEvent => ({
      type: "ghost-bomb-dropped",
      tick: 1,
      owner: rocketId,
      rocketId,
      x: 400,
      y: 64,
    })),
  ]);
  assert.deepEqual(cues.map((cue) => cue.kind).sort(), ["drop", "ghost"]);
});

test("the limiter enforces per-kind gaps, per-kind voices and the global cap", () => {
  const limiter = new CueLimiter();
  assert.equal(limiter.allow("explosion", 0), true);
  assert.equal(limiter.allow("explosion", 0.01), false); // closer than minGap
  let t = 0;
  let allowed = 0;
  for (let i = 0; i < 100; i++, t += 0.051)
    if (limiter.allow("explosion", 1 + t)) allowed++;
  // Never more explosion voices at once than the spec allows.
  assert.ok(limiter.live(1 + t) <= CUE_SPECS.explosion.maxVoices);
  assert.ok(allowed < 100);

  const full = new CueLimiter(CUE_SPECS, 3);
  assert.ok(full.allow("launch", 0));
  assert.ok(full.allow("hit", 0));
  assert.ok(full.allow("split", 0));
  assert.equal(full.allow("shield", 0), false); // global cap reached
  assert.equal(full.allow("fanfare", 0), true); // important cues still sound
  assert.equal(full.allow("shield", 10), true); // voices have ended
});

test("500 impacts per frame for a second stay under the voice cap", () => {
  const backend = new FakeBackend();
  const director = new AudioDirector(backend, undefined);
  const v = roundView();
  const frame = Array.from({ length: 500 }, () => crater(11));
  for (let i = 0; i < 60; i++) {
    backend.time = i / 60;
    director.roundEvents(frame, v);
  }
  const perSecond = backend.played.length;
  assert.ok(perSecond > 5 && perSecond <= 20, `${perSecond} explosions`);
});

test("a throttled big explosion is held briefly rather than lost", () => {
  const backend = new FakeBackend();
  const director = new AudioDirector(backend, undefined);
  const v = roundView();
  director.roundEvents([crater(11)], v);
  backend.time = 0.02;
  director.roundEvents([crater(46)], v); // too soon: held
  assert.equal(backend.played.length, 1);
  backend.time = 0.06;
  director.roundEvents([], v);
  assert.equal(backend.played.length, 2);
  assert.equal(backend.played[1]!.size, 1);
});

test("mute persists, silences cues and brings the wanted music back", () => {
  const backend = new FakeBackend();
  const store = fakeStorage();
  const director = new AudioDirector(backend, store.storage);
  director.music("lobby");
  director.setMuted(true);
  assert.equal(store.data.get(MUTE_KEY), "1");
  director.music("round"); // remembered, not played while muted
  director.roundEvents([crater(46)], roundView());
  assert.equal(backend.played.length, 0);
  director.setMuted(false);
  assert.equal(store.data.get(MUTE_KEY), "0");
  assert.deepEqual(
    backend.calls.filter((call) => !call.startsWith("sizzle")),
    ["music:lobby", "muted:true", "muted:false", "music:round"],
  );

  const again = new FakeBackend();
  const restored = new AudioDirector(
    again,
    fakeStorage({ [MUTE_KEY]: "1" }).storage,
  );
  assert.equal(restored.muted, true);
  assert.deepEqual(again.calls, ["muted:true"]);
});

test("?mute disables all audio and never touches storage", () => {
  assert.equal(mutedByQuery("?mute"), true);
  assert.equal(mutedByQuery("?seed=3&mute=1"), true);
  assert.equal(mutedByQuery("?mute=0"), false);
  assert.equal(mutedByQuery(""), false);

  const backend = new FakeBackend();
  const store = fakeStorage({ [MUTE_KEY]: "0" });
  const director = new AudioDirector(backend, store.storage, true);
  assert.equal(director.muted, true);
  director.unlock();
  director.setHidden(true);
  director.music("round");
  director.roundStarted();
  director.roundEvents(
    [crater(46), { type: "sudden-death-started", tick: 2 }],
    roundView(),
  );
  director.setMuted(false);
  assert.equal(director.muted, true);
  assert.deepEqual(backend.calls, []);
  assert.equal(backend.played.length, 0);
  assert.equal(store.writes(), 0);
});

test("blocked storage falls back to unmuted and keeps working", () => {
  const throwing: StorageLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  const director = new AudioDirector(new FakeBackend(), throwing);
  assert.equal(director.muted, false);
  director.setMuted(true);
  assert.equal(director.muted, true);
});

test("rounds drive the round, sudden-death and fuse sizzle", () => {
  const backend = new FakeBackend();
  const director = new AudioDirector(backend, undefined);
  const round = createRound({ seed: 5, playerCount: 2 });
  director.roundStarted();
  round.tick = round.fuseTicks * 0.9;
  director.roundEvents([], view(round));
  director.roundEvents([{ type: "sudden-death-started", tick: round.tick }], {
    ...view(round),
    phase: "sudden-death",
  });
  director.roundDetached();
  assert.deepEqual(backend.calls, [
    "music:round",
    "sizzle:0.80",
    "music:sudden-death",
    "sizzle:0.00",
  ]);
  assert.equal(backend.played[0]?.kind, "alarm");
});

test("a hidden tab goes silent and comes back with the wanted music unless muted", () => {
  const backend = new FakeBackend();
  const director = new AudioDirector(backend, undefined);
  director.music("lobby");
  director.setHidden(true);
  director.setHidden(false); // no gesture yet: only music, whose `play` waits for one
  director.unlock();
  director.setHidden(true);
  director.music("round"); // remembered while hidden
  director.roundEvents([crater(46)], roundView());
  assert.equal(backend.played.length, 0);
  director.setHidden(false);
  director.setMuted(true);
  director.setHidden(true);
  director.setHidden(false);
  const calls = backend.calls.filter((call) => !call.startsWith("sizzle"));
  assert.equal(
    calls.join(" "),
    "music:lobby suspend music:lobby unlock suspend resume music:round muted:true suspend",
  );
});
