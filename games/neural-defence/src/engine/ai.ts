import {
  constructionDispatchAvailability,
  constructionQueueAvailability,
  constructionUpgradeSource,
  STRUCTURES,
  canAttack,
  attackCells,
  protectionCells,
  researchAvailability,
} from "./catalog.js";
import { neighbors, homeCellOrder } from "./map.js";
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
      attackCells(world.map, s.cell, s.kind),
    ]),
  );
  const threats = (cell: number) =>
    enemy.filter(
      (s) => s.connected && canAttack(s.kind) && reach.get(s.cell)!.has(cell),
    );
  // Strategic pursuit ignores orphan branches, but guns can still engage them
  // and paid construction. Match combat's actual targets when allocating ammo.
  const attackable = [
    ...world.structures
      .filter((s) => s.ownerId !== playerId)
      .map((s) => s.cell),
    ...world.players
      .filter((p) => p.id !== playerId)
      .flatMap((p) =>
        p.queue
          .filter((j) => j.paid && j.upgradeFrom === undefined)
          .map((j) => j.cell),
      ),
  ];
  const firing = (cell: number) =>
    attackable.some((target) => reach.get(cell)?.has(target));
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
  const isolated = world.structures.filter(
    (s) => s.ownerId === playerId && !s.connected,
  );
  const gaps = new Set(
    own
      .flatMap((s) => neighbors(world.map, s.cell))
      .filter(
        (cell) =>
          world.map.cells[cell]?.terrain === "open" &&
          !world.structures.some((s) => s.cell === cell) &&
          neighbors(world.map, cell).some((n) =>
            isolated.some((s) => s.cell === n),
          ),
      ),
  );
  const dormantRepairGuns = world.structures.filter(
    (s) =>
      s.ownerId !== playerId &&
      !s.connected &&
      canAttack(s.kind) &&
      [...gaps].some((cell) => reach.get(s.cell)!.has(cell)),
  );
  // Reserve one of the finite supply destinations for clearing a repair gap,
  // even when four frontline guns are closer to the connected enemy army.
  const counterbattery = armed
    .filter(
      (s) =>
        s.kind === "siege" &&
        dormantRepairGuns.some((target) => reach.get(s.cell)!.has(target.cell)),
    )
    .sort((a, b) => cellOrder(a.cell, b.cell))[0];
  const fighting = armed.filter(
    (s) =>
      firing(s.cell) ||
      [...protectionCells(world, s.kind, s.cell)].some(
        (cell) =>
          (own.some((target) => target.cell === cell) ||
            player.queue.some((job) => job.paid && job.cell === cell)) &&
          threats(cell).length > 0,
      ),
  );
  const targets = (fighting.length ? fighting : armed)
    .sort(
      (a, b) =>
        Number(b === counterbattery) - Number(a === counterbattery) ||
        distance(a.cell) -
          STRUCTURES[a.kind].range -
          (distance(b.cell) - STRUCTURES[b.kind].range) ||
        STRUCTURES[b.kind].volley - STRUCTURES[a.kind].volley ||
        cellOrder(a.cell, b.cell),
    )
    .slice(0, 4);
  // A protective anchor must be stocked before the first incoming salvo;
  // waiting until its neighbor is hit is too late for distant supply lines.
  const reserve = armed
    .filter(
      (s) =>
        STRUCTURES[s.kind].protection &&
        !targets.some((t) => t.cell === s.cell),
    )
    .sort(
      (a, b) =>
        distance(a.cell) - distance(b.cell) || cellOrder(a.cell, b.cell),
    )[0];
  if (reserve) {
    if (targets.length === 4) targets.pop();
    targets.push(reserve);
  }
  for (const cell of Object.keys(player.priorities).map(Number))
    if (!targets.some((s) => s.cell === cell))
      actions.push({ type: "setPriority", cell, weight: 0 });
  for (const target of targets) {
    const weight = target === reserve ? 1 : 3;
    if (player.priorities[target.cell] !== weight)
      actions.push({ type: "setPriority", cell: target.cell, weight });
  }
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
      // Queue the intended investment while saving. Falling back to cheap
      // conduits on every decision otherwise prevents specialists ever starting.
      constructionDispatchAvailability(world, player, {
        kind,
        cell,
        upgradeFrom: constructionUpgradeSource(world, player, kind, cell)?.id,
      }).missing.every((requirement) => requirement.kind === "resource");
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
    // After repeated losses, seek a safer approach instead of indefinitely
    // adding guns to the same front. A route may start with a sideways step,
    // so distance to the brain alone cannot choose the next conduit.
    if (player.statistics.sitesLost >= 2 || player.statistics.lost >= 8) {
      const costs = new Map<number, number>();
      const pending = new Set<number>();
      for (const s of enemy.filter((s) => s.kind === "brain")) {
        costs.set(s.cell, 0);
        pending.add(s.cell);
      }
      while (pending.size) {
        const cell = [...pending].sort(
          (a, b) => costs.get(a)! - costs.get(b)! || cellOrder(a, b),
        )[0]!;
        pending.delete(cell);
        // One movement step, six for each covering gun, twelve to clear an
        // occupied enemy cell. These are planning costs, never game damage.
        const crossing =
          1 +
          threats(cell).length * 6 +
          (world.structures.some(
            (s) => s.ownerId !== playerId && s.cell === cell,
          )
            ? 12
            : 0);
        for (const next of neighbors(world.map, cell)) {
          if (world.map.cells[next]?.terrain !== "open") continue;
          const cost = costs.get(cell)! + crossing;
          if (cost < (costs.get(next) ?? Infinity)) {
            costs.set(next, cost);
            pending.add(next);
          }
        }
      }
      const best = Math.min(...own.map((s) => costs.get(s.cell) ?? Infinity));
      const flanks = sites.filter(
        (cell) =>
          eligible("neuron", cell) &&
          !threats(cell).length &&
          (costs.get(cell) ?? Infinity) < best,
      );
      flanks.sort(
        (a, b) =>
          (costs.get(a) ?? Infinity) - (costs.get(b) ?? Infinity) ||
          cellOrder(a, b),
      );
      if (flanks[0] !== undefined) choice = { kind: "neuron", cell: flanks[0] };
    }
    // A dormant enemy gun can reactivate as soon as its own gap is repaired.
    // Repeatedly reconnecting with a fragile neuron creates a synchronized
    // cut/rebuild loop on narrow fronts; reserve a durable conduit instead.
    const repairKind = (cell: number): BuildKind => {
      const dormantThreat = world.structures.some(
        (s) =>
          s.ownerId !== playerId &&
          !s.connected &&
          canAttack(s.kind) &&
          reach.get(s.cell)!.has(cell),
      );
      if (dormantThreat) {
        if (eligible("bastion", cell)) return "bastion";
        if (eligible("tower", cell)) return "tower";
      }
      return "neuron";
    };
    const repairs = sites.filter(
      (cell) =>
        eligible(repairKind(cell), cell) &&
        threats(cell).length === 0 &&
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
    // Try durable repairs before escalating a supply cut into an artillery
    // fight. Clear dormant guns only after sustained attrition: at least three
    // losses and a loss count at least half the completed construction jobs
    // (including upgrades). This checkpointed attrition heuristic distinguishes
    // an isolated cut from a failing repair strategy.
    const repairThreats = world.structures.filter(
      (s) =>
        s.ownerId !== playerId &&
        !s.connected &&
        canAttack(s.kind) &&
        repairs.some((cell) => reach.get(s.cell)!.has(cell)),
    );
    if (
      repairThreats.length &&
      player.research.includes("ballistics") &&
      player.statistics.lost >= 3 &&
      player.statistics.lost * 2 >= player.statistics.built
    ) {
      const uncovered = repairThreats.filter(
        (target) =>
          !own.some(
            (s) => s.kind === "siege" && reach.get(s.cell)!.has(target.cell),
          ),
      );
      const artillerySites = sites.filter(
        (cell) =>
          eligible("siege", cell) &&
          !threats(cell).length &&
          !repairThreats.some((s) => reach.get(s.cell)!.has(cell)) &&
          uncovered.some((s) =>
            attackCells(world.map, cell, "siege").has(s.cell),
          ),
      );
      artillerySites.sort(
        (a, b) => brainDistance(a) - brainDistance(b) || cellOrder(a, b),
      );
      if (artillerySites[0] !== undefined)
        choice = { kind: "siege", cell: artillerySites[0] };
    }
    if (!choice && repairs[0] !== undefined)
      choice = { kind: repairKind(repairs[0]), cell: repairs[0] };
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
      anchors.length < 1 &&
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
    // Support artillery with the opening's close-range weapon when the front
    // has entered its blind spot. Siege/Economy use a Pulse tower for support.
    if (tower === "siege" && forward < (STRUCTURES.siege.minRange ?? 0))
      tower = policy.weapon === "siege" ? "tower" : policy.weapon;
    const firingSites = sites.filter((cell) => {
      if (!eligible(tower, cell)) return false;
      const cells = attackCells(world.map, cell, tower);
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
      choice = {
        kind:
          player.statistics.sitesLost >= 2 &&
          threats(firingSites[0]).length > 0 &&
          eligible("bastion", firingSites[0]) &&
          !own.some((s) =>
            protectionCells(world, s.kind, s.cell).has(firingSites[0]!),
          )
            ? "bastion"
            : tower,
        cell: firingSites[0],
      };
    // A short-range army with no admissible firing site must be able to
    // establish an artillery position outside the opposing weapon's reach.
    if (
      !choice &&
      armed.some((s) => s.kind !== "brain" && s.kind !== "neuron") &&
      STRUCTURES[tower].range < STRUCTURES.siege.range &&
      player.research.includes("ballistics")
    ) {
      const artillery = sites.filter((cell) => {
        if (!eligible("siege", cell) || threats(cell).length > 0) return false;
        const targets = attackCells(world.map, cell, "siege");
        return enemy.some((s) => targets.has(s.cell));
      });
      artillery.sort(
        (a, b) =>
          brainDistance(a) - brainDistance(b) ||
          distance(b) - distance(a) ||
          cellOrder(a, b),
      );
      if (artillery[0] !== undefined)
        choice = { kind: "siege", cell: artillery[0] };
    }
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
