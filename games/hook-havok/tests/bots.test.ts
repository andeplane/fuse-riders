import test from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  PRESENCE,
  SPECTATOR,
  roomManager,
  type StreamEntries,
} from "fuse-netcode";
import {
  BOT_NAMES,
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  isEntry,
  type Entry,
  type Room,
} from "../src/online/game.js";
import { inPlay, type Keeper } from "../src/engine/arena.js";
import {
  CLASSIC_TUNING,
  DEFAULT_TUNING,
  NEUTRAL,
  S,
  type Input,
  type Tuning,
} from "../src/engine/world.js";
import { parseInput, parseTuning } from "../src/engine/codec.js";
import { MAPS } from "../src/engine/maps.js";
import { BLAST_RADIUS, COOLDOWN_TICKS } from "../src/engine/bomb-rules.js";
import {
  ALL_POWERS,
  POWER_KINDS,
  powerPool,
} from "../src/engine/power-rules.js";
import { grantPower } from "../src/engine/power-ups.js";
import { planBots } from "../src/engine/bot.js";
import { navGraph } from "../src/engine/bot-nav.js";
import { freshMind } from "../src/engine/bot-mind.js";
import {
  botsToRemove,
  chooseBots,
  removalInterrupts,
} from "../src/app/bot-count.js";
import { Mesh } from "./fixtures/mesh.js";

const host = "host";
/** One stream, the creator's, carrying every entry of a tick. */
function stream(entries: Entry[]): Map<string, StreamEntries<Entry>> {
  return new Map([[host, { generation: 1, entries }]]);
}
/** A running room: the host seated in slot 0 (unless `human` is false), then `bots` AI keepers. */
function botRoom(tuning: Tuning, bots: number, human = true): Room {
  const r = createRoom("lobby", tuning),
    first = human ? 1 : 0,
    entries: Entry[] = human
      ? [[1, 1, JOIN, host, "Keeper", 0, "keeper", 1]]
      : [];
  for (let i = 0; i < bots; i++)
    entries.push([
      entries.length + 1,
      1,
      BOT,
      "add",
      `bot:${i + 1}`,
      BOT_NAMES[first + i]!,
      first + i,
    ]);
  entries.push([entries.length + 1, 1, ACTION, "start", "match"]);
  foldTick(r, host, stream(entries));
  return r;
}
const humanInput = (t: number, input: Partial<Input>): Entry => [
  t * 4 + 100,
  t,
  0,
  "match",
  1,
  { ...NEUTRAL, ...input },
];
const idle = (r: Room) => foldTick(r, host, stream([]));
const bots = (r: Room) => r.simulation.keepers.filter((k) => k.mind);
const keeper = (r: Room, id: string) =>
  r.simulation.keepers.find((k) => k.id === id)!;
/** Stand a keeper on ledge `p` of the room's map at x (world units). */
function stand(r: Room, k: Keeper, p: number, x: number): void {
  const top = MAPS[r.settings.map].platforms[p]![1];
  Object.assign(k.world, {
    x: x * S,
    feet: top * S - 1,
    vx: 0,
    vy: 0,
    grounded: true,
  });
}

test("bot entries pass the wire guard, spectators still do not", () => {
  assert.ok(isEntry([1, 1, BOT, "add", "bot:1", "Wick", 1]));
  assert.ok(isEntry([2, 1, BOT, "remove", "bot:1"]));
  assert.equal(isEntry([3, 1, BOT, "add", "bot:1", "Wick", 5]), false);
  assert.equal(isEntry([4, 1, SPECTATOR, "join", "w", "Watcher", 1]), false);
  assert.equal(
    parseTuning({ ...DEFAULT_TUNING, botLevel: "insane" }),
    undefined,
  );
  const { botLevel: _level, ...old } = DEFAULT_TUNING;
  assert.equal(parseTuning(old), undefined, "a pre-13 setting is refused");
  assert.equal(DEFAULT_TUNING.botLevel, "normal");
});

test("only canonical bot ids pass the wire guard, and a person's entries may not name one", () => {
  // Every BOT add the guard lets through seats a bot a joiner can restore.
  for (const id of ["bot:1", "bot:9", "bot:10", "bot:99"]) {
    const add: Entry = [1, 1, BOT, "add", id, "Wick", 1];
    assert.ok(isEntry(add), id);
    assert.ok(isEntry([2, 1, BOT, "remove", id]), `remove ${id}`);
    const r = createRoom("lobby", DEFAULT_TUNING);
    foldTick(r, host, stream([add, [2, 1, ACTION, "start", "match"]]));
    assert.equal(r.seats.get(id)?.bot, true);
    assert.ok(decode(encode(r), r.tick), `a room with ${id} restores`);
  }
  for (const id of [
    "stranger",
    "bot:100",
    "bot:0",
    "bot:01",
    "Bot:3",
    "bot:",
  ]) {
    assert.equal(isEntry([1, 1, BOT, "add", id, "Wick", 1]), false, id);
    assert.equal(isEntry([2, 1, BOT, "remove", id]), false, `remove ${id}`);
    // Past the guard, the shared fold would seat it where `decode` refuses it.
    const r = createRoom("lobby", DEFAULT_TUNING);
    foldTick(r, host, stream([[1, 1, BOT, "add", id, "Wick", 1]]));
    assert.equal(r.seats.get(id)?.bot, true);
    assert.equal(
      decode(encode(r), r.tick),
      undefined,
      `${id} would not restore`,
    );
  }
  // A LEAVE, JOIN or PRESENCE naming a bot: a LEAVE mid-round would otherwise
  // mark the bot absent, and it would stop playing.
  assert.equal(isEntry([1, 5, LEAVE, "bot:1"]), false);
  assert.equal(isEntry([1, 5, JOIN, "bot:1", "Wick", 1, "keeper", 1]), false);
  assert.equal(isEntry([1, 5, PRESENCE, "bot:1", false, 0]), false);
  assert.ok(isEntry([1, 5, LEAVE, "guest"]));
  assert.ok(isEntry([1, 5, JOIN, "guest", "Guest", 1, "keeper", 1]));
  assert.ok(isEntry([1, 5, PRESENCE, "guest", false, 1]));
  const r = botRoom(DEFAULT_TUNING, 1);
  for (let t = 2; t < 5; t++) idle(r);
  foldTick(r, host, stream([[9, 5, LEAVE, "bot:1"]]));
  assert.equal(
    r.seats.get("bot:1")?.connected,
    false,
    "past the guard, a LEAVE would stop the bot",
  );
  assert.equal(decode(encode(r), r.tick), undefined, "and not restore");
});

test("the Bots choice: a raised count clears a pending removal, and removal takes the last seats", () => {
  assert.deepEqual(chooseBots(1, 3), { add: 0, target: 1, lobby: true });
  // 1 of 3, then 4 before the lobby frame arrives: the room must end at 4.
  let target = chooseBots(1, 3).target;
  const raise = chooseBots(4, 3);
  target = raise.target;
  assert.deepEqual(raise, { add: 1, target: undefined, lobby: false });
  assert.equal(target, undefined);
  assert.deepEqual(chooseBots(3, 3), {
    add: 0,
    target: undefined,
    lobby: false,
  });
  assert.deepEqual(chooseBots(0, 2), { add: 0, target: 0, lobby: true });
  const seats = [
    { id: "host", slot: 0, bot: false },
    { id: "bot:2", slot: 3, bot: true },
    { id: "bot:1", slot: 1, bot: true },
    { id: "bot:3", slot: 4, bot: true },
  ];
  assert.deepEqual(botsToRemove(seats, 1), ["bot:3", "bot:2"]);
  assert.deepEqual(botsToRemove(seats, 3), []);
  assert.deepEqual(botsToRemove(seats, 0), ["bot:3", "bot:2", "bot:1"]);
  // Only a competitive round under way asks before the lobby trip.
  const live = (
    rules: string,
    phase: string,
    stage: Room["stage"] = "running",
  ) => removalInterrupts(stage, { rules, phase });
  assert.equal(live("elimination", "active"), true);
  assert.equal(live("score", "countdown"), true);
  assert.equal(live("elimination", "over"), false);
  assert.equal(live("score", "waiting"), false);
  assert.equal(live("free", "active"), false);
  assert.equal(live("elimination", "active", "lobby"), false);
});

for (const botLevel of ["easy", "normal", "hard"] as const)
  test(`${botLevel} bots replay identically: two folds agree every tick, and clones and checkpoints resume to the same hash`, () => {
    const tuning: Tuning = { ...DEFAULT_TUNING, botLevel };
    const a = botRoom(tuning, 4);
    let b = botRoom(tuning, 4),
      c: Room | undefined;
    const script = (t: number): Partial<Input> => ({
      move: (t % 60 < 30 ? 1 : -1) as Input["move"],
      jump: t % 45 === 3,
      bomb: t % 70 < 8,
      aimX: 800,
      aimY: 500,
    });
    for (let t = 2; t <= 700; t++) {
      const s = stream([humanInput(t, script(t))]);
      foldTick(a, host, s);
      foldTick(b, host, s);
      if (c) foldTick(c, host, s);
      assert.equal(hash(b), hash(a), `independent fold, tick ${t}`);
      if (c) assert.equal(hash(c), hash(a), `restored checkpoint, tick ${t}`);
      // Rollback keeps structured clones; a joiner decodes a checkpoint.
      if (t % 97 === 0) b = structuredClone(b);
      if (t === 300) {
        c = decode(encode(a), a.tick);
        assert.ok(c, "a checkpoint with bots decodes");
        assert.equal(hash(c), hash(a));
      }
    }
    const all = bots(a);
    assert.equal(all.length, 4);
    assert.ok(all.reduce((n, k) => n + k.bomb.thrown, 0) > 5, "bots throw");
  });

test("five bots with bombs and every power-up, restored from their own checkpoint every 7 ticks and cloned for rollback, stay on the hash of a room never restored", () => {
  const tunings: Tuning[] = [
    {
      ...DEFAULT_TUNING,
      map: "crossroads",
      rules: "elimination",
      bomb: "fuse",
      botLevel: "hard",
      powerUps: ALL_POWERS,
      experiment: "ricochet",
    },
    {
      ...DEFAULT_TUNING,
      map: "belfry",
      rules: "score",
      bomb: "impact",
      botLevel: "easy",
      powerUps: ALL_POWERS,
      experiment: "ball",
    },
    { ...DEFAULT_TUNING, map: "belfry", rules: "free" },
    {
      ...DEFAULT_TUNING,
      map: "crossroads",
      rules: "score",
      jumpMode: "single",
      botLevel: "normal",
    },
  ];
  const seen = new Set<string>(),
    held = new Set<string>(),
    n = { pickups: 0, grants: 0, cluster: 0, bomblets: 0, dashing: 0 };
  for (const tuning of tunings) {
    const label = `${tuning.map}/${tuning.rules}/${tuning.botLevel}`;
    const never = botRoom(tuning, 5, false);
    let twin = botRoom(tuning, 5, false),
      restores = 0;
    for (let t = 2; t <= 600; t++) {
      idle(never);
      idle(twin);
      assert.equal(hash(twin), hash(never), `${label}, tick ${t}`);
      // Bots take pads on their own; now and then one in play also gets what
      // a pickup grants, the same in both rooms, so every kind is held.
      if (t % 40 === 0) {
        const pool = powerPool(tuning),
          kind = pool[(t / 40) % pool.length]!,
          k = bots(never).find(
            (b) =>
              inPlay(never.simulation, b) &&
              !b.world.respawn &&
              b.slot === (t / 40) % 5,
          );
        if (k) {
          for (const room of [never, twin])
            grantPower(keeper(room, k.id), kind, tuning.jumpMode);
          n.grants++;
        }
      }
      const a = never.simulation;
      for (const e of a.pickupEvents)
        if (!seen.has(`${label}p${e.tick}${e.by}`)) {
          seen.add(`${label}p${e.tick}${e.by}`);
          n.pickups++;
        }
      for (const b of a.bombs)
        if (!seen.has(`${label}b${b.id}`)) {
          seen.add(`${label}b${b.id}`);
          if (b.kind === "cluster") n.cluster++;
          if (b.kind === "bomblet") n.bomblets++;
        }
      for (const k of bots(never)) {
        if (k.power.kind) held.add(k.power.kind);
        if (k.world.dash) n.dashing++;
      }
      if (t % 7 === 0) {
        const saved = encode(twin),
          restored = decode(saved, twin.tick);
        assert.ok(restored, `${label}: the checkpoint at tick ${t} decodes`);
        assert.deepEqual(encode(restored), saved, `${label}: and re-encodes`);
        twin = restored;
        restores++;
      } else if (t % 5 === 0) twin = structuredClone(twin);
    }
    assert.equal(restores, 85);
    assert.equal(bots(never).length, 5);
    assert.ok(
      bots(never).reduce((n, k) => n + k.bomb.thrown, 0) > 5,
      `${label}: bots throw`,
    );
  }
  const summary = JSON.stringify({ ...n, held: [...held] });
  assert.equal(held.size, 5, `bots held every kind: ${summary}`);
  assert.ok(n.pickups > 10, `bots collect pads themselves: ${summary}`);
  assert.ok(n.cluster > 0 && n.bomblets > 0, `bots throw clusters: ${summary}`);
  assert.ok(n.dashing > 0, `bots dash: ${summary}`);
});

test("planning with every power active writes the bots' minds and nothing else", () => {
  const r = botRoom({ ...DEFAULT_TUNING, botLevel: "hard" }, 5, false);
  let dodges = 0,
    moved = 0,
    all = bots(r);
  for (let t = 2; t <= 400; t++) {
    idle(r);
    // The fold rebuilds the keeper list every tick.
    const a = r.simulation;
    all = bots(r);
    // One bot per kind, kept holding it, and now and then each bot's own bomb
    // at its feet, so dodges fly the planner's ghost with every power.
    all.forEach((k, i) => {
      if (!inPlay(a, k) || k.world.respawn) return;
      const kind = POWER_KINDS[i]!;
      if (k.power.kind !== kind) grantPower(k, kind, a.tuning.jumpMode);
      if (
        t % 25 === i * 3 &&
        !k.world.charge &&
        !a.bombs.some((b) => b.owner === k.id)
      ) {
        k.bomb.cooldown = COOLDOWN_TICKS;
        a.bombs.push({
          id: a.tick * 32 + k.slot * 4,
          owner: k.id,
          kind: "plain",
          x: k.world.x + 20 * S,
          y: k.world.feet - 11 * S,
          vx: 0,
          vy: 0,
          fuse: 40,
        });
        a.bombs.sort((p, q) => p.id - q.id);
        dodges++;
      }
    });
    const minds = all.map((k) => k.mind && { ...k.mind }),
      before = hash(r),
      state = structuredClone(a),
      twin = structuredClone(a);
    const inputs = planBots(a);
    // The same state plans the same inputs and the same minds.
    assert.deepEqual(planBots(twin), inputs, `tick ${t}: inputs`);
    assert.deepEqual(
      twin.keepers.map((k) => k.mind),
      a.keepers.map((k) => k.mind),
      `tick ${t}: minds`,
    );
    if (all.some((k, i) => !isDeepStrictEqual(k.mind, minds[i]))) moved++;
    // Put the minds back: every other byte must be as it was.
    all.forEach((k, i) => (k.mind = minds[i]!));
    assert.equal(hash(r), before, `tick ${t}: hash`);
    assert.ok(isDeepStrictEqual(a, state), `tick ${t}: state`);
  }
  assert.ok(dodges > 50 && moved > 100, JSON.stringify({ dodges, moved }));
  const kinds = new Set(all.map((k) => k.power.kind));
  assert.ok(kinds.size >= 4, [...kinds].join());
});

test("BOT entries seat bots in free slots; bots never manage, stay through succession and leave only between rounds", () => {
  const r = createRoom("lobby", DEFAULT_TUNING);
  foldTick(
    r,
    host,
    stream([
      [1, 1, JOIN, host, "Keeper", 0, "keeper", 1],
      [2, 1, BOT, "add", "bot:1", "Wick", 1],
      [3, 1, JOIN, "guest", "Guest", 2, "keeper", 1],
      [4, 1, BOT, "add", "bot:2", "Rook", 3],
      [5, 1, BOT, "add", "bot:3", "Tallow", 2], // slot taken: refused
      [6, 1, ACTION, "start", "match"],
    ]),
  );
  assert.deepEqual(
    [...r.seats.values()].map((s) => [s.id, s.slot, s.bot]),
    [
      [host, 0, false],
      ["bot:1", 1, true],
      ["guest", 2, false],
      ["bot:2", 3, true],
    ],
  );
  assert.equal(r.seats.get("bot:1")!.avatarId, "keeper");
  assert.deepEqual(
    r.simulation.keepers.map((k) => k.mind !== null),
    [false, true, false, true],
  );
  assert.equal(roomManager(r.seats.values(), host), host);
  // The host steps away: the crown passes to the guest, never to the bot in the lower slot.
  foldTick(r, host, stream([[7, 2, PRESENCE, host, false, 1]]));
  assert.equal(roomManager(r.seats.values(), host), "guest");
  const x = keeper(r, "bot:1").world.x;
  for (let t = 3; t < 60; t++) idle(r);
  assert.ok(r.seats.get("bot:1")?.connected, "bots stay through succession");
  assert.notEqual(keeper(r, "bot:1").world.x, x, "and keep playing");
  // A removal while the round runs is refused by the fold; between rounds it applies.
  const guest = (entries: Entry[]) =>
    foldTick(
      r,
      host,
      new Map([
        [host, { generation: 1, entries: [] }],
        ["guest", { generation: 1, entries }],
      ]),
    );
  guest([[1, 60, BOT, "remove", "bot:1"]]);
  assert.ok(r.seats.has("bot:1"));
  guest([
    [2, 61, ACTION, "lobby", "next"],
    [3, 61, BOT, "remove", "bot:1"],
    [4, 61, BOT, "add", "bot:4", "Gargoyle", 4],
    [5, 61, ACTION, "start", "next"],
  ]);
  assert.equal(r.stage, "running");
  assert.equal(r.seats.has("bot:1"), false);
  assert.deepEqual(
    r.simulation.keepers.map((k) => [k.id, k.mind !== null]),
    [
      [host, false],
      ["guest", false],
      ["bot:2", true],
      ["bot:4", true],
    ],
  );
  assert.ok(decode(encode(r), r.tick));
});

test("the room runtime adds bots on the manager's command and every peer drives them alike", () => {
  const mesh = new Mesh(),
    a = mesh.join("a");
  mesh.run(500);
  a.command({ type: "join", name: "A" });
  mesh.run(500);
  const b = mesh.join("b");
  mesh.run(1500);
  b.command({ type: "join", name: "B" });
  mesh.run(1000);
  assert.equal(a.command({ type: "action", action: "start" }), true);
  mesh.run(500);
  assert.equal(
    b.command({ type: "bot", action: "add" }),
    false,
    "only the manager",
  );
  assert.equal(a.command({ type: "bot", action: "add" }), true);
  assert.equal(a.command({ type: "bot", action: "add" }), true);
  mesh.run(3000);
  const seats = [...b.state()!.seats.values()].filter((s) => s.bot);
  assert.deepEqual(
    seats.map((s) => [s.id, s.name, s.slot]),
    [
      ["bot:1", BOT_NAMES[2], 2],
      ["bot:2", BOT_NAMES[3], 3],
    ],
  );
  assert.equal(
    a.command({ type: "bot", action: "remove", id: "bot:1" }),
    false,
    "not while the round runs",
  );
  const common = Math.min(a.state()!.tick, b.state()!.tick) - 10;
  assert.equal(a.hashAt(common), b.hashAt(common));
  const moved = b
    .state()!
    .simulation.keepers.filter(
      (k) => k.mind && k.world.x !== MAPS.belfry.spawns[k.slot]![0] * S,
    );
  assert.equal(moved.length, 2, "bots move on every peer");
  a.stop();
  mesh.run(6500);
  assert.equal(
    [...b.state()!.seats.values()].filter((s) => s.bot).length,
    2,
    "bots stay when the creator leaves",
  );
  b.stop();
});

test("corrupt bot seats and minds are refused and leave the healthy room unchanged", () => {
  const r = botRoom(DEFAULT_TUNING, 2);
  for (let t = 2; t < 80; t++) idle(r);
  const good = encode(r),
    saved = hash(r);
  assert.equal(hash(decode(good, r.tick)!), saved);
  type Seat = Record<string, unknown>;
  interface Arena {
    tuning: Record<string, unknown>;
    keepers: { id: string; mind: Record<string, unknown> | null }[];
  }
  const corrupt = (
    edit: (seats: Seat[], arena: Arena, f: unknown[]) => void,
  ) => {
    const f = structuredClone(good);
    edit(f[4] as Seat[], f[5] as Arena, f);
    return decode(f, r.tick);
  };
  const edges = navGraph(DEFAULT_TUNING).edges.length,
    ledges = MAPS[DEFAULT_TUNING.map].platforms.length;
  const cases: [string, (s: Seat[], a: Arena, f: unknown[]) => void][] = [
    ["bot seat with a generation", (s) => (s[1]!.generation = 1)],
    ["bot seat away", (s) => (s[1]!.away = true)],
    [
      "bot seat absent",
      (s, a) => {
        s[1]!.connected = false;
        (a.keepers[1] as Record<string, unknown>).connected = false;
      },
    ],
    [
      "a person with a bot's id",
      (s, a) => {
        s[0]!.id = "bot:9";
        a.keepers[0]!.id = "bot:9";
      },
    ],
    ["bot flag not a boolean", (s) => (s[1]!.bot = 1)],
    [
      "a bot seat with a person's id",
      (s, a) => {
        s[1]!.id = "stranger";
        a.keepers[1]!.id = "stranger";
      },
    ],
    [
      "a person claims a bot seat",
      (s) => {
        s[0]!.bot = true;
        s[0]!.id = "bot:9";
        delete s[0]!.generation;
      },
    ],
    ["a bot keeper without a mind", (_s, a) => (a.keepers[1]!.mind = null)],
    [
      "a person with a mind",
      (_s, a) => (a.keepers[0]!.mind = { ...freshMind() }),
    ],
    ["mind with an extra key", (_s, a) => (a.keepers[1]!.mind!.mood = 1)],
    ["mind missing a key", (_s, a) => delete a.keepers[1]!.mind!.arc],
    ["edge past the graph", (_s, a) => (a.keepers[1]!.mind!.edge = edges)],
    ["goal past the ledges", (_s, a) => (a.keepers[1]!.mind!.goal = ledges)],
    ["hop below −1", (_s, a) => (a.keepers[1]!.mind!.hop = -2)],
    ["fractional timer", (_s, a) => (a.keepers[1]!.mind!.timer = 1.5)],
    ["charge above full", (_s, a) => (a.keepers[1]!.mind!.hold = 37)],
    ["rival slot out of range", (_s, a) => (a.keepers[1]!.mind!.rival = 5)],
    ["unknown hook task", (_s, a) => (a.keepers[1]!.mind!.task = 3)],
    ["goal x outside the arena", (_s, a) => (a.keepers[1]!.mind!.goalX = 1601)],
    [
      "unknown level",
      (_s, a, f) => {
        a.tuning.botLevel = "insane";
        (f[3] as Record<string, unknown>).botLevel = "insane";
      },
    ],
  ];
  for (const [name, edit] of cases)
    assert.equal(corrupt(edit), undefined, name);
  assert.equal(hash(r), saved, "the healthy room is untouched");
});

test("a bot dodges a bomb that would have caught it", () => {
  const tuning: Tuning = { ...DEFAULT_TUNING, botLevel: "hard" };
  const plant = (r: Room, at: Keeper) => {
    const owner = keeper(r, host);
    owner.bomb.cooldown = COOLDOWN_TICKS;
    r.simulation.bombs.push({
      id: r.simulation.tick * 32,
      owner: host,
      kind: "plain",
      x: at.world.x - 30 * S,
      y: at.world.feet - 11 * S,
      vx: 0,
      vy: 0,
      fuse: 45,
    });
  };
  // Control: a keeper who stays put is caught.
  const control = botRoom(tuning, 1);
  const victim = keeper(control, host);
  for (let t = 2; t < 20; t++) idle(control);
  stand(control, victim, 2, 800);
  plant(control, victim);
  for (let t = 0; t < 20; t++) idle(control);
  assert.equal(victim.bomb.selfKnockouts, 1, "the bomb is lethal there");
  // The bot, same bomb at its feet on the ledge it runs along.
  const r = botRoom(tuning, 1);
  const bot = keeper(r, "bot:1");
  for (let t = 2; t < 20; t++) idle(r);
  stand(r, bot, 2, 800);
  plant(r, bot);
  const blasts = r.simulation.blasts.length;
  for (let t = 0; t < 20; t++) idle(r);
  assert.ok(
    r.simulation.blasts.length > blasts || r.simulation.bombs.length === 0,
  );
  assert.equal(bot.bomb.bombed, 0, "the bot got clear");
  assert.equal(bot.world.deaths, 0, "without falling");
});

test("a bot's throw lands on a keeper who stands still", () => {
  // No pads: a hard bot would take one first and throw from elsewhere.
  const r = botRoom({ ...DEFAULT_TUNING, botLevel: "hard", powerUps: 0 }, 1);
  const target = keeper(r, host),
    bot = keeper(r, "bot:1");
  stand(r, target, 0, 200);
  stand(r, bot, 1, 520);
  let blast: { x: number; y: number } | undefined;
  for (let t = 0; t < 300 && !blast; t++) {
    stand(r, target, 0, 200);
    idle(r);
    blast = r.simulation.blasts.find((e) => e.owner === "bot:1");
  }
  assert.ok(blast, "the bot throws within 15 seconds");
  const dx =
      blast.x - Math.max(200 * S - 16 * S, Math.min(200 * S + 16 * S, blast.x)),
    dy = blast.y - Math.max(810 * S - 53 * S, Math.min(810 * S, blast.y));
  assert.ok(
    Math.sqrt(dx * dx + dy * dy) <= BLAST_RADIUS * S,
    `blast ${Math.round(Math.sqrt(dx * dx + dy * dy) / S)} units from the target`,
  );
  assert.equal(target.bomb.bombed, 1, "and knocks it out");
  assert.equal(bot.bomb.selfKnockouts, 0);
});

test("a bot falling past every ledge hooks an anchor above and climbs back", () => {
  const tuning: Tuning = { ...DEFAULT_TUNING, bomb: "off", botLevel: "hard" };
  const fall = (r: Room, k: Keeper) =>
    Object.assign(k.world, {
      x: 335 * S,
      feet: 760 * S,
      vx: 0,
      vy: 4 * S,
      grounded: false,
      airJump: false,
      coyote: 0,
    });
  // Control: nothing below the gap between the first two floor ledges.
  const control = botRoom(tuning, 1);
  for (let t = 2; t < 10; t++) idle(control);
  fall(control, keeper(control, host));
  for (let t = 0; t < 30; t++) idle(control);
  assert.equal(keeper(control, host).world.deaths, 1, "the fall is fatal");
  const r = botRoom(tuning, 1),
    bot = keeper(r, "bot:1");
  for (let t = 2; t < 10; t++) idle(r);
  fall(r, bot);
  let hooked = false,
    landed = false;
  for (let t = 0; t < 60 && !landed; t++) {
    idle(r);
    hooked ||= bot.world.hook.phase === "attached";
    landed = bot.world.grounded;
  }
  assert.ok(hooked, "it hooked");
  assert.ok(landed, "and stands on a ledge");
  assert.equal(bot.world.deaths, 0);
});

/** Five bots, no people, for `ticks` log ticks; a finished round starts another. */
function soak(tuning: Tuning, ticks = 2400) {
  const r = botRoom(tuning, 5, false);
  const seen = new Set<string>(),
    still = new Map<string, { x: number; feet: number; n: number }>();
  const n = {
    rounds: 0,
    thrown: 0,
    knockouts: 0,
    self: 0,
    falls: 0,
    hits: 0,
    stuck: 0,
    invalid: 0,
    checkpoints: 0,
    pickups: 0,
    bomblets: 0,
    shieldPops: 0,
    dashes: 0,
  };
  let seq = 100;
  for (let t = 2; t <= ticks; t++) {
    // Every so often the room must survive a checkpoint exactly.
    if (t % 50 === 0) {
      const restored = decode(encode(r), r.tick);
      if (!restored || hash(restored) !== hash(r)) n.checkpoints++;
    }
    const over = r.simulation.contest.phase === "over";
    if (over) n.rounds++;
    const before = new Map(
      r.simulation.keepers.map((k) => [
        k.id,
        [k.world.deaths, k.bomb.bombed + k.bomb.selfKnockouts, k.hits],
      ]),
    );
    foldTick(
      r,
      host,
      stream(
        over
          ? [
              [seq++, t, ACTION, "lobby", `m${t}`],
              [seq++, t, ACTION, "start", `m${t}`],
            ]
          : [],
      ),
    );
    const a = r.simulation;
    for (const b of a.bombs)
      if (!seen.has(`b${b.id}`)) {
        seen.add(`b${b.id}`);
        if (b.kind === "bomblet") n.bomblets++;
        else n.thrown++;
      }
    for (const e of a.knockouts)
      if (!seen.has(`k${e.tick}${e.target}`)) {
        seen.add(`k${e.tick}${e.target}`);
        if (e.by === e.target) n.self++;
        else n.knockouts++;
      }
    for (const e of a.pickupEvents)
      if (!seen.has(`p${e.tick}${e.by}`)) {
        seen.add(`p${e.tick}${e.by}`);
        n.pickups++;
      }
    for (const e of a.shieldPops)
      if (!seen.has(`s${e.tick}${e.target}`)) {
        seen.add(`s${e.tick}${e.target}`);
        n.shieldPops++;
      }
    for (const k of a.keepers) {
      // A dash lasts 12 steps, four log ticks: count its first.
      if (k.world.dash > 9) n.dashes++;
      const w = k.world,
        [deaths, blasted, hits] = before.get(k.id) ?? [w.deaths, 0, k.hits];
      n.falls += Math.max(
        0,
        w.deaths - deaths! - (k.bomb.bombed + k.bomb.selfKnockouts - blasted!),
      );
      n.hits += Math.max(0, k.hits - hits!);
      if (!isDeepStrictEqual(parseInput(w.input), w.input)) n.invalid++;
      // Stuck: in play and within 8 units for ten seconds.
      const s = still.get(k.id) ?? { x: w.x, feet: w.feet, n: 0 };
      if (
        !inPlay(a, k) ||
        w.respawn ||
        Math.abs(w.x - s.x) > 8 * S ||
        Math.abs(w.feet - s.feet) > 8 * S
      )
        Object.assign(s, { x: w.x, feet: w.feet, n: 0 });
      else if (++s.n === 200) n.stuck++;
      still.set(k.id, s);
    }
  }
  return n;
}
for (const map of ["crossroads", "belfry"] as const)
  test(`soak: five bots play two minutes of every rule set on ${map}, with and without power-ups, without getting stuck`, () => {
    const runs: [Tuning["rules"], Tuning["botLevel"]][] = [
      ["free", "normal"],
      ["elimination", "normal"],
      ["score", "normal"],
      ["free", "easy"],
      ["free", "hard"],
    ];
    for (const powerUps of [ALL_POWERS, 0]) {
      let knockouts = 0;
      for (const [rules, botLevel] of runs) {
        const n = soak({ ...DEFAULT_TUNING, map, rules, botLevel, powerUps });
        const label = `${map}/${rules}/${botLevel}/${powerUps ? "powers" : "none"} ${JSON.stringify(n)}`;
        assert.equal(n.invalid, 0, `only valid inputs: ${label}`);
        assert.equal(n.stuck, 0, `no stuck bots: ${label}`);
        assert.equal(n.checkpoints, 0, `checkpoints round-trip: ${label}`);
        assert.ok(n.thrown >= 40, `bombs thrown: ${label}`);
        if (rules !== "free")
          assert.ok(n.rounds >= 1, `rounds finish: ${label}`);
        // Hard bots dodge one another almost always; the knockouts are the other levels'.
        if (botLevel !== "hard") {
          knockouts += n.knockouts + n.self;
          // Pads draw bots off their stand-offs and into hook range of one
          // another (a score round's hook hit protects the rival), so a
          // powered run can go without one (bots.md); a run without may not.
          if (!powerUps)
            assert.ok(n.knockouts + n.self > 0, `knockouts: ${label}`);
        }
        if (powerUps) {
          assert.ok(n.pickups >= 10, `bots take pads: ${label}`);
          assert.ok(n.bomblets > 0, `bots throw cluster bombs: ${label}`);
        } else assert.equal(n.pickups + n.bomblets + n.dashes, 0, label);
        if (process.env.BOT_SOAK) console.log(label);
      }
      assert.ok(knockouts >= 5, `${map}: knockouts across the levels`);
    }
  });

test("bots idle in the lobby and outside a round, and a classic room without bots is unchanged", () => {
  const r = botRoom({ ...CLASSIC_TUNING, rules: "elimination" }, 1);
  // Countdown: nobody plays yet, the bot included.
  idle(r);
  assert.equal(r.simulation.contest.phase, "countdown");
  assert.deepEqual(keeper(r, "bot:1").world.input, {
    ...NEUTRAL,
    aimX: keeper(r, "bot:1").world.input.aimX,
    aimY: keeper(r, "bot:1").world.input.aimY,
  });
  const plain = botRoom(CLASSIC_TUNING, 0);
  for (let t = 2; t < 50; t++) idle(plain);
  assert.ok(plain.simulation.keepers.every((k) => k.mind === null));
  assert.equal(inPlay(plain.simulation, plain.simulation.keepers[0]!), true);
});
