import test from "node:test";
import { deepEqual as eq, equal, match, ok } from "node:assert/strict";
import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import * as online from "../src/app/online-source.js";
import { buzz, present, trouble, type Viewer } from "../src/app/presenter.js";
import { keys, safeStore, sessionFor } from "../src/app/session.js";
import type { TickEvent } from "../src/engine/index.js";
import * as game from "../src/online/game.js";

test("the query opens the landing, the local lobby, solo or a room, with one token per room and the TV with none", () => {
  const items = new Map<string, string>();
  const store = safeStore(() => ({
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  }));
  const valid = (code: string) => /^\w{4}$/.test(code);
  const at = (query: string) =>
    sessionFor(query, store, "g", valid, () => "new");
  const queries = ["?mute", "?local", "?seed=7", "?solo=1"];
  eq(
    queries.map((q) => at(q).kind),
    ["landing", "local", "local", "solo"],
  );
  eq(at("?room=no!"), { kind: "invalid", code: "NO!" });
  const room = (code: string, token: string, role: string) => ({
    ...{ kind: "room", code, token, role },
  });
  eq(at("?room=ab12&touch"), room("AB12", "new", "joiner"));
  equal(items.get(keys("g").peer("AB12")), "new", "the same member on reload");
  store.setItem(keys("g").host("CD34"), "made");
  eq(at("?room=CD34"), room("CD34", "made", "host"));
  const stored = items.size;
  eq(at("?room=CD34&display=1"), room("CD34", "new", "display"));
  equal(items.size, stored, "the TV keeps no token: it holds no seat");
  const blocked = safeStore(() => {
    throw new Error("blocked");
  });
  blocked.setItem("name", "Ada");
  equal(blocked.getItem("name"), "Ada", "blocked storage falls back to memory");
});

let seq = 0;
function fold(room: game.Room, bodies: Record<string, unknown[][]> = {}) {
  const streams = new Map<string, StreamEntries<game.Entry>>();
  for (const [id, list] of Object.entries(bodies)) {
    const entries = list.map((e) => [++seq, room.tick + 1, ...e] as game.Entry);
    streams.set(id, { generation: 1, entries });
  }
  game.foldTick(room, "a", streams);
}
/** `a`, whose name is markup, and a bot seated; `start` begins the match. */
function lobby(wins = 1): game.Room {
  const room = game.createRoom("m0", { ...game.DEFAULT_SETTINGS, wins });
  const a = [JOIN, "a", "<b>Ada</b>", 0, "gunship", 1];
  fold(room, { a: [a, [BOT, "add", "bot:1", "Baron", 1]] });
  return room;
}
const start = (room: game.Room) => {
  fold(room, { a: [[ACTION, "start", `m${room.round}`]] });
  while (room.tick < room.startAt) fold(room);
};
const seen = { hostPresent: true, touch: false, display: false };
const viewer = (me: string, host = false): Viewer => ({ ...seen, me, host });
const host = viewer("a", true),
  guest = viewer("z");
const show = (room: game.Room, viewer = host) =>
  present(game.view(room), viewer);

test("the lobby: the host adds and removes bots and starts at two gunships; a newcomer picks a name", () => {
  const room = lobby();
  const mine = show(room);
  const rows = mine.members.map((m) => `${m.name} ${m.status} ${m.removable}`);
  eq(rows, ["<b>Ada</b> YOU false", "Baron BOT true"]);
  ok(mine.canStart && mine.canAddBot && !mine.askName);
  const theirs = show(room, guest);
  ok(theirs.askName && !theirs.canStart && !theirs.members[1]!.removable);
  equal(theirs.note, "Pick a name to take a seat");
  equal(show(room, viewer("bot:1")).note, "Waiting for the host to start");
  match(show(room, { ...host, hostPresent: false }).note, /host left/);
  const alone = game.createRoom("m0", game.DEFAULT_SETTINGS);
  fold(alone, { a: [[JOIN, "a", "Ada", 0, "gunship", 1]] });
  ok(!show(alone).canStart);
  match(show(alone).note, /invite a friend or add a bot/);
});

test("a round counts down, says GO, follows this device's gunship and escapes the names it shows", () => {
  const room = lobby();
  fold(room, { a: [[ACTION, "start", "m1"]] });
  let model = show(room, { ...host, touch: true });
  equal(model.screen, "countdown");
  match(model.overlay, /class="countdown">3</);
  match(model.overlay, /&#60;b&#62;Ada/);
  ok(!model.overlay.includes("<b>"), "a name is text, not markup");
  eq([model.follow, model.flying, model.looks[0]!.tag], [0, true, "YOU"]);
  eq([model.looks[0]!.prompt, model.looks[1]!.prompt], ["TAP FIRE", undefined]);
  equal(show(room, guest).follow, undefined);
  while (room.tick < room.startAt) fold(room);
  model = show(room);
  ok(model.screen === "playing" && model.overlay.includes("GO!"));
  for (let i = 0; i < 20; i++) fold(room);
  ok(!show(room).overlay.includes("countdown"));
});

/** Plays the round out with only `survivor` left flying. */
function decide(room: game.Room, survivor: string): void {
  for (const c of room.world!.castles)
    if (room.ships[c.id] !== survivor) [c.alive, c.hp] = [false, 0];
  while (room.stage === "running") fold(room);
}

test("between rounds the scoreboard counts down to the next; at the end the host gets REMATCH", () => {
  const room = lobby(2);
  start(room);
  decide(room, "bot:1");
  let model = show(room);
  equal(model.screen, "between");
  match(model.overlay, /Baron<\/span> WINS THE ROUND.*NEXT ROUND IN 5/s);
  while (room.stage === "between") fold(room);
  while (room.tick < room.startAt) fold(room);
  decide(room, "bot:1");
  model = show(room);
  equal(model.screen, "over");
  match(model.overlay, /Baron<\/span> WINS!.*data-action="rematch"/s);
  match(show(room, guest).overlay, /WAITING FOR THE HOST/);
});

test("a shared TV: the TV frames everyone and asks no name; each seated device is a controller", () => {
  const room = lobby(2);
  room.settings.display = true;
  const tv: Viewer = { ...seen, me: "tv", host: false, display: true };
  match(show(room, tv).note, /Scan the code/);
  ok(!show(room, tv).askName && !show(room, tv).openTv);
  ok(show(room).openTv && !show(room, guest).openTv, "OPEN TV SCREEN: host");
  fold(room, { a: [[ACTION, "start", "m1"]] });
  const screen = show(room, tv);
  eq(
    [screen.screen, screen.follow, screen.controller, screen.note],
    ["countdown", undefined, null, ""],
  );
  let model = show(room);
  eq(
    [model.screen, model.flying, model.controller?.line],
    ["controller", true, "3"],
  );
  eq(
    model.controller && [
      model.controller.name,
      model.controller.tag,
      model.controller.wins,
    ],
    ["<b>Ada</b>", "P1", "0 / 2"],
  );
  equal(show(room, guest).screen, "countdown", "an unseated page watches");
  while (room.tick < room.startAt + 20) fold(room);
  const castle = room.world!.castles[0]!;
  [castle.hp, castle.reloadTicks, castle.reloadTotalTicks] = [
    castle.maxHp / 4,
    10,
    40,
  ];
  model = show(room);
  eq(
    model.controller && [
      model.controller.hp,
      model.controller.state,
      model.controller.loaded,
      model.controller.reload,
      model.controller.line,
    ],
    [0.25, "flying", false, 0.75, ""],
  );
  castle.alive = false;
  room.world!.ghosts.push({
    owner: 0,
    x: 9,
    y: 9,
    vx: 0,
    vy: 0,
    thrust: 0,
    reloadTicks: 0,
    reloadTotalTicks: 9,
    spawnTick: 0,
  });
  model = show(room);
  eq(
    model.controller && [
      model.controller.state,
      model.controller.loaded,
      model.controller.line,
    ],
    ["ghost", true, "GHOST: DROP BOMBS"],
  );
  decide(room, "bot:1");
  match(show(room).controller!.line, /^BARON WINS THE ROUND · NEXT IN \d$/);
  while (room.stage === "between") fold(room);
  while (room.tick < room.startAt) fold(room);
  decide(room, "bot:1");
  model = show(room);
  eq(
    [model.controller?.line, model.controller?.actions],
    ["BARON WINS THE MATCH", true],
  );
  equal(
    show(room, viewer("a")).controller?.line,
    "BARON WINS THE MATCH · WAITING FOR THE HOST",
  );
});

test("a controller buzzes when its own gunship is hit or falls", () => {
  const hit = (castleId: number, shielded = false): TickEvent => ({
    ...{ type: "hit", tick: 1, castleId, owner: 1, x: 0, y: 0 },
    ...{ damage: 5, shielded, splash: false },
  });
  const fell: TickEvent = {
    type: "castle-destroyed",
    tick: 1,
    castleId: 0,
    by: 1,
    x: 0,
    y: 0,
  };
  eq([buzz(hit(0), 0), buzz(hit(0, true), 0), buzz(fell, 0)], [60, 20, 300]);
  eq([buzz(hit(1), 0), buzz(fell, 1), buzz(hit(0), undefined)], [0, 0, 0]);
});

test("room status lines: dead ends, a link being retried, and news", () => {
  const lines = {
    "Room full (five players, five spectators and TV)": "full",
    "Room is full": "", // a seat refused: the page stays, to join once one frees
    "Room is full (AI included)": "",
    "Simulation out of sync — reload this page": "desync",
    "Direct connection failed · retrying": "retry",
    "Could not load the game — reload this page": "retry",
    "This host tab was replaced — use the newer tab": "fatal",
    "This room is on an older game version — start a new room": "fatal",
    "Connected · direct game link": "",
    "Waiting for a display": "display",
  };
  for (const [text, kind] of Object.entries(lines)) equal(trouble(text), kind);
});

test("the online source blends a round's two newest frames and hands on its round's events", () => {
  const room = lobby();
  start(room);
  const frame = (x: number, angle: number, tick = 0) => {
    Object.assign(room.world!.castles[0]!, { x, angle });
    const view = game.view(room);
    return { ...view, tick: view.tick + tick, matchId: "m0", logTick: 0 };
  };
  const older = { ...frame(100, 6.2), managerId: "a" };
  const newer = { ...frame(200, 0.1, 3), managerId: "a" };
  const half = online.blendRound(older.world, newer.world!, 0.5).castles[0]!;
  equal(half.x, 150);
  ok(Math.abs(half.angle - (6.2 + 0.1 + 2 * Math.PI) / 2) < 1e-9, "short way");
  const other = { ...older.world!, config: { seed: 9, playerCount: 2 } };
  equal(online.blendRound(other, newer.world!, 0.5), newer.world);
  const timing = { older, newer, tick: older.tick + 1.5, lead: 0 };
  const me = () => "a";
  const source = new online.OnlineSource(() => timing, me, newer.world!);
  const shown = source.view.castles[0]!.x;
  eq([shown, source.round, source.follow], [150, "m0:1", 0]);
  const at = { tick: 1, owner: 0, x: 1, y: 1 };
  const boom: TickEvent = { type: "rocket-exploded", ...at, cause: "ground" };
  source.push(boom, "m0", 1);
  source.push(boom, "m0", 2);
  eq([source.advance(), source.advance()], [[boom], []]);
  for (let i = 0; i <= online.MAX_EVENTS; i++) source.push(boom, "m0", 1);
  equal(source.advance().length, online.MAX_EVENTS, "a bounded queue");
});
