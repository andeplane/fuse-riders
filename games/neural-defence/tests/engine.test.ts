import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  step,
  neighbors,
  loadMap,
  encodeState,
  decodeState,
  hashState,
  isAction,
  type World,
  type MapDefinition,
  type Command,
  RULES,
} from "../src/engine/index.ts";
function map(): MapDefinition {
  return {
    schemaVersion: 1,
    id: "test",
    width: 8,
    height: 8,
    layout: "odd-r",
    cells: Array.from({ length: 64 }, (_, i) =>
      i === 27
        ? { terrain: "deposit", resourceKind: "biomass" }
        : i === 36
          ? { terrain: "deposit", resourceKind: "insight" }
          : { terrain: "open" },
    ),
    spawns: [
      { slot: 0, cellIndex: 9 },
      { slot: 1, cellIndex: 14 },
      { slot: 2, cellIndex: 49 },
      { slot: 3, cellIndex: 54 },
    ],
  };
}
const start = (debug = false) =>
  createMatch(map(), { instantConstruction: debug, instantResearch: debug }, [
    { id: "a", slot: 0 },
  ]);
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w = step(w);
  return w;
};
const command = (
  sequence: number,
  action: Command["action"],
  playerId = "a",
): Command => ({ sequence, action, playerId });

test("auto expansion defaults off, grows through ordinary construction, and stops after disabling", () => {
  const initial = start();
  assert.equal(initial.players[0]!.autoExpand, false);
  assert.equal(run(initial, 100).structures.length, 1);
  let w = step(initial, [command(0, { type: "setAutoExpand", enabled: true })]);
  assert.equal(w.players[0]!.queue.length, 1);
  assert.equal(w.players[0]!.queue[0]!.paid, true);
  assert.equal(w.players[0]!.biomass, 60_050 - RULES.neuronCost);
  const active = w.players[0]!.queue[0]!.cell;
  w = step(w, [command(1, { type: "setAutoExpand", enabled: false })]);
  w = run(w, 200);
  assert.ok(w.structures.some((s) => s.cell === active));
  assert.equal(
    w.structures.length,
    2,
    "disable finishes current work without starting another",
  );
  assert.equal(w.players[0]!.queue.length, 0);
});

test("auto expansion waits for funds, respects manual plans, and resumes after they clear", () => {
  let w = start();
  w.players[0]!.biomass = 0;
  w = step(w, [command(0, { type: "setAutoExpand", enabled: true })]);
  assert.equal(w.players[0]!.queue.length, 0);
  const saved = w;
  const funded = run(saved, 400);
  assert.equal(funded.players[0]!.autoExpand, true);
  assert.ok(
    funded.players[0]!.queue.some((j) => j.paid),
    "income automatically resumes expansion without a new toggle",
  );
  w.players[0]!.biomass = RULES.neuronCost;
  w = step(w, [
    command(1, { type: "queueConstruction", kind: "neuron", cell: 63 }),
  ]);
  assert.deepEqual(
    w.players[0]!.queue.map((j) => j.cell),
    [63],
    "even a waiting manual plan takes priority",
  );
  w = step(w, [command(2, { type: "cancelConstruction", cell: 63 })]);
  assert.equal(w.players[0]!.queue.length, 1);
  assert.notEqual(w.players[0]!.queue[0]!.cell, 63);
  assert.equal(w.players[0]!.queue[0]!.paid, true);
});

test("auto expansion replays and checkpoints exactly, and validates toggle state", () => {
  const initial = start(true);
  const commands = [command(0, { type: "setAutoExpand", enabled: true })];
  const w = run(step(initial, commands), 160);
  assert.ok(w.structures.length > 2);
  assert.equal(hashState(w), hashState(run(step(initial, commands), 160)));
  assert.equal(
    hashState(run(w, 50)),
    hashState(run(decodeState(encodeState(w)), 50)),
  );
  assert.equal(isAction({ type: "setAutoExpand", enabled: "yes" }), false);
  assert.equal(
    isAction({ type: "setAutoExpand", enabled: true, cell: 9 }),
    false,
  );
  const raw = JSON.parse(encodeState(w));
  raw.players[0].autoExpand = "yes";
  assert.throws(() => decodeState(JSON.stringify(raw)), /player/);
  raw.players[0].autoExpand = true;
  raw.rulesVersion = 1;
  assert.throws(() => decodeState(JSON.stringify(raw)), /unsupported/);
});
test("contested auto expansion uses rotating slots, not IDs or opponent unpaid plans", () => {
  const narrow: MapDefinition = {
    schemaVersion: 1,
    id: "auto-contest",
    width: 3,
    height: 1,
    layout: "odd-r",
    cells: [{ terrain: "open" }, { terrain: "open" }, { terrain: "open" }],
    spawns: [
      { slot: 0, cellIndex: 0 },
      { slot: 1, cellIndex: 2 },
    ],
  };
  for (const ids of [
    ["a", "z"],
    ["z", "a"],
  ])
    for (const delay of [0, 1]) {
      let w = createMatch(narrow, {}, [
        { id: ids[0]!, slot: 0 },
        { id: ids[1]!, slot: 1 },
      ]);
      w = run(w, delay);
      w.players.reverse();
      w = step(
        w,
        ids.map((id) =>
          command(0, { type: "setAutoExpand", enabled: true }, id!),
        ),
      );
      const winner = w.players.find((p) => p.queue.some((j) => j.paid))!;
      assert.equal(winner.slot, delay);
      assert.equal(
        w.players.find((p) => p.id !== winner.id)!.queue.length,
        0,
        "losing auto claims do not leave stale plans",
      );
      assert.doesNotThrow(() => decodeState(encodeState(w)));
    }
  let w = createMatch(narrow, {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  w.players[1]!.biomass = 0;
  w = step(w, [
    command(0, { type: "queueConstruction", kind: "neuron", cell: 1 }, "b"),
    command(0, { type: "setAutoExpand", enabled: true }, "a"),
  ]);
  assert.equal(
    w.players[0]!.queue[0]!.paid,
    true,
    "foreign unpaid ghosts do not block expansion",
  );
});

test("map schema and odd-r boundaries are validated", () => {
  assert.deepEqual(neighbors(map(), 0), [1, 8]);
  assert.equal(neighbors(map(), 9).length, 6);
  assert.throws(() => loadMap({ ...map(), schemaVersion: 2 }));
  assert.throws(() =>
    loadMap({
      ...map(),
      spawns: [
        { slot: 0, cellIndex: 9 },
        { slot: 0, cellIndex: 10 },
      ],
    }),
  );
  assert.throws(() => loadMap({ ...map(), cells: [] }));
  assert.equal(isAction({ type: "startResearch", research: "shield" }), false);
  assert.equal(isAction({ type: "setPriority", cell: 10, weight: NaN }), false);
});
test("four independent economies, pure steps and exact checkpoint replay", () => {
  const w = createMatch(
    map(),
    {},
    ["a", "b", "c", "d"].map((id, slot) => ({ id, slot })),
  );
  const before = encodeState(w);
  const after = run(w, 20);
  assert.equal(encodeState(w), before);
  for (const p of after.players) {
    assert.equal(p.biomass, 61000);
    assert.equal(p.insight, 500);
  }
  assert.equal(after.particles.length, 512);
  assert.equal(hashState(after), hashState(decodeState(encodeState(after))));
  assert.equal(
    hashState(run(after, 20)),
    hashState(run(decodeState(encodeState(after)), 20)),
  );
});
test("queued ghosts wait for connectivity, builder delivers, debug does not teleport", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 12, kind: "neuron" }),
    command(1, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  assert.ok(w.structures.some((s) => s.cell === 10));
  assert.equal(w.players[0]!.queue.find((j) => j.cell === 12)!.paid, false);
  w = run(w, 2);
  w = step(w, [
    command(2, { type: "queueConstruction", cell: 11, kind: "neuron" }),
  ]);
  const moving = w.players[0]!.worker;
  assert.equal(moving.mode, "outbound");
  assert.ok(moving.arrivesAt > w.tick);
  assert.equal(
    w.structures.some((s) => s.cell === 11),
    false,
  );
  w = run(w, 20);
  assert.ok(w.structures.some((s) => s.cell === 11));
  assert.ok(w.structures.some((s) => s.cell === 12));
});
test("ordinary construction takes time; no duplicated spending and foreign priority rejected", () => {
  let w = start();
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  assert.equal(w.players[0]!.biomass, 40050);
  assert.equal(w.structures.length, 1);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  assert.equal(w.players[0]!.queue.length, 1);
  w = run(w, 118);
  assert.equal(w.structures.length, 2);
  w = step(w, [command(1, { type: "setPriority", cell: 55, weight: 3 })]);
  assert.ok(w.outcomes.some((o) => o.type === "rejected"));
});
test("mining follows owned connected adjacency and research changes future builds", () => {
  let w = start(true);
  w = run(w, 400);
  w = step(w, [command(0, { type: "startResearch", research: "growth" })]);
  assert.deepEqual(w.players[0]!.research, ["growth"]);
  assert.equal(w.players[0]!.insight, 25);
  w = step(w, [
    command(1, { type: "queueConstruction", cell: 18, kind: "neuron" }),
  ]);
  w = run(w, 10);
  assert.ok(w.structures.some((s) => s.cell === 18));
  w = step(w, [
    command(2, { type: "queueConstruction", cell: 19, kind: "neuron" }),
  ]);
  w = run(w, 12);
  const before = w.players[0]!.biomass;
  w = run(w, 20);
  assert.equal(w.players[0]!.biomass - before, 2000);
});
test("priority routes conserved particles with edge capacity and visible latency", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  w = step(w, [command(1, { type: "setPriority", cell: 10, weight: 3 })]);
  assert.equal(w.particles.filter((p) => p.mode === "transit").length, 8);
  assert.equal(w.particles.filter((p) => p.cell === 10).length, 0);
  for (let i = 0; i < 20; i++) {
    w = step(w);
    assert.equal(w.particles.length, 128);
    assert.ok(w.particles.filter((p) => p.mode === "transit").length <= 32);
  }
  assert.equal(
    w.particles.filter((p) => p.cell === 10 && p.mode === "stationed").length,
    32,
  );
  assert.equal(
    hashState(run(w, 5)),
    hashState(run(decodeState(encodeState(w)), 5)),
  );
});
test("frontline tower builds with one connected neighbor", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "tower" }),
  ]);
  w = run(w, 100);
  assert.equal(w.structures.length, 2);
  assert.equal(w.players[0]!.queue.length, 0);
  assert.equal(w.structures.find((s) => s.cell === 10)!.kind, "tower");
});
test("checkpoint rejects conservation, ownership and coordinate corruption atomically", () => {
  const w = start();
  const original = hashState(w);
  const malformed = structuredClone(w);
  malformed.particles.pop();
  assert.throws(() => decodeState(encodeState(malformed)));
  const foreign = structuredClone(w);
  foreign.structures[0]!.ownerId = "stranger";
  assert.throws(() => decodeState(encodeState(foreign)));
  const bad = structuredClone(w);
  bad.players[0]!.worker.to = 10000;
  assert.throws(() => decodeState(encodeState(bad)));
  assert.equal(hashState(w), original);
});
test("combat spends actual particles and simultaneous brain damage can draw", () => {
  const m = map();
  m.spawns = [
    { slot: 0, cellIndex: 9 },
    { slot: 1, cellIndex: 10 },
  ];
  let w = createMatch(m, {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  w.structures.forEach((s) => (s.hp = 8));
  w = run(w, 20);
  assert.equal(w.finished, true);
  assert.equal(w.winnerId, null);
  assert.ok(w.players.every((p) => !p.alive));
  assert.equal(w.particles.length, 0);
});

test("allied tower uses delivered ammunition and retains fire through a redundant connection", () => {
  const m = map();
  m.spawns[1]!.cellIndex = 20;
  let w = createMatch(m, { instantConstruction: true }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  const p = w.players[0]!;
  p.biomass = 200000;
  const center = 18;
  for (const cell of neighbors(w.map, center))
    if (!w.structures.some((s) => s.cell === cell))
      w.structures.push({
        id: w.nextEntityId++,
        cell,
        ownerId: "a",
        kind: "neuron",
        hp: 60,
        connected: true,
      });
  w = step(w, [
    command(0, { type: "queueConstruction", cell: center, kind: "tower" }),
  ]);
  w = run(w, 20);
  assert.ok(w.structures.some((s) => s.cell === center && s.kind === "tower"));
  w = step(w, [command(1, { type: "setPriority", cell: center, weight: 3 })]);
  w = run(w, 30);
  assert.equal(
    w.particles.filter((q) => q.mode === "stationed" && q.cell === center)
      .length,
    32,
  );
  w = run(w, 60 - w.tick);
  assert.ok(
    w.outcomes.some(
      (o) =>
        o.playerId === "a" &&
        o.type === "damage" &&
        o.cell === 20 &&
        o.amount === 16,
    ),
  );
  assert.equal(
    w.particles.filter(
      (q) =>
        q.ownerId === "a" &&
        q.mode === "recovering" &&
        q.recoverAt === w.tick + RULES.recoveryTicks + q.speed,
    ).length,
    8,
  );
  w = run(w, 19);
  w.structures.find((s) => s.cell === 19)!.hp = 1;
  w = step(w);
  assert.ok(w.outcomes.some((o) => o.type === "destroyed" && o.cell === 19));
  const enemyHp = w.structures.find((s) => s.cell === 20)!.hp;
  w = run(w, 20);
  assert.equal(w.structures.find((s) => s.cell === center)!.connected, true);
  assert.ok(
    w.particles.some(
      (q) => q.ownerId === "a" && q.cell === center && q.mode === "stationed",
    ),
  );
  assert.ok(w.structures.find((s) => s.cell === 20)!.hp < enemyHp);
  assert.equal(
    w.outcomes.some((o) => o.playerId === "a" && o.type === "damage"),
    true,
  );
  assert.equal(
    w.particles.filter((q) => q.ownerId === "a").length,
    RULES.particleCount,
  );
  assert.doesNotThrow(() => decodeState(encodeState(w)));
});

test("disconnected particles recover without duplication, and checkpoint survives branch cuts", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  w = step(w, [command(1, { type: "setPriority", cell: 10, weight: 3 })]);
  w = run(w, 20);
  w.structures = w.structures.filter((s) => s.cell !== 10);
  w = step(w);
  assert.equal(w.particles.filter((q) => q.mode === "recovering").length, 32);
  assert.doesNotThrow(() => decodeState(encodeState(w)));
  w = run(w, 130);
  assert.equal(w.particles.length, 128);
  assert.ok(w.particles.every((q) => q.mode === "stationed" && q.cell === 9));
});

test("research does not mutate properties of already deployed particles", () => {
  let w = start(true);
  w = step(w, [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  w = step(w, [command(1, { type: "setPriority", cell: 10, weight: 3 })]);
  w = run(w, 400);
  w = step(w, [command(2, { type: "startResearch", research: "excitation" })]);
  assert.ok(
    w.particles.filter((q) => q.cell === 10).every((q) => q.attack === 2),
  );
  w = step(w, [command(3, { type: "setPriority", cell: 10, weight: 0 })]);
  w = run(w, 30);
  w = step(w, [command(4, { type: "setPriority", cell: 10, weight: 3 })]);
  w = run(w, 30);
  assert.ok(
    w.particles.filter((q) => q.cell === 10).every((q) => q.attack === 3),
  );
});

function addNeuron(w: World, cell: number, ownerId = "a") {
  w.structures.push({
    id: w.nextEntityId++,
    cell,
    ownerId,
    kind: "neuron",
    hp: 60,
    connected: true,
  });
}

test("destroyed priorities release one of eight slots and stale priorities can be cleared", () => {
  let w = createMatch(map(), {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  for (const cell of [10, 11, 12, 13, 17, 18, 19, 20]) addNeuron(w, cell);
  w = step(
    w,
    [9, 10, 11, 12, 13, 17, 18, 19].map((cell, sequence) =>
      command(sequence, { type: "setPriority", cell, weight: 1 }),
    ),
  );
  w = run(w, 18);
  w.structures.find((s) => s.cell === 13)!.hp = 1;
  w = step(w);
  assert.ok(w.outcomes.some((o) => o.type === "destroyed" && o.cell === 13));
  assert.equal(Object.hasOwn(w.players[0]!.priorities, "13"), false);
  w = step(w, [
    command(8, { type: "setPriority", cell: 13, weight: 0 }),
    command(9, { type: "setPriority", cell: 20, weight: 3 }),
  ]);
  assert.equal(
    w.outcomes.some((o) => o.type === "rejected"),
    false,
  );
  assert.equal(w.players[0]!.priorities[20], 3);
  assert.equal(Object.keys(w.players[0]!.priorities).length, 8);
});

test("simultaneous construction claims rotate by slot, independent of IDs and input order", () => {
  const m = map();
  m.spawns[1]!.cellIndex = 11;
  for (const ids of [
    ["a", "z"],
    ["z", "a"],
  ]) {
    for (let delay = 0; delay < 2; delay++) {
      const initial = run(
        createMatch(
          m,
          {},
          ids.map((id, slot) => ({ id, slot })),
        ),
        delay,
      );
      const commands = ids.map((id) =>
        command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }, id),
      );
      const w = step(initial, commands);
      assert.equal(
        hashState(w),
        hashState(step(initial, [...commands].reverse())),
      );
      const winner = w.players.find((p) => p.queue[0]?.paid)!;
      assert.equal(winner.slot, delay);
      assert.equal(
        winner.biomass,
        60_000 + 50 * (delay + 1) - RULES.neuronCost,
      );
      const loser = w.players.find((p) => p !== winner)!;
      assert.equal(loser.queue[0]!.paid, false);
      assert.equal(loser.biomass, 60_000 + 50 * (delay + 1));
      assert.doesNotThrow(() => decodeState(encodeState(w)));
    }
  }
});

test("builders recover when either edge endpoint is cut, even on the arrival tick", () => {
  for (const cut of [10, 11])
    for (const arrivalTick of [false, true]) {
      let w = start(true);
      for (const cell of [10, 11, 18, 19, 20]) addNeuron(w, cell);
      w = step(w, [
        command(0, { type: "queueConstruction", cell: 12, kind: "neuron" }),
      ]);
      w = run(w, 4);
      assert.equal(w.players[0]!.worker.from, 10);
      assert.equal(w.players[0]!.worker.to, 11);
      if (arrivalTick) w = run(w, 3);
      w.structures = w.structures.filter((s) => s.cell !== cut);
      w = step(w);
      assert.equal(w.players[0]!.worker.mode, "recovering");
      assert.equal(w.players[0]!.queue[0]!.progress, 0);
      assert.equal(
        w.structures.some((s) => s.cell === 12),
        false,
      );
      assert.doesNotThrow(() => decodeState(encodeState(w)));
      const recoveryEnd = w.players[0]!.worker.recoverAt;
      w = run(w, recoveryEnd - w.tick + 20);
      assert.ok(w.structures.some((s) => s.cell === 12));
      assert.equal(w.players[0]!.statistics.built, 1);
    }
});

test("checkpoint requires every numeric field and coherent research, worker and match state", () => {
  const w = start();
  const baseline = hashState(w);
  const reject = (
    mutate: (
      value: Record<string, unknown>,
      player: Record<string, unknown>,
    ) => void,
  ) => {
    const raw: Record<string, unknown> = JSON.parse(encodeState(w));
    const players = raw.players as Record<string, unknown>[];
    mutate(raw, players[0]!);
    assert.throws(
      () => decodeState(JSON.stringify(raw)),
      /checkpoint|settings/,
    );
    assert.equal(hashState(w), baseline);
  };
  reject((raw) => {
    delete raw.settings;
  });
  reject((raw) => {
    raw.settings = [];
  });
  reject((raw, p) => {
    p.statistics = {};
  });
  for (const key of [
    "biomassEarned",
    "insightEarned",
    "built",
    "damage",
    "lost",
  ]) {
    reject((raw, p) => {
      delete (p.statistics as Record<string, unknown>)[key];
    });
    reject((raw, p) => {
      (p.statistics as Record<string, unknown>)[key] = null;
    });
    reject((raw, p) => {
      (p.statistics as Record<string, unknown>)[key] = -1;
    });
  }
  reject((raw, p) => {
    delete p.researchJob;
  });
  reject((raw, p) => {
    p.research = ["growth"];
    p.researchJob = { kind: "growth", completesAt: 10 };
  });
  reject((raw, p) => {
    p.researchJob = { kind: "growth", completesAt: 0 };
  });
  reject((raw, p) => {
    (p.worker as Record<string, unknown>).mode = "building";
  });
  reject((raw, p) => {
    (p.worker as Record<string, unknown>).to = 10;
  });
  reject((raw, p) => {
    p.miningRemainders = { "9": 0 };
  });
  reject((raw) => {
    raw.winnerId = "a";
  });
  reject((raw) => {
    raw.matchId = "foreign-match";
  });
});

test("checkpoint rejects paid-site progress and live transit corruption", () => {
  const building = step(start(), [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  const progress = structuredClone(building);
  progress.players[0]!.queue[0]!.progress = RULES.constructionTicks;
  assert.throws(() => decodeState(encodeState(progress)), /construction/);
  const unpaid = structuredClone(building);
  unpaid.players[0]!.queue[0]!.paid = false;
  assert.throws(() => decodeState(encodeState(unpaid)), /construction/);
  let moving = step(start(true), [
    command(0, { type: "queueConstruction", cell: 10, kind: "neuron" }),
  ]);
  moving = step(moving, [
    command(1, { type: "setPriority", cell: 10, weight: 3 }),
  ]);
  assert.doesNotThrow(() => decodeState(encodeState(moving)));
  for (const field of ["cell", "departedAt", "arrivesAt"] as const) {
    const corrupt = structuredClone(moving);
    corrupt.particles.find((q) => q.mode === "transit")![field] += 1;
    assert.throws(() => decodeState(encodeState(corrupt)), /transit/);
  }
  const missingEndpoint = structuredClone(moving);
  missingEndpoint.structures = missingEndpoint.structures.filter(
    (s) => s.cell !== 10,
  );
  missingEndpoint.players[0]!.priorities = {};
  assert.throws(() => decodeState(encodeState(missingEndpoint)), /transit/);
});

test("four-player construction, research, income and finite attacks replay through every checkpoint", () => {
  const m = map();
  m.spawns = [
    { slot: 0, cellIndex: 9 },
    { slot: 1, cellIndex: 12 },
    { slot: 2, cellIndex: 49 },
    { slot: 3, cellIndex: 52 },
  ];
  let w = createMatch(
    m,
    {},
    ["a", "b", "c", "d"].map((id, slot) => ({ id, slot })),
  );
  const cells = [10, 11, 50, 51];
  let replay = decodeState(encodeState(w));
  for (let tick = 1; tick <= 820; tick++) {
    const commands = w.players.flatMap((p, i) => {
      if (tick === 1)
        return [
          command(
            0,
            { type: "queueConstruction", cell: cells[i]!, kind: "neuron" },
            p.id,
          ),
        ];
      if (tick === 125)
        return [
          command(1, { type: "setPriority", cell: cells[i]!, weight: 3 }, p.id),
        ];
      if (tick === 401)
        return [
          command(2, { type: "startResearch", research: "excitation" }, p.id),
        ];
      return [];
    });
    w = step(w, commands);
    for (const damage of w.outcomes.filter((o) => o.type === "damage")) {
      assert.ok(
        Number.isInteger(damage.fromCell),
        "damage has an authoritative origin for effects",
      );
      assert.ok(damage.cell !== damage.fromCell);
    }
    replay = step(replay, [...commands].reverse());
    assert.equal(hashState(w), hashState(replay), `replay at tick ${tick}`);
    replay = decodeState(encodeState(replay));
    for (const p of w.players) {
      assert.equal(
        w.particles.filter((q) => q.ownerId === p.id).length,
        p.alive ? RULES.particleCount : 0,
      );
      assert.ok(Number.isSafeInteger(p.statistics.biomassEarned));
      assert.ok(Number.isSafeInteger(p.statistics.insightEarned));
    }
  }
  for (const p of w.players) {
    assert.equal(p.statistics.built, 1);
    assert.ok(p.statistics.damage > 0);
    assert.ok(p.statistics.lost > 0);
    assert.deepEqual(p.research, ["excitation"]);
    assert.equal(p.statistics.insightEarned, 820 * 25);
  }
});
