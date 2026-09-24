import { neighbors, type World, type Command } from "../engine/index.js";

/** Authored scenario setup only. Once ticking, the opponent has exactly the ordinary action interface. */
export function prepareCombatLab(world: World): void {
  if (world.players.length !== 2) return;
  const human = world.players.find((p) => p.id !== "lab-opponent")!;
  const opponent = world.players.find((p) => p.id === "lab-opponent")!;
  const start = world.structures.find((s) => s.ownerId === human.id)!.cell;
  const end = world.structures.find((s) => s.ownerId === opponent.id)!.cell;
  const paths: number[][] = [[start]],
    seen = new Set([start]);
  let route: number[] = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!,
      cell = path[path.length - 1]!;
    if (cell === end) {
      route = path;
      break;
    }
    for (const n of neighbors(world.map, cell))
      if (!seen.has(n) && world.map.cells[n]?.terrain === "open") {
        seen.add(n);
        paths.push([...path, n]);
      }
  }
  const middle = Math.floor(route.length / 2);
  for (let i = 1; i < route.length - 1; i++)
    world.structures.push({
      id: world.nextEntityId++,
      cell: route[i]!,
      ownerId: i < middle ? human.id : opponent.id,
      kind: "neuron",
      hp: 60,
      connected: true,
    });
  const front = route[middle - 1];
  if (front !== undefined) human.priorities[String(front)] = 3;
  // A single experimental tower, with its six support cells, behind the human front.
  const candidate = route.slice(1, Math.max(1, middle - 1)).find((c) => {
    const ns = neighbors(world.map, c);
    return (
      ns.length === 6 &&
      ns.every(
        (n) =>
          world.map.cells[n]?.terrain === "open" &&
          !world.structures.some((s) => s.cell === n && s.ownerId !== human.id),
      )
    );
  });
  if (candidate !== undefined) {
    const tower = world.structures.find((s) => s.cell === candidate)!;
    tower.kind = "tower";
    tower.hp = 100;
    for (const n of neighbors(world.map, candidate))
      if (!world.structures.some((s) => s.cell === n))
        world.structures.push({
          id: world.nextEntityId++,
          cell: n,
          ownerId: human.id,
          kind: "neuron",
          hp: 60,
          connected: true,
        });
  }
}

export function labCommands(world: World): Command[] {
  const opponent = world.players.find((p) => p.id === "lab-opponent");
  if (!opponent?.alive || world.tick % 100 !== 0) return [];
  const enemies = world.structures.filter((s) => s.ownerId !== opponent.id);
  const front = world.structures
    .filter((s) => s.ownerId === opponent.id && s.connected)
    .sort((a, b) => {
      const pressure = (cell: number) =>
        neighbors(world.map, cell).filter((n) =>
          enemies.some((s) => s.cell === n),
        ).length;
      return pressure(b.cell) - pressure(a.cell) || a.cell - b.cell;
    })[0];
  return front
    ? [
        {
          playerId: opponent.id,
          sequence: opponent.sequence + 1,
          matchId: world.matchId,
          action: { type: "setPriority", cell: front.cell, weight: 3 },
        },
      ]
    : [];
}
