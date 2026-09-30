import { DURATION, MAX_GHOSTS, type World } from "./world.js";
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
const id = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9:_-]{1,80}$/.test(v) &&
  !(v in Object.prototype);
/** Validate bounds and ownership together, then clone so rejection/installation is atomic. */
export function decodeWorld(raw: unknown): World | undefined {
  if (
    !plain(raw) ||
    Object.keys(raw).length !== 5 ||
    !int(raw.tick, 0, DURATION) ||
    !int(raw.rng, 0, 0xffffffff) ||
    !int(raw.nextId, 1, 2000) ||
    !Array.isArray(raw.hunters) ||
    raw.hunters.length < 2 ||
    raw.hunters.length > 5 ||
    !Array.isArray(raw.ghosts) ||
    raw.ghosts.length > MAX_GHOSTS
  )
    return;
  const ids = new Set<string>(),
    slots = new Set<number>(),
    cargo = new Map<number, string>();
  for (const h of raw.hunters) {
    if (
      !plain(h) ||
      Object.keys(h).length !== 14 ||
      !id(h.id) ||
      ids.has(h.id) ||
      !int(h.slot, 0, 4) ||
      slots.has(h.slot) ||
      !int(h.x, 40, 960) ||
      !int(h.y, 90, 580) ||
      !int(h.dx, -1, 1) ||
      !int(h.dy, -1, 1) ||
      (!h.dx && !h.dy) ||
      !Array.isArray(h.tank) ||
      h.tank.length > 5 ||
      !int(h.score, 0, 400) ||
      !int(h.deposit, 0, 24) ||
      !int(h.cooldown, 0, 70) ||
      !int(h.stun, 0, 12) ||
      !int(h.protection, 0, 35) ||
      !int(h.beam, 0, 1999) ||
      !int(h.pulse, 0, 8)
    )
      return;
    ids.add(h.id);
    slots.add(h.slot);
    for (const g of h.tank) {
      if (!int(g, 1, raw.nextId - 1) || cargo.has(g)) return;
      cargo.set(g, h.id);
    }
  }
  const gids = new Set<number>();
  for (const g of raw.ghosts) {
    if (
      !plain(g) ||
      Object.keys(g).length !== 9 ||
      !int(g.id, 1, raw.nextId - 1) ||
      gids.has(g.id) ||
      (g.kind !== 1 && g.kind !== 4) ||
      !int(g.x, 40, 960) ||
      !int(g.y, 90, 580) ||
      !int(g.resistance, 0, g.kind === 4 ? 100 : 36) ||
      !int(g.emerge, 0, 30) ||
      !int(g.tug, 0, 24) ||
      !Array.isArray(g.claim) ||
      g.claim.length !== 5 ||
      !g.claim.every((n) => int(n, 0, DURATION)) ||
      typeof g.carrier !== "string" ||
      (g.carrier !== "" && !ids.has(g.carrier)) ||
      (cargo.get(g.id) ?? "") !== g.carrier
    )
      return;
    gids.add(g.id);
  }
  if ([...cargo.keys()].some((g) => !gids.has(g))) return;
  return structuredClone(raw) as unknown as World;
}
