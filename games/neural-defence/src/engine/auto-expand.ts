import {
  CONSTRUCTIONS,
  constructionQueueAvailability,
  constructionDispatchAvailability,
  isSprout,
  sproutSlots,
} from "./catalog.js";
import { homeCellOrder, neighbors } from "./map.js";
import type { Player, World } from "./types.js";

/** Nearest legal frontier to the brain; ties follow the seat's home order. */
export function autoExpandCell(
  world: Readonly<World>,
  player: Readonly<Player>,
): number | null {
  if (
    !player.autoExpand ||
    !player.alive ||
    player.queue.some((j) => !j.paid) ||
    player.queue.filter((j) => j.paid && isSprout(j)).length >=
      sproutSlots(player) ||
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
  // Only cells beside the connected network can take a sprout; scan those,
  // nearest the brain first, with seat-fair ties.
  const frontier = new Set<number>();
  for (const s of world.structures)
    if (s.ownerId === player.id && s.connected)
      for (const n of neighbors(world.map, s.cell)) frontier.add(n);
  let best: number | null = null,
    bestDistance = Infinity;
  for (const cell of frontier) {
    const [cq, cr] = axial(cell);
    const distance =
      (Math.abs(cq - q) + Math.abs(cr - r) + Math.abs(cq + cr - q - r)) / 2;
    if (
      distance > bestDistance ||
      (distance === bestDistance &&
        best !== null &&
        homeCellOrder(world.map, player.slot, cell, best) > 0)
    )
      continue;
    if (
      !constructionQueueAvailability(world, player, "neuron", cell).allowed ||
      !constructionDispatchAvailability(world, player, { kind: "neuron", cell })
        .allowed
    )
      continue;
    best = cell;
    bestDistance = distance;
  }
  return best;
}
