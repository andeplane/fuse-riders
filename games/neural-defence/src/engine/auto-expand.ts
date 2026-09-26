import {
  CONSTRUCTIONS,
  constructionQueueAvailability,
  constructionDispatchAvailability,
} from "./catalog.js";
import type { Player, World } from "./types.js";

/** Nearest legal frontier to the brain; cell index breaks ties deterministically. */
export function autoExpandCell(
  world: Readonly<World>,
  player: Readonly<Player>,
): number | null {
  if (
    !player.autoExpand ||
    !player.alive ||
    player.queue.length ||
    player.worker.mode !== "idle" ||
    player.biomass < CONSTRUCTIONS.neuron.cost
  )
    return null;
  const brain = world.structures.find(
    (s) => s.ownerId === player.id && s.kind === "brain",
  );
  if (!brain) return null;
  const axial = (cell: number) => {
    const row = Math.floor(cell / world.map.width);
    return [(cell % world.map.width) - (row - (row & 1)) / 2, row] as const;
  };
  const [q, r] = axial(brain.cell);
  let best: number | null = null,
    bestDistance = Infinity;
  for (let cell = 0; cell < world.map.cells.length; cell++) {
    if (
      !constructionQueueAvailability(world, player, "neuron", cell).allowed ||
      !constructionDispatchAvailability(world, player, { kind: "neuron", cell })
        .allowed
    )
      continue;
    const [cq, cr] = axial(cell);
    const distance =
      (Math.abs(cq - q) + Math.abs(cr - r) + Math.abs(cq + cr - q - r)) / 2;
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}
