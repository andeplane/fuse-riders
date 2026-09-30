import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMatch,
  decodeState,
  dominanceCells,
  dominanceShare,
  encodeState,
  hashState,
  loadMap,
  neighbors,
  step,
  claimableCells,
  territoryCounts,
  territoryOwners,
  RULES,
  TERRITORY,
  TIMELINE,
  type World,
} from "../src/engine/index.ts";
import { STRUCTURES } from "../src/engine/catalog.ts";
import { aiCommands } from "../src/engine/ai.ts";

test("connected structures claim their cell and its neighbours; touching networks contest", () => {
  const w = duel();
  const a = brainCell(w, "a");
  const owners = territoryOwners(w);
  assert.equal(owners.get(a), "a");
  for (const cell of neighbors(w.map, a)) assert.equal(owners.get(cell), "a");
  assert.equal(territoryCounts(w).get("a"), 1 + neighbors(w.map, a).length);

  // A rival neuron touching the edge of a's claim makes the shared cells nobody's.
  const edge = neighbors(w.map, a)[0]!;
  const rival = neighbors(w.map, edge).find(
    (cell) => cell !== a && !neighbors(w.map, a).includes(cell),
  )!;
  plant(w, "b", rival);
  const contested = territoryOwners(w);
  assert.equal(contested.has(edge), false);
  assert.equal(contested.get(a), "a");
  assert.equal(contested.get(rival), "b");
});

test("disconnected structures claim nothing", () => {
  const w = duel();
  const far = w.map.cells.findIndex(
    (c, i) =>
      c.terrain === "open" &&
      !territoryOwners(w).has(i) &&
      neighbors(w.map, i).every((n) => !territoryOwners(w).has(n)),
  );
  w.structures.push({
    id: w.nextEntityId++,
    cell: far,
    ownerId: "a",
    kind: "neuron",
    hp: 1,
    connected: false,
  });
  assert.equal(territoryOwners(w).has(far), false);
});

test("territory pays a trickle of biomass once a second", () => {
  let w = duel();
  w = until(w, RULES.ticksPerSecond - 1);
  const before = w.players[0]!.statistics.biomassEarned;
  const biomass = w.players[0]!.biomass;
  w = step(w);
  const p = w.players[0]!;
  assert.equal(p.territory, 7);
  // Mining can add to the same tick; the trickle is at least the territory's worth.
  assert.ok(p.biomass - biomass >= 7 * TERRITORY.incomePerCell);
  assert.ok(p.statistics.biomassEarned - before >= 7 * TERRITORY.incomePerCell);
});

test("the dominance share shrinks with more players", () => {
  assert.equal(dominanceShare(1), 0.4);
  assert.equal(dominanceShare(2), 0.4);
  assert.ok(Math.abs(dominanceShare(4) - 0.3) < 1e-9);
  assert.ok(Math.abs(dominanceShare(8) - 0.25) < 1e-9);
  for (let n = 2; n < RULES.maxPlayers; n++)
    assert.ok(dominanceShare(n + 1) <= dominanceShare(n));
  const w = duel();
  assert.equal(
    dominanceCells(w),
    Math.ceil(claimableCells(w.map) * dominanceShare(2)),
  );
});

test("holding a dominant share for a minute wins the match by dominance", () => {
  let w = duel();
  spread(w, "a", dominanceCells(w));
  w = step(w);
  const a = w.players[0]!;
  assert.ok(a.territory >= dominanceCells(w));
  assert.equal(a.dominanceSince, w.tick);
  assert.ok(
    w.outcomes.some((o) => o.type === "dominating" && o.playerId === "a"),
  );
  const since = w.tick;
  w = until(w, since + TERRITORY.dominanceTicks - 1);
  assert.equal(w.finished, false);
  w = step(w);
  assert.equal(w.finished, true);
  assert.equal(w.winnerId, "a");
  assert.equal(w.victory, "dominance");
  assert.ok(
    w.players.every((p) => p.alive),
    "nobody was eliminated",
  );
  // The finished world survives a checkpoint and stays finished.
  const restored = decodeState(encodeState(w));
  assert.equal(hashState(restored), hashState(w));
  assert.equal(step(restored).tick, w.tick);
  assert.ok(w.events.some((e) => e.type === "dominating"));
  assert.equal(w.timeline.at(-1)?.tick, w.tick, "the final moment is sampled");
});

test("losing the share resets the dominance clock", () => {
  let w = duel();
  const planted = spread(w, "a", dominanceCells(w));
  w = until(w, 100);
  assert.notEqual(w.players[0]!.dominanceSince, null);
  // Knock out the outer ring: the share falls below the threshold.
  const lost = new Set(planted.slice(-30));
  w.structures = w.structures.filter((s) => !lost.has(s.cell));
  w = step(w);
  assert.equal(w.players[0]!.dominanceSince, null);
  assert.ok(
    w.outcomes.some((o) => o.type === "dominanceBroken" && o.playerId === "a"),
  );
  w = until(w, TERRITORY.dominanceTicks + 200);
  assert.equal(w.finished, false);
});

test("an elimination records its victory kind", () => {
  let w = duel();
  const b = w.structures.find((s) => s.ownerId === "b" && s.kind === "brain")!;
  b.hp = 0;
  w.structures = w.structures.filter((s) => s !== b);
  w = step(w);
  assert.equal(w.finished, true);
  assert.equal(w.winnerId, "a");
  assert.equal(w.victory, "elimination");
  assert.doesNotThrow(() => decodeState(encodeState(w)));
});

test("a free-for-all plays on after one elimination and ends at the last brain", () => {
  const map = loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/cortex-crossing.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  let w = createMatch(map, { matchId: "ffa" }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
    { id: "c", slot: 2 },
  ]);
  const kill = (id: string) => {
    w.structures = w.structures.filter(
      (s) => !(s.ownerId === id && s.kind === "brain"),
    );
    w = step(w);
  };
  kill("c");
  assert.equal(w.finished, false);
  assert.deepEqual(
    w.players.map((p) => p.alive),
    [true, true, false],
  );
  assert.equal(w.players[2]!.territory, 0);
  assert.ok(!w.structures.some((s) => s.ownerId === "c"));
  assert.ok(
    w.events.some((e) => e.type === "eliminated" && e.playerId === "c"),
  );
  assert.doesNotThrow(() => decodeState(encodeState(w)));
  kill("a");
  assert.equal(w.finished, true);
  assert.equal(w.winnerId, "b");
  assert.equal(w.victory, "elimination");
});

test("checkpoints reject impossible victories, territory and timelines", () => {
  const w = until(duel(), TIMELINE.interval);
  assert.equal(w.timeline.length, 1);
  const tamper = (edit: (raw: Record<string, unknown>) => void) => {
    const raw = JSON.parse(encodeState(w)) as Record<string, unknown>;
    edit(raw);
    return () => decodeState(JSON.stringify(raw));
  };
  const players = (raw: Record<string, unknown>) =>
    raw.players as Record<string, unknown>[];
  assert.throws(tamper((raw) => (raw.victory = "dominance")));
  assert.throws(tamper((raw) => (raw.victory = "surrender")));
  assert.throws(
    tamper((raw) => {
      raw.finished = true;
      raw.winnerId = "a";
      raw.victory = "elimination";
    }),
  );
  assert.throws(tamper((raw) => (players(raw)[0]!.territory = -1)));
  assert.throws(tamper((raw) => (players(raw)[0]!.territory = 10_000)));
  assert.throws(tamper((raw) => (players(raw)[0]!.dominanceSince = 1e9)));
  assert.throws(tamper((raw) => (raw.timeline = [{ tick: 1e9, players: [] }])));
  assert.throws(tamper((raw) => (raw.timeline = "x")));
  assert.throws(
    tamper(
      (raw) =>
        (raw.events = [{ tick: 1, playerId: "zed", type: "researched" }]),
    ),
  );
  assert.throws(
    tamper((raw) => (raw.events = [{ tick: 1, playerId: "a", type: "gloat" }])),
  );
  // A dominance win in a finished world is valid.
  assert.doesNotThrow(
    tamper((raw) => {
      raw.finished = true;
      raw.winnerId = "a";
      raw.victory = "dominance";
    }),
  );
});

test("the timeline samples every ten seconds and logs the deciding moments", () => {
  let w = duel();
  w = until(w, TIMELINE.interval * 3);
  assert.deepEqual(
    w.timeline.map((s) => s.tick),
    [1, 2, 3].map((n) => n * TIMELINE.interval),
  );
  const last = w.timeline.at(-1)!;
  assert.deepEqual(
    last.players.map((p) => p.id),
    ["a", "b"],
  );
  assert.equal(last.players[0]!.territory, w.players[0]!.territory);
  assert.equal(last.players[0]!.structures, 1);
});

test("a Spore tower's salvo splashes enemy structures beside its target", () => {
  // An open strip: a's brain at 0 with a Spore at 2; b's line at 4, 5, 12.
  const w = createMatch(
    {
      schemaVersion: 1,
      id: "strip",
      width: 8,
      height: 4,
      layout: "odd-r",
      cells: Array.from({ length: 32 }, () => ({ terrain: "open" })),
      spawns: [
        { slot: 0, cellIndex: 0 },
        { slot: 1, cellIndex: 7 },
      ],
    },
    {},
    [
      { id: "a", slot: 0 },
      { id: "b", slot: 1 },
    ],
  );
  for (const [ownerId, cell, kind, hp] of [
    ["a", 1, "neuron", STRUCTURES.neuron.hp],
    ["a", 2, "spore", STRUCTURES.spore.hp],
    ["b", 4, "neuron", 10],
    ["b", 5, "neuron", STRUCTURES.neuron.hp],
    ["b", 6, "neuron", STRUCTURES.neuron.hp],
    ["b", 12, "neuron", STRUCTURES.neuron.hp],
  ] as const)
    w.structures.push({
      id: w.nextEntityId++,
      ownerId,
      cell,
      kind,
      hp,
      connected: true,
    });
  w.tick = STRUCTURES.spore.cadence * 2 - 1;
  const a = w.players[0]!;
  a.research = ["growth"];
  a.priorities = { 2: 3 };
  for (const q of w.particles.filter((q) => q.ownerId === "a").slice(0, 8))
    Object.assign(q, { cell: 2, destination: 2, from: 2, to: 2 });
  const next = step(w);
  const hits = next.outcomes.filter(
    (o) => o.type === "damage" && o.playerId === "a" && o.fromCell === 2,
  );
  const direct = hits.find((o) => o.cell === 4)!;
  assert.ok(direct, "the pod strikes the weakest target");
  for (const cell of [5, 12]) {
    const splash = hits.find((o) => o.cell === cell);
    assert.ok(splash, `the burst reaches ${cell}`);
    assert.ok(splash.amount! < direct.amount! || direct.amount! <= 10);
  }
  assert.ok(!hits.some((o) => o.cell === 6), "only neighbours of the target");
  assert.ok(!hits.some((o) => o.cell === 1), "never its own network");
});

test("the Swarm opening plays legal commands and out-claims a passive rival", () => {
  let w = createMatch(closeQuarters(), { matchId: "swarm" }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  for (let i = 0; i < 20 * 120; i++) {
    w = step(w, aiCommands(w, "a", "swarm"));
    assert.equal(
      w.outcomes.filter((o) => o.type === "rejected" && o.playerId === "a")
        .length,
      0,
    );
  }
  assert.ok(w.players[0]!.territory > w.players[1]!.territory * 2);
});

test("N-player matches seat up to the rules' maximum and keep territory separate", () => {
  const map = closeQuarters();
  const spawns = [175, 304, 30, 450, 100, 380, 60, 420].map(
    (cellIndex, slot) => ({ slot, cellIndex }),
  );
  const big = loadMap({ ...map, spawns });
  const roster = spawns.map(({ slot }) => ({ id: `p${slot}`, slot }));
  let w = createMatch(big, { matchId: "eight" }, roster);
  assert.equal(w.players.length, RULES.maxPlayers);
  w = until(w, 40);
  for (const p of w.players) assert.ok(p.territory > 0);
  assert.throws(() =>
    createMatch(big, {}, [...roster, { id: "extra", slot: 8 }]),
  );
  assert.equal(hashState(decodeState(encodeState(w))), hashState(w));
});

const closeQuarters = () =>
  loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/close-quarters.json", import.meta.url),
        "utf8",
      ),
    ),
  );
function duel(matchId = "territory"): World {
  return createMatch(closeQuarters(), { matchId }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
}
function until(w: World, tick: number): World {
  while (w.tick < tick && !w.finished) w = step(w);
  return w;
}
function brainCell(w: World, id: string): number {
  return w.structures.find((s) => s.ownerId === id && s.kind === "brain")!.cell;
}
/** A connected neuron for `owner` on `cell`, bypassing construction. */
function plant(w: World, owner: string, cell: number, hp = 1): void {
  w.structures.push({
    id: w.nextEntityId++,
    cell,
    ownerId: owner,
    kind: "neuron",
    hp,
    connected: true,
  });
}
/**
 * Grows `owner`'s network outward from its brain, breadth first, until it
 * claims `cells`, keeping clear of every rival. Returns the planted cells.
 */
function spread(w: World, owner: string, cells: number): number[] {
  const rivals = new Set(
    w.structures
      .filter((s) => s.ownerId !== owner)
      .flatMap((s) => [
        s.cell,
        ...neighbors(w.map, s.cell),
        ...neighbors(w.map, s.cell).flatMap((n) => neighbors(w.map, n)),
      ]),
  );
  const planted: number[] = [];
  const queue = [brainCell(w, owner)];
  const seen = new Set(queue);
  while (queue.length && (territoryCounts(w).get(owner) ?? 0) < cells) {
    const cell = queue.shift()!;
    for (const next of neighbors(w.map, cell)) {
      if (seen.has(next)) continue;
      seen.add(next);
      if (w.map.cells[next]!.terrain !== "open" || rivals.has(next)) continue;
      if (!w.structures.some((s) => s.cell === next)) {
        plant(w, owner, next, STRUCTURES.neuron.hp);
        planted.push(next);
      }
      queue.push(next);
    }
  }
  assert.ok((territoryCounts(w).get(owner) ?? 0) >= cells, "room to spread");
  return planted;
}
