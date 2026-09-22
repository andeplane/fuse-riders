import {
  HEIGHT,
  MAX_AMMO,
  RULES,
  UNIT,
  WIDTH,
  integer,
  legalVector,
  type Match,
  type Player,
  type Projectile,
  type Crate,
} from "./types.js";

const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max = 96): x is string =>
  typeof x === "string" && x.length <= max;
const id = (x: unknown): x is string => text(x) && /^[\w:.-]{1,96}$/.test(x);
const number = (
  r: Record<string, unknown>,
  key: string,
  low = 0,
  high = 0x7fffffff,
) => integer(r[key], low, high);
const position = (r: Record<string, unknown>) =>
  number(r, "x", -20 * UNIT, (WIDTH + 20) * UNIT) &&
  number(r, "y", -20 * UNIT, (HEIGHT + 20) * UNIT);
const velocity = (r: Record<string, unknown>) =>
  number(r, "vx", -5000, 5000) && number(r, "vy", -5000, 8000);
function isPlayer(raw: unknown): raw is Player {
  return (
    record(raw) &&
    id(raw.id) &&
    text(raw.name, 48) &&
    raw.name.trim().length > 0 &&
    number(raw, "slot", 0, 4) &&
    position(raw) &&
    number(raw, "hp", 0, 100) &&
    number(raw, "ammo", 0, MAX_AMMO) &&
    number(raw, "ordinal")
  );
}
function isProjectile(raw: unknown): raw is Projectile {
  return (
    record(raw) &&
    number(raw, "id", 1) &&
    number(raw, "shot", 1) &&
    id(raw.owner) &&
    ["pebble", "scatter", "fragment"].includes(String(raw.kind)) &&
    position(raw) &&
    velocity(raw) &&
    number(raw, "expires", 1) &&
    typeof raw.cleared === "boolean"
  );
}
function isCrate(raw: unknown): raw is Crate {
  return (
    record(raw) &&
    number(raw, "id", 1) &&
    position(raw) &&
    number(raw, "vy", 0, 110) &&
    typeof raw.grounded === "boolean"
  );
}
/** Plain bounded data for MessagePack or a Node runner; no rendering resources. */
export function encodeState(state: Match): Match {
  return structuredClone(state);
}
export function decodeState(raw: unknown): Match | undefined {
  if (
    !record(raw) ||
    raw.rules !== RULES ||
    !id(raw.id) ||
    !number(raw, "seed", 0, 0xffffffff) ||
    !number(raw, "rng", 0, 0xffffffff)
  )
    return;
  if (
    !number(raw, "round", 1, 1_000_000) ||
    !number(raw, "tick") ||
    !number(raw, "step") ||
    raw.step !== Number(raw.tick) * 3
  )
    return;
  if (
    !["preparing", "aiming", "flight", "settling", "over", "fault"].includes(
      String(raw.phase),
    )
  )
    return;
  if (
    !Array.isArray(raw.players) ||
    raw.players.length < 2 ||
    raw.players.length > 5 ||
    !raw.players.every(isPlayer)
  )
    return;
  const players = raw.players;
  if (
    new Set(players.map((p) => p.id)).size !== players.length ||
    new Set(players.map((p) => p.slot)).size !== players.length
  )
    return;
  const member = (x: unknown) => players.some((p) => p.id === x);
  if (
    !Array.isArray(raw.projectiles) ||
    raw.projectiles.length > 8 ||
    !raw.projectiles.every(isProjectile) ||
    raw.projectiles.some((p) => !member(p.owner))
  )
    return;
  if (
    !Array.isArray(raw.crates) ||
    raw.crates.length > 3 ||
    !raw.crates.every(isCrate)
  )
    return;
  const entities = [...raw.projectiles, ...raw.crates];
  if (
    new Set(entities.map((p) => p.id)).size !== entities.length ||
    !number(raw, "nextEntity", 1) ||
    entities.some((p) => p.id >= Number(raw.nextEntity))
  )
    return;
  if (
    !number(raw, "active", 0, players.length - 1) ||
    !number(raw, "turn", 1, 1_000_000) ||
    !number(raw, "deadline") ||
    !number(raw, "water", 300, 705) ||
    !number(raw, "wind", -2, 2) ||
    !number(raw, "cycle", 0, 1_000_000) ||
    !number(raw, "shot")
  )
    return;
  if (
    !Array.isArray(raw.remaining) ||
    raw.remaining.length > 5 ||
    !raw.remaining.every(member) ||
    new Set(raw.remaining).size !== raw.remaining.length
  )
    return;
  if (raw.winner !== null && !member(raw.winner)) return;
  if (raw.fault !== null && !text(raw.fault, 256)) return;
  const terrain = raw.terrain;
  if (
    !record(terrain) ||
    !(terrain.bits instanceof Uint8Array) ||
    terrain.bits.length !== (WIDTH * HEIGHT) / 8 ||
    !number(terrain, "version") ||
    !Array.isArray(terrain.revisions) ||
    terrain.revisions.length !== 72 ||
    !terrain.revisions.every((n) => integer(n, 0, 0x7fffffff))
  )
    return;
  const job = raw.preparation;
  const search = raw.crateSearch;
  if (
    search !== null &&
    (!record(search) ||
      !Array.isArray(search.sites) ||
      search.sites.length !== 8 ||
      !search.sites.every((x) => integer(x, 40, WIDTH - 41)) ||
      !number(search, "site", 0, 7) ||
      !number(search, "player", 0, players.length - 1) ||
      !number(search, "candidate", 0, 23) ||
      !number(search, "work", 0, 100_000) ||
      raw.phase === "preparing" ||
      raw.phase === "over" ||
      raw.phase === "fault")
  )
    return;
  if (
    !record(job) ||
    !number(job, "attempt", 0, 4) ||
    !number(job, "pair", 0, players.length * (players.length - 1)) ||
    !number(job, "wind", 0, 4) ||
    !number(job, "candidate", 0, 201) ||
    !number(job, "work", 0, 1_000_000) ||
    !Array.isArray(job.witnesses) ||
    job.witnesses.length > 100
  )
    return;
  if (
    !job.witnesses.every(
      (w) =>
        record(w) &&
        member(w.from) &&
        member(w.to) &&
        w.from !== w.to &&
        number(w, "wind", -2, 2) &&
        legalVector(w.vx, w.vy),
    )
  )
    return;
  if (raw.phase === "flight" && !raw.projectiles.length) return;
  if (raw.phase !== "flight" && raw.projectiles.length) return;
  if (raw.phase === "over") {
    const alive = players.filter((p) => p.hp > 0);
    if (alive.length > 1 || raw.winner !== (alive[0]?.id ?? null)) return;
  } else if (raw.winner !== null) return;
  if (
    raw.phase === "aiming" &&
    (players[Number(raw.active)]!.hp <= 0 ||
      Number(raw.deadline) <= Number(raw.tick))
  )
    return;
  if (
    raw.projectiles.some(
      (p) => p.expires <= Number(raw.step) || p.shot !== raw.shot,
    )
  )
    return;
  if (raw.phase === "fault" ? raw.fault === null : raw.fault !== null) return;
  // Rebuild whitelisted data, rather than retaining arbitrary checkpoint properties/prototypes.
  return {
    rules: RULES,
    id: raw.id,
    seed: Number(raw.seed),
    rng: Number(raw.rng),
    round: Number(raw.round),
    tick: Number(raw.tick),
    step: Number(raw.step),
    phase: raw.phase as Match["phase"],
    terrain: {
      bits: terrain.bits.slice(),
      revisions: [...terrain.revisions] as number[],
      version: Number(terrain.version),
    },
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      slot: p.slot,
      x: p.x,
      y: p.y,
      hp: p.hp,
      ammo: p.ammo,
      ordinal: p.ordinal,
    })),
    projectiles: raw.projectiles.map((p) => ({
      id: p.id,
      shot: p.shot,
      owner: p.owner,
      kind: p.kind,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      expires: p.expires,
      cleared: p.cleared,
    })),
    crates: raw.crates.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      vy: c.vy,
      grounded: c.grounded,
    })),
    crateSearch:
      search === null
        ? null
        : {
            sites: [...(search.sites as number[])],
            site: Number(search.site),
            player: Number(search.player),
            candidate: Number(search.candidate),
            work: Number(search.work),
          },
    active: Number(raw.active),
    turn: Number(raw.turn),
    deadline: Number(raw.deadline),
    water: Number(raw.water),
    wind: Number(raw.wind),
    cycle: Number(raw.cycle),
    remaining: [...raw.remaining] as string[],
    nextEntity: Number(raw.nextEntity),
    shot: Number(raw.shot),
    preparation: {
      attempt: Number(job.attempt),
      pair: Number(job.pair),
      wind: Number(job.wind),
      candidate: Number(job.candidate),
      work: Number(job.work),
      witnesses: job.witnesses.map((w) => ({
        from: String(w.from),
        to: String(w.to),
        wind: Number(w.wind),
        vx: Number(w.vx),
        vy: Number(w.vy),
      })),
    },
    winner: raw.winner as string | null,
    fault: raw.fault as string | null,
  };
}
export function hashState(state: Match): string {
  let a = 2166136261,
    b = 0x9e3779b9;
  const feed = (n: number) => {
    a = Math.imul(a ^ n, 16777619) >>> 0;
    b = Math.imul(b ^ n, 0x85ebca6b) >>> 0;
  };
  // Canonical property ordering is defined by encode/decode and construction, not caller insertion order.
  const { terrain, ...rest } = state;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.entries(value)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  };
  const serialized = canonical({
    ...rest,
    terrain: { version: terrain.version, revisions: terrain.revisions },
  });
  for (let i = 0; i < serialized.length; i++) feed(serialized.charCodeAt(i));
  for (const byte of terrain.bits) feed(byte);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
