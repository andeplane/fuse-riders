import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  World as RollbackWorld,
  type RuntimeDependencies,
  type StreamEntries,
} from "fuse-netcode";
import { loadMap } from "../src/engine/index.js";
import { createSession } from "../src/online/session.js";
import {
  neuralGame,
  isEntry,
  type NeuralSettings,
  type NeuralEntry,
} from "../src/online/game.js";
const map = loadMap(
  JSON.parse(
    readFileSync(new URL("../maps/sandbox-12.json", import.meta.url), "utf8"),
  ),
);
const settings = (
  mode: NeuralSettings["mode"] = "sandbox",
  gameMap = map,
): NeuralSettings => ({ map: gameMap, slot: 0, mode, engine: {} });
function fold(
  entries: Record<string, NeuralEntry[]>,
  gameSettings = settings(),
) {
  const room = neuralGame.createRoom("match", gameSettings);
  const ticker = neuralGame.createTicker();
  const end = Math.max(
    ...Object.values(entries)
      .flat()
      .map((entry) => entry[1]),
  );
  for (let tick = 1; tick <= end; tick++) {
    const streams = new Map<string, StreamEntries<NeuralEntry>>();
    for (const [id, log] of Object.entries(entries))
      streams.set(id, {
        generation: 1,
        entries: log.filter((entry) => entry[1] === tick),
      });
    ticker(room, "host", streams);
  }
  return room;
}
const join = (
  seq: number,
  tick: number,
  id: string,
  slot: number,
): NeuralEntry => [seq, tick, 10, id, id, slot, "brain", 1];
const start = (seq: number, tick: number): NeuralEntry => [
  seq,
  tick,
  14,
  "start",
  "new-match",
];
const changeSettings = (
  seq: number,
  tick: number,
  next: NeuralSettings,
): NeuralEntry => [seq, tick, 13, next];
class Clock implements RuntimeDependencies {
  time = 0;
  serial = 0;
  loops = new Set<() => void>();
  now = () => this.time;
  hidden = () => false;
  token = () => `test-${++this.serial}`;
  generation = () => 1;
  schedule = (callback: () => void) => {
    this.loops.add(callback);
    return () => this.loops.delete(callback);
  };
  onVisibilityChange = () => () => {};
  run(ms: number) {
    for (let i = 0; i < ms; i += 10) {
      this.time += 10;
      for (const loop of this.loops) loop();
    }
  }
}
test("one human starts without bots, advances through shared runtime, and disposes its clock", () => {
  const clock = new Clock();
  const session = createSession(map, 0, "sandbox", {}, clock);
  clock.run(1000);
  assert.equal(session.view().players.length, 1);
  assert.equal(session.view().players[0]?.id, "solo");
  assert.ok(session.view().tick >= 18);
  assert.equal(session.view().finished, false);
  const initial = session.view().tick;
  session.dispatch({ type: "startResearch", research: "growth" });
  clock.run(200);
  assert.ok(session.view().tick > initial);
  session.reset();
  assert.ok(session.view().tick < initial);
  session.dispose();
  assert.equal(clock.loops.size, 0);
});
test("wire rejects malformed commands and checkpoints include management state in hash", () => {
  assert.equal(
    isEntry([1, 1, 1, "match", { type: "setPriority", cell: 0, weight: 999 }]),
    false,
  );
  const settings: NeuralSettings = {
    map,
    slot: 0,
    mode: "sandbox",
    engine: {},
  };
  const room = neuralGame.createRoom("match", settings);
  const hash = neuralGame.hash(room);
  room.settings = { ...room.settings, engine: { instantResearch: true } };
  assert.notEqual(neuralGame.hash(room), hash);
  room.settings = settings;
  const fields = neuralGame.checkpoint.encode(room);
  const restored = neuralGame.checkpoint.decode(fields, 0);
  assert.ok(restored);
  assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
  assert.equal(neuralGame.checkpoint.decode(fields, 9), undefined);
  assert.equal(neuralGame.checkpoint.decode(["{}"], 0), undefined);
});
test("combat lab supplies an opposing network and exactly one test tower", () => {
  const lab = loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/combat-lab-12.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const clock = new Clock();
  const session = createSession(lab, 0, "combat-lab", {}, clock);
  assert.equal(session.view().players.length, 2);
  assert.equal(
    session.view().structures.filter((s) => s.kind === "tower").length,
    1,
  );
  clock.run(12_000);
  assert.ok(session.view().players.some((p) => p.statistics.damage > 0));
  session.dispose();
});
test("each selected solo spawn is used in the runtime and survives checkpoint", () => {
  for (const spawn of map.spawns) {
    const clock = new Clock();
    const session = createSession(map, spawn.slot, "sandbox", {}, clock);
    const brain = session
      .view()
      .structures.find(
        (structure) => structure.ownerId === session.localPlayerId,
      );
    assert.equal(
      session
        .view()
        .players.find((player) => player.id === session.localPlayerId)?.slot,
      spawn.slot,
    );
    assert.equal(brain?.cell, spawn.cellIndex);
    session.dispose();
    const room = fold(
      { host: [join(1, 1, "host", 0), start(2, 2)] },
      { ...settings(), slot: spawn.slot },
    );
    assert.equal(
      room.world.players.find((player) => player.id === "host")?.slot,
      spawn.slot,
    );
    const restored = neuralGame.checkpoint.decode(
      neuralGame.checkpoint.encode(room),
      room.tick,
    );
    assert.ok(restored);
    assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
  }
});
test("each combat lab spawn creates exactly one supported test tower", () => {
  const lab = loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/combat-lab-12.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  for (const spawn of lab.spawns) {
    const clock = new Clock();
    const session = createSession(lab, spawn.slot, "combat-lab", {}, clock);
    assert.equal(
      session
        .view()
        .players.find((player) => player.id === session.localPlayerId)?.slot,
      spawn.slot,
    );
    assert.equal(
      session
        .view()
        .structures.filter((structure) => structure.kind === "tower").length,
      1,
    );
    session.dispose();
    const room = fold(
      { host: [join(1, 1, "host", 0), start(2, 2)] },
      { ...settings("combat-lab", lab), slot: spawn.slot },
    );
    assert.equal(room.stage, "running");
    assert.equal(
      room.world.players.find((player) => player.id === "host")?.slot,
      spawn.slot,
    );
    assert.equal(
      room.world.structures.filter((structure) => structure.kind === "tower")
        .length,
      1,
    );
    const restored = neuralGame.checkpoint.decode(
      neuralGame.checkpoint.encode(room),
      room.tick,
    );
    assert.ok(restored);
    assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
  }
});
test("watcher management entry survives checkpoint and whole-room hash", () => {
  const room = fold({
    host: [join(1, 1, "host", 0), [2, 2, 16, "join", "viewer", "Viewer", 1]],
  });
  assert.equal(room.seats.get("viewer")?.avatarId, "");
  const restored = neuralGame.checkpoint.decode(
    neuralGame.checkpoint.encode(room),
    room.tick,
  );
  assert.ok(restored);
  assert.deepEqual(restored.seats.get("viewer"), room.seats.get("viewer"));
  assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
});
test("an away watcher remains valid through checkpoint restore", () => {
  const room = fold({
    host: [join(1, 1, "host", 0), [2, 2, 16, "join", "viewer", "Viewer", 1]],
    viewer: [[1, 3, 12, "viewer", false, 1]],
  });
  assert.equal(room.seats.get("viewer")?.away, true);
  const restored = neuralGame.checkpoint.decode(
    neuralGame.checkpoint.encode(room),
    room.tick,
  );
  assert.ok(restored);
  assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
});
test("lobby settings rebuild the placeholder world and apply before a same-tick start", () => {
  const updated = { ...settings(), engine: { instantResearch: true } };
  const lobby = fold({
    host: [join(1, 1, "host", 0), changeSettings(2, 2, updated)],
  });
  assert.equal(lobby.stage, "lobby");
  assert.equal(lobby.world.settings.instantResearch, true);
  const restored = neuralGame.checkpoint.decode(
    neuralGame.checkpoint.encode(lobby),
    lobby.tick,
  );
  assert.ok(restored);
  assert.equal(neuralGame.hash(restored), neuralGame.hash(lobby));

  const started = fold({
    host: [join(1, 1, "host", 0), changeSettings(2, 2, updated), start(3, 2)],
  });
  assert.equal(started.stage, "running");
  assert.equal(started.world.settings.instantResearch, true);
  assert.ok(
    neuralGame.checkpoint.decode(
      neuralGame.checkpoint.encode(started),
      started.tick,
    ),
  );
});
test("settings entries cannot change an active or completed match", () => {
  const changed = { ...settings(), engine: { instantResearch: true } };
  const running = fold({
    host: [
      join(1, 1, "host", 0),
      start(2, 2),
      changeSettings(3, 2, changed),
      changeSettings(4, 3, changed),
    ],
  });
  assert.equal(running.stage, "running");
  assert.deepEqual(running.settings.engine, {});
  assert.deepEqual(running.world.settings, { matchId: "new-match" });
  assert.ok(
    neuralGame.checkpoint.decode(
      neuralGame.checkpoint.encode(running),
      running.tick,
    ),
  );
});
test("a completed match keeps its historical roster after a participant leaves", () => {
  const tiny = loadMap({
    schemaVersion: 1,
    id: "close-combat",
    width: 2,
    height: 1,
    layout: "odd-r",
    cells: [{ terrain: "open" }, { terrain: "open" }],
    spawns: [
      { slot: 0, cellIndex: 0 },
      { slot: 1, cellIndex: 1 },
    ],
  });
  const room = fold(
    { host: [join(1, 1, "host", 0), join(2, 2, "friend", 1), start(3, 3)] },
    settings("sandbox", tiny),
  );
  const ticker = neuralGame.createTicker();
  for (let attempt = 0; attempt < 600 && room.stage === "running"; attempt++)
    ticker(room, "host", new Map());
  assert.equal(room.stage, "over");
  assert.equal(room.world.finished, true);
  const tick = room.tick + 1;
  ticker(
    room,
    "host",
    new Map([
      [
        "host",
        {
          generation: 1,
          entries: [
            [4, tick, 11, "friend"],
            changeSettings(5, tick, {
              ...settings("sandbox", tiny),
              engine: { instantResearch: true },
            }),
          ],
        },
      ],
    ]),
  );
  assert.equal(room.seats.has("friend"), false);
  assert.equal(
    room.world.players.some((player) => player.id === "friend"),
    true,
  );
  assert.deepEqual(room.settings.engine, {});
  const restored = neuralGame.checkpoint.decode(
    neuralGame.checkpoint.encode(room),
    room.tick,
  );
  assert.ok(restored);
  assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
});
test("combat lab rejects two human seats without changing a healthy lobby", () => {
  const room = fold(
    { host: [join(1, 1, "host", 0), join(2, 2, "friend", 1), start(3, 3)] },
    settings("combat-lab"),
  );
  assert.equal(room.stage, "lobby");
  assert.equal(room.matchId, "match");
  assert.equal(room.world.tick, 0);
  assert.equal(room.world.players.length, 1);
});
test("sparse spawn slots retain explicit seat assignments", () => {
  const sparse = loadMap({
    ...map,
    spawns: map.spawns.filter((spawn) => spawn.slot !== 1),
  });
  const room = fold(
    { host: [join(1, 1, "host", 0), join(2, 2, "friend", 2), start(3, 3)] },
    settings("sandbox", sparse),
  );
  assert.equal(room.stage, "running");
  assert.deepEqual(
    room.world.players.map((player) => player.slot).sort(),
    [0, 2],
  );
  assert.ok(
    neuralGame.checkpoint.decode(neuralGame.checkpoint.encode(room), room.tick),
  );
});
test("unsupported spawn assignment leaves lobby intact", () => {
  const sparse = loadMap({
    ...map,
    spawns: map.spawns.filter((spawn) => spawn.slot !== 1),
  });
  const room = fold(
    { host: [join(1, 1, "host", 0), join(2, 2, "friend", 1), start(3, 3)] },
    settings("sandbox", sparse),
  );
  assert.equal(room.stage, "lobby");
  assert.equal(room.matchId, "match");
});
test("all four authored spawn slots start a sandbox match", () => {
  const room = fold({
    host: [
      join(1, 1, "host", 0),
      join(2, 2, "friend-1", 1),
      join(3, 3, "friend-2", 2),
      join(4, 4, "friend-3", 3),
      start(5, 5),
    ],
  });
  assert.equal(room.stage, "running");
  assert.deepEqual(
    room.world.players.map((player) => player.slot).sort(),
    [0, 1, 2, 3],
  );
});
test("a seat applies commands only from its logged stream generation", () => {
  const room = neuralGame.createRoom("match", settings());
  const ticker = neuralGame.createTicker();
  const apply = (
    entries: NeuralEntry[],
    generation = 1,
    retired: NeuralEntry[] = [],
  ) =>
    ticker(
      room,
      "host",
      new Map([
        [
          "host",
          {
            generation,
            entries,
            ...(retired.length
              ? { retired: [{ generation: 1, entries: retired }] }
              : {}),
          },
        ],
      ]),
    );
  apply([join(1, 1, "host", 0)]);
  apply([start(2, 2)]);
  const brain = room.world.structures.find(
    (structure) => structure.ownerId === "host",
  )!.cell;
  apply([]);
  apply([], 2, [
    [3, 4, 1, "new-match", { type: "setPriority", cell: brain, weight: 1 }],
  ]);
  assert.equal(room.world.players[0]?.priorities[String(brain)], 1);
  apply([[4, 5, 12, "host", true, 2]], 2);
  apply(
    [[5, 6, 1, "new-match", { type: "setPriority", cell: brain, weight: 2 }]],
    2,
    [[6, 6, 1, "new-match", { type: "setPriority", cell: brain, weight: 3 }]],
  );
  assert.equal(room.world.players[0]?.priorities[String(brain)], 2);
});
test("checkpoint rejects map, settings, clock and participant corruption", () => {
  const room = fold({ host: [join(1, 1, "host", 0), start(2, 2)] });
  const base = JSON.parse(
    neuralGame.checkpoint.encode(room)[0] as string,
  ) as Record<string, unknown>;
  const corrupt = (
    edit: (
      payload: Record<string, unknown>,
      world: Record<string, unknown>,
    ) => void,
  ) => {
    const payload = structuredClone(base);
    const world = JSON.parse(payload.world as string) as Record<
      string,
      unknown
    >;
    edit(payload, world);
    payload.world = JSON.stringify(world);
    assert.equal(
      neuralGame.checkpoint.decode([JSON.stringify(payload)], room.tick),
      undefined,
    );
  };
  corrupt((payload, world) => {
    world.map = map;
    payload.settings = { ...settings(), map: { ...map, id: "different" } };
  });
  corrupt((_payload, world) => {
    world.settings = { instantResearch: true, matchId: "new-match" };
  });
  corrupt((_payload, world) => {
    world.tick = room.tick + 1;
  });
  corrupt((_payload, world) => {
    (world.players as Record<string, unknown>[])[0]!.id = "stranger";
  });
  corrupt((_payload, world) => {
    delete world.settings;
  });
  corrupt((_payload, world) => {
    (world.players as Record<string, unknown>[])[0]!.statistics = {};
  });
});
test("late input replay converges through the shared rollback world", () => {
  for (const mode of ["sandbox", "skirmish"] as const) {
    for (const action of [
      { type: "startResearch", research: "growth" } as const,
      { type: "setAutoExpand", enabled: true } as const,
    ]) {
      const make = () =>
        new RollbackWorld(
          neuralGame,
          neuralGame.createRoom("match", settings(mode)),
          "host",
          "host",
        );
      const early = make(),
        late = make();
      const management: NeuralEntry[] = [join(1, 1, "host", 0), start(2, 2)];
      const input: NeuralEntry = [3, 5, 1, "new-match", action];
      for (const world of [early, late]) world.stream("host", 1);
      assert.equal(
        early.receive("host", [...management, input], 3, 8, 0).status,
        "accepted",
      );
      assert.equal(
        late.receive("host", management, 3, 8, 0).status,
        "accepted",
      );
      early.advance(8);
      late.advance(8);
      assert.equal(late.receive("host", [input], 3, 8, 8).status, "accepted");
      assert.equal(neuralGame.hash(late.state), neuralGame.hash(early.state));
    }
  }
});

test("skirmish starts a fair AI opponent and restores its runtime state", () => {
  for (const spawn of map.spawns) {
    const room = fold(
      { host: [join(1, 1, "host", 0), start(2, 2)] },
      { ...settings("skirmish"), slot: spawn.slot },
    );
    assert.equal(room.stage, "running");
    assert.equal(room.world.players.length, 2);
    const ai = room.world.players.find((p) => p.id === "ai-opponent")!;
    assert.notEqual(ai.slot, spawn.slot);
    assert.equal(
      ai.statistics.biomassEarned,
      room.world.players.find((p) => p.id === "host")!.statistics.biomassEarned,
    );
    const restored = neuralGame.checkpoint.decode(
      neuralGame.checkpoint.encode(room),
      room.tick,
    );
    assert.ok(restored);
    assert.equal(neuralGame.hash(restored), neuralGame.hash(room));
  }
  const clock = new Clock();
  const session = createSession(map, 0, "skirmish", {}, clock);
  clock.run(10_000);
  assert.ok(
    session.view().players.find((p) => p.id === "ai-opponent")!.statistics
      .built > 0,
  );
  session.dispose();
  assert.equal(clock.loops.size, 0);
});
