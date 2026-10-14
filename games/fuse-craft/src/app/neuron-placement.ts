import {
  constructionQueueAvailability,
  isSprout,
  planSupport,
} from "../engine/catalog.js";
import { neighbors } from "../engine/map.js";
import { RULES, type Player, type World } from "../engine/types.js";

export interface NeuronPlacement {
  /** Ordinary neuron orders, from the network towards the requested hex. */
  cells: number[];
  hint: string;
}

/** Fill gaps hidden by large structure artwork without changing growth rules. */
export function planNeuronPlacement(
  world: Readonly<World>,
  player: Readonly<Player>,
  target: number,
): NeuronPlacement {
  if (!constructionQueueAvailability(world, player, "neuron", target).allowed)
    return { cells: [], hint: "" };
  const anchors = new Set(
    world.structures
      .filter((s) => s.ownerId === player.id && s.connected)
      .map((s) => s.cell),
  );
  const occupied = new Set(world.structures.map((s) => s.cell));
  for (const p of world.players)
    for (const job of p.queue)
      if (
        (p.id !== player.id && job.paid) ||
        (p.id === player.id && !isSprout(job))
      )
        occupied.add(job.cell);
  // A rival may have claimed a waiting plan's cell. Neither it nor plans
  // relying on it can anchor a new route, even while its ghost remains.
  const support = planSupport(world, {
    ...player,
    queue: player.queue.filter((job) => !occupied.has(job.cell)),
  });
  const connected = new Set(anchors);
  for (const job of player.queue)
    if (
      isSprout(job) &&
      !occupied.has(job.cell) &&
      (support.get(job.cell) === "connected" ||
        support.get(job.cell) === "chained" ||
        (job.paid &&
          neighbors(world.map, job.cell).some((c) => connected.has(c))))
    )
      anchors.add(job.cell);
  const existing = new Set(player.queue.map((j) => j.cell));
  // Search backwards so an existing, supported plan is as useful as a built
  // neuron. Never cross deposits, rocks, buildings or another player's site.
  const next = new Map<number, number | null>([[target, null]]);
  const frontier = [target];
  for (const cell of frontier) {
    if (neighbors(world.map, cell).some((n) => anchors.has(n))) {
      const cells: number[] = [];
      for (let c: number | null = cell; c !== null; c = next.get(c)!)
        if (!existing.has(c)) cells.push(c);
      if (player.queue.length + cells.length > RULES.queueLimit)
        return {
          cells: [],
          hint: `Connecting path needs ${cells.length} queue spaces; only ${RULES.queueLimit - player.queue.length} free.`,
        };
      return {
        cells,
        hint:
          cells.length > 1
            ? `Queues ${cells.length - 1} connecting neuron${cells.length === 2 ? "" : "s"} first. Each grows in turn using biomass.`
            : "",
      };
    }
    for (const n of neighbors(world.map, cell))
      if (
        !next.has(n) &&
        !occupied.has(n) &&
        world.map.cells[n]?.terrain === "open"
      ) {
        next.set(n, cell);
        frontier.push(n);
      }
  }
  return {
    cells: [],
    hint: "No open path to your network. Choose another hex.",
  };
}
