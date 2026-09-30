import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import { clockText, present, tag, type Viewer } from "../src/app/presenter.js";
import { HeldControls, KEYS } from "../src/app/controls.js";
import {
  AUDIO_KEY,
  DEFAULT_VOLUME,
  createAudio,
  loadPrefs,
  mutedByQuery,
  savePrefs,
  type AudioDependencies,
} from "../src/app/audio.js";
import {
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  type Store,
} from "../src/app/session.js";
import { blend, fraction } from "../src/render/interpolate.js";
import { seatColor, seatShade } from "../src/render/palette.js";
import {
  COUNTDOWN_STEPS,
  DEFAULT_SETTINGS,
  LEFT,
  RIGHT,
  STEPS_PER_TICK,
  toView,
  type Settings,
} from "../src/engine/index.js";
import {
  createRoom,
  foldTick,
  view,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { place, playing } from "./fixtures/world.js";

let seq = 0;
function fold(room: Room, body: readonly unknown[][] = []): void {
  const tick = room.tick + 1;
  const streams = new Map<string, StreamEntries<Entry>>([
    [
      "a",
      { generation: 1, entries: body.map((b) => [++seq, tick, ...b] as Entry) },
    ],
  ]);
  foldTick(room, "a", streams);
}
/** `a` (host) and `b` seated with a bot; started unless `lobby`. */
function room(settings: Settings = DEFAULT_SETTINGS, lobby = false): Room {
  const r = createRoom("m0", settings);
  fold(r, [
    [JOIN, "a", "Ada", 0, "train", 1],
    [JOIN, "b", "Bo", 1, "train", 1],
    [BOT, "add", "bot:1", "Loco Lola", 2],
  ]);
  if (!lobby) fold(r, [[ACTION, "start", "m1"]]);
  return r;
}
const host: Viewer = { me: "a", host: true, solo: false, display: false };
const guest: Viewer = { me: "b", host: false, solo: false, display: false };
const tv: Viewer = { me: "tv", host: false, solo: false, display: true };
const toPlay = (r: Room) => {
  for (let i = 0; i < Math.ceil(COUNTDOWN_STEPS / STEPS_PER_TICK) + 1; i++)
    fold(r);
};
/** Ends the round with these scores and runs the outro out. */
function finish(r: Room, scores: Record<string, number>) {
  const world = r.world!;
  for (const t of world.trains) {
    t.score = scores[t.id] ?? 0;
    t.cargo = [];
  }
  world.step = COUNTDOWN_STEPS + world.length - 1;
  for (let i = 0; i < 80 && r.stage === "running"; i++) fold(r);
}

test("the lobby: the host adds bots and starts, a guest waits, a newcomer names itself", () => {
  const lobby = room(DEFAULT_SETTINGS, true);
  const mine = present(view(lobby), host);
  assert.equal(mine.screen, "lobby");
  assert.equal(mine.lobby.members.length, 3);
  assert.ok(
    mine.lobby.canAddBot && mine.lobby.showStart && mine.lobby.canStart,
  );
  assert.deepEqual(mine.lobby.removable, ["bot:1"]);
  const theirs = present(view(lobby), guest);
  assert.ok(!theirs.lobby.showStart && !theirs.lobby.editable);
  assert.equal(theirs.lobby.note, "Waiting for the host to start");
  const stranger = present(view(lobby), { ...guest, me: "zed" });
  assert.ok(stranger.askName);
  assert.equal(
    present(view(lobby), tv).askName,
    false,
    "the TV never takes a seat",
  );
  assert.equal(mine.time, "01:15", "the lobby shows the round's length");
});

test("in a round: the depot on devices and the TV, a two-button controller on phones of a shared screen", () => {
  const r = room();
  assert.equal(present(view(r), host).screen, "play");
  const shared = room({ ...DEFAULT_SETTINGS, display: true });
  assert.equal(present(view(shared), host).screen, "controller");
  assert.equal(present(view(shared), tv).screen, "play");
  assert.equal(
    present(view(shared), { ...guest, me: "zed" }).screen,
    "play",
    "a watcher sees the depot",
  );
});

test("banners: the countdown, GO, the last ten seconds, and who won the round", () => {
  const r = room();
  assert.equal(present(view(r), host).banner!.title, "3");
  assert.equal(
    present(view(r), host).banner!.detail,
    "COLLECT · STEAL · DELIVER",
  );
  toPlay(r);
  assert.equal(present(view(r), host).banner!.title, "GO!");
  for (let i = 0; i < 20; i++) fold(r);
  assert.equal(present(view(r), host).banner, null);
  assert.ok(!present(view(r), host).urgent);
  r.world!.step = COUNTDOWN_STEPS + r.world!.length - 590;
  fold(r);
  const final = present(view(r), host);
  assert.equal(final.banner!.title, "10 SECONDS LEFT!");
  assert.ok(final.urgent);
  assert.equal(final.callout, "ONE LAST DELIVERY!");
  assert.equal(final.time, "00:10");
  for (let i = 0; i < 40; i++) fold(r);
  assert.equal(
    present(view(r), host).banner,
    null,
    "announced, then out of the way",
  );
  // The whistle: one leader, a shared lead, nobody.
  const outro = (scores: Record<string, number>) => {
    const w = room();
    toPlay(w);
    for (const t of w.world!.trains) t.score = scores[t.id] ?? 0;
    w.world!.step = COUNTDOWN_STEPS + w.world!.length - 1;
    fold(w);
    return present(view(w), host).banner!;
  };
  assert.deepEqual(outro({ b: 4, a: 2 }), {
    title: "P2 WINS THE ROUND!",
    detail: "Bo delivered 4 wagons",
    tone: "seat-1",
  });
  assert.equal(outro({ a: 3, b: 3 }).title, "SHARED ROUND!");
  assert.equal(outro({ a: 3, b: 3 }).detail, "Ada & Bo on 3 wagons");
  assert.equal(outro({}).title, "NO DELIVERIES");
});

test("HUD cards: banked score, wagons pulled, a full train, round wins and places", () => {
  const r = room();
  toPlay(r);
  const [a, b] = r.world!.trains;
  a!.score = 4;
  a!.cargo = [0, 1];
  b!.cargo = Array(8).fill(0);
  const cards = present(view(r), host).cards;
  assert.deepEqual(
    cards.map((c) => [
      c.tag,
      c.score,
      c.carrying,
      c.full,
      c.place,
      c.you,
      c.bot,
    ]),
    [
      ["P1", 4, 2, false, 1, true, false],
      ["P2", 0, 8, true, 2, false, false],
      ["P3", 0, 0, false, 2, false, true],
    ],
  );
  assert.deepEqual(present(view(r), host).labels.get("a"), "YOU");
  assert.deepEqual(present(view(r), host).labels.get("b"), "P2");
});

test("between rounds the scoreboard shows the round's places, shared where level; the match result names its winners", () => {
  const r = room({ ...DEFAULT_SETTINGS, wins: 2 });
  toPlay(r);
  finish(r, { a: 5, b: 5, "bot:1": 2 });
  const board = present(view(r), host).board!;
  assert.equal(board.title, "ROUND 1: SHARED WIN");
  assert.deepEqual(
    board.rows.map((row) => [row.place, row.name, row.score]),
    [
      [1, "Ada", 5],
      [1, "Bo", 5],
      [3, "Loco Lola", 2],
    ],
  );
  assert.match(board.rows[0]!.detail, /1\/2 wins/);
  assert.match(board.next, /Round 2 in 5/);
  // Round two: Ada alone, and the match.
  for (let i = 0; i < 120 && r.stage === "between"; i++) fold(r);
  toPlay(r);
  finish(r, { a: 3, b: 1 });
  const over = present(view(r), host).result!;
  assert.equal(over.title, "ADA RUNS THE DEPOT!");
  assert.deepEqual(over.lines.slice(0, 2), [
    "1. Ada — 2 wins · 8 wagons",
    "2. Bo — 1 win · 6 wagons",
  ]);
  assert.ok(over.host);
  assert.equal(
    present(view(r), guest).result!.waiting,
    "Waiting for the host to start a rematch",
  );
  // Level on wins and wagons: a shared victory.
  const level = room({ ...DEFAULT_SETTINGS, wins: 1 });
  toPlay(level);
  finish(level, { a: 2, b: 2 });
  assert.equal(
    present(view(level), host).result!.title,
    "SHARED VICTORY: ADA & BO",
  );
});

test("notes for a driver waiting for the next round and for a watcher", () => {
  const r = room();
  fold(r, [[JOIN, "c", "Cy", 3, "train", 1]]);
  assert.equal(
    present(view(r), { ...guest, me: "c" }).note,
    "You join the next round",
  );
  assert.equal(
    present(view(r), { ...guest, me: "zed" }).note,
    "Pick a name to drive from the next round",
  );
  assert.equal(present(view(r), tv).note, "");
});

test("time reads as minutes and seconds, rounded up; tags are P1 to P5; seats have their colours", () => {
  assert.equal(clockText(75 * 60), "01:15");
  assert.equal(clockText(1), "00:01");
  assert.equal(clockText(0), "00:00");
  assert.equal(clockText(-5), "00:00");
  assert.equal(tag(4), "P5");
  assert.equal(seatColor(0), "#27e3ff");
  assert.equal(seatColor(6), seatColor(1));
  assert.notEqual(seatShade(2), seatColor(2));
});

test("held controls: keys by code, touch sources, one change at a time", () => {
  const changes: number[] = [];
  const controls = new HeldControls((bits) => changes.push(bits));
  assert.equal(KEYS.KeyA, LEFT);
  assert.equal(KEYS.ArrowRight, RIGHT);
  assert.ok(controls.press("KeyA"));
  assert.ok(controls.press("ArrowLeft"), "a second left key");
  assert.ok(!controls.press("Space"), "not ours");
  controls.hold("pad:right", RIGHT);
  assert.equal(controls.bits, LEFT | RIGHT);
  controls.release("KeyA");
  assert.equal(controls.bits, LEFT | RIGHT, "the other left key still holds");
  controls.release("ArrowLeft");
  controls.hold("pad:right", 0);
  controls.clear();
  assert.deepEqual(changes, [LEFT, LEFT | RIGHT, RIGHT, 0]);
});

test("drawing between frames blends positions by id and wagons by place, and never across rounds", () => {
  const world = playing(1);
  place(world, "t0", 300, 300, 0, 2);
  const older = toView(world);
  for (let i = 0; i < 3; i++) {
    world.step++;
    world.trains[0]!.x += 256 * 3;
  }
  const newer = toView(world);
  const half = blend(older, newer, 0.5);
  assert.equal(half.trains[0]!.x, 304.5);
  assert.ok(
    Math.abs(
      half.trains[0]!.wagons[0]!.x -
        (older.trains[0]!.wagons[0]!.x + newer.trains[0]!.wagons[0]!.x) / 2,
    ) < 1e-9,
  );
  assert.equal(blend(older, newer, 1), newer);
  assert.equal(blend({ ...older, seed: older.seed + 1 }, newer, 0.5), newer);
  assert.equal(fraction(undefined, 10, 5), 1);
  assert.equal(fraction(0, 10, 5), 0.5);
  assert.equal(fraction(0, 10, 20), 1);
});

/** Browser storage as a map; `throws` makes every call fail, as a locked-down Safari does. */
function memory(throws = false): Storage {
  const map = new Map<string, string>();
  const fail = () => {
    throw new Error("denied");
  };
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (throws ? fail() : (map.get(k) ?? null)),
    setItem: (k, v) => (throws ? fail() : void map.set(k, v)),
    removeItem: (k) => (throws ? fail() : void map.delete(k)),
  };
}

test("sessions: solo, landing, a joiner's kept token, the creator's token and a fresh one for the TV", () => {
  const store = safeStore(() => memory());
  let n = 0;
  const secret = () => `s${++n}`;
  const valid = (code: string) => /^[A-Z]{4}$/.test(code);
  assert.deepEqual(
    sessionFor("?solo=1", store, "fuse-freight", valid, secret),
    { kind: "solo" },
  );
  assert.deepEqual(sessionFor("", store, "fuse-freight", valid, secret), {
    kind: "landing",
  });
  assert.deepEqual(
    sessionFor("?room=no", store, "fuse-freight", valid, secret),
    {
      kind: "invalid",
      code: "NO",
    },
  );
  const join = sessionFor("?room=abcd", store, "fuse-freight", valid, secret);
  assert.deepEqual(join, {
    kind: "room",
    code: "ABCD",
    role: "joiner",
    token: "s1",
  });
  assert.deepEqual(
    sessionFor("?room=ABCD", store, "fuse-freight", valid, secret),
    join,
    "a refresh is the same member",
  );
  store.setItem(keys("fuse-freight").host("WXYZ"), "creator");
  assert.equal(
    (
      sessionFor("?room=WXYZ", store, "fuse-freight", valid, secret) as {
        role: string;
      }
    ).role,
    "host",
  );
  const display = sessionFor(
    "?room=ABCD&display=1",
    store,
    "fuse-freight",
    valid,
    secret,
  );
  assert.deepEqual(display, {
    kind: "room",
    code: "ABCD",
    role: "display",
    token: "s2",
  });
  // A browser that refuses storage still gets a working page.
  const locked = safeStore(() => memory(true));
  locked.setItem("k", "v");
  assert.equal(locked.getItem("k"), "v");
  assert.equal(
    roomFailure("unknown game fuse-freight"),
    "Online rooms are not open yet for this game. Play solo against bots meanwhile.",
  );
  assert.equal(
    roomFailure("Room belongs to another game"),
    "That code is a room of another game",
  );
});

test("audio preferences: the stored choice every Fuse page shares, the first-visit default, and ?mute", () => {
  const store: Store = safeStore(() => memory());
  assert.deepEqual(loadPrefs(store, false), {
    muted: { music: false, effects: false },
    volume: { ...DEFAULT_VOLUME },
  });
  assert.equal(
    loadPrefs(store, true).muted.music,
    true,
    "phones start with music off",
  );
  store.setItem(
    AUDIO_KEY,
    JSON.stringify({
      muted: { music: true, effects: true },
      volume: { music: 2, effects: 0.3 },
      other: 1,
    }),
  );
  assert.deepEqual(loadPrefs(store, false), {
    muted: { music: true, effects: true },
    volume: { music: 1, effects: 0.3 },
  });
  const prefs = loadPrefs(store, false);
  prefs.muted.music = false;
  savePrefs(store, prefs);
  const saved = JSON.parse(store.getItem(AUDIO_KEY)!) as Record<
    string,
    unknown
  >;
  assert.equal(saved.other, 1, "keeps what another page stores beside it");
  assert.deepEqual(saved.muted, { music: false, effects: true });
  store.setItem(AUDIO_KEY, "{broken");
  assert.equal(
    loadPrefs(store, false).muted.music,
    false,
    "corrupt storage falls back",
  );
  assert.ok(mutedByQuery("?mute"));
  assert.ok(mutedByQuery("?room=AB&mute=1"));
  assert.ok(!mutedByQuery("?mute=0"));
  assert.ok(!mutedByQuery("?mute=false"));
  assert.ok(!mutedByQuery(""));
});

/** A Web Audio stand-in that counts the nodes it makes. */
function fakeAudio(state: "running" | "suspended" = "running") {
  const made: string[] = [];
  const node = (kind: string): unknown => {
    made.push(kind);
    const param = {
      value: 0,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
    };
    const self: Record<string, unknown> = {
      gain: param,
      frequency: param,
      Q: param,
      type: "",
      buffer: null,
      connect: () => self,
      start() {},
      stop() {},
    };
    return self;
  };
  const context = {
    state,
    currentTime: 1,
    sampleRate: 100,
    destination: {},
    resume: async () => {
      context.state = "running";
    },
    createGain: () => node("gain"),
    createOscillator: () => node("osc"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise"),
    createBuffer: (_c: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };
  let opened = 0;
  const timers: (() => void)[] = [];
  const stopped: number[] = [];
  const deps: AudioDependencies = {
    open: () => {
      opened++;
      return context as unknown as AudioContext;
    },
    later: (run) => run(),
    every: (run) => {
      timers.push(run);
      const index = timers.length - 1;
      return () => stopped.push(index);
    },
    random: () => 0.5,
  };
  return { deps, made, timers, stopped, opened: () => opened, context };
}

test("sound: nothing at all under ?mute; effects per cue; music runs only while it is wanted and allowed", async () => {
  const silent = fakeAudio();
  const muted = createAudio(
    true,
    loadPrefs(
      safeStore(() => memory()),
      false,
    ),
    silent.deps,
  );
  muted.resume();
  muted.mood("round");
  muted.play("cut");
  assert.equal(silent.opened(), 0, "no audio context is ever opened");
  assert.ok(muted.silenced);

  const fake = fakeAudio();
  const prefs = loadPrefs(
    safeStore(() => memory()),
    false,
  );
  const audio = createAudio(false, prefs, fake.deps);
  audio.play("collect");
  assert.equal(fake.opened(), 0, "nothing before the first gesture");
  audio.resume();
  const before = fake.made.length;
  audio.play("cut");
  audio.play("deliver");
  assert.ok(fake.made.slice(before).filter((k) => k === "osc").length >= 6);
  audio.setMuted("effects", true);
  const quiet = fake.made.length;
  audio.play("bump");
  assert.equal(fake.made.length, quiet, "muted effects make nothing");
  // Music: the scheduler runs in a mood, and stops when music is muted or the mood is off.
  audio.mood("round");
  assert.equal(fake.timers.length, 1);
  fake.timers[0]!();
  assert.ok(fake.made.length > quiet, "the scheduler queued notes");
  audio.setMuted("music", true);
  assert.deepEqual(fake.stopped, [0]);
  audio.setMuted("music", false);
  assert.equal(fake.timers.length, 2);
  audio.mood("off");
  assert.deepEqual(fake.stopped, [0, 1]);

  // A browser that has not allowed sound yet: resume asks, and music waits for it.
  const waiting = fakeAudio("suspended");
  const later = createAudio(
    false,
    loadPrefs(
      safeStore(() => memory()),
      false,
    ),
    waiting.deps,
  );
  later.mood("menu");
  later.resume();
  assert.equal(waiting.timers.length, 0);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    waiting.timers.length,
    1,
    "music starts once the browser allows it",
  );
});
