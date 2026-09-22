import {
  BODY_X,
  BODY_Y,
  GRAVITY,
  HEIGHT,
  MAX_AMMO,
  RULES,
  SHOT_STEPS,
  START_AMMO,
  TURN_TICKS,
  UNIT,
  WIDTH,
  WINDS,
  integer,
  legalVector,
  nextRandom,
  type Action,
  type Fact,
  type Match,
  type Player,
  type PlayerSpec,
  type Projectile,
} from "./types.js";
import {
  advanceProjectile,
  blastProfile,
  damageAt,
  collectsCrate,
  projectileOrigin,
  outside,
  sweep,
  type Contact,
} from "./physics.js";
import { boxClear, carve, generateTerrain } from "./terrain.js";
import { prepareLevel } from "./level.js";
import { scheduleCrate, searchCrate } from "./crate-search.js";

export function createMatch(
  id: string,
  seed: number,
  players: readonly PlayerSpec[],
  round = 1,
): Match {
  if (
    !/^[\w:.-]{1,96}$/.test(id) ||
    !integer(seed, 0, 0xffffffff) ||
    !integer(round, 1, 1_000_000) ||
    players.length < 2 ||
    players.length > 5 ||
    new Set(players.map((p) => p.id)).size !== players.length ||
    new Set(players.map((p, i) => p.slot ?? i)).size !== players.length ||
    players.some((p) => p.slot !== undefined && !integer(p.slot, 0, 4)) ||
    players.some(
      (p) =>
        !/^[\w:.-]{1,96}$/.test(p.id) || !p.name.trim() || p.name.length > 48,
    )
  )
    throw new Error("Invalid match configuration");
  const level = generateTerrain(seed, players.length);
  return {
    rules: RULES,
    id,
    seed,
    rng: (seed ^ 0x736b891d) >>> 0,
    round,
    tick: 0,
    step: 0,
    phase: "preparing",
    terrain: level.terrain,
    players: players.map((p, i) => ({
      ...p,
      slot: p.slot ?? i,
      ...level.spawns[i]!,
      vx: 0,
      vy: 0,
      hp: 100,
      ammo: START_AMMO,
      grounded: true,
      fallFrom: level.spawns[i]!.y,
      ordinal: 0,
    })),
    projectiles: [],
    crates: [],
    crateSearch: null,
    active: (round - 1) % players.length,
    turn: 1,
    deadline: TURN_TICKS,
    movement: 48 * UNIT,
    water: 705,
    wind: 0,
    cycle: 0,
    remaining: players.map((p) => p.id),
    nextEntity: 1,
    shot: 0,
    settleUntil: 0,
    preparation: {
      attempt: 0,
      pair: 0,
      wind: 0,
      candidate: 0,
      work: 0,
      witnesses: [],
    },
    winner: null,
    fault: null,
  };
}
export function isAction(raw: unknown): raw is Action {
  if (!raw || typeof raw !== "object") return false;
  const a = raw as Record<string, unknown>;
  if (
    typeof a.actor !== "string" ||
    a.actor.length > 96 ||
    !integer(a.round, 1, 1_000_000) ||
    !integer(a.turn, 1, 1_000_000) ||
    !integer(a.ordinal, 1, 0x7fffffff)
  )
    return false;
  if (a.type === "pass") return true;
  if (a.type === "move") return a.direction === -1 || a.direction === 1;
  if (a.type === "hop")
    return a.direction === -1 || a.direction === 0 || a.direction === 1;
  return (
    a.type === "launch" &&
    (a.weapon === "pebble" || a.weapon === "scatter") &&
    legalVector(a.vx, a.vy)
  );
}
function beginSettling(state: Match): void {
  state.phase = "settling";
  state.settleUntil = state.step + 180;
}
function applyAction(state: Match, action: Action, facts: Fact[]): void {
  const p = state.players[state.active]!;
  if (
    !isAction(action) ||
    state.phase !== "aiming" ||
    action.actor !== p.id ||
    action.turn !== state.turn ||
    action.round !== state.round ||
    action.ordinal <= p.ordinal
  )
    return;
  p.ordinal = action.ordinal;
  if (action.type === "pass") {
    beginSettling(state);
    return;
  }
  if (!p.grounded || p.hp <= 0) {
    facts.push({
      type: "rejected",
      actor: p.id,
      reason: "Wait until your bird lands.",
    });
    return;
  }
  if (action.type === "move") {
    if (state.movement < 3 * UNIT) return;
    const x = p.x + action.direction * 3 * UNIT;
    if (x < BODY_X || x > WIDTH * UNIT - BODY_X) return;
    for (let lift = 0; lift <= 3; lift++)
      if (boxClear(state.terrain, x, p.y - lift * UNIT, BODY_X, BODY_Y)) {
        if (state.movement < (3 + lift) * UNIT) return;
        if (
          (lift > 0 &&
            sweep(
              state.terrain,
              p.x,
              p.y,
              0,
              -lift * UNIT,
              BODY_X - 1,
              [],
              [],
              undefined,
              BODY_Y - 1,
            )) ||
          sweep(
            state.terrain,
            p.x,
            p.y - lift * UNIT,
            x - p.x,
            0,
            BODY_X - 1,
            [],
            [],
            undefined,
            BODY_Y - 1,
          )
        )
          continue;
        p.x = x;
        p.y -= lift * UNIT;
        state.movement -= (3 + lift) * UNIT;
        p.grounded = false;
        return;
      }
    return;
  }
  if (action.type === "hop") {
    if (state.movement < 18 * UNIT) return;
    state.movement -= 18 * UNIT;
    p.vy = -700;
    p.vx = action.direction * 210;
    p.grounded = false;
    p.fallFrom = p.y;
    return;
  }
  if (action.weapon === "scatter" && p.ammo === 0) {
    facts.push({
      type: "rejected",
      actor: p.id,
      reason: "No Scatter Bombs left. Select Pebble.",
    });
    return;
  }
  if (action.weapon === "scatter") p.ammo--;
  state.shot++;
  state.projectiles.push({
    id: state.nextEntity++,
    shot: state.shot,
    owner: p.id,
    kind: action.weapon,
    ...projectileOrigin(p, action, state.terrain, state.players, state.crates),
    vx: action.vx,
    vy: action.vy,
    expires: state.step + SHOT_STEPS,
    cleared: false,
  });
  state.phase = "flight";
  facts.push({ type: "shot", actor: p.id, x: p.x / UNIT, y: p.y / UNIT });
}
function hurt(p: Player, amount: number, facts: Fact[]): void {
  if (p.hp <= 0 || amount <= 0) return;
  const damage = Math.min(p.hp, amount);
  p.hp -= damage;
  facts.push({
    type: "damage",
    actor: p.id,
    amount: damage,
    x: p.x / UNIT,
    y: p.y / UNIT,
  });
  if (p.hp === 0) {
    p.vx = 0;
    p.vy = 0;
    facts.push({
      type: "eliminated",
      actor: p.id,
      x: p.x / UNIT,
      y: p.y / UNIT,
    });
  }
}
function projectilesStep(state: Match, facts: Fact[]): void {
  const impacts: { projectile: Projectile; hit: Contact }[] = [],
    next: Projectile[] = [];
  for (const p of state.projectiles) {
    const immediateSplit = p.kind === "scatter" && p.vy >= 0;
    const hit = immediateSplit
      ? sweep(
          state.terrain,
          p.x,
          p.y,
          0,
          0,
          UNIT,
          state.players,
          state.crates,
          p.owner,
        )
      : advanceProjectile(
          p,
          state.wind,
          state.terrain,
          state.players,
          state.crates,
        );
    if (hit) {
      impacts.push({ projectile: p, hit });
      continue;
    }
    if (outside(p) || state.step >= p.expires || p.y / UNIT >= state.water)
      continue;
    if (p.kind === "scatter" && p.vy >= 0) {
      for (const offset of [-320, 0, 320])
        next.push({
          ...p,
          id: state.nextEntity++,
          kind: "fragment",
          vx: p.vx + offset,
          vy: Math.max(70, p.vy),
          cleared: true,
        });
      facts.push({
        type: "split",
        x: p.x / UNIT,
        y: p.y / UNIT,
        actor: p.owner,
      });
    } else {
      next.push(p);
    }
  }
  impacts.sort(
    (a, b) =>
      a.hit.time.n * b.hit.time.d - b.hit.time.n * a.hit.time.d ||
      a.projectile.id - b.projectile.id,
  );
  const damages = new Map<string, number>(),
    impulses = new Map<string, { x: number; y: number }>(),
    collected = new Map<number, string>();
  for (const { projectile: p, hit } of impacts) {
    const { radius } = blastProfile(p.kind);
    for (const bird of state.players)
      if (bird.hp > 0) {
        const damage = damageAt(state.terrain, hit, bird, p.kind);
        damages.set(bird.id, (damages.get(bird.id) ?? 0) + damage);
        if (damage > 0) {
          const dx = bird.x - hit.x,
            dy = bird.y - hit.y,
            distance = Math.max(1, Math.abs(dx) + Math.abs(dy));
          const impulse = impulses.get(bird.id) ?? { x: 0, y: 0 };
          impulse.x += Math.trunc((dx * damage * 18) / distance);
          impulse.y += Math.trunc((dy * damage * 18) / distance) - damage * 8;
          impulses.set(bird.id, impulse);
        }
      }
    for (const c of state.crates) {
      if (collectsCrate(state.terrain, hit, c, radius))
        if (!collected.has(c.id)) collected.set(c.id, p.owner);
    }
  }
  for (const bird of state.players)
    hurt(bird, damages.get(bird.id) ?? 0, facts);
  for (const bird of state.players) {
    const impulse = impulses.get(bird.id);
    if (bird.hp > 0 && impulse) {
      bird.vx = Math.max(-900, Math.min(900, bird.vx + impulse.x));
      bird.vy = Math.max(-1100, Math.min(2200, bird.vy + impulse.y));
      bird.grounded = false;
      bird.fallFrom = Math.min(bird.fallFrom, bird.y);
    }
  }
  for (const c of [...state.crates].sort((a, b) => a.id - b.id)) {
    const id = collected.get(c.id),
      owner = state.players.find((b) => b.id === id && b.hp > 0);
    if (owner) {
      const amount = owner.ammo < MAX_AMMO ? 1 : 0;
      owner.ammo = Math.min(MAX_AMMO, owner.ammo + 1);
      facts.push({
        type: "pickup",
        actor: owner.id,
        amount,
        x: c.x / UNIT,
        y: c.y / UNIT,
      });
    }
  }
  state.crates = state.crates.filter((c) => !collected.has(c.id));
  for (const { projectile: p, hit } of impacts) {
    const { radius } = blastProfile(p.kind);
    carve(
      state.terrain,
      Math.round(hit.x / UNIT),
      Math.round(hit.y / UNIT),
      radius,
    );
    facts.push({
      type: "blast",
      actor: p.owner,
      x: hit.x / UNIT,
      y: hit.y / UNIT,
      radius,
    });
  }
  state.projectiles = next;
}
function bodiesStep(state: Match, facts: Fact[]): void {
  for (const p of state.players) {
    if (p.hp === 0) continue;
    if (state.phase === "settling" && state.step >= state.settleUntil) p.vx = 0;
    p.fallFrom = Math.min(p.fallFrom, p.y);
    if (p.vx) {
      const wall = sweep(
        state.terrain,
        p.x,
        p.y,
        p.vx,
        0,
        BODY_X,
        [],
        [],
        undefined,
        BODY_Y - 1,
      );
      if (wall) {
        p.x = wall.x - Math.sign(p.vx);
        p.vx = 0;
      } else p.x += p.vx;
    }
    p.vy = Math.min(2200, p.vy + GRAVITY);
    const ground = sweep(
      state.terrain,
      p.x,
      p.y,
      0,
      p.vy,
      BODY_X - 1,
      [],
      [],
      undefined,
      BODY_Y,
    );
    if (ground) {
      p.y = ground.y - Math.sign(p.vy);
      if (p.vy > 0) {
        const drop = Math.floor((p.y - p.fallFrom) / UNIT);
        if (!p.grounded && drop > 55)
          hurt(p, Math.min(40, Math.floor((drop - 55) / 3)), facts);
        p.grounded = true;
        p.fallFrom = p.y;
        p.vx = Math.trunc((p.vx * 3) / 4);
        if (Math.abs(p.vx) < 10) p.vx = 0;
      }
      p.vy = 0;
    } else ((p.grounded = false), (p.y += p.vy));
    if (p.y / UNIT + 6 >= state.water || p.x < 0 || p.x > WIDTH * UNIT)
      hurt(p, 100, facts);
  }
  for (const c of state.crates) {
    c.vy = Math.min(110, c.vy + GRAVITY);
    const ground = sweep(state.terrain, c.x, c.y, 0, c.vy, 5 * UNIT);
    if (ground) {
      c.y = ground.y - 1;
      c.vy = 0;
      c.grounded = true;
    } else {
      c.y += c.vy;
      c.grounded = false;
    }
  }
  state.crates = state.crates.filter((c) => c.y / UNIT + 5 < state.water);
}
function resolveTurn(state: Match, facts: Fact[]): void {
  const alive = state.players.filter((p) => p.hp > 0);
  if (alive.length <= 1) {
    state.phase = "over";
    state.crateSearch = null;
    state.winner = alive[0]?.id ?? null;
    facts.push({ type: "result", actor: state.winner ?? undefined });
    return;
  }
  const previous = state.players[state.active]!;
  state.remaining = state.remaining.filter(
    (id) => id !== previous.id && alive.some((p) => p.id === id),
  );
  if (!state.remaining.length) {
    state.cycle++;
    state.remaining = alive.map((p) => p.id);
    state.wind = WINDS[nextRandom(state) % WINDS.length]!;
    if (state.cycle >= 8) state.water = Math.max(300, state.water - 28);
    scheduleCrate(state);
  }
  for (let i = 1; i <= state.players.length; i++) {
    const index = (state.active + i) % state.players.length;
    if (state.players[index]!.hp > 0) {
      state.active = index;
      break;
    }
  }
  state.turn++;
  state.movement = 48 * UNIT;
  state.deadline = state.tick + TURN_TICKS;
  state.phase = "aiming";
  facts.push({ type: "turn", actor: state.players[state.active]!.id });
}
/** Caller-driven, synchronous, UI-free. One call is one 50 ms logical tick. */
export function advance(state: Match, actions: readonly Action[] = []): Fact[] {
  const facts: Fact[] = [];
  state.tick++;
  if (state.phase === "preparing") {
    state.step += 3;
    prepareLevel(state);
    return facts;
  }
  if (state.phase === "over" || state.phase === "fault") {
    state.step += 3;
    return facts;
  }
  if (state.phase === "aiming" && state.tick >= state.deadline)
    beginSettling(state);
  let moved = false;
  for (const action of actions.slice(0, 32)) {
    if (!isAction(action)) continue;
    const active = state.players[state.active]!;
    if (
      (action.type === "move" || action.type === "hop") &&
      state.phase === "aiming" &&
      action.actor === active.id &&
      action.round === state.round &&
      action.turn === state.turn &&
      action.ordinal > active.ordinal
    ) {
      if (moved) continue;
      moved = true;
    }
    applyAction(state, action, facts);
  }
  for (let i = 0; i < 3; i++) {
    state.step++;
    if (state.phase === "flight") projectilesStep(state, facts);
    bodiesStep(state, facts);
    if (state.phase === "flight" && !state.projectiles.length)
      beginSettling(state);
    if (state.phase === "aiming" && state.players[state.active]!.hp === 0)
      beginSettling(state);
    if (
      state.phase === "settling" &&
      state.players.every((p) => p.hp === 0 || (p.grounded && p.vx === 0))
    )
      resolveTurn(state, facts);
  }
  searchCrate(state);
  return facts;
}
