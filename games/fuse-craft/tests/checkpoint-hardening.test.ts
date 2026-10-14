import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoExpandCell } from "../src/engine/auto-expand.ts";
import {
  createMatch,
  decodeState,
  encodeState,
  loadMap,
  neighbors,
  step,
  type Command,
  type World,
} from "../src/engine/index.ts";
import { STRUCTURES } from "../src/engine/catalog.ts";

test("losing a sprout leaves the builder on its tower and every tick a valid checkpoint", () => {
  for (const loss of ["cancel", "destroyed"] as const) {
    let w = duel();
    const p = w.players[0]!;
    p.biomass = 500_000;
    const brain = brainCell(w, "a");
    // A neuron two steps out for the tower, and a sprout on another side.
    const [near, other] = openNeighbours(w, brain);
    const far = openNeighbours(w, near!).find(
      (c) => !neighbors(w.map, brain).includes(c) && c !== brain,
    )!;
    plant(w, "a", near!);
    plant(w, "a", far);
    w = step(w, [
      command(1, { type: "queueConstruction", kind: "tower", cell: far }),
      command(2, { type: "queueConstruction", kind: "neuron", cell: other! }),
    ]);
    const a = () => w.players[0]!;
    assert.ok(
      a().queue.every((j) => j.paid),
      "both jobs paid",
    );
    assert.equal(a().worker.mode, "outbound");
    if (loss === "cancel")
      w = step(w, [command(3, { type: "cancelConstruction", cell: other! })]);
    else {
      a().queue.find((j) => j.kind === "neuron")!.hp = 0;
      w = step(w);
    }
    assert.ok(!a().queue.some((j) => j.kind === "neuron"), `sprout ${loss}`);
    assert.notEqual(a().worker.mode, "returning", "the builder keeps going");
    for (let i = 0; i < 40; i++) {
      assert.doesNotThrow(() => decodeState(encodeState(w)), `tick ${w.tick}`);
      w = step(w);
    }
  }
});

test("checkpoints refuse what no peer could have produced", () => {
  let w = duel();
  for (let i = 0; i < 60; i++) w = step(w);
  const tamper = (edit: (raw: Record<string, any>) => void) => {
    const raw = JSON.parse(encodeState(w)) as Record<string, any>;
    edit(raw);
    return () => decodeState(JSON.stringify(raw));
  };
  assert.doesNotThrow(tamper(() => {}));
  // Buffs need powerups, and no buff outlasts every possible pickup.
  assert.throws(
    tamper((raw) => {
      raw.players[0].buffs = [{ kind: "frenzy", expiresAt: raw.tick + 10 }];
    }),
  );
  // Zero-time construction exists only with instant construction.
  assert.throws(
    tamper((raw) => {
      raw.players[0].queue = [
        {
          cell: openNeighbours(w, brainCell(w, "a"))[0],
          kind: "neuron",
          paid: true,
          progress: 0,
          duration: 0,
          hp: STRUCTURES.neuron.hp,
        },
      ];
    }),
  );
  // Territory cannot exceed what the network claims.
  assert.throws(tamper((raw) => (raw.players[0].territory = 64)));
  // A dominance clock needs the dominant share.
  assert.throws(tamper((raw) => (raw.players[0].dominanceSince = 0)));
  // Players are stored in id order.
  assert.throws(tamper((raw) => raw.players.reverse()));
  // Particle upgrades need their research.
  assert.throws(
    tamper((raw) => {
      raw.particles[0].attack += 1;
    }),
  );
});

test("powerup buffs are bounded by the pickups that could have stacked them", () => {
  let w = createMatch(closeQuarters(), { matchId: "buffs", powerups: true }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  for (let i = 0; i < 30; i++) w = step(w);
  const raw = JSON.parse(encodeState(w)) as Record<string, any>;
  raw.players[0].buffs = [{ kind: "frenzy", expiresAt: raw.tick + 10 }];
  assert.doesNotThrow(() => decodeState(JSON.stringify(raw)));
  raw.players[0].buffs = [
    { kind: "frenzy", expiresAt: Number.MAX_SAFE_INTEGER },
  ];
  assert.throws(() => decodeState(JSON.stringify(raw)));
});

test("auto expansion breaks distance ties the same way for mirror-image seats", () => {
  const map = closeQuarters();
  const w = createMatch(map, {}, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
  for (const p of w.players) p.autoExpand = true;
  const a = autoExpandCell(w, w.players[0]!)!;
  const b = autoExpandCell(w, w.players[1]!)!;
  // Close Quarters is point-symmetric: cell i mirrors cell N-1-i.
  assert.equal(b, map.cells.length - 1 - a);
});

function closeQuarters() {
  return loadMap(
    JSON.parse(
      readFileSync(
        new URL("../maps/close-quarters.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}
function duel(): World {
  return createMatch(closeQuarters(), { matchId: "hardening" }, [
    { id: "a", slot: 0 },
    { id: "b", slot: 1 },
  ]);
}
function brainCell(w: World, id: string): number {
  return w.structures.find((s) => s.ownerId === id && s.kind === "brain")!.cell;
}
function openNeighbours(w: World, cell: number): number[] {
  return neighbors(w.map, cell).filter(
    (n) =>
      w.map.cells[n]!.terrain === "open" &&
      !w.structures.some((s) => s.cell === n),
  );
}
function plant(w: World, owner: string, cell: number): void {
  w.structures.push({
    id: w.nextEntityId++,
    cell,
    ownerId: owner,
    kind: "neuron",
    hp: STRUCTURES.neuron.hp,
    connected: true,
  });
}
function command(sequence: number, action: Command["action"]): Command {
  return { playerId: "a", sequence, matchId: "hardening", action };
}
