import {
  constructionDispatchAvailability,
  constructionQueueAvailability,
  constructionUpgradeSource,
  STRUCTURES,
  canAttack,
  researchAvailability,
} from "./catalog.js";
import { neighbors, homeCellOrder, weaponCells } from "./map.js";
import type {
  Action,
  Command,
  Research,
  World,
  BuildKind,
  ParticleKind,
} from "./types.js";

import type { AiStrategy } from "./types.js";
export { AI_STRATEGIES, type AiStrategy } from "./types.js";
const openings: Record<
  AiStrategy,
  {
    research: readonly Research[];
    deposits: number;
    harvesters: number;
    weapon: BuildKind;
    profile: ParticleKind;
  }
> = {
  balanced: {
    research: ["growth", "excitation", "ballistics", "conduction", "resonance"],
    deposits: 7,
    harvesters: 1,
    weapon: "tower",
    profile: "heavy",
  },
  pressure: {
    research: ["growth", "excitation", "conduction", "ballistics", "resonance"],
    deposits: 3,
    harvesters: 0,
    weapon: "tower",
    profile: "pulse",
  },
  economy: {
    research: ["growth", "conduction", "excitation", "ballistics", "resonance"],
    deposits: 14,
    harvesters: 2,
    weapon: "siege",
    profile: "heavy",
  },
  siege: {
    research: ["excitation", "ballistics", "growth", "conduction", "resonance"],
    deposits: 5,
    harvesters: 0,
    weapon: "siege",
    profile: "heavy",
  },
  relay: {
    research: ["growth", "conduction", "resonance", "excitation", "ballistics"],
    deposits: 5,
    harvesters: 0,
    weapon: "relay",
    profile: "swift",
  },
  defensive: {
    research: ["growth", "excitation", "ballistics", "conduction", "resonance"],
    deposits: 5,
    harvesters: 0,
    weapon: "bastion",
    profile: "heavy",
  },
};

/** Stateless, public-information opponent. All decisions enter ordinary apply(). */
export function aiCommands(
  world: Readonly<World>,
  playerId: string,
  strategy: AiStrategy = "balanced",
): Command[] {
  const player = world.players.find((p) => p.id === playerId);
  if (!player?.alive || world.finished || world.tick % 20 !== 0) return [];
  const policy = openings[strategy];
  const cellOrder = (a: number, b: number) =>
    homeCellOrder(world.map, player.slot, a, b);
  const own = world.structures.filter(
    (s) => s.ownerId === playerId && s.connected,
  );
  // Orphaned enemy branches do not fire and should not pull the whole army
  // away from the brain and its living supply network.
  const enemy = world.structures.filter(
    (s) => s.ownerId !== playerId && s.connected,
  );
  if (!enemy.length) return [];
  const distances = new Map<number, number>();
  const frontier = enemy.map((s) => s.cell).sort(cellOrder);
  for (const cell of frontier) distances.set(cell, 0);
  for (const cell of frontier)
    for (const next of neighbors(world.map, cell)) {
      if (world.map.cells[next]?.terrain !== "open" || distances.has(next))
        continue;
      distances.set(next, distances.get(cell)! + 1);
      frontier.push(next);
    }
  const distance = (cell: number) =>
    distances.get(cell) ?? world.map.cells.length;
  const brainDistances = new Map<number, number>();
  const brainFrontier = enemy
    .filter((s) => s.kind === "brain")
    .map((s) => s.cell);
  for (const cell of brainFrontier) brainDistances.set(cell, 0);
  for (const cell of brainFrontier)
    for (const next of neighbors(world.map, cell)) {
      if (world.map.cells[next]?.terrain !== "open" || brainDistances.has(next))
        continue;
      brainDistances.set(next, brainDistances.get(cell)! + 1);
      brainFrontier.push(next);
    }
  const brainDistance = (cell: number) =>
    brainDistances.get(cell) ?? world.map.cells.length;
  const reach = new Map(
    world.structures.map((s) => [
      s.cell,
      weaponCells(world.map, s.cell, STRUCTURES[s.kind].range),
    ]),
  );
  const threats = (cell: number) =>
    enemy.filter(
      (s) => s.connected && canAttack(s.kind) && reach.get(s.cell)!.has(cell),
    );
  const firing = (cell: number) =>
    enemy.some((s) => reach.get(cell)?.has(s.cell));
  const actions: Action[] = [];
  for (const job of player.queue)
    if (
      !neighbors(world.map, job.cell).some((cell) =>
        own.some((s) => s.cell === cell),
      ) ||
      world.structures.some(
        (s) => s.cell === job.cell && s.id !== job.upgradeFrom,
      )
    )
      actions.push({ type: "cancelConstruction", cell: job.cell });

  const forward = Math.min(...own.map((s) => distance(s.cell)));
  const artilleryThreat = enemy.some(
    (s) =>
      s.connected &&
      s.kind === "siege" &&
      own.some((o) =>
        [o.cell, ...neighbors(world.map, o.cell)].some((cell) =>
          reach.get(s.cell)!.has(cell),
        ),
      ),
  );
  const profile = artilleryThreat ? "heavy" : policy.profile;
  const unlocked =
    profile === "pulse" ||
    player.research.includes(profile === "heavy" ? "ballistics" : "resonance");
  if (unlocked && profile !== player.particleKind)
    actions.push({ type: "setParticleKind", kind: profile });

  // Active guns receive ammunition before reserves; economic conduits never do.
  const armed = own.filter((s) => canAttack(s.kind));
  const fighting = armed.filter((s) => firing(s.cell));
  const targets = (fighting.length ? fighting : armed)
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
  const research = policy.research.find(
    (kind) => !player.research.includes(kind),
  );
  if (research && researchAvailability(player, research).allowed)
    actions.push({ type: "startResearch", research });

  if (!player.queue.length && player.worker.mode === "idle") {
    const sites = [
      ...new Set(own.flatMap((s) => neighbors(world.map, s.cell))),
    ];
    const eligible = (kind: BuildKind, cell: number) =>
      constructionQueueAvailability(world, player, kind, cell).allowed &&
      constructionDispatchAvailability(world, player, {
        kind,
        cell,
        upgradeFrom: constructionUpgradeSource(world, player, kind, cell)?.id,
      }).allowed;
    const deposits = (cell: number) =>
      neighbors(world.map, cell).filter(
        (n) => world.map.cells[n]?.terrain === "deposit",
      );
    const specialistSites = sites.filter(
      (cell) =>
        eligible("harvester", cell) &&
        !threats(cell).length &&
        deposits(cell).some(
          (deposit) =>
            !own.some(
              (s) =>
                (STRUCTURES[s.kind].miningBonus ?? 0) > 0 &&
                neighbors(world.map, deposit).includes(s.cell),
            ),
        ),
    );
    specialistSites.sort(
      (a, b) =>
        deposits(b).length - deposits(a).length ||
        distance(b) - distance(a) ||
        cellOrder(a, b),
    );
    let choice: { kind: BuildKind; cell: number } | undefined;
    const isolated = world.structures.filter(
      (s) => s.ownerId === playerId && !s.connected,
    );
    const repairs = sites.filter(
      (cell) =>
        eligible("neuron", cell) &&
        threats(cell).length <= 1 &&
        neighbors(world.map, cell).some((n) =>
          isolated.some((s) => s.cell === n),
        ),
    );
    const repairValue = (cell: number) =>
      isolated
        .filter((s) => neighbors(world.map, cell).includes(s.cell))
        .reduce((value, s) => value + STRUCTURES[s.kind].hp, 0);
    repairs.sort(
      (a, b) =>
        repairValue(b) - repairValue(a) ||
        threats(a).length - threats(b).length ||
        cellOrder(a, b),
    );
    if (repairs[0] !== undefined) choice = { kind: "neuron", cell: repairs[0] };
    if (
      !choice &&
      own.filter((s) => s.kind === "harvester").length < policy.harvesters &&
      specialistSites[0] !== undefined &&
      (forward > 3 || fighting.length > 0)
    )
      choice = { kind: "harvester", cell: specialistSites[0] };
    let tower: BuildKind = policy.weapon;
    // Establish a supplied anchor before the enemy reaches it, then use
    // artillery behind that line. A range-one bunker cannot advance by itself.
    const anchors = own.filter((s) => s.kind === "bastion");
    if (
      !choice &&
      strategy === "defensive" &&
      anchors.length < 2 &&
      forward <= 5
    ) {
      const fortifications = sites.filter(
        (cell) =>
          eligible("bastion", cell) &&
          distance(cell) >= 2 &&
          distance(cell) <= 3 &&
          !threats(cell).length &&
          !anchors.some((s) => neighbors(world.map, s.cell).includes(cell)),
      );
      fortifications.sort(
        (a, b) =>
          distance(a) - distance(b) ||
          brainDistance(a) - brainDistance(b) ||
          cellOrder(a, b),
      );
      if (fortifications[0] !== undefined)
        choice = { kind: "bastion", cell: fortifications[0] };
    }
    if (
      (artilleryThreat ||
        (strategy === "balanced" && forward <= 4) ||
        (strategy === "defensive" && anchors.length > 0)) &&
      player.research.includes("ballistics")
    )
      tower = "siege";
    if (tower === "siege" && !player.research.includes("ballistics"))
      tower = "tower";
    if (tower === "relay" && !player.research.includes("resonance"))
      tower = "tower";
    if (tower === "bastion" && !player.research.includes("growth"))
      tower = "tower";
    const firingSites = sites.filter((cell) => {
      if (!eligible(tower, cell)) return false;
      const cells = weaponCells(world.map, cell, STRUCTURES[tower].range);
      return enemy.some((s) => cells.has(s.cell));
    });
    firingSites.sort(
      (a, b) =>
        threats(a).length - threats(b).length ||
        brainDistance(a) - brainDistance(b) ||
        distance(b) - distance(a) ||
        cellOrder(a, b),
    );
    if (
      !choice &&
      firingSites[0] !== undefined &&
      (!threats(firingSites[0]).length ||
        fighting.length > 0 ||
        tower === "siege" ||
        tower === "bastion")
    )
      choice = { kind: tower, cell: firingSites[0] };
    if (!choice) {
      const candidates = sites.filter(
        (cell) => eligible("neuron", cell) && !threats(cell).length,
      );
      const score = (cell: number) =>
        distance(cell) * 4 +
        brainDistance(cell) -
        deposits(cell).length * policy.deposits;
      candidates.sort((a, b) => score(a) - score(b) || cellOrder(a, b));
      if (candidates[0] !== undefined)
        choice = { kind: "neuron", cell: candidates[0] };
    }
    if (choice) actions.push({ type: "queueConstruction", ...choice });
  }
  return actions.map((action, index) => ({
    playerId,
    matchId: world.matchId,
    sequence: player.sequence + index + 1,
    action,
  }));
}
