import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMatch,
  decodeState,
  encodeState,
  hashState,
  loadMap,
  neighbors,
  step,
  POWERUP_RULES,
  hexDistance,
  powerupCandidates,
  powerupPhase,
  type World,
} from "../src/engine/index.ts";
import { STRUCTURES } from "../src/engine/catalog.ts";
import { aiCommands } from "../src/engine/ai.ts";

const closeQuarters = () =>
  loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/close-quarters.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const duel = (matchId = "duel-1", powerups = true) =>
  createMatch(closeQuarters(), { matchId, powerups }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
const until = (w: World, tick: number) => {
  while (w.tick < tick) w = step(w);
  return w;
};
const brainCell = (w: World, id: string) =>
  w.structures.find((s) => s.ownerId === id && s.kind === "brain")!.cell;
/** A connected neuron for `owner` on `cell`, bypassing construction. */
const plant = (w: World, owner: string, cell: number) => {
  w.structures.push({
    id: w.nextEntityId++,
    cell,
    ownerId: owner,
    kind: "neuron",
    hp: 1,
    connected: true,
  });
};

test("powerups stay off unless the match enables them", () => {
  const w = until(duel("off", false), POWERUP_RULES.firstTick + 10);
  assert.deepEqual(w.powerups, []);
  assert.equal(w.powerupSerial, 0);
});

test("the first powerup spawns on a fair, open, untouched tile at the scheduled tick", () => {
  let w = until(duel(), POWERUP_RULES.firstTick - 1);
  assert.equal(w.powerups.length, 0);
  w = step(w);
  assert.equal(w.powerups.length, 1);
  const [p] = w.powerups;
  assert.equal(w.map.cells[p!.cell]!.terrain, "open");
  assert.equal(w.powerupSerial, 1);
  assert.equal(p!.expiresAt, w.tick + POWERUP_RULES.lifetime);
  const distances = ["a", "b"].map((id) =>
    hexDistance(w.map.width, p!.cell, brainCell(w, id)),
  );
  assert.ok(Math.min(...distances) >= POWERUP_RULES.minBrainDistance);
  assert.ok(Math.max(...distances) - Math.min(...distances) <= 1);
  assert.ok(!w.structures.some((s) => s.cell === p!.cell));
});

test("spawns are deterministic per match and survive a checkpoint", () => {
  const a = until(duel("seed-x"), POWERUP_RULES.firstTick);
  const b = until(duel("seed-x"), POWERUP_RULES.firstTick);
  assert.deepEqual(a.powerups, b.powerups);
  assert.equal(hashState(a), hashState(b));
  const kinds = new Set(
    Array.from({ length: 24 }, (_, i) => {
      const w = until(duel(`seed-${i}`), POWERUP_RULES.firstTick);
      return `${w.powerups[0]?.kind}@${w.powerups[0]?.cell}`;
    }),
  );
  assert.ok(kinds.size > 6, "different matches get different powerups");
  const restored = decodeState(encodeState(a));
  assert.deepEqual(restored.powerups, a.powerups);
  assert.equal(hashState(step(restored)), hashState(step(a)));
});

test("checkpoints reject invalid powerups", () => {
  const w = until(duel(), POWERUP_RULES.firstTick);
  const bad = (edit: (w: World) => void) => {
    const copy = decodeState(encodeState(w));
    edit(copy);
    assert.throws(() => decodeState(encodeState(copy)));
  };
  bad((c) => (c.powerups[0]!.kind = "nuke" as never));
  bad((c) => {
    c.powerups[0]!.cell = c.map.cells.findIndex((x) => x.terrain !== "open");
  });
  bad((c) => (c.powerups[0]!.expiresAt = c.tick));
  bad((c) => (c.powerups[0]!.id = c.nextEntityId));
  bad((c) => (c.settings.powerups = false));
  bad((c) => (c.players[0]!.buffs = [{ kind: "frenzy", expiresAt: c.tick }]));
});

test("the first network to touch a powerup claims it; touching together keeps it contested", () => {
  const w = until(duel(), POWERUP_RULES.firstTick);
  const powerup = w.powerups[0]!;
  const [left, right] = neighbors(w.map, powerup.cell).filter(
    (c) => w.map.cells[c]!.terrain === "open",
  );
  const contested = decodeState(encodeState(w));
  plant(contested, "a", left!);
  plant(contested, "b", right!);
  powerupPhase(contested);
  assert.ok(
    contested.powerups.some((p) => p.id === powerup.id),
    "both touching: nobody claims",
  );
  const claimed = decodeState(encodeState(w));
  plant(claimed, "a", left!);
  claimed.powerups[0]!.kind = "cache";
  const biomass = claimed.players.find((p) => p.id === "a")!.biomass;
  powerupPhase(claimed);
  assert.ok(!claimed.powerups.some((p) => p.id === powerup.id));
  assert.equal(
    claimed.players.find((p) => p.id === "a")!.biomass,
    biomass + POWERUP_RULES.cacheBiomass,
  );
  assert.deepEqual(
    claimed.outcomes.find((o) => o.type === "claimed"),
    {
      tick: claimed.tick,
      playerId: "a",
      type: "claimed",
      cell: powerup.cell,
      reason: "cache",
    },
  );
});

test("regrowth heals, and timed buffs extend rather than stack, then expire", () => {
  const w = until(duel(), POWERUP_RULES.firstTick);
  const cell = neighbors(w.map, w.powerups[0]!.cell).find(
    (c) => w.map.cells[c]!.terrain === "open",
  )!;
  plant(w, "a", cell);
  w.powerups[0]!.kind = "regrowth";
  powerupPhase(w);
  const planted = w.structures.find((s) => s.cell === cell)!;
  assert.equal(
    planted.hp,
    1 +
      Math.floor((STRUCTURES.neuron.hp * POWERUP_RULES.regrowthPercent) / 100),
  );
  const a = w.players.find((p) => p.id === "a")!;
  const free = () =>
    neighbors(w.map, cell).find(
      (c) =>
        w.map.cells[c]!.terrain === "open" &&
        !w.structures.some((s) => s.cell === c),
    )!;
  w.powerups = [
    {
      id: w.nextEntityId++,
      cell: free(),
      kind: "surge",
      expiresAt: w.tick + 10,
    },
  ];
  powerupPhase(w);
  assert.deepEqual(a.buffs, [
    { kind: "surge", expiresAt: w.tick + POWERUP_RULES.surgeTicks },
  ]);
  w.powerups = [
    {
      id: w.nextEntityId++,
      cell: free(),
      kind: "surge",
      expiresAt: w.tick + 10,
    },
  ];
  powerupPhase(w);
  assert.equal(a.buffs.length, 1);
  assert.equal(a.buffs[0]!.expiresAt, w.tick + 2 * POWERUP_RULES.surgeTicks);
  w.tick += 2 * POWERUP_RULES.surgeTicks;
  powerupPhase(w);
  assert.deepEqual(a.buffs, []);
});

test("unclaimed powerups expire", () => {
  let w = until(duel(), POWERUP_RULES.firstTick);
  const expiry = w.powerups[0]!.expiresAt;
  w = until(w, expiry);
  assert.ok(!w.powerups.some((p) => p.expiresAt <= w.tick));
});

test("growth surge speeds construction", () => {
  const build = (surge: boolean) => {
    let w = createMatch(closeQuarters(), { matchId: "surge" }, [
      { id: "a", slot: 0 },
    ]);
    if (surge) w.players[0]!.buffs = [{ kind: "surge", expiresAt: 100_000 }];
    const cell = neighbors(w.map, brainCell(w, "a")).find(
      (c) => w.map.cells[c]!.terrain === "open",
    )!;
    w = step(w, [
      {
        playerId: "a",
        sequence: 0,
        action: { type: "queueConstruction", kind: "neuron", cell },
      },
    ]);
    while (!w.structures.some((s) => s.cell === cell)) w = step(w);
    return w.tick;
  };
  assert.ok(build(true) < build(false) - 30);
});

test("synaptic frenzy makes a real front fire more often", () => {
  // Play an ordinary AI match to its first exchange of fire, then branch.
  const play = (w: World) =>
    step(w, [
      ...aiCommands(w, "a", "pressure"),
      ...aiCommands(w, "b", "balanced"),
    ]);
  let w = createMatch(closeQuarters(), { matchId: "frenzy" }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  while (!w.outcomes.some((o) => o.type === "damage") && w.tick < 12_000)
    w = play(w);
  assert.ok(w.tick < 12_000, "the match reaches combat");
  const volleys = (frenzy: boolean) => {
    let branch = decodeState(encodeState(w));
    const shooter = branch.outcomes.find((o) => o.type === "damage")!.playerId;
    if (frenzy)
      branch.players.find((p) => p.id === shooter)!.buffs = [
        { kind: "frenzy", expiresAt: branch.tick + 400 },
      ];
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      branch = play(branch);
      hits += branch.outcomes.filter(
        (o) => o.type === "damage" && o.playerId === shooter,
      ).length;
    }
    return hits;
  };
  assert.ok(volleys(true) > volleys(false));
});

test("the AI builds toward a reachable powerup", () => {
  const w = duel("ai-race");
  w.tick = POWERUP_RULES.firstTick;
  const home = brainCell(w, "a");
  // Place a powerup exactly three open steps from the AI's brain.
  const steps = new Map([[home, 0]]);
  const queue = [home];
  for (const cell of queue)
    for (const next of neighbors(w.map, cell))
      if (w.map.cells[next]!.terrain === "open" && !steps.has(next)) {
        steps.set(next, steps.get(cell)! + 1);
        queue.push(next);
      }
  const target = [...steps].find(([, d]) => d === 3)![0];
  w.powerups = [
    {
      id: w.nextEntityId++,
      cell: target,
      kind: "cache",
      expiresAt: w.tick + 100,
    },
  ];
  const queued = aiCommands(w, "a", "balanced").find(
    (c) => c.action.type === "queueConstruction",
  )?.action;
  assert.ok(queued && queued.type === "queueConstruction");
  assert.equal(queued.kind, "neuron");
  assert.equal(steps.get(queued.cell), 1, "one step closer to the powerup");
  const toTarget = new Map([[target, 0]]);
  const fromTarget = [target];
  for (const cell of fromTarget)
    for (const next of neighbors(w.map, cell))
      if (w.map.cells[next]!.terrain === "open" && !toTarget.has(next)) {
        toTarget.set(next, toTarget.get(cell)! + 1);
        fromTarget.push(next);
      }
  assert.ok(toTarget.get(queued.cell)! < toTarget.get(home)!);
  assert.ok(
    powerupCandidates(w).every((c) => w.map.cells[c]!.terrain === "open"),
  );
});
