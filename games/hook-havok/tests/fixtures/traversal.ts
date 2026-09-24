import {
  NEUTRAL,
  createWorld,
  type Input,
  type World,
} from "../../src/engine/world.js";
import { step } from "../../src/engine/step.js";
/** Ordinary 60 Hz inputs only. No teleports, privileged impulses or changed tuning. */
export const TRAVERSAL: readonly {
  ticks: number;
  input: Partial<Input>;
  mark?: string;
}[] = [
  { ticks: 32, input: { move: 1 } },
  { ticks: 9, input: { move: -1 } },
  { ticks: 16, input: { jump: true } },
  { ticks: 13, input: { jump: true, move: -1 } },
  { ticks: 15, input: { move: 1 } },
  { ticks: 15, input: {}, mark: "low ledge" },
  { ticks: 32, input: { jump: true, move: 1 } },
  { ticks: 15, input: { move: -1 } },
  { ticks: 15, input: {}, mark: "central gap" },
  { ticks: 27, input: { move: 1 } },
  { ticks: 12, input: {} },
  {
    ticks: 30,
    input: { fire: true, aimX: 1180, aimY: 285 },
    mark: "high anchor",
  },
  {
    ticks: 16,
    input: { fire: true, jump: true, move: 1, aimX: 1180, aimY: 285 },
  },
  { ticks: 20, input: { move: -1 } },
  { ticks: 15, input: {}, mark: "release and land" },
  { ticks: 34, input: { move: 1 }, mark: "off edge" },
  {
    ticks: 55,
    input: { fire: true, aimX: 1240, aimY: 290 },
    mark: "recovery pull",
  },
  { ticks: 30, input: { move: -1 } },
  { ticks: 15, input: {}, mark: "recovery landing" },
  { ticks: 180, input: { move: 1 }, mark: "fall" },
  { ticks: 1, input: { reset: true } },
  { ticks: 30, input: {}, mark: "reset" },
];
export function traverse(
  inspect?: (world: World, mark?: string) => void,
): World {
  const world = createWorld();
  for (const segment of TRAVERSAL) {
    world.input = { ...NEUTRAL, ...segment.input };
    for (let i = 0; i < segment.ticks; i++) {
      step(world);
      inspect?.(world, i === segment.ticks - 1 ? segment.mark : undefined);
    }
  }
  return world;
}
