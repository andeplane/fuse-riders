import test from "node:test";
import assert from "node:assert/strict";
import type { SeatRecord, Stage } from "fuse-netcode";
import { HeldControls, KEY_HELP, KEYS } from "../src/app/controls.js";
import {
  HEROES,
  pixelScale,
  present,
  type Viewer,
} from "../src/app/presenter.js";
import {
  NOT_OPEN,
  keys,
  roomFailure,
  safeStore,
  sessionFor,
} from "../src/app/session.js";
import {
  ATTACK,
  DOWN,
  JUMP,
  LEFT,
  MAGIC,
  RIGHT,
  UP,
  createWorld,
} from "../src/engine/index.js";
import {
  DEFAULT_SETTINGS,
  createRoom,
  view,
  type Room,
  type View,
} from "../src/online/game.js";

const host: Viewer = { me: "a", host: true, solo: false, display: false };
const guest: Viewer = { me: "b", host: false, solo: false, display: false };
const tv: Viewer = { me: "tv", host: false, solo: false, display: true };

const seat = (
  id: string,
  slot: number,
  avatarId: string,
  extra: Partial<SeatRecord> = {},
): [string, SeatRecord] => [
  id,
  {
    id,
    name: id.toUpperCase(),
    slot,
    avatarId,
    connected: true,
    bot: false,
    generation: 1,
    ...extra,
  },
];

/** Ada (P1, Rhea) and Bo (P2, Gorm) seated, Wes watching; in a run only Ada's and Bo's heroes are in the world. */
function frame(stage: Stage, extra: Partial<Room> = {}): View {
  const seats = new Map([
    seat("a", 0, "rhea"),
    seat("b", 1, "gorm"),
    seat("w", -1, "", { watcher: true }),
  ]);
  return view({
    ...createRoom("m1", DEFAULT_SETTINGS),
    stage,
    round: stage === "lobby" ? 0 : 1,
    seats,
    world:
      stage === "lobby"
        ? null
        : createWorld({
            seed: 1,
            heroes: [
              { seat: 0, kind: "rhea" },
              { seat: 1, kind: "gorm" },
            ],
          }),
    ...extra,
  });
}

test("the lobby: each seat's hero from the room, the host starts, a guest waits, a stranger names itself", () => {
  const lobby = frame("lobby");
  const mine = present(lobby, host);
  assert.equal(mine.screen, "lobby");
  assert.deepEqual(
    mine.members.map((m) => [m.name, m.tag, m.hero, m.status]),
    [
      ["A (you)", "P1", "rhea", "P1 · RHEA"],
      ["B", "P2", "gorm", "P2 · GORM"],
    ],
  );
  assert.equal(mine.watchers, 1);
  assert.equal(mine.hero, "rhea");
  assert.ok(mine.seated && mine.canPick && !mine.playing);
  assert.ok(mine.showStart && mine.canStart && !mine.canReturn);
  assert.equal(mine.note, "Pick your hero, then START");
  const theirs = present(lobby, guest);
  assert.equal(theirs.hero, "gorm");
  assert.equal(theirs.showStart, false);
  assert.equal(theirs.note, "Pick your hero; the host starts the run");
  const stranger = present(lobby, { ...guest, me: "zed" });
  assert.ok(stranger.askName && !stranger.seated && !stranger.canPick);
  assert.equal(stranger.hero, null);
  const watcher = present(lobby, { ...guest, me: "w" });
  assert.ok(!watcher.askName && !watcher.canPick && watcher.hero === null);
  const screen = present(lobby, tv);
  assert.ok(!screen.askName && !screen.canPick && !screen.showStart);
  assert.match(screen.note, /watches/);
  assert.equal(
    present(view(createRoom("m1", DEFAULT_SETTINGS)), host).note,
    "Pick a name to take a seat",
  );
  assert.equal(
    present(lobby, { ...host, solo: true, me: "zed" }).askName,
    false,
    "solo seats its player itself",
  );
});

test("a seat's hero changes only when the room's does; an away or offline seat cannot pick", () => {
  const picked = frame("lobby", {
    seats: new Map([seat("a", 0, "gorm"), seat("b", 1, "gorm")]),
  });
  assert.equal(present(picked, host).hero, "gorm", "duplicates are allowed");
  assert.equal(present(picked, guest).hero, "gorm");
  const away = frame("lobby", {
    seats: new Map([
      seat("a", 0, "rhea", { away: true, connected: false }),
      seat("b", 1, "gorm", { connected: false }),
    ]),
  });
  assert.equal(present(away, host).canPick, false);
  assert.equal(present(away, guest).canPick, false);
  assert.deepEqual(
    present(away, host).members.map((m) => m.status),
    ["AWAY", "OFFLINE"],
  );
});

test("in a run: the game for every page, keys for a hero in the world, notes for the rest", () => {
  const running = frame("running");
  const mine = present(running, host);
  assert.equal(mine.screen, "play");
  assert.ok(mine.playing && !mine.canPick && mine.canReturn);
  assert.equal(mine.note, "");
  assert.equal(present(running, guest).canReturn, false);
  assert.equal(present(running, tv).screen, "play");
  assert.equal(present(running, tv).playing, false);
  assert.equal(present(running, tv).note, "");
  const late = frame("running", {
    seats: new Map([seat("a", 0, "rhea"), seat("c", 2, "brakka")]),
  });
  assert.equal(present(late, { ...guest, me: "c" }).playing, false);
  assert.equal(
    present(late, { ...guest, me: "c" }).note,
    "You join the next run",
  );
  assert.equal(present(running, { ...guest, me: "w" }).note, "Watching");
  assert.equal(
    present(running, { ...guest, me: "zed" }).note,
    "Pick a name to play from the next run",
  );
  const over = present(frame("over"), host);
  assert.ok(over.canPick && !over.playing);
  assert.equal(over.note, "The run is over");
});

test("the screen scales by the largest whole number that fits, never below 1", () => {
  assert.equal(pixelScale(1920, 1080), 6);
  assert.equal(pixelScale(1280, 720), 4);
  assert.equal(pixelScale(1279, 900), 3);
  assert.equal(pixelScale(2000, 539), 2);
  assert.equal(pixelScale(100, 50), 1);
});

test("held controls: arrows or WASD walk, J/Z attack, K/X jump, L/C magic, one change at a time", () => {
  const seen: number[] = [];
  const controls = new HeldControls((bits) => seen.push(bits));
  assert.equal(controls.press("ArrowRight"), true);
  assert.equal(controls.press("KeyD"), true);
  assert.equal(controls.press("KeyQ"), false, "not ours");
  assert.deepEqual(seen, [RIGHT], "a second right key changes nothing");
  controls.press("KeyW");
  controls.press("KeyJ");
  assert.equal(controls.bits, RIGHT | UP | ATTACK);
  controls.release("ArrowRight");
  assert.equal(controls.bits, RIGHT | UP | ATTACK, "D still holds right");
  controls.release("KeyD");
  controls.release("KeyW");
  controls.release("KeyJ");
  assert.equal(controls.release("KeyQ"), false);
  assert.equal(controls.bits, 0);
  controls.hold("pad", LEFT | DOWN);
  controls.press("KeyX");
  controls.press("KeyC");
  assert.equal(controls.bits, LEFT | DOWN | JUMP | MAGIC);
  controls.hold("pad", 0);
  assert.equal(controls.bits, JUMP | MAGIC);
  controls.clear();
  assert.equal(controls.bits, 0);
  assert.equal(seen.at(-1), 0);
  assert.deepEqual(
    [KEYS.KeyZ, KEYS.KeyK, KEYS.KeyL, KEYS.KeyA, KEYS.ArrowDown],
    [ATTACK, JUMP, MAGIC, LEFT, DOWN],
  );
  assert.deepEqual(
    KEY_HELP.map(([key]) => key),
    ["ARROWS / WASD", "J / Z", "K / X", "L / C"],
  );
  assert.deepEqual(
    Object.values(HEROES).map((hero) => hero.name),
    ["BRAKKA", "RHEA", "GORM"],
  );
});

test("sessions: solo, landing, a joiner's kept token, the creator's token and a fresh one for a watching screen", () => {
  const memory = new Map<string, string>();
  const store = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  const valid = (code: string) => /^[A-Z0-9]{4}$/.test(code);
  let n = 0;
  const secret = () => `s${++n}`;
  assert.deepEqual(sessionFor("?solo=1", store, "fa", valid, secret), {
    kind: "solo",
  });
  assert.deepEqual(sessionFor("", store, "fa", valid, secret), {
    kind: "landing",
  });
  assert.deepEqual(sessionFor("?room=bad!", store, "fa", valid, secret), {
    kind: "invalid",
    code: "BAD!",
  });
  const joiner = sessionFor("?room=abcd", store, "fa", valid, secret);
  assert.deepEqual(joiner, {
    kind: "room",
    code: "ABCD",
    role: "joiner",
    token: "s1",
  });
  assert.deepEqual(
    sessionFor("?room=ABCD", store, "fa", valid, secret),
    joiner,
    "a refresh is the same member",
  );
  store.setItem(keys("fa").host("ABCD"), "creator");
  assert.deepEqual(sessionFor("?room=ABCD", store, "fa", valid, secret), {
    kind: "room",
    code: "ABCD",
    role: "host",
    token: "creator",
  });
  assert.deepEqual(
    sessionFor("?room=ABCD&display=1", store, "fa", valid, secret),
    { kind: "room", code: "ABCD", role: "display", token: "s2" },
  );
  assert.equal(keys("fuse-axe").hero, "fuse-axe-hero");
  const broken = safeStore(() => {
    throw new Error("blocked");
  });
  broken.setItem("x", "1");
  assert.equal(broken.getItem("x"), "1");
  broken.removeItem("x");
  assert.equal(broken.getItem("x"), null);
  const refuse = (): never => {
    throw new Error("quota");
  };
  const refusing: Storage = {
    length: 0,
    clear: refuse,
    key: () => null,
    getItem: (key: string) => (key === "probe" ? null : refuse()),
    setItem: refuse,
    removeItem: refuse,
  };
  const flaky = safeStore(() => refusing);
  flaky.setItem("y", "2");
  assert.equal(flaky.getItem("y"), "2", "a refusing storage falls back");
  flaky.removeItem("y");
  assert.equal(flaky.getItem("y"), null);
  assert.equal(roomFailure("unknown game fuse-axe"), NOT_OPEN);
  assert.match(roomFailure("room is for another game"), /another game/);
  assert.equal(roomFailure("full"), "full");
});
