import test from "node:test";
import assert from "node:assert/strict";
import { clockText, present, tag, type Viewer } from "../src/app/presenter.js";
import { HeldControls, KEYS } from "../src/app/controls.js";
import { createSfx } from "../src/app/audio.js";
import {
  keys,
  roomFailure,
  safeStore,
  sessionFor,
  NOT_OPEN,
} from "../src/app/session.js";
import { blend, fraction } from "../src/render/interpolate.js";
import { seatColor, seatShade } from "../src/render/palette.js";
import {
  DEFAULT_SETTINGS,
  DOWN,
  FIRE,
  LEFT,
  RIGHT,
  UP,
  toView,
} from "../src/engine/index.js";
import { view, type Room, type View } from "../src/online/game.js";
import { playing } from "./fixtures/world.js";

const host: Viewer = { me: "a", host: true, solo: false, display: false };
const guest: Viewer = { me: "b", host: false, solo: false, display: false };
const tv: Viewer = { me: "tv", host: false, solo: false, display: true };

function room(stage: Room["stage"], extra: Partial<Room> = {}): View {
  const seats = new Map([
    [
      "a",
      {
        id: "a",
        name: "Ada",
        slot: 0,
        avatarId: "chopper",
        connected: true,
        bot: false,
        generation: 1,
      },
    ],
    [
      "b",
      {
        id: "b",
        name: "Bo",
        slot: 1,
        avatarId: "chopper",
        connected: true,
        bot: false,
        generation: 1,
      },
    ],
    [
      "bot:1",
      {
        id: "bot:1",
        name: "Rotor Rex",
        slot: 2,
        avatarId: "chopper",
        connected: true,
        bot: true,
      },
    ],
  ]);
  const world = stage === "lobby" ? null : playing(3);
  if (world) world.choppers.forEach((c, i) => (c.id = ["a", "b", "bot:1"][i]!));
  return view({
    tick: 10,
    matchId: "m1",
    round: stage === "lobby" ? 0 : 1,
    stage,
    seats,
    settings: { ...DEFAULT_SETTINGS },
    play: { ...DEFAULT_SETTINGS },
    wins: {},
    results: [],
    winner: "",
    resumeAt: 0,
    held: {},
    world,
    ...extra,
  });
}

test("the lobby: the host adds bots and takes off, a guest waits, a newcomer names itself", () => {
  const lobby = room("lobby");
  const mine = present(lobby, host);
  assert.equal(mine.screen, "lobby");
  assert.equal(mine.lobby.members.length, 3);
  assert.ok(
    mine.lobby.canAddBot && mine.lobby.showStart && mine.lobby.canStart,
  );
  assert.deepEqual(mine.lobby.removable, ["bot:1"]);
  assert.equal(mine.lobby.editable, true);
  const theirs = present(lobby, guest);
  assert.equal(theirs.lobby.showStart, false);
  assert.equal(theirs.lobby.note, "Waiting for the host to start");
  const stranger = present(lobby, { ...guest, me: "zed" });
  assert.ok(stranger.askName);
  assert.equal(present(lobby, tv).askName, false, "the TV never takes a seat");
  assert.equal(mine.cards[0]!.state, "ready");
  const shared = present(
    room("lobby", { settings: { ...DEFAULT_SETTINGS, display: true } }),
    host,
  );
  assert.match(shared.lobby.note, /TV screen/);
});

test("in a round: the cave on devices and the TV, a controller on phones of a shared screen", () => {
  const running = room("running");
  assert.equal(present(running, host).screen, "play");
  assert.equal(present(running, tv).screen, "play");
  const shared = room("running", {
    play: { ...DEFAULT_SETTINGS, display: true },
  });
  assert.equal(present(shared, guest).screen, "controller");
  assert.equal(present(shared, tv).screen, "play");
  const model = present(running, host);
  assert.equal(model.cards.length, 3);
  assert.deepEqual(
    model.cards.map((c) => c.tag),
    ["P1", "P2", "P3"],
  );
  assert.ok(model.cards[0]!.you);
  assert.ok(model.cards[2]!.bot);
  assert.equal(model.labels.get("a"), "YOU");
  assert.equal(model.labels.get("b"), "P2");
  assert.equal(model.round, "ROUND 1 · FIRST TO 3 ♛");
  assert.equal(model.flying, true);
});

test("banners: the countdown, GO, a round's winner, a draw and the break between rounds", () => {
  const counting = room("running");
  counting.world = {
    ...counting.world!,
    phase: "countdown",
    remaining: 100,
    played: 0,
  };
  assert.equal(present(counting, host).banner!.title, "2");
  assert.match(present(counting, host).banner!.detail, /HOLD TO CLIMB/);
  counting.world = { ...counting.world, lift: "thrust" };
  assert.match(present(counting, host).banner!.detail, /W \/ S/);
  counting.world = { ...counting.world, remaining: 0 };
  assert.equal(present(counting, host).banner!.title, "GO!");
  const go = room("running");
  go.world = { ...go.world!, phase: "play", played: 10 };
  assert.equal(present(go, host).banner!.tone, "go");
  go.world = { ...go.world, played: 500 };
  assert.equal(present(go, host).banner, null);
  const won = room("running");
  won.world = { ...won.world!, phase: "outro", winner: "b", played: 900 };
  assert.deepEqual(present(won, host).banner, {
    title: "P2 WINS THE ROUND!",
    detail: "Bo takes the crown",
    tone: "seat-1",
  });
  won.world = { ...won.world, winner: "" };
  assert.equal(present(won, host).banner!.title, "NOBODY SURVIVED");
  const between = room("between", {
    resumeAt: 40,
    results: [{ round: 1, winner: "a", placings: [] }],
    wins: { a: 1 },
  });
  const pause = present(between, guest).banner!;
  assert.equal(pause.title, "ADA +1 ♛");
  assert.equal(pause.detail, "Round 2 in 2…");
  const drawn = room("between", {
    resumeAt: 20,
    results: [{ round: 1, winner: "", placings: [] }],
  });
  assert.equal(present(drawn, guest).banner!.title, "DRAW");
});

test("notes for a crashed, escaped, waiting or watching pilot", () => {
  const running = room("running");
  const crashed = {
    ...running,
    world: {
      ...running.world!,
      choppers: running.world!.choppers.map((c) =>
        c.id === "a" ? { ...c, state: "crashed" as const } : c,
      ),
    },
  };
  assert.match(present(crashed, host).note, /Crashed/);
  assert.equal(present(crashed, host).cards[0]!.state, "crashed");
  const escaped = {
    ...running,
    world: {
      ...running.world!,
      choppers: running.world!.choppers.map((c) =>
        c.id === "a" ? { ...c, state: "escaped" as const } : c,
      ),
    },
  };
  assert.match(present(escaped, host).note, /escaped/);
  const late = {
    ...running,
    world: {
      ...running.world!,
      choppers: running.world!.choppers.filter((c) => c.id !== "a"),
    },
  };
  assert.match(present(late, host).note, /next round/);
  assert.equal(present(late, host).cards[0]!.state, "out");
  assert.equal(present(running, { ...guest, me: "watcher" }).note, "Watching");
  assert.equal(present(running, tv).note, "");
});

test("the match result: the winner, the crowns, and who can rematch", () => {
  const over = room("over", { winner: "b", wins: { b: 3, a: 1 } });
  const model = present(over, host);
  assert.equal(model.result!.title, "BO RULES THE CAVE!");
  assert.deepEqual(model.result!.lines.slice(0, 3), [
    "1. Bo — 3 crowns",
    "2. Ada — 1 crown",
    "3. Rotor Rex — 0 crowns",
  ]);
  assert.equal(model.result!.host, true);
  assert.match(present(over, guest).result!.waiting, /host/);
  assert.equal(
    present(room("over", { winner: "" }), host).result!.title,
    "THE CAVE WINS",
  );
});

test("effects light the pilot's status dots", () => {
  const running = room("running");
  running.world = {
    ...running.world!,
    choppers: running.world!.choppers.map((c) =>
      c.id === "a"
        ? { ...c, shield: true, triple: 5, turbo: 5, scramble: 5, stun: 5 }
        : c,
    ),
  };
  assert.deepEqual(present(running, host).cards[0]!.effects, [
    "shield",
    "triple",
    "turbo",
    "scramble",
    "stun",
  ]);
});

test("time reads as minutes, seconds and tenths; tags are P1 to P5", () => {
  assert.equal(clockText(0), "00:00.0");
  assert.equal(clockText(60 * 42 + 36), "00:42.6");
  assert.equal(clockText(60 * 75), "01:15.0");
  assert.equal(clockText(-5), "00:00.0");
  assert.equal(tag(4), "P5");
});

test("held controls: keys by code, touch and mouse sources, one change at a time", () => {
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  assert.equal(controls.press("Space"), true);
  assert.equal(controls.press("KeyW"), true);
  assert.equal(controls.press("KeyQ"), false, "not ours");
  assert.deepEqual(seen, [UP], "a second lift key changes nothing");
  controls.press("ArrowRight");
  controls.hold("pad:fire", FIRE);
  assert.equal(controls.bits, UP | RIGHT | FIRE);
  controls.release("Space");
  assert.equal(controls.bits, UP | RIGHT | FIRE, "W still holds the lift");
  controls.release("KeyW");
  controls.hold("pad:fire", 0);
  assert.equal(controls.release("KeyQ"), false);
  assert.equal(controls.bits, RIGHT);
  controls.press("KeyS");
  controls.press("KeyA");
  assert.equal(controls.bits, RIGHT | LEFT | DOWN);
  controls.clear();
  assert.equal(controls.bits, 0);
  assert.equal(seen.at(-1), 0);
  assert.equal(KEYS.Enter, FIRE);
});

test("drawing between frames blends positions by id, and never across rounds", () => {
  const world = playing(2);
  const older = toView(world);
  world.camX += 256 * 30;
  world.choppers[0]!.y += 256 * 10;
  world.step += 3;
  world.bullets.push({
    id: 999,
    owner: 0,
    x: 256 * 500,
    y: 256 * 200,
    vx: 256 * 6,
    vy: 0,
    life: 40,
  });
  const newer = toView(world);
  const half = blend(older, newer, 0.5);
  assert.equal(half.camX, (older.camX + newer.camX) / 2);
  assert.equal(
    half.choppers[0]!.y,
    (older.choppers[0]!.y + newer.choppers[0]!.y) / 2,
  );
  assert.equal(
    half.bullets[0]!.x,
    500 - 6 * 1.5,
    "a new shot is placed back along its flight",
  );
  assert.equal(blend(older, newer, 1), newer);
  assert.equal(blend(undefined, newer, 0.5), newer);
  assert.equal(blend({ ...older, seed: older.seed + 1 }, newer, 0.5), newer);
  assert.equal(fraction(10, 13, 11.5), 0.5);
  assert.equal(fraction(undefined, 13, 11), 1);
  assert.equal(fraction(10, 13, 20), 1);
  assert.equal(seatColor(5), seatColor(0));
  assert.equal(seatShade(-1), seatShade(4));
});

test("sessions: solo, landing, a joiner's kept token, the creator's token and a fresh one for the TV", () => {
  const memory = new Map<string, string>();
  const store = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  const valid = (code: string) => /^[A-Z0-9]{4}$/.test(code);
  let n = 0;
  const secret = () => `s${++n}`;
  assert.deepEqual(sessionFor("?solo=1", store, "fc", valid, secret), {
    kind: "solo",
  });
  assert.deepEqual(sessionFor("", store, "fc", valid, secret), {
    kind: "landing",
  });
  assert.deepEqual(sessionFor("?room=bad!", store, "fc", valid, secret), {
    kind: "invalid",
    code: "BAD!",
  });
  const joiner = sessionFor("?room=abcd", store, "fc", valid, secret);
  assert.deepEqual(joiner, {
    kind: "room",
    code: "ABCD",
    role: "joiner",
    token: "s1",
  });
  assert.deepEqual(
    sessionFor("?room=ABCD", store, "fc", valid, secret),
    joiner,
    "a refresh is the same member",
  );
  store.setItem(keys("fc").host("ABCD"), "creator");
  assert.equal(
    (sessionFor("?room=ABCD", store, "fc", valid, secret) as { role: string })
      .role,
    "host",
  );
  const display = sessionFor(
    "?room=ABCD&display=1",
    store,
    "fc",
    valid,
    secret,
  ) as { role: string; token: string };
  assert.equal(display.role, "display");
  assert.equal(display.token, "s2");
  const broken = safeStore(() => {
    throw new Error("blocked");
  });
  broken.setItem("x", "1");
  assert.equal(broken.getItem("x"), "1");
  broken.removeItem("x");
  assert.equal(broken.getItem("x"), null);
  assert.equal(roomFailure("unknown game fuse-choppers"), NOT_OPEN);
  assert.match(roomFailure("room is for another game"), /another game/);
  assert.equal(roomFailure("full"), "full");
});

test("sounds: silent when muted or before the page may play, then a voice per effect and jingle notes later", () => {
  const started: string[] = [];
  const param = {
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    value: 0,
  };
  const node = (kind: string) => ({
    connect: (next: unknown) => next,
    start: () => void started.push(kind),
    stop() {},
    frequency: param,
    gain: param,
    type: "",
    buffer: null,
  });
  let state = "suspended",
    opened = 0;
  const audio = {
    get state() {
      return state;
    },
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    createOscillator: () => node("tone"),
    createGain: () => node("gain"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise"),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
    resume: async () => {
      state = "running";
    },
  };
  const later: (() => void)[] = [];
  const deps = {
    open: () => {
      opened++;
      return audio as unknown as AudioContext;
    },
    later: (run: () => void) => void later.push(run),
  };
  const muted = createSfx(true, deps);
  muted.resume();
  muted.play("explode");
  assert.equal(opened, 0, "a muted page never opens audio");
  const sfx = createSfx(false, deps);
  sfx.play("explode");
  assert.equal(started.length, 0, "nothing before the page may play");
  sfx.resume();
  const kinds = [
    "explode",
    "droneDown",
    "hit",
    "bump",
    "shot",
    "pickup",
    "shock",
    "shieldPop",
    "shatter",
    "bolt",
    "exit",
    "crown",
    "count",
    "go",
    "spark",
  ] as const;
  for (const kind of kinds) sfx.play(kind);
  assert.ok(started.includes("tone") && started.includes("noise"));
  const before = started.length;
  for (const run of later) run();
  assert.ok(started.length > before, "the jingles' later notes play");
  assert.equal(opened, 1, "one audio context for the page");
});
