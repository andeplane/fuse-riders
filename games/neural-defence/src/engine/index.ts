import {
  hasBuff,
  isBuffKind,
  isPowerupKind,
  POWERUP_RULES,
  powerupPhase,
  powerupDraw,
} from "./powerups.js";
import {
  DOMINANCE_LEAD,
  dominanceCells,
  territoryCounts,
  territoryPhase,
} from "./territory.js";
import { EVENT_TYPES, recordTimeline, TIMELINE } from "./timeline.js";
import { loadMap, neighbors, homeCellOrder, homeOrder } from "./map.ts";
import { autoExpandCell } from "./auto-expand.js";
import {
  CONSTRUCTIONS,
  RESEARCH,
  STRUCTURES,
  PARTICLES,
  canAttack,
  attackCells,
  protectionCells,
  depositContribution,
  constructionSiteRequirements,
  particleProfile,
  isParticleKind,
  researchPrerequisites,
  constructionQueueAvailability,
  constructionUpgradeSource,
  constructionDispatchAvailability,
  constructionDuration,
  constructionDurations,
  isSprout,
  sproutSlots,
  SPROUT,
  researchAvailability,
  isBuildKind,
  isResearchKind,
} from "./catalog.js";
import {
  RULES,
  isAiStrategy,
  type Action,
  type Command,
  type Construction,
  type MatchSettings,
  type Player,
  type RosterEntry,
  type Structure,
  type World,
  type MapDefinition,
} from "./types.ts";
export * from "./types.ts";
export { loadMap, neighbors } from "./map.ts";
export * from "./powerups.js";
export * from "./territory.js";
export * from "./timeline.js";
export { SPROUT, isSprout, sproutSlots } from "./catalog.js";
const clone = <T>(v: T): T => structuredClone(v);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (
  n: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const hp = (kind: Structure["kind"]) => STRUCTURES[kind].hp;
const structure = (w: World, cell: number) =>
  w.structures.find((s) => s.cell === cell);
const brain = (w: World, p: Player) =>
  w.structures.find((s) => s.ownerId === p.id && s.kind === "brain");
function emit(
  w: World,
  p: Player,
  type: World["outcomes"][number]["type"],
  extra: Partial<World["outcomes"][number]> = {},
) {
  w.outcomes.push({ tick: w.tick, playerId: p.id, type, ...extra });
}
export function createMatch(
  raw: MapDefinition,
  settings: MatchSettings = {},
  roster: RosterEntry[] = [{ id: "player-1", slot: 0 }],
): World {
  const map = loadMap(raw);
  if (
    roster.length < 1 ||
    roster.length > RULES.maxPlayers ||
    new Set(roster.map((p) => p.id)).size !== roster.length ||
    new Set(roster.map((p) => p.slot)).size !== roster.length ||
    roster.some(
      (p) =>
        !/^[-a-zA-Z0-9_]{1,64}$/.test(p.id) ||
        !map.spawns.some((s) => s.slot === p.slot),
    )
  )
    throw new Error("roster: invalid players or spawn assignments");
  if (
    !record(settings) ||
    Object.keys(settings).some(
      (k) =>
        ![
          "instantConstruction",
          "instantResearch",
          "matchId",
          "aiStrategy",
          "powerups",
        ].includes(k),
    ) ||
    (settings.powerups !== undefined &&
      typeof settings.powerups !== "boolean") ||
    (settings.aiStrategy !== undefined && !isAiStrategy(settings.aiStrategy)) ||
    (settings.instantConstruction !== undefined &&
      typeof settings.instantConstruction !== "boolean") ||
    (settings.instantResearch !== undefined &&
      typeof settings.instantResearch !== "boolean") ||
    (settings.matchId !== undefined &&
      (typeof settings.matchId !== "string" || settings.matchId.length > 128))
  )
    throw new Error("settings: invalid");
  const w: World = {
    formatVersion: 1,
    rulesVersion: RULES.version,
    matchId: settings.matchId ?? "sandbox",
    tick: 0,
    map,
    settings: clone(settings),
    players: [],
    structures: [],
    particles: [],
    nextEntityId: 1,
    powerups: [],
    powerupSerial: 0,
    outcomes: [],
    victory: null,
    timeline: [],
    events: [],
    winnerId: null,
    finished: false,
  };
  for (const r of [...roster].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const cell = map.spawns.find((s) => s.slot === r.slot)!.cellIndex;
    w.players.push({
      ...r,
      alive: true,
      autoExpand: false,
      particleKind: "pulse",
      biomass: 60_000,
      insight: 0,
      sequence: -1,
      queue: [],
      worker: {
        mode: "idle",
        cell,
        from: cell,
        to: cell,
        departedAt: 0,
        arrivesAt: 0,
        recoverAt: 0,
      },
      research: [],
      researchJob: null,
      priorities: {},
      miningRemainders: {},
      statistics: {
        biomassEarned: 0,
        insightEarned: 0,
        built: 0,
        damage: 0,
        lost: 0,
        sitesLost: 0,
      },
      buffs: [],
      territory: 0,
      dominanceSince: null,
    });
    w.structures.push({
      id: w.nextEntityId++,
      cell,
      ownerId: r.id,
      kind: "brain",
      hp: 240,
      connected: true,
    });
    for (let i = 0; i < RULES.particleCount; i++)
      w.particles.push({
        kind: "pulse",
        id: w.nextEntityId++,
        ownerId: r.id,
        cell,
        destination: cell,
        from: cell,
        to: cell,
        departedAt: 0,
        arrivesAt: 0,
        recoverAt: 0,
        mode: "stationed",
        attack: 2,
        speed: RULES.particleSpeed,
      });
  }
  return w;
}
/** Structures by cell; a cell holds at most one. Valid until structures change. */
type CellIndex = ReadonlyMap<number, Structure>;
const cellIndex = (w: World): CellIndex =>
  new Map(w.structures.map((s) => [s.cell, s]));
function connectivity(w: World) {
  const at = cellIndex(w);
  for (const s of w.structures) s.connected = false;
  for (const p of w.players) {
    const b = brain(w, p);
    if (!b) continue;
    const queue = [b];
    b.connected = true;
    for (const s of queue)
      for (const n of neighbors(w.map, s.cell)) {
        const next = at.get(n);
        if (next && next.ownerId === p.id && !next.connected) {
          next.connected = true;
          queue.push(next);
        }
      }
  }
}
function path(
  w: World,
  p: Player,
  from: number,
  to: number,
  index: CellIndex = cellIndex(w),
): number[] | null {
  const start = index.get(from);
  if (!start || start.ownerId !== p.id || !start.connected) return null;
  const order = homeOrder(w.map, p.slot);
  const queue = [[from]],
    seen = new Set([from]);
  for (const route of queue) {
    const at = route[route.length - 1]!;
    if (at === to) return route;
    for (const n of neighbors(w.map, at).sort(order)) {
      const s = index.get(n);
      if (s?.connected && s.ownerId === p.id && !seen.has(n)) {
        seen.add(n);
        queue.push([...route, n]);
      }
    }
  }
  return null;
}
export function isAction(raw: unknown): raw is Action {
  const a = raw as Action;
  if (!a || typeof a !== "object") return false;
  const keys: Record<Action["type"], string[]> = {
    setParticleKind: ["type", "kind"],
    setAutoExpand: ["type", "enabled"],
    queueConstruction: ["type", "cell", "kind"],
    cancelConstruction: ["type", "cell"],
    setPriority: ["type", "cell", "weight"],
    startResearch: ["type", "research"],
    cancelResearch: ["type"],
  };
  if (
    !Object.hasOwn(keys, a.type) ||
    Object.keys(a).some((k) => !keys[a.type].includes(k))
  )
    return false;
  switch (a.type) {
    case "setParticleKind":
      return isParticleKind(a.kind);
    case "setAutoExpand":
      return typeof a.enabled === "boolean";
    case "queueConstruction":
      return integer(a.cell) && isBuildKind(a.kind);
    case "cancelConstruction":
      return integer(a.cell);
    case "setPriority":
      return integer(a.cell) && integer(a.weight, 0, 3);
    case "startResearch":
      return isResearchKind(a.research);
    case "cancelResearch":
      return true;
    default:
      return false;
  }
}
function apply(w: World, c: Command) {
  const p = w.players.find((p) => p.id === c.playerId);
  if (!p) return;
  const reject = (reason: string) => emit(w, p, "rejected", { reason });
  if (
    !integer(c.sequence) ||
    !isAction(c.action) ||
    (c.matchId !== undefined && c.matchId !== w.matchId)
  ) {
    reject("invalid command");
    return;
  }
  if (c.sequence <= p.sequence) return;
  p.sequence = c.sequence;
  if (!p.alive) {
    reject("player eliminated");
    return;
  }
  const a = c.action;
  if (a.type === "setAutoExpand") {
    p.autoExpand = a.enabled;
  } else if (a.type === "queueConstruction") {
    if (!constructionQueueAvailability(w, p, a.kind, a.cell).allowed) {
      reject("invalid construction cell or full queue");
      return;
    }
    p.queue.push({
      ...(constructionUpgradeSource(w, p, a.kind, a.cell)
        ? { upgradeFrom: constructionUpgradeSource(w, p, a.kind, a.cell)!.id }
        : {}),
      cell: a.cell,
      kind: a.kind,
      paid: false,
      progress: 0,
      duration: 0,
      hp: hp(a.kind),
    });
    emit(w, p, "queued", { cell: a.cell });
  } else if (a.type === "cancelConstruction") {
    const i = p.queue.findIndex((j) => j.cell === a.cell);
    if (i < 0) {
      reject("no owned construction");
      return;
    }
    const j = p.queue[i]!;
    p.queue.splice(i, 1);
    // Delivered work is spent; queued ghosts cost nothing. Only the builder's
    // own job sends it home: sprouts never use it, and a recovering builder
    // keeps its penalty.
    if (j.paid && !isSprout(j) && p.worker.mode !== "recovering")
      p.worker.mode = "returning";
  } else if (a.type === "setPriority") {
    // Clearing an old destination must remain possible after its destruction.
    if (a.weight === 0) {
      delete p.priorities[String(a.cell)];
      return;
    }
    const s = structure(w, a.cell);
    if (
      !s ||
      s.ownerId !== p.id ||
      !canAttack(s.kind) ||
      (!Object.hasOwn(p.priorities, String(a.cell)) &&
        Object.keys(p.priorities).length >= 8 &&
        a.weight > 0)
    ) {
      reject("invalid priority destination");
      return;
    }
    p.priorities[String(a.cell)] = a.weight;
  } else if (a.type === "setParticleKind") {
    if (researchPrerequisites(p, PARTICLES[a.kind].requires).length) {
      reject("particle profile unavailable");
      return;
    }
    p.particleKind = a.kind;
  } else if (a.type === "startResearch") {
    if (!researchAvailability(p, a.research).allowed) {
      reject("research unavailable");
      return;
    }
    const definition = RESEARCH[a.research];
    p.insight -= definition.cost;
    p.researchJob = {
      kind: a.research,
      completesAt:
        w.tick + (w.settings.instantResearch ? 0 : definition.duration),
    };
    emit(w, p, "researchStarted", {
      amount: definition.cost,
      resource: "insight",
    });
  } else if (a.type === "cancelResearch") {
    p.researchJob = null;
  }
}
function economy(w: World, p: Player) {
  const initialBiomass = p.biomass,
    initialInsight = p.insight;
  const add = (kind: "biomass" | "insight", amount: number) => {
    const actual = Math.min(amount, RULES.bankCap - p[kind]);
    p[kind] += actual;
    p.statistics[kind === "biomass" ? "biomassEarned" : "insightEarned"] +=
      actual;
  };
  add("biomass", 50);
  add("insight", 25);
  w.map.cells.forEach((cell, index) => {
    if (cell.terrain !== "deposit") return;
    const n = depositContribution(w, p.id, index);
    const numerator =
      (p.miningRemainders[index] ?? 0) +
      (cell.resourceKind === "biomass" ? 6000 : 3000) * n;
    add(cell.resourceKind, Math.floor(numerator / 120));
    p.miningRemainders[index] = numerator % 120;
  });
  if (p.researchJob && p.researchJob.completesAt <= w.tick) {
    p.research.push(p.researchJob.kind);
    emit(w, p, "researched", { reason: p.researchJob.kind });
    p.researchJob = null;
  }
  emit(w, p, "income", {
    resource: "biomass",
    amount: p.biomass - initialBiomass,
  });
  emit(w, p, "income", {
    resource: "insight",
    amount: p.insight - initialInsight,
  });
}
function prepareWorker(w: World, p: Player): boolean {
  const b = brain(w, p);
  if (!b) return false;
  const worker = p.worker;
  const recover = () => {
    worker.mode = "recovering";
    worker.recoverAt = w.tick + RULES.recoveryTicks;
  };
  if (worker.mode === "recovering") {
    if (w.tick < worker.recoverAt) return false;
    worker.cell = b.cell;
    worker.to = b.cell;
    worker.from = b.cell;
    worker.arrivesAt = w.tick;
    worker.mode = p.queue.some((j) => j.paid && !isSprout(j))
      ? "outbound"
      : "idle";
  }
  // Check both endpoints before waiting or arriving: an alternate route to the
  // destination does not repair the edge on which this builder was travelling.
  if (worker.to !== worker.cell) {
    const from = structure(w, worker.from),
      to = structure(w, worker.to);
    if (
      !from?.connected ||
      !to?.connected ||
      from.ownerId !== p.id ||
      to.ownerId !== p.id
    ) {
      recover();
      return false;
    }
  }
  if (worker.arrivesAt > w.tick) return false;
  if (worker.to !== worker.cell) {
    worker.cell = worker.to;
    worker.from = worker.cell;
  }
  if (!path(w, p, worker.cell, b.cell)) {
    recover();
    return false;
  }
  return true;
}
/**
 * A seat's place in this tick's construction precedence; the lowest wins a
 * contested claim. Each tick shuffles every seat by hashing the match, tick
 * and slot, so any two seats are equally likely to come first, whatever the
 * number of players and however regular their timing (the AI acts every 20
 * ticks), and matches do not all resolve their first contest the same way. A
 * rotation is not enough: with four players, neighbours in the rotation win
 * three ties in four against each other.
 */
export function claimPrecedence(
  matchId: string,
  tick: number,
  slot: number,
): number {
  return powerupDraw(matchId, tick, 1000 + slot);
}
function dispatchConstruction(w: World, ready: Player[]) {
  // Collect claims against one shared pre-dispatch board. Contested claims go
  // by claimPrecedence, a per-tick shuffle of seats, so renaming players
  // cannot buy construction priority.
  const rank = (p: Player) => claimPrecedence(w.matchId, w.tick, p.slot);
  // The builder takes one tower or upgrade at a time; neurons sprout from the
  // network into every free sprout slot.
  const claims = w.players
    .filter((p) => p.alive)
    .flatMap((p) => {
      const out: { p: Player; job: Construction }[] = [];
      if (
        ready.includes(p) &&
        p.worker.mode === "idle" &&
        !p.queue.some((j) => j.paid && !isSprout(j))
      ) {
        const job = p.queue.find(
          (j) =>
            !j.paid &&
            !isSprout(j) &&
            constructionDispatchAvailability(w, p, j).allowed,
        );
        if (job) out.push({ p, job });
      }
      let free =
        sproutSlots(p) - p.queue.filter((j) => j.paid && isSprout(j)).length;
      for (const job of p.queue) {
        if (free <= 0) break;
        if (
          !job.paid &&
          isSprout(job) &&
          constructionDispatchAvailability(w, p, job).allowed
        ) {
          out.push({ p, job });
          free--;
        }
      }
      return out;
    })
    .sort((a, b) => rank(a.p) - rank(b.p));
  const claimed = new Set<number>();
  for (const { p, job } of claims) {
    const cost = CONSTRUCTIONS[job.kind].cost;
    if (claimed.has(job.cell) || p.biomass < cost) continue;
    claimed.add(job.cell);
    p.biomass -= cost;
    job.paid = true;
    job.duration = constructionDuration(w, p, job.kind);
    if (!isSprout(job)) p.worker.mode = "outbound";
    emit(w, p, "dispatched", {
      cell: job.cell,
      amount: cost,
      resource: "biomass",
    });
  }
}
function worker(w: World, p: Player) {
  const b = brain(w, p)!;
  const worker = p.worker;
  const job = p.queue.find((j) => j.paid && !isSprout(j));
  const move = (target: number) => {
    const route = path(w, p, worker.cell, target);
    if (!route) {
      worker.mode = "recovering";
      worker.recoverAt = w.tick + RULES.recoveryTicks;
      return;
    }
    if (route.length > 1) {
      worker.from = worker.cell;
      worker.to = route[1]!;
      worker.departedAt = w.tick;
      worker.arrivesAt = w.tick + (p.research.includes("conduction") ? 3 : 4);
    }
  };
  if (worker.mode === "returning" || !job) {
    worker.mode = "returning";
    if (worker.cell === b.cell) {
      worker.mode = "idle";
      worker.to = b.cell;
    } else move(b.cell);
    return;
  }
  const anchors = neighbors(w.map, job.cell)
    .map((c) => path(w, p, worker.cell, c))
    .filter((r): r is number[] => r !== null)
    .sort(
      (a, b) =>
        a.length - b.length ||
        homeCellOrder(w.map, p.slot, a[a.length - 1]!, b[b.length - 1]!),
    );
  if (!anchors.length) return;
  const target = anchors[0]![anchors[0]!.length - 1]!;
  if (worker.cell !== target) {
    move(target);
    return;
  }
  worker.mode = "building";
  job.progress += hasBuff(p, "surge", w.tick) ? 2 : 1;
  if (job.progress >= job.duration) {
    const source =
      job.upgradeFrom === undefined
        ? undefined
        : w.structures.find((s) => s.id === job.upgradeFrom);
    if (source) {
      const fraction = source.hp / hp(source.kind);
      source.kind = job.kind;
      source.hp = Math.max(1, Math.floor(hp(job.kind) * fraction));
      delete source.firingCursor;
      if (!canAttack(source.kind)) delete p.priorities[String(source.cell)];
    } else
      w.structures.push({
        id: w.nextEntityId++,
        cell: job.cell,
        ownerId: p.id,
        kind: job.kind,
        hp: job.hp,
        connected: true,
      });
    p.queue.splice(p.queue.indexOf(job), 1);
    p.statistics.built++;
    emit(w, p, "constructed", { cell: job.cell });
    worker.mode = "returning";
  }
}
/** Paid neurons grow while they touch this player's connected network. */
function sprouts(w: World, p: Player) {
  for (const job of p.queue.filter((j) => j.paid && isSprout(j))) {
    const anchored = neighbors(w.map, job.cell).some((cell) =>
      w.structures.some(
        (s) => s.cell === cell && s.ownerId === p.id && s.connected,
      ),
    );
    if (!anchored) continue;
    job.progress += hasBuff(p, "surge", w.tick) ? 2 : 1;
    if (job.progress < job.duration) continue;
    w.structures.push({
      id: w.nextEntityId++,
      cell: job.cell,
      ownerId: p.id,
      kind: job.kind,
      hp: job.hp,
      connected: true,
    });
    p.queue.splice(p.queue.indexOf(job), 1);
    p.statistics.built++;
    emit(w, p, "constructed", { cell: job.cell });
  }
}
function recoverParticle(w: World, particle: World["particles"][number]) {
  particle.mode = "recovering";
  particle.recoverAt =
    w.tick + PARTICLES[particle.kind].recovery + particle.speed;
}
function particles(w: World, p: Player, edgeLaunch: Map<string, number>) {
  const b = brain(w, p);
  if (!b) return;
  const all = w.particles.filter((q) => q.ownerId === p.id);
  for (const q of all) {
    if (q.mode === "recovering") {
      if (q.recoverAt > w.tick) continue;
      q.cell = b.cell;
      q.mode = "stationed";
      q.destination = b.cell;
      Object.assign(q, particleProfile(p));
    }
    if (q.mode === "transit") {
      const from = structure(w, q.from),
        to = structure(w, q.to);
      if (
        !from?.connected ||
        !to?.connected ||
        from.ownerId !== p.id ||
        to.ownerId !== p.id
      ) {
        recoverParticle(w, q);
        continue;
      }
      if (q.arrivesAt > w.tick) continue;
      q.cell = q.to;
      q.mode = "stationed";
    }
    if (!structure(w, q.cell)?.connected) {
      recoverParticle(w, q);
      continue;
    }
  }
  const destinations = Object.entries(p.priorities)
    .map(([cell, weight]) => ({ cell: Number(cell), weight, count: 0 }))
    .filter(
      (d) =>
        structure(w, d.cell)?.connected &&
        structure(w, d.cell)?.ownerId === p.id,
    )
    .sort((a, b) => homeCellOrder(w.map, p.slot, a.cell, b.cell));
  const targets = new Map<number, number>();
  for (let i = 0; i < all.filter((q) => q.mode !== "recovering").length; i++) {
    const options = destinations.filter(
      (d) => d.count < (d.cell === b.cell ? 128 : RULES.nodeCapacity),
    );
    options.sort(
      (a, b) =>
        (a.count + 1) * b.weight - (b.count + 1) * a.weight ||
        homeCellOrder(w.map, p.slot, a.cell, b.cell),
    );
    const best = options[0];
    if (!best) break;
    best.count++;
    targets.set(best.cell, best.count);
  }
  targets.set(
    b.cell,
    (targets.get(b.cell) ?? 0) +
      all.filter((q) => q.mode !== "recovering").length -
      [...targets.values()].reduce((a, b) => a + b, 0),
  );
  const assignments = new Map<number, number>();
  for (const q of all)
    if (q.mode !== "recovering")
      assignments.set(q.destination, (assignments.get(q.destination) ?? 0) + 1);
  for (const q of all) {
    if (q.mode === "recovering") continue;
    if (
      (assignments.get(q.destination) ?? 0) > (targets.get(q.destination) ?? 0)
    ) {
      const destination =
        [...targets].find(
          ([cell, count]) => (assignments.get(cell) ?? 0) < count,
        )?.[0] ?? b.cell;
      assignments.set(q.destination, (assignments.get(q.destination) ?? 1) - 1);
      q.destination = destination;
      assignments.set(destination, (assignments.get(destination) ?? 0) + 1);
    }
  }
  // Rotate arbitration to avoid permanently privileging low particle IDs.
  const ordered = [...all.slice(w.tick % 128), ...all.slice(0, w.tick % 128)];
  // Structures do not change while particles move, so the index and the
  // routes between cells hold for the whole pass. Edge and arrival counts are
  // kept as particles launch, matching a fresh count at every decision.
  const index = cellIndex(w);
  const routes = new Map<string, number[] | null>();
  const edgeOf = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const transitsOn = new Map<string, number>();
  for (const a of w.particles)
    if (a.mode === "transit") {
      const edge = edgeOf(a.from, a.to);
      transitsOn.set(edge, (transitsOn.get(edge) ?? 0) + 1);
    }
  const arriving = new Map<number, number>();
  for (const a of all) {
    const cell =
      a.mode === "stationed" ? a.cell : a.mode === "transit" ? a.to : null;
    if (cell !== null) arriving.set(cell, (arriving.get(cell) ?? 0) + 1);
  }
  for (const q of ordered) {
    if (
      q.mode !== "stationed" ||
      q.cell === q.destination ||
      q.arrivesAt === w.tick
    )
      continue;
    if (q.cell === b.cell) {
      Object.assign(q, particleProfile(p));
    }
    const key = `${q.cell}>${q.destination}`;
    if (!routes.has(key))
      routes.set(key, path(w, p, q.cell, q.destination, index));
    const route = routes.get(key);
    if (!route || route.length < 2) continue;
    const next = route[1]!,
      edge = edgeOf(q.cell, next);
    if (
      (edgeLaunch.get(edge) ?? 0) >= RULES.edgeLaunchCapacity ||
      (transitsOn.get(edge) ?? 0) >= RULES.edgeTransitCapacity ||
      (arriving.get(next) ?? 0) >= 128
    )
      continue;
    edgeLaunch.set(edge, (edgeLaunch.get(edge) ?? 0) + 1);
    transitsOn.set(edge, (transitsOn.get(edge) ?? 0) + 1);
    arriving.set(q.cell, (arriving.get(q.cell) ?? 0) - 1);
    arriving.set(next, (arriving.get(next) ?? 0) + 1);
    q.from = q.cell;
    q.to = next;
    q.departedAt = w.tick;
    q.arrivesAt = w.tick + q.speed;
    q.mode = "transit";
  }
}
function combat(w: World) {
  const hits = new Map<number, number>();
  const siteHits = new Map<string, number>();
  const shots: {
    player: Player;
    from: number;
    cell: number;
    owner: string;
    site: boolean;
    id: number;
    damage: number;
  }[] = [];
  for (const s of w.structures) {
    const weapon = STRUCTURES[s.kind];
    if (!s.connected || !canAttack(s.kind)) continue;
    const p = w.players.find((p) => p.id === s.ownerId)!;
    // Synaptic frenzy halves the time between volleys.
    const cadence = hasBuff(p, "frenzy", w.tick)
      ? Math.max(1, Math.floor(weapon.cadence / 2))
      : weapon.cadence;
    if (w.tick % cadence !== 0) continue;
    const cells = attackCells(w.map, s.cell, s.kind);
    const targets = [
      ...w.structures
        .filter((t) => t.ownerId !== s.ownerId && cells.has(t.cell))
        .map((t) => ({
          cell: t.cell,
          hp: t.hp,
          id: t.id,
          owner: t.ownerId,
          site: false,
          priority:
            t.kind === "brain"
              ? 0
              : t.connected &&
                  canAttack(t.kind) &&
                  attackCells(w.map, t.cell, t.kind).has(s.cell)
                ? 1
                : 2,
        })),
      ...w.players
        .filter((o) => o.id !== p.id)
        .flatMap((o) =>
          o.queue
            .filter(
              (j) => j.paid && j.upgradeFrom === undefined && cells.has(j.cell),
            )
            .map((j) => ({
              cell: j.cell,
              hp: j.hp,
              id: -1,
              owner: o.id,
              site: true,
              priority: 3,
            })),
        ),
    ];
    // Splash weapons aim where the burst hits most: the target with the most
    // enemy structures beside it. Others finish the weakest target first.
    const cluster = (cell: number) =>
      weapon.splashPercent
        ? neighbors(w.map, cell).filter((n) =>
            w.structures.some((t) => t.cell === n && t.ownerId !== s.ownerId),
          ).length
        : 0;
    const density = new Map(targets.map((t) => [t.cell, cluster(t.cell)]));
    targets.sort(
      (a, b) =>
        a.priority - b.priority ||
        density.get(b.cell)! - density.get(a.cell)! ||
        a.hp - b.hp ||
        homeCellOrder(w.map, p.slot, a.cell, b.cell),
    );
    const equal = targets.filter(
      (t) =>
        t.priority === targets[0]?.priority &&
        density.get(t.cell) === density.get(targets[0]!.cell) &&
        t.hp === targets[0]?.hp,
    );
    const target = equal[(s.firingCursor ?? 0) % equal.length];
    if (!target) continue;
    const ammo = w.particles
      .filter(
        (q) =>
          q.ownerId === s.ownerId &&
          q.mode === "stationed" &&
          q.cell === s.cell &&
          q.destination === s.cell,
      )
      .slice(0, weapon.volley);
    const damage = ammo.reduce((sum, q) => sum + q.attack, 0);
    if (!damage) continue;
    s.firingCursor = (s.firingCursor ?? 0) + 1;
    for (const q of ammo) recoverParticle(w, q);
    shots.push({ player: p, from: s.cell, ...target, damage });
    // Spores burst on impact: every enemy structure beside the target is hit too.
    const splash = Math.floor((damage * (weapon.splashPercent ?? 0)) / 100);
    if (splash > 0)
      for (const cell of neighbors(w.map, target.cell)) {
        const t = w.structures.find(
          (t) => t.cell === cell && t.ownerId !== s.ownerId,
        );
        if (t)
          shots.push({
            player: p,
            from: s.cell,
            cell: t.cell,
            owner: t.ownerId,
            site: false,
            id: t.id,
            damage: splash,
          });
      }
  }
  // Resolve protection after every gun reserves its salvo. A particle cannot
  // fire and shield in the same tick. Protectors and victims remain alive until
  // simultaneous damage is applied, as with offensive fire.
  // Spend shared protection on brain attacks first, then strongest salvos.
  // Home-relative cell ties preserve swapped-seat symmetry and make allocation
  // independent of structure-array insertion order.
  shots.sort((a, b) => {
    if (a.owner !== b.owner) return a.owner < b.owner ? -1 : 1;
    const slot = w.players.find((p) => p.id === a.owner)!.slot;
    const priority = (shot: typeof a) =>
      w.structures.find((s) => s.id === shot.id)?.kind === "brain" ? 0 : 1;
    return (
      priority(a) - priority(b) ||
      b.damage - a.damage ||
      homeCellOrder(w.map, slot, a.cell, b.cell) ||
      homeCellOrder(w.map, slot, a.from, b.from)
    );
  });
  for (const shot of shots) {
    let damage = shot.damage;
    const owner = w.players.find((p) => p.id === shot.owner)!;
    const protectors = w.structures
      .filter(
        (s) =>
          s.ownerId === owner.id &&
          s.connected &&
          protectionCells(w, s.kind, s.cell).has(shot.cell),
      )
      .sort((a, b) => homeCellOrder(w.map, owner.slot, a.cell, b.cell));
    // Fields do not stack their percentage. Several supplied protectors may
    // share the finite cost when one runs dry.
    const limit = Math.floor(
      (shot.damage *
        Math.max(
          0,
          ...protectors.map(
            (s) => STRUCTURES[s.kind].protection!.absorbPercent,
          ),
        )) /
        100,
    );
    let remaining = limit;
    for (const protector of protectors) {
      const definition = STRUCTURES[protector.kind].protection!;
      let absorbed = 0;
      for (const q of w.particles) {
        if (remaining <= 0) break;
        if (
          q.ownerId !== owner.id ||
          q.mode !== "stationed" ||
          q.cell !== protector.cell ||
          q.destination !== protector.cell
        )
          continue;
        const amount = Math.min(
          remaining,
          q.attack * definition.capacityPerAttack,
        );
        remaining -= amount;
        absorbed += amount;
        recoverParticle(w, q);
      }
      if (absorbed) {
        damage -= absorbed;
        emit(w, owner, "shielded", {
          cell: shot.cell,
          fromCell: protector.cell,
          amount: absorbed,
        });
      }
    }
    if (shot.site) {
      const key = `${shot.owner}:${shot.cell}`;
      siteHits.set(key, (siteHits.get(key) ?? 0) + damage);
    } else hits.set(shot.id, (hits.get(shot.id) ?? 0) + damage);
    shot.player.statistics.damage += damage;
    emit(w, shot.player, "damage", {
      cell: shot.cell,
      fromCell: shot.from,
      amount: damage,
    });
  }
  for (const s of w.structures) s.hp -= hits.get(s.id) ?? 0;
  for (const p of w.players) {
    for (const j of p.queue) j.hp -= siteHits.get(`${p.id}:${j.cell}`) ?? 0;
    const destroyed = p.queue.some((j) => j.paid && !isSprout(j) && j.hp <= 0);
    for (const j of p.queue) {
      if (j.paid && j.upgradeFrom === undefined && j.hp <= 0) {
        p.statistics.sitesLost++;
        emit(w, p, "destroyed", { cell: j.cell });
      }
    }
    p.queue = p.queue.filter((j) => j.hp > 0);
    if (destroyed && p.worker.mode !== "recovering")
      p.worker.mode = "returning";
  }
  for (const s of w.structures.filter((s) => s.hp <= 0)) {
    const p = w.players.find((p) => p.id === s.ownerId)!;
    p.statistics.lost++;
    delete p.priorities[String(s.cell)];
    emit(w, p, "destroyed", { cell: s.cell });
  }
  w.structures = w.structures.filter((s) => s.hp > 0);
  for (const p of w.players) {
    const lostSource = p.queue.some(
      (j) =>
        j.upgradeFrom !== undefined &&
        !w.structures.some((s) => s.id === j.upgradeFrom) &&
        j.paid,
    );
    p.queue = p.queue.filter(
      (j) =>
        j.upgradeFrom === undefined ||
        w.structures.some((s) => s.id === j.upgradeFrom),
    );
    if (lostSource) p.worker.mode = "returning";
  }
  for (const p of w.players)
    if (p.alive && !brain(w, p)) {
      p.alive = false;
      p.autoExpand = false;
      p.queue = [];
      p.researchJob = null;
      p.priorities = {};
      p.territory = 0;
      p.dominanceSince = null;
      w.structures = w.structures.filter((s) => s.ownerId !== p.id);
      w.particles = w.particles.filter((q) => q.ownerId !== p.id);
      emit(w, p, "eliminated");
    }
  const alive = w.players.filter((p) => p.alive);
  if (w.players.length > 1 && alive.length <= 1) {
    w.finished = true;
    w.winnerId = alive[0]?.id ?? null;
    w.victory = alive.length ? "elimination" : null;
  }
}
export function step(state: World, commands: readonly Command[] = []): World {
  if (commands.length > 256) throw new Error("too many commands in one tick");
  const w = clone(state);
  w.outcomes = [];
  if (w.finished) return w;
  w.tick++;
  connectivity(w);
  for (const c of [...commands].sort((a, b) =>
    a.playerId < b.playerId
      ? -1
      : a.playerId > b.playerId
        ? 1
        : a.sequence - b.sequence,
  ))
    apply(w, c);
  for (const p of w.players) if (p.alive) economy(w, p);
  // Damage resolves before completion, so a killed site cannot become a healthy building.
  combat(w);
  connectivity(w);
  for (const p of w.players)
    for (const cell of Object.keys(p.priorities))
      if (structure(w, Number(cell))?.ownerId !== p.id)
        delete p.priorities[cell];
  const ready = w.players.filter((p) => p.alive && prepareWorker(w, p));
  const automatic: { player: Player; cell: number }[] = [];
  for (const p of w.players) {
    if (!p.alive) continue;
    const cell = autoExpandCell(w, p);
    if (cell !== null) {
      p.queue.push({
        cell,
        kind: "neuron",
        paid: false,
        progress: 0,
        duration: 0,
        hp: hp("neuron"),
      });
      automatic.push({ player: p, cell });
    }
  }
  dispatchConstruction(w, ready);
  // Losing automatic claims are retried from the next authoritative board;
  // they must not become stale ghost jobs that block this player's expansion.
  for (const { player, cell } of automatic)
    player.queue = player.queue.filter((job) => job.cell !== cell || job.paid);
  for (const p of ready) worker(w, p);
  for (const p of w.players) if (p.alive) sprouts(w, p);
  connectivity(w);
  powerupPhase(w);
  if (!w.finished) {
    const dominant = territoryPhase(w, (id, type) =>
      emit(
        w,
        w.players.find((p) => p.id === id)!,
        type,
      ),
    );
    if (dominant) {
      w.finished = true;
      w.winnerId = dominant;
      w.victory = "dominance";
    }
  }
  const launches = new Map<string, number>();
  for (const p of w.players) if (p.alive) particles(w, p, launches);
  recordTimeline(w, w.outcomes);
  return w;
}
export function observe(world: World): Readonly<World> {
  return clone(world);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
export function encodeState(world: World): string {
  return JSON.stringify(canonical(world));
}
export function hashState(world: World): string {
  let hash = 2166136261;
  const text = encodeState({ ...world, outcomes: [] });
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function decodeState(raw: unknown): World {
  if (typeof raw !== "string" || raw.length > 4_000_000)
    throw new Error("checkpoint: invalid size");
  const w: World = JSON.parse(raw);
  if (
    !record(w) ||
    w.formatVersion !== 1 ||
    w.rulesVersion !== RULES.version ||
    !integer(w.tick) ||
    !Array.isArray(w.players) ||
    !Array.isArray(w.structures) ||
    !Array.isArray(w.particles) ||
    !record(w.settings) ||
    w.structures.length > 4096 ||
    w.particles.length > RULES.particleCount * RULES.maxPlayers
  )
    throw new Error("checkpoint: unsupported or malformed");
  createMatch(
    w.map,
    w.settings,
    w.players.map((p) => ({ id: p.id, slot: p.slot })),
  );
  if (
    typeof w.matchId !== "string" ||
    w.matchId.length > 128 ||
    w.matchId !== (w.settings.matchId ?? "sandbox") ||
    !integer(w.nextEntityId, 1) ||
    typeof w.finished !== "boolean" ||
    !Array.isArray(w.outcomes) ||
    w.outcomes.length > 2048
  )
    throw new Error("checkpoint: invalid world");
  if (w.players.some((p, i) => i > 0 && w.players[i - 1]!.id >= p.id))
    throw new Error("checkpoint: players out of order");
  const owners = new Set(w.players.map((p) => p.id)),
    ids = new Set<number>(),
    occupied = new Set<number>();
  for (const o of w.outcomes)
    if (
      !o ||
      !owners.has(o.playerId) ||
      !integer(o.tick, 0, w.tick) ||
      ![
        "rejected",
        "queued",
        "dispatched",
        "constructed",
        "researched",
        "researchStarted",
        "income",
        "damage",
        "shielded",
        "destroyed",
        "eliminated",
        "claimed",
        "dominating",
        "dominanceBroken",
      ].includes(o.type) ||
      (o.cell !== undefined && !integer(o.cell, 0, w.map.cells.length - 1)) ||
      (o.fromCell !== undefined &&
        !integer(o.fromCell, 0, w.map.cells.length - 1)) ||
      (o.amount !== undefined && !integer(o.amount)) ||
      (o.type === "shielded" &&
        (!integer(o.cell, 0, w.map.cells.length - 1) ||
          !integer(o.fromCell, 0, w.map.cells.length - 1) ||
          !integer(o.amount, 1))) ||
      (o.resource !== undefined &&
        !["biomass", "insight"].includes(o.resource)) ||
      (o.reason !== undefined &&
        (typeof o.reason !== "string" || o.reason.length > 256))
    )
      throw new Error("checkpoint: invalid events");
  for (const s of w.structures) {
    if (
      !record(s) ||
      !owners.has(s.ownerId) ||
      !integer(s.id, 1) ||
      ids.has(s.id) ||
      !integer(s.cell, 0, w.map.cells.length - 1) ||
      w.map.cells[s.cell]?.terrain !== "open" ||
      occupied.has(s.cell) ||
      (s.kind !== "brain" && !isBuildKind(s.kind)) ||
      !integer(s.hp, 1, hp(s.kind)) ||
      typeof s.connected !== "boolean" ||
      (s.firingCursor !== undefined && !integer(s.firingCursor))
    )
      throw new Error("checkpoint: invalid structure");
    ids.add(s.id);
    occupied.add(s.cell);
  }
  for (const p of w.players) {
    if (
      typeof p.alive !== "boolean" ||
      !integer(p.biomass, 0, RULES.bankCap) ||
      !integer(p.insight, 0, RULES.bankCap) ||
      typeof p.autoExpand !== "boolean" ||
      !isParticleKind(p.particleKind) ||
      (!p.alive && p.autoExpand) ||
      !integer(p.sequence, -1) ||
      !Array.isArray(p.queue) ||
      p.queue.length > RULES.queueLimit ||
      !Array.isArray(p.research) ||
      p.research.some((r) => !isResearchKind(r)) ||
      new Set(p.research).size !== p.research.length ||
      !record(p.worker) ||
      !["idle", "outbound", "building", "returning", "recovering"].includes(
        p.worker.mode,
      ) ||
      !record(p.priorities) ||
      Object.keys(p.priorities).length > 8 ||
      !record(p.miningRemainders) ||
      !record(p.statistics) ||
      !integer(p.territory, 0, w.map.cells.length) ||
      (p.dominanceSince !== null && !integer(p.dominanceSince, 0, w.tick)) ||
      (!p.alive && (p.territory !== 0 || p.dominanceSince !== null)) ||
      !Array.isArray(p.buffs) ||
      p.buffs.length > 2 ||
      (!w.settings.powerups && p.buffs.length > 0) ||
      p.buffs.some(
        (b, i) =>
          !record(b) ||
          !isBuffKind(b.kind) ||
          // Stacked pickups extend a buff, at most once per powerup spawned.
          !integer(
            b.expiresAt,
            w.tick + 1,
            w.tick +
              Math.max(POWERUP_RULES.surgeTicks, POWERUP_RULES.frenzyTicks) *
                Math.max(1, w.powerupSerial),
          ) ||
          (i > 0 && p.buffs[i - 1]!.kind >= b.kind),
      )
    )
      throw new Error("checkpoint: invalid player");
    if (
      researchPrerequisites(p, PARTICLES[p.particleKind].requires).length ||
      p.research.some(
        (kind) => researchPrerequisites(p, RESEARCH[kind].requires).length,
      )
    )
      throw new Error("checkpoint: unmet research prerequisite");
    for (const [key, value] of Object.entries(p.priorities))
      if (
        !integer(Number(key), 0, w.map.cells.length - 1) ||
        String(Number(key)) !== key ||
        !integer(value, 1, 3) ||
        structure(w, Number(key))?.ownerId !== p.id ||
        !canAttack(structure(w, Number(key))!.kind)
      )
        throw new Error("checkpoint: invalid priorities");
    for (const [cell, n] of Object.entries(p.miningRemainders))
      if (
        String(Number(cell)) !== cell ||
        w.map.cells[Number(cell)]?.terrain !== "deposit" ||
        !integer(n, 0, 119)
      )
        throw new Error("checkpoint: invalid remainder");
    for (const key of [
      "biomassEarned",
      "insightEarned",
      "built",
      "damage",
      "lost",
      "sitesLost",
    ] as const)
      if (!integer(p.statistics[key]))
        throw new Error("checkpoint: invalid statistics");
    if (
      p.researchJob !== null &&
      (!record(p.researchJob) ||
        !isResearchKind(p.researchJob.kind) ||
        researchPrerequisites(p, RESEARCH[p.researchJob.kind].requires).length >
          0 ||
        p.research.includes(p.researchJob.kind) ||
        !integer(
          p.researchJob.completesAt,
          w.tick + 1,
          w.tick + RESEARCH[p.researchJob.kind].duration,
        ))
    )
      throw new Error("checkpoint: invalid research job");
    for (const j of p.queue) {
      const source = isBuildKind(j.kind)
        ? constructionUpgradeSource(w, p, j.kind, j.cell)
        : undefined;
      if (
        !record(j) ||
        !integer(j.cell, 0, w.map.cells.length - 1) ||
        w.map.cells[j.cell]?.terrain !== "open" ||
        !isBuildKind(j.kind) ||
        constructionSiteRequirements(w, j.kind, j.cell).length > 0 ||
        researchPrerequisites(p, CONSTRUCTIONS[j.kind].requires).length > 0 ||
        typeof j.paid !== "boolean" ||
        !integer(j.progress) ||
        !integer(j.duration) ||
        // Zero-time work exists only with debug instant construction.
        (j.paid
          ? w.settings.instantConstruction
            ? j.duration !== 0
            : j.duration === 0 ||
              !constructionDurations(j.kind).includes(j.duration)
          : !constructionDurations(j.kind).includes(j.duration)) ||
        !integer(j.hp, 1, hp(j.kind)) ||
        (!j.paid &&
          (j.progress !== 0 || j.duration !== 0 || j.hp !== hp(j.kind))) ||
        (j.paid &&
          (j.duration === 0 ? j.progress !== 0 : j.progress >= j.duration)) ||
        (j.upgradeFrom !== undefined &&
          (!integer(j.upgradeFrom) ||
            source?.id !== j.upgradeFrom ||
            j.hp !== hp(j.kind))) ||
        (j.paid &&
          occupied.has(j.cell) &&
          (j.upgradeFrom === undefined || source?.id !== j.upgradeFrom))
      )
        throw new Error("checkpoint: invalid construction");
      if (j.paid) occupied.add(j.cell);
    }
    for (const key of ["cell", "from", "to"] as const)
      if (!integer(p.worker[key], 0, w.map.cells.length - 1))
        throw new Error("checkpoint: invalid worker location");
    for (const key of ["departedAt", "arrivesAt", "recoverAt"] as const)
      if (!integer(p.worker[key]))
        throw new Error("checkpoint: invalid worker timing");
    const worker = p.worker;
    const paid = p.queue.some((j) => j.paid && !isSprout(j));
    if (
      p.alive &&
      (worker.departedAt > w.tick ||
        (["outbound", "building"].includes(worker.mode) && !paid) ||
        (["idle", "returning"].includes(worker.mode) && paid) ||
        (worker.mode === "idle" && worker.cell !== brain(w, p)?.cell) ||
        (worker.mode === "recovering" &&
          !integer(worker.recoverAt, w.tick + 1, w.tick + RULES.recoveryTicks)))
    )
      throw new Error("checkpoint: inconsistent worker");
    if (p.alive && worker.mode !== "recovering") {
      const from = structure(w, worker.cell),
        to = structure(w, worker.to);
      if (
        !from?.connected ||
        from.ownerId !== p.id ||
        !to?.connected ||
        to.ownerId !== p.id ||
        worker.from !== worker.cell ||
        (worker.to !== worker.cell &&
          (!neighbors(w.map, worker.from).includes(worker.to) ||
            worker.arrivesAt <= w.tick ||
            ![3, 4].includes(worker.arrivesAt - worker.departedAt))) ||
        (worker.to === worker.cell && worker.arrivesAt > w.tick)
      )
        throw new Error("checkpoint: invalid worker transit");
    }
    if (
      p.queue.filter((j) => j.paid && !isSprout(j)).length > 1 ||
      p.queue.filter((j) => j.paid && isSprout(j)).length > SPROUT.maxSlots ||
      new Set(p.queue.map((j) => j.cell)).size !== p.queue.length ||
      w.structures.filter((s) => s.ownerId === p.id && s.kind === "brain")
        .length !== (p.alive ? 1 : 0) ||
      p.alive !== !!brain(w, p) ||
      (!p.alive &&
        (p.queue.length > 0 ||
          p.researchJob !== null ||
          Object.keys(p.priorities).length > 0 ||
          w.structures.some((s) => s.ownerId === p.id))) ||
      w.particles.filter((q) => q.ownerId === p.id).length !==
        (p.alive ? 128 : 0)
    )
      throw new Error("checkpoint: particle conservation or brain mismatch");
  }
  for (const s of w.structures) {
    const owner = w.players.find((p) => p.id === s.ownerId)!;
    if (
      s.kind !== "brain" &&
      (researchPrerequisites(owner, CONSTRUCTIONS[s.kind].requires).length ||
        constructionSiteRequirements(w, s.kind, s.cell).length)
    )
      throw new Error("checkpoint: structure requires research");
  }
  for (const q of w.particles) {
    if (
      !record(q) ||
      !owners.has(q.ownerId) ||
      !integer(q.id, 1) ||
      ids.has(q.id) ||
      !["stationed", "transit", "recovering"].includes(q.mode) ||
      !isParticleKind(q.kind) ||
      researchPrerequisites(
        w.players.find((p) => p.id === q.ownerId)!,
        PARTICLES[q.kind].requires,
      ).length > 0 ||
      // Upgrades apply only once researched, and only when a particle is
      // re-equipped, so either value is possible after research, not before.
      ![
        PARTICLES[q.kind].attack,
        ...(w.players
          .find((p) => p.id === q.ownerId)!
          .research.includes("excitation")
          ? [PARTICLES[q.kind].attack + 1]
          : []),
      ].includes(q.attack) ||
      ![
        PARTICLES[q.kind].speed,
        ...(w.players
          .find((p) => p.id === q.ownerId)!
          .research.includes("conduction")
          ? [PARTICLES[q.kind].speed - 1]
          : []),
      ].includes(q.speed)
    )
      throw new Error("checkpoint: invalid particle");
    ids.add(q.id);
    for (const key of ["cell", "from", "to", "destination"] as const)
      if (!integer(q[key], 0, w.map.cells.length - 1))
        throw new Error("checkpoint: invalid particle location");
    for (const key of ["departedAt", "arrivesAt", "recoverAt"] as const)
      if (!integer(q[key]))
        throw new Error("checkpoint: invalid particle timing");
    if (
      q.mode === "transit" &&
      (!neighbors(w.map, q.from).includes(q.to) ||
        q.arrivesAt - q.departedAt !== q.speed ||
        q.departedAt > w.tick ||
        q.cell !== q.from ||
        ![q.from, q.to].every((cell) => {
          const s = structure(w, cell);
          return s?.connected && s.ownerId === q.ownerId;
        }))
    )
      throw new Error("checkpoint: invalid transit");
    if (
      q.mode === "recovering" &&
      !integer(
        q.recoverAt,
        w.tick + 1,
        w.tick + PARTICLES[q.kind].recovery + q.speed,
      )
    )
      throw new Error("checkpoint: invalid recovery");
  }
  if (
    !Array.isArray(w.powerups) ||
    w.powerups.length > POWERUP_RULES.maxActive ||
    !integer(w.powerupSerial, w.powerups.length) ||
    (!w.settings.powerups && (w.powerups.length > 0 || w.powerupSerial > 0))
  )
    throw new Error("checkpoint: invalid powerups");
  for (const p of w.powerups) {
    if (
      !record(p) ||
      !integer(p.id, 1) ||
      ids.has(p.id) ||
      !integer(p.cell, 0, w.map.cells.length - 1) ||
      w.map.cells[p.cell]?.terrain !== "open" ||
      w.powerups.filter((q) => q.cell === p.cell).length > 1 ||
      !isPowerupKind(p.kind) ||
      !integer(p.expiresAt, w.tick + 1, w.tick + POWERUP_RULES.lifetime)
    )
      throw new Error("checkpoint: invalid powerup");
    ids.add(p.id);
  }
  if ([...ids].some((id) => id >= w.nextEntityId))
    throw new Error("checkpoint: invalid identity counter");
  const connected = clone(w);
  connectivity(connected);
  if (
    connected.structures.some(
      (s, i) => s.connected !== w.structures[i]!.connected,
    )
  )
    throw new Error("checkpoint: invalid connectivity");
  for (const q of w.particles) {
    if (
      q.mode === "stationed" &&
      !w.structures.some(
        (s) => s.cell === q.cell && s.ownerId === q.ownerId && s.connected,
      )
    )
      throw new Error("checkpoint: invalid stationary particle");
    if (q.mode === "transit" && q.arrivesAt <= w.tick)
      throw new Error("checkpoint: overdue transit");
  }
  const edges = new Map<string, number>();
  for (const q of w.particles)
    if (q.mode === "transit") {
      const key = [q.from, q.to].sort((a, b) => a - b).join(":");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  if ([...edges.values()].some((n) => n > RULES.edgeTransitCapacity))
    throw new Error("checkpoint: edge capacity exceeded");
  const alive = w.players.filter((p) => p.alive);
  const eliminated = w.players.length > 1 && alive.length <= 1;
  // Territory and the dominance clock come from the network. A match still
  // in play cannot claim more than its structures claim, nor run a clock
  // without the dominant share and lead (an ended match may be a tick stale).
  if (!w.finished) {
    const counts = territoryCounts(w);
    const needed = dominanceCells(w);
    for (const p of alive) {
      const rival = Math.max(
        0,
        ...alive.filter((q) => q !== p).map((q) => q.territory),
      );
      if (
        p.territory > (counts.get(p.id) ?? 0) ||
        (p.dominanceSince !== null &&
          (w.players.length < 2 ||
            p.territory < needed ||
            p.territory < rival * DOMINANCE_LEAD))
      )
        throw new Error("checkpoint: invalid territory");
    }
  }
  if (
    !["elimination", "dominance", null].includes(w.victory) ||
    (!w.finished && (w.winnerId !== null || w.victory !== null)) ||
    (w.winnerId !== null && !alive.some((p) => p.id === w.winnerId)) ||
    (w.victory === "dominance"
      ? !w.finished || w.winnerId === null || eliminated
      : w.finished !== eliminated ||
        (w.finished && w.winnerId !== (alive[0]?.id ?? null)) ||
        (w.victory === "elimination") !== (w.finished && w.winnerId !== null))
  )
    throw new Error("checkpoint: invalid outcome");
  if (
    !Array.isArray(w.timeline) ||
    w.timeline.length > TIMELINE.maxSamples ||
    w.timeline.some(
      (sample, i) =>
        !record(sample) ||
        !integer(sample.tick, 0, w.tick) ||
        (i > 0 && sample.tick <= w.timeline[i - 1]!.tick) ||
        !Array.isArray(sample.players) ||
        sample.players.length !== w.players.length ||
        sample.players.some(
          (entry, j) =>
            !record(entry) ||
            entry.id !== w.players[j]!.id ||
            (
              [
                "territory",
                "structures",
                "weapons",
                "biomassEarned",
                "insightEarned",
                "damage",
                "lost",
                "biomass",
              ] as const
            ).some((key) => !integer(entry[key])),
        ),
    ) ||
    !Array.isArray(w.events) ||
    w.events.length > TIMELINE.maxEvents ||
    w.events.some(
      (e) =>
        !record(e) ||
        !integer(e.tick, 0, w.tick) ||
        !owners.has(e.playerId) ||
        !(EVENT_TYPES as readonly string[]).includes(e.type) ||
        (e.detail !== undefined &&
          (typeof e.detail !== "string" || e.detail.length > 64)),
    )
  )
    throw new Error("checkpoint: invalid timeline");
  return clone(w);
}
