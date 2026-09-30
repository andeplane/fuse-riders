/** Integer fixed-step rules, independent of the browser and transport. */
export const WIDTH = 1000,
  HEIGHT = 620,
  DURATION = 1800,
  CAPACITY = 5,
  MAX_GHOSTS = 18;
export const UP = 1,
  DOWN = 2,
  LEFT = 4,
  RIGHT = 8,
  VACUUM = 16,
  PULSE = 32;
export const SHRINES = [
  { x: 100, y: 310 },
  { x: 900, y: 310 },
];
export const GRAVES = [
  { x: 260, y: 150 },
  { x: 500, y: 130 },
  { x: 740, y: 150 },
  { x: 260, y: 470 },
  { x: 500, y: 490 },
  { x: 740, y: 470 },
];
export const WALLS = [
  { x: 300, y: 260, w: 85, h: 40 },
  { x: 615, y: 320, w: 85, h: 40 },
];
export interface Hunter {
  id: string;
  slot: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  tank: number[];
  score: number;
  deposit: number;
  cooldown: number;
  stun: number;
  protection: number;
  beam: number;
  pulse: number;
}
export interface Ghost {
  id: number;
  kind: 1 | 4;
  x: number;
  y: number;
  resistance: number;
  emerge: number;
  tug: number;
  claim: number[];
  carrier: string;
}
export interface World {
  tick: number;
  rng: number;
  nextId: number;
  hunters: Hunter[];
  ghosts: Ghost[];
}
export interface Settings {
  display: boolean;
}
export const DEFAULT_SETTINGS: Settings = { display: false };
export function parseSettings(v: unknown): Settings | undefined {
  if (
    v &&
    typeof v === "object" &&
    Object.keys(v).length === 1 &&
    "display" in v &&
    typeof v.display === "boolean"
  )
    return { display: v.display };
}
export const isInput = (n: unknown): n is number =>
  Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 63;
export function seedOf(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function random(w: World, n: number): number {
  w.rng = (Math.imul(w.rng, 1664525) + 1013904223) >>> 0;
  return w.rng % n;
}
export function createWorld(
  seed: number,
  seats: { id: string; slot: number }[],
): World {
  const w: World = {
    tick: 0,
    rng: seed,
    nextId: 1,
    hunters: seats.map((s) => ({
      id: s.id,
      slot: s.slot,
      x: 180 + s.slot * 160,
      y: 310,
      dx: 0,
      dy: -1,
      tank: [],
      score: 0,
      deposit: 0,
      cooldown: 0,
      stun: 0,
      protection: 0,
      beam: 0,
      pulse: 0,
    })),
    ghosts: [],
  };
  for (let i = 0; i < 12; i++) spawn(w);
  return w;
}
function spawn(w: World): void {
  if (w.ghosts.length >= MAX_GHOSTS) return;
  const p = GRAVES[random(w, GRAVES.length)]!;
  const kind = w.nextId % 4 === 0 ? 4 : 1;
  w.ghosts.push({
    id: w.nextId++,
    kind,
    x: p.x + random(w, 91) - 45,
    y: p.y + random(w, 71) - 35,
    resistance: kind === 4 ? 100 : 36,
    emerge: 30,
    tug: 0,
    claim: [0, 0, 0, 0, 0],
    carrier: "",
  });
}
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function cone(h: Hunter, g: { x: number; y: number }, range: number): boolean {
  const x = g.x - h.x,
    y = g.y - h.y,
    d = x * h.dx + y * h.dy;
  return (
    dist2(h, g) <= range * range &&
    (dist2(h, g) < 28 * 28 ||
      (d > 0 && d * d * 2 >= dist2(h, g) * (h.dx * h.dx + h.dy * h.dy)))
  );
}
function move(h: Hunter, x: number, y: number): void {
  const nx = Math.max(40, Math.min(WIDTH - 40, h.x + x)),
    ny = Math.max(90, Math.min(HEIGHT - 40, h.y + y));
  if (
    !WALLS.some(
      (r) =>
        nx > r.x - 16 &&
        nx < r.x + r.w + 16 &&
        h.y > r.y - 16 &&
        h.y < r.y + r.h + 16,
    )
  )
    h.x = nx;
  if (
    !WALLS.some(
      (r) =>
        h.x > r.x - 16 &&
        h.x < r.x + r.w + 16 &&
        ny > r.y - 16 &&
        ny < r.y + r.h + 16,
    )
  )
    h.y = ny;
}
export function carried(w: World, h: Hunter): number {
  return h.tank.reduce(
    (n, id) => n + (w.ghosts.find((g) => g.id === id)?.kind ?? 0),
    0,
  );
}
export function botInput(w: World, h: Hunter): number {
  let target: { x: number; y: number } | undefined;
  const full =
    h.tank.length >= 3 || (h.tank.length > 0 && w.tick > DURATION - 200);
  if (full) target = [...SHRINES].sort((a, b) => dist2(h, a) - dist2(h, b))[0];
  else
    target = w.ghosts
      .filter((g) => !g.carrier && !g.emerge)
      .sort((a, b) => dist2(h, a) - dist2(h, b) || a.id - b.id)[0];
  if (!target) return 0;
  const dx = target.x - h.x,
    dy = target.y - h.y;
  let bits =
    (dx > 12 ? RIGHT : dx < -12 ? LEFT : 0) |
    (dy > 12 ? DOWN : dy < -12 ? UP : 0);
  if (!full && dist2(h, target) < 130 ** 2) bits |= VACUUM;
  if (full && dist2(h, target) < 42 ** 2) bits = 0;
  if (w.hunters.some((r) => r.id !== h.id && r.tank.length && cone(h, r, 90)))
    bits |= PULSE;
  return bits;
}
/** Move, resolve pulse intents, suction/capture, deposits, then replenish. */
export function stepWorld(w: World, inputs: ReadonlyMap<string, number>): void {
  if (w.tick >= DURATION) return;
  w.tick++;
  const pulses: Hunter[] = [];
  for (const h of w.hunters) {
    h.beam = 0;
    h.pulse = Math.max(0, h.pulse - 1);
    h.cooldown = Math.max(0, h.cooldown - 1);
    h.protection = Math.max(0, h.protection - 1);
    h.stun = Math.max(0, h.stun - 1);
    const b = inputs.get(h.id) ?? 0;
    if (h.stun) continue;
    const x = Number(Boolean(b & RIGHT)) - Number(Boolean(b & LEFT)),
      y = Number(Boolean(b & DOWN)) - Number(Boolean(b & UP));
    if (x || y) {
      h.dx = x;
      h.dy = y;
    }
    const speed = b & VACUUM ? 3 : 6;
    move(h, x * speed, y * speed);
    if (b & PULSE && !h.cooldown) {
      pulses.push(h);
      h.cooldown = 70;
      h.pulse = 8;
    }
  }
  const hits = new Map<string, Hunter>();
  for (const a of pulses)
    for (const b of w.hunters)
      if (a !== b && !b.protection && cone(a, b, 100) && !hits.has(b.id))
        hits.set(b.id, a);
  for (const [id, a] of hits) {
    const h = w.hunters.find((p) => p.id === id)!;
    h.stun = 12;
    h.protection = 35;
    h.deposit = 0;
    move(h, a.dx * 32, a.dy * 32);
    const gid = h.tank.shift();
    const g = w.ghosts.find((g) => g.id === gid);
    if (g) {
      g.carrier = "";
      g.x = h.x;
      g.y = h.y;
      g.resistance = g.kind === 4 ? 55 : 20;
      g.claim.fill(0);
      g.tug = 0;
      g.emerge = 12;
    }
  }
  const targets = new Map<number, Hunter[]>();
  for (const h of w.hunters) {
    if (
      h.stun ||
      h.tank.length >= CAPACITY ||
      !((inputs.get(h.id) ?? 0) & VACUUM)
    )
      continue;
    const g = w.ghosts
      .filter((g) => !g.carrier && !g.emerge && cone(h, g, 155))
      .sort((a, b) => dist2(h, a) - dist2(h, b) || a.id - b.id)[0];
    if (g) {
      h.beam = g.id;
      const group = targets.get(g.id) ?? [];
      group.push(h);
      targets.set(g.id, group);
    }
  }
  for (const g of w.ghosts) {
    if (g.carrier) continue;
    if (g.emerge) {
      g.emerge--;
      continue;
    }
    const group = targets.get(g.id) ?? [];
    if (group.length) {
      for (const h of group) {
        g.claim[h.slot] = (g.claim[h.slot] ?? 0) + 1;
        if (g.kind === 4 && w.tick % 2 === 0)
          move(h, Math.sign(g.x - h.x), Math.sign(g.y - h.y));
      }
      g.resistance = Math.max(0, g.resistance - group.length);
      if (g.resistance === 0) {
        g.tug++;
        if ((group.length === 1 && g.tug >= 8) || g.tug >= 24) {
          const priority = (w.tick - g.tug + g.id) % 5;
          group.sort(
            (a, b) =>
              (g.claim[b.slot] ?? 0) - (g.claim[a.slot] ?? 0) ||
              ((a.slot - priority + 5) % 5) - ((b.slot - priority + 5) % 5),
          );
          const winner = group[0]!;
          g.carrier = winner.id;
          winner.tank.push(g.id);
          winner.beam = 0;
        }
      } else {
        const nearest = group[0]!;
        g.x = Math.max(45, Math.min(955, g.x + Math.sign(g.x - nearest.x)));
        g.y = Math.max(100, Math.min(570, g.y + Math.sign(g.y - nearest.y)));
      }
    } else {
      g.tug = 0;
      g.claim = g.claim.map((n) => Math.max(0, n - 1));
      if (w.tick % 4 === 0) {
        g.x = Math.max(45, Math.min(955, g.x + random(w, 7) - 3));
        g.y = Math.max(100, Math.min(570, g.y + random(w, 7) - 3));
      }
    }
  }
  for (const h of w.hunters) {
    const b = inputs.get(h.id) ?? 0;
    const at = SHRINES.some((s) => dist2(h, s) < 48 ** 2);
    if (h.tank.length && at && !(b & 15) && !h.stun) {
      h.deposit++;
      if (h.deposit >= 25) {
        h.score += carried(w, h);
        const ids = new Set(h.tank);
        w.ghosts = w.ghosts.filter((g) => !ids.has(g.id));
        h.tank = [];
        h.deposit = 0;
      }
    } else h.deposit = 0;
  }
  if (w.tick % 25 === 0) spawn(w);
}
