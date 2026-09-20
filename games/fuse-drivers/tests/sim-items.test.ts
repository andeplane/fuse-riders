import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BASE_STATS, config } from "../src/game/sim/config.js";
import { NEUTRAL_INPUT } from "../src/game/sim/input.js";
import {
  applyHit,
  rollItem,
  stepMissiles,
  useItem,
  type World,
} from "../src/game/sim/items.js";
import { createRace, step, type RaceState } from "../src/game/sim/race.js";
import { parseTrack } from "../src/game/sim/track.js";
import { createTruck, type Truck } from "../src/game/sim/truck.js";
import { defined } from "./fixtures/defined.js";

const track = parseTrack(
  JSON.parse(readFileSync("games/fuse-drivers/tracks/refinery.tmj", "utf8")),
  "refinery",
);
const racing = (seed: number, n: number): RaceState => ({
  ...createRace(track, seed, Array(n).fill(BASE_STATS)),
  phase: "racing",
  tick: 100,
});
const at = (
  t: Truck,
  x: number,
  y: number,
  heading = 0,
  extra: Partial<Truck> = {},
): Truck => ({ ...t, x, y, heading, ...extra });
const world: World = {
  missiles: [],
  mines: [],
  oils: [],
  drones: [],
  nextId: 1,
};

test("odds interpolate by position for 1, 2 and 5 trucks and favour missiles at the back", () => {
  const counts = (position: number, n: number) => {
    const c: Record<string, number> = {};
    let rng = 7;
    for (let i = 0; i < 2000; i++) {
      const [k, r] = rollItem(position, n, rng);
      rng = r;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  };
  const solo = counts(1, 1),
    leader = counts(1, 5),
    last = counts(5, 5),
    two = counts(2, 2);
  /** A kind the roll never produced is absent, which for a comparison of frequencies means zero. */
  const rolled = (c: Record<string, number>, kind: string) => c[kind] ?? 0;
  assert.ok(rolled(solo, "mine") > rolled(solo, "missile"));
  assert.ok(rolled(leader, "mine") > rolled(leader, "missile"));
  assert.ok(rolled(last, "missile") > rolled(last, "mine"));
  assert.ok(rolled(two, "missile") > rolled(two, "mine"));
  assert.ok("oil" in leader && "drone" in last && "emp" in last);
  assert.ok(!("emp" in leader));
});

test("missile locks only within 600 u and the 45 degree cone; otherwise dumb-fires", () => {
  const owner = at(createTruck(0, 0, 0, 0), 500, 500, 0);
  const inCone = at(createTruck(1, 0, 0, 0), 800, 600);
  const offCone = at(createTruck(1, 0, 0, 0), 600, 620);
  const far = at(createTruck(1, 0, 0, 0), 1200, 500);
  const withItem = { ...owner, item: "missile" as const };
  assert.equal(
    useItem(withItem, false, [withItem, inCone], world, 100, track).lockedSlot,
    1,
  );
  assert.equal(
    useItem(withItem, false, [withItem, offCone], world, 100, track).lockedSlot,
    null,
  );
  assert.equal(
    useItem(withItem, false, [withItem, far], world, 100, track).lockedSlot,
    null,
  );
  const back = useItem(withItem, true, [withItem, inCone], world, 100, track);
  assert.equal(back.lockedSlot, null);
  assert.ok(
    Math.abs(Math.abs(defined(back.missiles[0]).heading) - Math.PI) < 1e-9,
  );
});

test("missile dies on a wall and cannot hit in its first 10 ticks", () => {
  const wall = {
    ...track,
    walls: [{ a: { x: 600, y: 400 }, b: { x: 600, y: 600 } }],
  };
  const m = {
    id: 1,
    owner: 0,
    x: 590,
    y: 500,
    heading: 0,
    launchedTick: 100,
    target: null,
    onBridge: false,
  };
  assert.equal(stepMissiles([m], [], wall, 101).missiles.length, 0);
  const victim = at(createTruck(1, 0, 0, 0), 615, 500);
  const young = stepMissiles(
    [{ ...m, x: 590 }],
    [victim],
    { ...track, walls: [] },
    105,
  );
  assert.equal(young.hits.length, 0);
  const armed = stepMissiles(
    [{ ...m, x: 590 }],
    [victim],
    { ...track, walls: [] },
    111,
  );
  assert.equal(armed.hits.length, 1);
});

test("shield absorbs exactly one hit, invulnerable ignores, zero armor explodes and clears state", () => {
  const t = {
    ...createTruck(0, 0, 0, 0),
    shieldUntilTick: 200,
    item: "mine" as const,
  };
  const first = applyHit(t, 100);
  assert.ok(first.absorbed);
  assert.equal(first.truck.armor, 4);
  const second = applyHit(first.truck, 100);
  assert.ok(!second.absorbed);
  assert.equal(second.truck.armor, 3);
  assert.equal(second.truck.spinUntilTick, 100 + config.truck.spinOutTicks);
  const dying = applyHit({ ...t, shieldUntilTick: 0, armor: 1 }, 100);
  assert.ok(dying.killed);
  assert.equal(dying.truck.item, null);
  assert.equal(dying.truck.respawnAtTick, 100 + config.truck.respawnTicks);
});

test("two hits on one tick from two owners kill a two-armor truck and credit the second owner", () => {
  let s = racing(1, 3);
  const victim = at(defined(s.trucks[2]), 700, 437, 0, { armor: 2 });
  const a = at(defined(s.trucks[0]), 620, 437, 0),
    b = at(defined(s.trucks[1]), 780, 437, 0);
  s = {
    ...s,
    trucks: [a, b, victim],
    mines: [
      { id: 1, owner: 0, x: 700, y: 437, droppedTick: 0, onBridge: false },
      { id: 2, owner: 1, x: 702, y: 437, droppedTick: 0, onBridge: false },
    ],
    nextId: 3,
  };
  const r = step(
    s,
    [NEUTRAL_INPUT, NEUTRAL_INPUT, { ...NEUTRAL_INPUT, brake: true }],
    track,
  );
  const kills = r.events.filter((e) => e.type === "kill");
  assert.equal(kills.length, 1);
  assert.equal((kills[0] as { by: number }).by, 1);
  assert.equal(defined(r.state.trucks[1]).kills, 1);
  assert.equal(
    defined(r.state.trucks[2]).respawnAtTick,
    r.state.tick + config.truck.respawnTicks,
  );
});

test("respawn returns to the last checkpoint with an empty slot and invulnerability that ignores mines", () => {
  let s = racing(1, 2);
  const dead = {
    ...defined(s.trucks[0]),
    respawnAtTick: 101,
    checkpoint: 0,
    item: "shield" as const,
  };
  s = {
    ...s,
    trucks: [dead, defined(s.trucks[1])],
    mines: [
      {
        id: 1,
        owner: 1,
        x: defined(track.checkpoints[track.checkpoints.length - 1]).mid.x,
        y: defined(track.checkpoints[track.checkpoints.length - 1]).mid.y,
        droppedTick: 0,
        onBridge: false,
      },
    ],
  };
  const r = step(s, [NEUTRAL_INPUT, NEUTRAL_INPUT], track);
  const t = defined(r.state.trucks[0]);
  assert.equal(t.respawnAtTick, 0);
  assert.equal(t.item, null);
  assert.equal(t.armor, t.stats.maxArmor);
  assert.ok(t.invulnerableUntilTick > r.state.tick);
  assert.equal(r.state.mines.length, 1);
  assert.equal(r.events.filter((e) => e.type === "hit").length, 0);
});

test("a missile sweeps its path, so it cannot tunnel through a truck it overlaps", () => {
  const m = {
    id: 1,
    owner: 0,
    x: 590,
    y: 518,
    heading: 0,
    launchedTick: 80,
    target: null,
    onBridge: false,
  };
  const victim = at(createTruck(1, 0, 0, 0), 600, 500);
  assert.equal(
    stepMissiles([m], [victim], { ...track, walls: [] }, 100).hits.length,
    1,
  );
});

test("lock-on lands on a lower slot than the owner, and two pickups on one tick roll in slot order", () => {
  let s = racing(1, 2);
  const shooter = at(defined(s.trucks[1]), 620, 437, 0, { item: "missile" });
  s = { ...s, trucks: [at(defined(s.trucks[0]), 700, 437, 0), shooter] };
  const r = step(s, [NEUTRAL_INPUT, { ...NEUTRAL_INPUT, item: true }], track);
  assert.ok(defined(r.state.trucks[0]).lockedUntilTick > r.state.tick);
  let p = racing(2, 2);
  const boxes = track.items;
  p = {
    ...p,
    trucks: [
      at(defined(p.trucks[0]), defined(boxes[2]).x, defined(boxes[2]).y),
      at(defined(p.trucks[1]), defined(boxes[0]).x, defined(boxes[0]).y),
    ],
  };
  const pr = step(p, [NEUTRAL_INPUT, NEUTRAL_INPUT], track);
  assert.deepEqual(
    pr.events.filter((e) => e.type === "pickup").map((e) => e.slot),
    [0, 1],
  );
});

test("a mine and a missile hitting on one tick resolve in launch order", () => {
  let s = racing(1, 3);
  const victim = at(defined(s.trucks[2]), 700, 437, 0, { armor: 2 });
  s = {
    ...s,
    trucks: [
      at(defined(s.trucks[0]), 620, 437, 0),
      at(defined(s.trucks[1]), 780, 437, Math.PI),
      victim,
    ],
    mines: [
      { id: 5, owner: 0, x: 700, y: 437, droppedTick: 0, onBridge: false },
    ],
    missiles: [
      {
        id: 2,
        owner: 1,
        x: 705,
        y: 437,
        heading: Math.PI,
        launchedTick: 0,
        target: 2,
        onBridge: false,
      },
    ],
    nextId: 6,
  };
  const r = step(
    s,
    [NEUTRAL_INPUT, NEUTRAL_INPUT, { ...NEUTRAL_INPUT, brake: true }],
    track,
  );
  const kill = r.events.find((e) => e.type === "kill") as
    { by: number } | undefined;
  assert.equal(
    kill?.by,
    0,
    "mine id 5 launched after missile id 2, so the mine lands the final hit",
  );
});

test("toxic cannot kill and a finished truck cannot be hit", () => {
  let s = racing(1, 2);
  const toxicTile = (() => {
    for (let i = 0; i < track.surface.length; i++)
      if (track.surface[i] === "toxic")
        return {
          x: (i % track.cols) * 32 + 16,
          y: Math.floor(i / track.cols) * 32 + 16,
        };
    throw new Error("no toxic");
  })();
  s = {
    ...s,
    trucks: [
      at(defined(s.trucks[0]), toxicTile.x, toxicTile.y, 0, {
        armor: 1,
        speed: 0,
      }),
      defined(s.trucks[1]),
    ],
  };
  for (let i = 0; i < 40; i++)
    s = step(
      s,
      [{ ...NEUTRAL_INPUT, brake: true }, NEUTRAL_INPUT],
      track,
    ).state;
  assert.equal(defined(s.trucks[0]).armor, 1);
  assert.equal(defined(s.trucks[0]).respawnAtTick, 0);
  let f = racing(1, 2);
  f = {
    ...f,
    trucks: [
      at(defined(f.trucks[0]), 700, 437, 0, { finishedTick: 50 }),
      defined(f.trucks[1]),
    ],
    mines: [
      { id: 1, owner: 1, x: 700, y: 437, droppedTick: 0, onBridge: false },
    ],
  };
  const r = step(f, [NEUTRAL_INPUT, NEUTRAL_INPUT], track);
  assert.equal(r.events.filter((e) => e.type === "hit").length, 0);
});

test("EMP stuns and strips items within range, shield blocks it; drone zaps without spin-out", () => {
  let s = racing(1, 3);
  s = {
    ...s,
    trucks: [
      at(defined(s.trucks[0]), 700, 437, 0, { item: "emp" }),
      at(defined(s.trucks[1]), 800, 437, 0, { item: "mine" }),
      at(defined(s.trucks[2]), 750, 437, 0, { shieldUntilTick: 500 }),
    ],
  };
  const r = step(
    s,
    [{ ...NEUTRAL_INPUT, item: true }, NEUTRAL_INPUT, NEUTRAL_INPUT],
    track,
  );
  assert.ok(defined(r.state.trucks[1]).stunUntilTick > r.state.tick);
  assert.equal(defined(r.state.trucks[1]).item, null);
  assert.equal(defined(r.state.trucks[2]).shieldUntilTick, 0);
  assert.equal(defined(r.state.trucks[2]).stunUntilTick, 0);
  const zap = applyHit(
    at(createTruck(0, 0, 0, 0), 0, 0, 0, { speed: 300 }),
    100,
    "drone",
  );
  assert.equal(zap.truck.armor, 3);
  assert.equal(zap.truck.spinUntilTick, 0);
  assert.equal(zap.truck.speed, 300);
});

test("respawn pose is the last checkpoint facing the next", () => {
  let s = racing(1, 1);
  const dead = { ...defined(s.trucks[0]), respawnAtTick: 101, checkpoint: 3 };
  const r = step({ ...s, trucks: [dead] }, [NEUTRAL_INPUT], track);
  const last = defined(track.checkpoints[2]),
    next = defined(track.checkpoints[3]);
  assert.equal(defined(r.state.trucks[0]).x, last.mid.x);
  assert.equal(defined(r.state.trucks[0]).y, last.mid.y);
  assert.ok(
    Math.abs(
      defined(r.state.trucks[0]).heading -
        Math.atan2(next.mid.y - last.mid.y, next.mid.x - last.mid.x),
    ) < 1e-9,
  );
});

test("a box gives an item on a press edge, never while holding one, and respects its cooldown", () => {
  let s = racing(5, 1);
  const box = defined(track.items[0]);
  const t = at(defined(s.trucks[0]), box.x, box.y, 0);
  // Neighbouring boxes overlap the pickup radius; park them on cooldown so only box 0 is in play.
  s = {
    ...s,
    trucks: [t],
    boxCooldowns: s.boxCooldowns.map((_, i) => (i === 0 ? 0 : 99999)),
  };
  let r = step(s, [NEUTRAL_INPUT], track);
  assert.ok(defined(r.state.trucks[0]).item);
  assert.ok(r.events.some((e) => e.type === "pickup"));
  const held = defined(r.state.trucks[0]).item;
  r = step(
    { ...r.state, trucks: [at(defined(r.state.trucks[0]), box.x, box.y)] },
    [NEUTRAL_INPUT],
    track,
  );
  assert.equal(defined(r.state.trucks[0]).item, held);
  const fired = step(
    {
      ...r.state,
      trucks: [
        at(defined(r.state.trucks[0]), box.x, box.y, 0, {
          item: "nitro",
          nitros: 0,
        }),
      ],
    },
    [{ ...NEUTRAL_INPUT, item: true }],
    track,
  );
  assert.equal(
    defined(fired.state.trucks[0]).item,
    null,
    "box 0 is on cooldown, so no new item",
  );
  assert.equal(defined(fired.state.trucks[0]).nitros, 2);
  assert.ok(fired.events.some((e) => e.type === "fire"));
  const later = step(
    {
      ...fired.state,
      tick: fired.state.tick + config.items.boxCooldownTicks,
      trucks: [at(defined(fired.state.trucks[0]), box.x, box.y)],
    },
    [NEUTRAL_INPUT],
    track,
  );
  assert.ok(
    defined(later.state.trucks[0]).item,
    "box 0 gives again after its cooldown",
  );
});
