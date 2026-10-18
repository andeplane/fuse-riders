import test from "node:test";
import assert from "node:assert/strict";
import {
  Frame,
  Mode,
  Particles,
  QualityGovernor,
  cuesOf,
  emit,
  qualityParam,
  type CueContext,
  type Spawn,
} from "../src/render3d/fx.js";
import { EventDedupe, type StampedEvent } from "../src/render/cues.js";
import { SUB, TILE_PX, type CombatEvent } from "../src/engine/view.js";
import {
  distanceTo,
  heightField,
  terrainBuffers,
  wet,
} from "../src/render3d/terrain.js";

const T = SUB * TILE_PX;
const dot = (born: number, life: number, mode: Spawn["mode"] = Mode.Glow): Spawn => ({
  x: 0, y: 0, z: 0, born, life, size: 1, rgb: [1, 1, 1], alpha: 1, mode,
}); // prettier-ignore

/** A small seeded generator, so emitted effects repeat exactly. */
function seeded(seed: number): () => number {
  return () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
}

const ctx: CueContext = {
  kindOf: (id) => (["grunt", "torch", "lightTank"] as const)[id],
  teamOf: (mark) => (mark.of === "hero" ? 1 : 0),
  site: (id) => (id === 3 ? { x: 4.5, z: 6.5 } : undefined),
  heroAt: (seat) => (seat === 0 ? { x: 2, z: 3, team: 0 } : undefined),
};
const mark = (of: "unit" | "hero" | "building", id: number) => ({
  of,
  id,
  x: id * T,
  y: 0,
});
const shot = (of: "unit" | "hero" | "building", id: number): CombatEvent => ({
  type: "shot", from: mark(of, id), to: { of: "unit", id: 9, x: 8 * T, y: 2 * T }, damage: 1,
}); // prettier-ignore

test("the particle pool holds a fixed number, the newest replacing the oldest", () => {
  const pool = new Particles(4);
  for (let i = 0; i < 6; i++) pool.spawn({ ...dot(i, 1000), x: i });
  assert.equal(pool.live(10), 4);
  const glow = new Frame(8);
  pool.render(10, glow, new Frame(8));
  // Particles 0 and 1 gave way to 4 and 5.
  assert.deepEqual([0, 3, 6, 9].map((i) => glow.pos[i]).sort(), [2, 3, 4, 5]);
});

test("a particle shows only between its birth and its end, and draws in its mode's frame", () => {
  const pool = new Particles(8);
  pool.spawn(dot(100, 50));
  pool.spawn(dot(0, 1000, Mode.Smoke));
  pool.spawn({ ...dot(0, 1000, Mode.Streak), dx: 2 });
  assert.equal(pool.live(50), 2, "not yet born");
  assert.equal(pool.live(120), 3);
  assert.equal(pool.live(150), 2, "expired");
  const glow = new Frame(8),
    blend = new Frame(1);
  pool.render(120, glow, blend);
  assert.deepEqual([glow.count, blend.count], [2, 1]);
  assert.deepEqual(
    [...glow.data.subarray(0, 8)].filter((_, i) => i % 4 === 2).sort(),
    [Mode.Glow, Mode.Streak],
  );
  // A full frame drops the rest rather than growing.
  pool.spawn(dot(0, 1000, Mode.Smoke));
  blend.count = 0;
  pool.render(120, glow, blend);
  assert.equal(blend.count, 1);
  pool.clear();
  assert.equal(pool.live(120), 0);
});

test("shots look like their shooter: torch flame, tank and building shells, tracers otherwise", () => {
  const kinds = [shot("unit", 0), shot("unit", 1), shot("unit", 2), shot("building", 3), shot("hero", 0)].map(
    (e) => cuesOf(e, ctx)[0]!,
  ); // prettier-ignore
  assert.deepEqual(
    kinds.map((c) => c.kind),
    ["tracer", "flame", "shell", "shell", "tracer"],
  );
  assert.equal(kinds[4]!.size, 1.5, "a hero's shot is heavier");
  assert.deepEqual([kinds[4]!.team, kinds[0]!.x2, kinds[0]!.z2], [1, 8, 2]);
});

test("deaths, ruins, spells and level-ups each start their effect", () => {
  const one = (e: CombatEvent) => cuesOf(e, ctx).map((c) => [c.kind, c.x, c.z, c.size]);
  assert.deepEqual(one({ type: "death", id: 2, kind: "lightTank", owner: 0, x: 2 * T, y: T }), [["boom", 2, 1, 1]]);
  assert.deepEqual(one({ type: "destroyed", building: 3, kind: "turret" }), [["boom", 4.5, 6.5, 1.8]]);
  assert.deepEqual(one({ type: "destroyed", building: 7, kind: "turret" }), []);
  assert.deepEqual(one({ type: "cast", seat: 0, slot: 3, effect: "orbitalDrop", x: T, y: T }), [["drop", 1, 1, 3]]);
  assert.deepEqual(one({ type: "cast", seat: 1, slot: 0, effect: "repair", x: T, y: T }), [["spell", 1, 1, 3]]);
  assert.deepEqual(one({ type: "levelUp", seat: 0, level: 2 }), [["levelUp", 2, 3, 1]]);
  assert.deepEqual(one({ type: "won", winner: 0 }), []);
}); // prettier-ignore

test("a rollback that re-delivers steps plays only what changed", () => {
  const dedupe = new EventDedupe();
  const death = (step: number, id: number): StampedEvent => ({
    step, event: { type: "death", id, kind: "grunt", owner: 0, x: step * T, y: 0 },
  }); // prettier-ignore
  const played = (events: StampedEvent[]) =>
    events
      .filter((e) => dedupe.accept("m", e))
      .flatMap((e) => cuesOf(e.event, ctx)).length;
  const first = Array.from({ length: 10 }, (_, i) => death(i + 1, 1));
  assert.equal(played(first), 10);
  // Steps 6..10 run again; on step 8 a different unit dies this time.
  const again = first.slice(5).map((e) => (e.step === 8 ? death(8, 2) : e));
  assert.equal(played(again), 1);
  assert.equal(played(again), 0, "a second replay adds nothing");
});

test("an explosion bursts, leaves a scorch and asks for a light, the same way for the same seed", () => {
  const run = () => {
    const pool = new Particles(256), scorch = new Particles(4);
    const flashes = emit({ kind: "boom", x: 3, z: 3, x2: 3, z2: 3, size: 1, team: -1 }, 0, () => 0.2, pool, scorch, seeded(5));
    const glow = new Frame(256), blend = new Frame(256);
    pool.render(100, glow, blend);
    return { flashes, scorches: scorch.live(1e9), glow: glow.count, blend: blend.count, xs: [...glow.pos.subarray(0, 9)] };
  }; // prettier-ignore
  const a = run();
  assert.equal(a.flashes.length, 1);
  assert.equal(a.scorches, 1, "the decal outlives the blast");
  assert.ok(a.glow >= 10 && a.blend >= 10, `fire ${a.glow}, debris ${a.blend}`);
  assert.deepEqual(run(), a);
});

test("every cue spawns within the pool and the shell's blast waits for it to land", () => {
  const pool = new Particles(64), scorch = new Particles(4);
  for (const kind of ["tracer", "shell", "flame", "shockwave", "rally", "ironHide", "spell", "drop", "levelUp", "respawn"] as const)
    emit({ kind, x: 1, z: 1, x2: 9, z2: 1, size: 3, team: 0 }, 0, () => 0, pool, scorch, seeded(1));
  assert.ok(pool.live(200) <= 64);
  const shell = new Particles(64);
  emit({ kind: "shell", x: 0, z: 0, x2: 9, z2: 0, size: 1, team: 0 }, 0, () => 0, shell, scorch, seeded(2));
  assert.ok(shell.live(1) < shell.live(500), "impact sparks are born when the shell arrives");
}); // prettier-ignore

test("quality: ?quality forces a level, else it starts high and drops for good when frames run slow", () => {
  assert.equal(qualityParam("?quality=low"), "low");
  assert.equal(qualityParam("?mute&quality=high"), "high");
  assert.equal(qualityParam("?quality=ultra"), undefined);
  const forced = new QualityGovernor("high", 34, 10, 0);
  for (let i = 0; i < 50; i++) forced.sample(100);
  assert.equal(forced.level, "high");
  const fast = new QualityGovernor(undefined, 34, 10, 5);
  for (let i = 0; i < 50; i++) fast.sample(16);
  // A hidden tab's long gaps are not slowness.
  for (let i = 0; i < 50; i++) fast.sample(1000);
  assert.equal(fast.level, "high");
  const slow = new QualityGovernor(undefined, 34, 10, 5);
  const changes = Array.from({ length: 30 }, () => slow.sample(50)).filter(
    Boolean,
  ).length;
  assert.deepEqual([slow.level, changes], ["low", 1]);
  for (let i = 0; i < 50; i++) slow.sample(5);
  assert.equal(slow.level, "low", "no flip-flopping back");
});

test("the river's banks darken and distances reach to the nearest water", () => {
  const map = { width: 8, height: 1, terrain: ["....~~.."] };
  assert.equal(distanceTo(map, 4.5, 0.5, wet), 0);
  assert.ok(Math.abs(distanceTo(map, 3, 0.5, wet) - 1) < 1e-9);
  assert.equal(distanceTo(map, 0.5, 0.5, wet, 2), 2, "out of reach");
  const field = heightField(map);
  const plain = terrainBuffers(field).colors,
    banked = terrainBuffers(field, 7, map).colors;
  const at = (colors: Float32Array, x: number) =>
    colors[(1 * field.cols + x * field.res) * 3]!;
  assert.ok(
    at(banked, 10 / 3) < at(plain, 10 / 3),
    "sand two thirds of a tile from the bank darker",
  );
  assert.equal(at(banked, 0), at(plain, 0), "far sand unchanged");
});
