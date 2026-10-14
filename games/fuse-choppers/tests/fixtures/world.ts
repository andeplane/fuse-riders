import {
  createWorld,
  stepWorld,
  type Settings,
  type World,
} from "../../src/engine/index.js";
import { SUB, px } from "../../src/engine/math.js";
import { CRUSH_START } from "../../src/engine/tuning.js";

export type Rules = Pick<Settings, "lift" | "combat" | "powerUps">;
export const CLASSIC: Rules = {
  lift: "classic",
  combat: "all",
  powerUps: true,
};
/** The thrust trial: a chopper holding nothing hovers, which keeps a combat test still. */
export const HOVER: Rules = { ...CLASSIC, lift: "thrust" };

/**
 * A world past its countdown, with `count` choppers `c0`, `c1`… in slots 0, 1…, every one already flying under its
 * own power (the start hover has its own test).
 */
export function playing(count = 1, rules: Rules = CLASSIC, seed = 7): World {
  const world = createWorld(
    seed,
    Array.from({ length: count }, (_, slot) => ({ id: `c${slot}`, slot })),
    rules,
  );
  while (world.phase === "countdown") stepWorld(world, new Map());
  for (const chopper of world.choppers) chopper.engaged = true;
  return world;
}

export function steps(
  world: World,
  count: number,
  inputs:
    | ReadonlyMap<string, number>
    | (() => ReadonlyMap<string, number>) = new Map(),
): void {
  for (let i = 0; i < count; i++)
    stepWorld(world, typeof inputs === "function" ? inputs() : inputs);
}

export const held = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

/** Puts a chopper at `(x, y)` pixels, still, with the camera around it. */
export function place(world: World, id: string, x: number, y: number): void {
  const chopper = world.choppers.find((c) => c.id === id)!;
  chopper.x = px(x);
  chopper.y = px(y);
  chopper.vx = 0;
  chopper.vy = 0;
  if (px(x) < world.camX + px(200) || px(x) > world.camX + px(900)) {
    world.camX = Math.max(0, px(x - 300));
    world.crushX = world.camX + CRUSH_START;
  }
}

/** The world's entities in pixels, for readable assertions. */
export const at = (value: number): number => value / SUB;
