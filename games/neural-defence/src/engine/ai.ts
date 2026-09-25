import {
  constructionDispatchAvailability,
  constructionQueueAvailability,
  RESEARCH,
  STRUCTURES,
  researchAvailability,
} from "./catalog.js";
import { neighbors, homeCellOrder } from "./map.js";
import type { Action, Command, Research, World } from "./types.js";

/** Stateless, public-information opponent. Every decision enters ordinary apply(). */
export type AiStrategy = "balanced" | "pressure" | "economy";
export function aiCommands(
  world: Readonly<World>,
  playerId: string,
  strategy: AiStrategy = "balanced",
): Command[] {
  const player = world.players.find((p) => p.id === playerId);
  if (!player?.alive || world.finished || world.tick % 20 !== 0) return [];
  // Resolve equivalent choices in the player's home orientation. Absolute
  // cell indices otherwise make both sides prefer the north-west frontier.
  const cellOrder = (a: number, b: number) =>
    homeCellOrder(world.map, player.slot, a, b);
  const own = world.structures.filter(
    (s) => s.ownerId === playerId && s.connected,
  );
  const enemy = world.structures.filter((s) => s.ownerId !== playerId);
  if (!enemy.length) return [];
  const distances = new Map<number, number>();
  const frontier = enemy.map((s) => s.cell).sort((a, b) => a - b);
  for (const cell of frontier) distances.set(cell, 0);
  for (const cell of frontier) {
    for (const next of neighbors(world.map, cell)) {
      if (world.map.cells[next]?.terrain !== "open" || distances.has(next))
        continue;
      distances.set(next, distances.get(cell)! + 1);
      frontier.push(next);
    }
  }
  const distance = (cell: number) =>
    distances.get(cell) ?? world.map.cells.length;
  const actions: Action[] = [];
  for (const job of player.queue) {
    if (
      !neighbors(world.map, job.cell).some((cell) =>
        own.some((s) => s.cell === cell),
      ) ||
      world.structures.some((s) => s.cell === job.cell)
    )
      actions.push({ type: "cancelConstruction", cell: job.cell });
  }
  if (
    strategy === "pressure" &&
    player.research.includes("resonance") &&
    player.particleKind !== "swift"
  )
    actions.push({ type: "setParticleKind", kind: "swift" });
  else if (
    strategy !== "pressure" &&
    player.research.includes("ballistics") &&
    player.particleKind !== "heavy"
  )
    actions.push({ type: "setParticleKind", kind: "heavy" });
  // Keep supply on four forward nodes, enough to use the full 128-particle pool.
  // Clear stale orders before adding
  // new ones so ordinary priority limits cannot strand the army behind a front.
  const targets = [...own]
    .sort(
      (a, b) =>
        distance(a.cell) -
          STRUCTURES[a.kind].range -
          (distance(b.cell) - STRUCTURES[b.kind].range) ||
        STRUCTURES[b.kind].volley - STRUCTURES[a.kind].volley ||
        cellOrder(a.cell, b.cell),
    )
    .slice(0, 4);
  for (const cell of Object.keys(player.priorities).map(Number))
    if (!targets.some((s) => s.cell === cell))
      actions.push({ type: "setPriority", cell, weight: 0 });
  for (const target of targets)
    if (player.priorities[target.cell] !== 3)
      actions.push({ type: "setPriority", cell: target.cell, weight: 3 });
  const researchOrder: Research[] =
    strategy === "pressure"
      ? ["conduction", "resonance", "excitation", "ballistics", "growth"]
      : (Object.keys(RESEARCH) as Research[]);
  const research = researchOrder.find(
    (kind) => researchAvailability(player, kind).allowed,
  );
  if (research) actions.push({ type: "startResearch", research });
  if (!player.queue.length && player.worker.mode === "idle") {
    const sites = [
      ...new Set(own.flatMap((s) => neighbors(world.map, s.cell))),
    ];
    // A ranged firing position can pressure enemies without putting a fragile
    // construction site directly in their melee range.
    const towerKind =
      strategy === "pressure" && player.research.includes("resonance")
        ? "relay"
        : player.research.includes("ballistics")
          ? "siege"
          : "tower";
    const firingSites = sites.filter(
      (cell) =>
        distance(cell) > 1 &&
        distance(cell) <= STRUCTURES[towerKind].range &&
        constructionQueueAvailability(world, player, towerKind, cell).allowed &&
        constructionDispatchAvailability(world, player, {
          kind: towerKind,
          cell,
        }).allowed,
    );
    firingSites.sort((a, b) => distance(b) - distance(a) || cellOrder(a, b));
    if (firingSites[0] !== undefined) {
      actions.push({
        type: "queueConstruction",
        kind: towerKind,
        cell: firingSites[0],
      });
    } else {
      const candidates = [
        ...new Set(own.flatMap((s) => neighbors(world.map, s.cell))),
      ].filter(
        (cell) =>
          constructionQueueAvailability(world, player, "neuron", cell)
            .allowed &&
          constructionDispatchAvailability(world, player, {
            kind: "neuron",
            cell,
          }).allowed,
      );
      const score = (cell: number) => {
        const deposits = neighbors(world.map, cell).filter(
          (n) => world.map.cells[n]?.terrain === "deposit",
        ).length;
        // Economic footholds first, then steady pressure toward the opponent.
        return (
          distance(cell) * 4 -
          deposits *
            (strategy === "economy" ? 12 : strategy === "pressure" ? 3 : 7)
        );
      };
      candidates.sort((a, b) => score(a) - score(b) || cellOrder(a, b));
      const cell = candidates[0];
      if (cell !== undefined)
        actions.push({ type: "queueConstruction", kind: "neuron", cell });
    }
  }
  return actions.map((action, index) => ({
    playerId,
    matchId: world.matchId,
    sequence: player.sequence + index + 1,
    action,
  }));
}
