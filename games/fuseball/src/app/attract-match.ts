import {
  createWorld,
  botInput,
  paceTick,
  stepWorld,
  toView,
  winnerOf,
} from "../engine/index.js";
import { DEFAULT_SETTINGS } from "../online/game.js";

/** The public engine and ordinary bot inputs, without lobby admission or product metrics. */
export function createAttractMatch() {
  const fresh = () =>
    createWorld(DEFAULT_SETTINGS.mapId, ["demo-cyan", "demo-magenta"], 73);
  let world = fresh(),
    tick = 0;
  const advance = () => {
    if (tick >= 1200 || winnerOf(world) !== -1) {
      world = fresh();
      tick = 0;
    }
    const inputs = new Map(
      world.riders.map((rider) => [rider.id, botInput(world, rider)]),
    );
    for (let left = paceTick(world); left > 0; left--) stepWorld(world, inputs);
    tick++;
  };
  for (let i = 0; i < 100; i++) advance();
  return { advance, tick: () => tick, view: () => toView(world) };
}
