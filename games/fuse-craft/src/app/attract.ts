import { createAttractScene } from "./attract-scene.js";
import { step } from "../engine/index.js";
import { aiCommands } from "../engine/ai.js";
import { renderBoard } from "../render/board.js";
import type { World } from "../engine/types.js";
export function createAttract(host: HTMLElement) {
  let world: World = createAttractScene();
  const svg = host.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  host.append(svg);
  const advance = () => {
    if (world.finished || world.tick > 1200) world = createAttractScene();
    else
      world = step(
        world,
        world.players.flatMap((player) => aiCommands(world, player.id)),
      );
  };
  for (let i = 0; i < 100; i++) advance();
  return {
    advance,
    tick: () => world.tick,
    render(now: number) {
      renderBoard(svg, world, null, false, true, now);
    },
    dispose() {
      svg.remove();
    },
  };
}
