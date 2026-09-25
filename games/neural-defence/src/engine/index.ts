import { loadMap, neighbors } from "./map.ts";
import {
  RULES,
  type Action,
  type Command,
  type MatchSettings,
  type Player,
  type RosterEntry,
  type Structure,
  type World,
  type MapDefinition,
} from "./types.ts";
export * from "./types.ts";
export { loadMap, neighbors } from "./map.ts";
const clone = <T>(v: T): T => structuredClone(v);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (
  n: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const hp = (kind: Structure["kind"]) =>
  kind === "brain" ? 240 : kind === "tower" ? 100 : 60;
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
    roster.length > 4 ||
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
      (k) => !["instantConstruction", "instantResearch", "matchId"].includes(k),
    ) ||
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
    rulesVersion: 1,
    matchId: settings.matchId ?? "sandbox",
    tick: 0,
    map,
    settings: clone(settings),
    players: [],
    structures: [],
    particles: [],
    nextEntityId: 1,
    outcomes: [],
    winnerId: null,
    finished: false,
  };
  for (const r of [...roster].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const cell = map.spawns.find((s) => s.slot === r.slot)!.cellIndex;
    w.players.push({
      ...r,
      alive: true,
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
      },
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
function connectivity(w: World) {
  for (const s of w.structures) s.connected = false;
  for (const p of w.players) {
    const b = brain(w, p);
    if (!b) continue;
    const queue = [b];
    b.connected = true;
    for (const s of queue)
      for (const n of neighbors(w.map, s.cell)) {
        const next = structure(w, n);
        if (next && next.ownerId === p.id && !next.connected) {
          next.connected = true;
          queue.push(next);
        }
      }
  }
}
function path(w: World, p: Player, from: number, to: number): number[] | null {
  const start = structure(w, from);
  if (!start || start.ownerId !== p.id || !start.connected) return null;
  const queue = [[from]],
    seen = new Set([from]);
  for (const route of queue) {
    const at = route[route.length - 1]!;
    if (at === to) return route;
    for (const n of neighbors(w.map, at)) {
      const s = structure(w, n);
      if (s?.connected && s.ownerId === p.id && !seen.has(n)) {
        seen.add(n);
        queue.push([...route, n]);
      }
    }
  }
  return null;
}
function occupied(w: World, cell: number) {
  return (
    !!structure(w, cell) ||
    w.players.some((p) => p.queue.some((j) => j.cell === cell && j.paid))
  );
}
export function isAction(raw: unknown): raw is Action {
  const a = raw as Action;
  if (!a || typeof a !== "object") return false;
  const keys: Record<Action["type"], string[]> = {
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
    case "queueConstruction":
      return integer(a.cell) && ["neuron", "tower"].includes(a.kind);
    case "cancelConstruction":
      return integer(a.cell);
    case "setPriority":
      return integer(a.cell) && integer(a.weight, 0, 3);
    case "startResearch":
      return ["growth", "excitation", "conduction"].includes(a.research);
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
  if (a.type === "queueConstruction") {
    if (
      w.map.cells[a.cell]?.terrain !== "open" ||
      occupied(w, a.cell) ||
      p.queue.some((j) => j.cell === a.cell) ||
      p.queue.length >= RULES.queueLimit
    ) {
      reject("invalid construction cell or full queue");
      return;
    }
    p.queue.push({
      cell: a.cell,
      kind: a.kind,
      paid: false,
      progress: 0,
      duration: 0,
      hp: 20,
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
    if (j.paid) {
      p.worker.mode = "returning";
    } // Delivered work is spent; queued ghosts cost nothing.
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
      (!Object.hasOwn(p.priorities, String(a.cell)) &&
        Object.keys(p.priorities).length >= 8 &&
        a.weight > 0)
    ) {
      reject("invalid priority destination");
      return;
    }
    p.priorities[String(a.cell)] = a.weight;
  } else if (a.type === "startResearch") {
    if (
      p.researchJob ||
      p.research.includes(a.research) ||
      p.insight < RULES.researchCost
    ) {
      reject("research unavailable");
      return;
    }
    p.insight -= RULES.researchCost;
    p.researchJob = {
      kind: a.research,
      completesAt:
        w.tick + (w.settings.instantResearch ? 0 : RULES.researchTicks),
    };
    emit(w, p, "researchStarted", {
      amount: RULES.researchCost,
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
    const n = neighbors(w.map, index).filter((c) => {
      const s = structure(w, c);
      return s?.connected && s.ownerId === p.id;
    }).length;
    const numerator =
      (p.miningRemainders[index] ?? 0) +
      (cell.resourceKind === "biomass" ? 6000 : 3000) * n;
    add(cell.resourceKind, Math.floor(numerator / 120));
    p.miningRemainders[index] = numerator % 120;
  });
  if (p.researchJob && p.researchJob.completesAt <= w.tick) {
    p.research.push(p.researchJob.kind);
    p.researchJob = null;
    emit(w, p, "researched");
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
    worker.mode = p.queue.some((j) => j.paid) ? "outbound" : "idle";
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
function dispatchConstruction(w: World, ready: Player[]) {
  // Collect claims against one shared pre-dispatch board. Rotate spawn-slot
  // precedence each tick so renaming players cannot buy construction priority.
  const order = [...w.players].sort((a, b) => a.slot - b.slot);
  const first = (w.tick - 1) % order.length;
  const rank = (p: Player) =>
    (order.indexOf(p) - first + order.length) % order.length;
  const claims = ready
    .flatMap((p) => {
      if (p.worker.mode !== "idle" || p.queue.some((j) => j.paid)) return [];
      const job = p.queue.find(
        (j) =>
          !j.paid &&
          !occupied(w, j.cell) &&
          neighbors(w.map, j.cell).some(
            (c) =>
              structure(w, c)?.ownerId === p.id && structure(w, c)?.connected,
          ) &&
          (j.kind !== "tower" ||
            (neighbors(w.map, j.cell).length === 6 &&
              neighbors(w.map, j.cell).every(
                (c) =>
                  structure(w, c)?.ownerId === p.id &&
                  structure(w, c)?.connected,
              ))) &&
          p.biomass >=
            (j.kind === "tower" ? RULES.towerCost : RULES.neuronCost),
      );
      return job ? [{ p, job }] : [];
    })
    .sort((a, b) => rank(a.p) - rank(b.p));
  const claimed = new Set<number>();
  for (const { p, job } of claims) {
    if (claimed.has(job.cell)) continue;
    claimed.add(job.cell);
    const cost = job.kind === "tower" ? RULES.towerCost : RULES.neuronCost;
    p.biomass -= cost;
    job.paid = true;
    job.duration = w.settings.instantConstruction
      ? 0
      : job.kind === "tower"
        ? RULES.towerConstructionTicks
        : p.research.includes("growth")
          ? 80
          : RULES.constructionTicks;
    p.worker.mode = "outbound";
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
  const job = p.queue.find((j) => j.paid);
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
    .sort((a, b) => a.length - b.length || a[a.length - 1]! - b[b.length - 1]!);
  if (!anchors.length) return;
  const target = anchors[0]![anchors[0]!.length - 1]!;
  if (worker.cell !== target) {
    move(target);
    return;
  }
  worker.mode = "building";
  job.progress++;
  if (job.progress >= job.duration) {
    w.structures.push({
      id: w.nextEntityId++,
      cell: job.cell,
      ownerId: p.id,
      kind: job.kind,
      hp: hp(job.kind) - (20 - job.hp),
      connected: true,
    });
    p.queue.splice(p.queue.indexOf(job), 1);
    p.statistics.built++;
    emit(w, p, "constructed", { cell: job.cell });
    worker.mode = "returning";
  }
}
function recoverParticle(w: World, particle: World["particles"][number]) {
  particle.mode = "recovering";
  particle.recoverAt = w.tick + RULES.recoveryTicks + particle.speed;
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
      q.attack = p.research.includes("excitation") ? 3 : 2;
      q.speed = p.research.includes("conduction") ? 3 : 4;
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
    .sort((a, b) => a.cell - b.cell);
  const targets = new Map<number, number>();
  for (let i = 0; i < all.filter((q) => q.mode !== "recovering").length; i++) {
    const options = destinations.filter(
      (d) => d.count < (d.cell === b.cell ? 128 : RULES.nodeCapacity),
    );
    options.sort(
      (a, b) =>
        (a.count + 1) * b.weight - (b.count + 1) * a.weight || a.cell - b.cell,
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
  for (const q of ordered) {
    if (
      q.mode !== "stationed" ||
      q.cell === q.destination ||
      q.arrivesAt === w.tick
    )
      continue;
    if (q.cell === b.cell) {
      q.attack = p.research.includes("excitation") ? 3 : 2;
      q.speed = p.research.includes("conduction") ? 3 : 4;
    }
    const route = path(w, p, q.cell, q.destination);
    if (!route || route.length < 2) continue;
    const next = route[1]!,
      edge = [q.cell, next].sort((a, b) => a - b).join(":");
    const transits = w.particles.filter(
      (a) =>
        a.mode === "transit" &&
        [a.from, a.to].sort((a, b) => a - b).join(":") === edge,
    ).length;
    const receiving = all.filter(
      (a) =>
        (a.mode === "stationed" && a.cell === next) ||
        (a.mode === "transit" && a.to === next),
    ).length;
    if (
      (edgeLaunch.get(edge) ?? 0) >= RULES.edgeLaunchCapacity ||
      transits >= RULES.edgeTransitCapacity ||
      receiving >= 128
    )
      continue;
    edgeLaunch.set(edge, (edgeLaunch.get(edge) ?? 0) + 1);
    q.from = q.cell;
    q.to = next;
    q.departedAt = w.tick;
    q.arrivesAt = w.tick + q.speed;
    q.mode = "transit";
  }
}
function combat(w: World) {
  if (w.tick % 20 !== 0) return;
  const hits = new Map<number, number>();
  const siteHits = new Map<string, number>();
  for (const s of w.structures) {
    if (!s.connected) continue;
    const p = w.players.find((p) => p.id === s.ownerId)!;
    const radius = s.kind === "tower" ? 2 : 1;
    if (
      s.kind === "tower" &&
      (neighbors(w.map, s.cell).length !== 6 ||
        neighbors(w.map, s.cell).some(
          (c) =>
            structure(w, c)?.ownerId !== s.ownerId ||
            !structure(w, c)?.connected,
        ))
    )
      continue;
    const cells = new Set(neighbors(w.map, s.cell));
    if (radius === 2)
      for (const n of [...cells])
        if (w.map.cells[n]?.terrain === "open")
          for (const c of neighbors(w.map, n)) cells.add(c);
    const targets = [
      ...w.structures
        .filter((t) => t.ownerId !== s.ownerId && cells.has(t.cell))
        .map((t) => ({
          cell: t.cell,
          hp: t.hp,
          id: t.id,
          owner: t.ownerId,
          site: false,
        })),
      ...w.players
        .filter((o) => o.id !== p.id)
        .flatMap((o) =>
          o.queue
            .filter((j) => j.paid && cells.has(j.cell))
            .map((j) => ({
              cell: j.cell,
              hp: j.hp,
              id: -1,
              owner: o.id,
              site: true,
            })),
        ),
    ].sort((a, b) => a.hp - b.hp || a.cell - b.cell);
    const equal = targets.filter((t) => t.hp === targets[0]?.hp);
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
      .slice(0, s.kind === "tower" ? 8 : 4);
    const damage = ammo.reduce((sum, q) => sum + q.attack, 0);
    if (!damage) continue;
    s.firingCursor = (s.firingCursor ?? 0) + 1;
    for (const q of ammo) recoverParticle(w, q);
    if (target.site) {
      const key = `${target.owner}:${target.cell}`;
      siteHits.set(key, (siteHits.get(key) ?? 0) + damage);
    } else hits.set(target.id, (hits.get(target.id) ?? 0) + damage);
    p.statistics.damage += damage;
    emit(w, p, "damage", {
      cell: target.cell,
      fromCell: s.cell,
      amount: damage,
    });
  }
  for (const s of w.structures) s.hp -= hits.get(s.id) ?? 0;
  for (const p of w.players) {
    for (const j of p.queue) j.hp -= siteHits.get(`${p.id}:${j.cell}`) ?? 0;
    const destroyed = p.queue.some((j) => j.paid && j.hp <= 0);
    p.queue = p.queue.filter((j) => j.hp > 0);
    if (destroyed) p.worker.mode = "returning";
  }
  for (const s of w.structures.filter((s) => s.hp <= 0)) {
    const p = w.players.find((p) => p.id === s.ownerId)!;
    p.statistics.lost++;
    delete p.priorities[String(s.cell)];
    emit(w, p, "destroyed", { cell: s.cell });
  }
  w.structures = w.structures.filter((s) => s.hp > 0);
  for (const p of w.players)
    if (p.alive && !brain(w, p)) {
      p.alive = false;
      p.queue = [];
      p.researchJob = null;
      p.priorities = {};
      w.structures = w.structures.filter((s) => s.ownerId !== p.id);
      w.particles = w.particles.filter((q) => q.ownerId !== p.id);
      emit(w, p, "eliminated");
    }
  const alive = w.players.filter((p) => p.alive);
  if (w.players.length > 1 && alive.length <= 1) {
    w.finished = true;
    w.winnerId = alive[0]?.id ?? null;
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
  dispatchConstruction(w, ready);
  for (const p of ready) worker(w, p);
  connectivity(w);
  const launches = new Map<string, number>();
  for (const p of w.players) if (p.alive) particles(w, p, launches);
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
    w.rulesVersion !== 1 ||
    !integer(w.tick) ||
    !Array.isArray(w.players) ||
    !Array.isArray(w.structures) ||
    !Array.isArray(w.particles) ||
    !record(w.settings) ||
    w.structures.length > 4096 ||
    w.particles.length > 512
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
        "destroyed",
        "eliminated",
      ].includes(o.type) ||
      (o.cell !== undefined && !integer(o.cell, 0, w.map.cells.length - 1)) ||
      (o.fromCell !== undefined &&
        !integer(o.fromCell, 0, w.map.cells.length - 1)) ||
      (o.amount !== undefined && !integer(o.amount)) ||
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
      !["brain", "neuron", "tower"].includes(s.kind) ||
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
      !integer(p.sequence, -1) ||
      !Array.isArray(p.queue) ||
      p.queue.length > 32 ||
      !Array.isArray(p.research) ||
      p.research.some(
        (r) => !["growth", "excitation", "conduction"].includes(r),
      ) ||
      new Set(p.research).size !== p.research.length ||
      !record(p.worker) ||
      !["idle", "outbound", "building", "returning", "recovering"].includes(
        p.worker.mode,
      ) ||
      !record(p.priorities) ||
      Object.keys(p.priorities).length > 8 ||
      !record(p.miningRemainders) ||
      !record(p.statistics)
    )
      throw new Error("checkpoint: invalid player");
    for (const [key, value] of Object.entries(p.priorities))
      if (
        !integer(Number(key), 0, w.map.cells.length - 1) ||
        String(Number(key)) !== key ||
        !integer(value, 1, 3) ||
        structure(w, Number(key))?.ownerId !== p.id
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
    ] as const)
      if (!integer(p.statistics[key]))
        throw new Error("checkpoint: invalid statistics");
    if (
      p.researchJob !== null &&
      (!record(p.researchJob) ||
        !["growth", "excitation", "conduction"].includes(p.researchJob.kind) ||
        p.research.includes(p.researchJob.kind) ||
        !integer(
          p.researchJob.completesAt,
          w.tick + 1,
          w.tick + RULES.researchTicks,
        ))
    )
      throw new Error("checkpoint: invalid research job");
    for (const j of p.queue) {
      if (
        !record(j) ||
        !integer(j.cell, 0, w.map.cells.length - 1) ||
        w.map.cells[j.cell]?.terrain !== "open" ||
        !["neuron", "tower"].includes(j.kind) ||
        typeof j.paid !== "boolean" ||
        !integer(j.progress) ||
        !integer(j.duration, 0, 240) ||
        !integer(j.hp, 1, 20) ||
        (!j.paid && (j.progress !== 0 || j.duration !== 0 || j.hp !== 20)) ||
        (j.paid &&
          (j.duration === 0 ? j.progress !== 0 : j.progress >= j.duration)) ||
        (j.paid && ![0, 80, 120, 240].includes(j.duration)) ||
        (j.paid &&
          j.duration !== 0 &&
          (j.kind === "tower"
            ? j.duration !== RULES.towerConstructionTicks
            : j.duration === RULES.towerConstructionTicks)) ||
        (j.paid && occupied.has(j.cell))
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
    const paid = p.queue.some((j) => j.paid);
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
      p.queue.filter((j) => j.paid).length > 1 ||
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
  for (const q of w.particles) {
    if (
      !record(q) ||
      !owners.has(q.ownerId) ||
      !integer(q.id, 1) ||
      ids.has(q.id) ||
      !["stationed", "transit", "recovering"].includes(q.mode) ||
      !integer(q.attack, 2, 3) ||
      !integer(q.speed, 3, 4)
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
      !integer(q.recoverAt, w.tick + 1, w.tick + RULES.recoveryTicks + q.speed)
    )
      throw new Error("checkpoint: invalid recovery");
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
  if (
    (!w.finished && w.winnerId !== null) ||
    (w.winnerId !== null && !alive.some((p) => p.id === w.winnerId)) ||
    w.finished !== (w.players.length > 1 && alive.length <= 1) ||
    (w.finished && w.winnerId !== (alive[0]?.id ?? null))
  )
    throw new Error("checkpoint: invalid outcome");
  return clone(w);
}
