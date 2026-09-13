export const PORTAL_RADIUS = 24;
export const PORTAL_MIN_SEPARATION = 400;
export const PORTAL_LIFETIME_TICKS = 200;
export const PORTAL_COOLDOWN_TICKS = 15;
export const PORTAL_GRACE_TICKS = 10;
export const PORTAL_PLACEMENT_ATTEMPTS = 24;

export interface PortalPoint { x: number; y: number }
/** Interior wall coordinates, before subtracting rider/gate clearance. */
export interface PortalBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface PortalPair {
  id: string;
  gates: readonly [PortalPoint, PortalPoint];
  expiresAtTick: number;
}
export type PortalSafetyCheck = (point: PortalPoint, radius: number) => boolean;

export interface PortalPlacementOptions {
  id: string;
  tick: number;
  bounds: PortalBounds;
  riderRadius: number;
  random: () => number;
  isSafe: PortalSafetyCheck;
}

/** At most 24 candidate sites and 48 RNG samples, including unsuccessful placement. */
export function createPortalPair(options: PortalPlacementOptions): PortalPair | undefined {
  const { bounds, riderRadius, random, isSafe } = options;
  const clearance = PORTAL_RADIUS + riderRadius;
  const minX = bounds.minX + clearance;
  const minY = bounds.minY + clearance;
  const width = bounds.maxX - clearance - minX;
  const height = bounds.maxY - clearance - minY;
  if (width < 0 || height < 0 || Math.hypot(width, height) < PORTAL_MIN_SEPARATION) return undefined;
  const candidates: PortalPoint[] = [];
  for (let attempt = 0; attempt < PORTAL_PLACEMENT_ATTEMPTS; attempt += 1) {
    const point = { x: minX + random() * width, y: minY + random() * height };
    if (!isSafe(point, clearance)) continue;
    const partner = candidates.find(other => Math.hypot(other.x - point.x, other.y - point.y) >= PORTAL_MIN_SEPARATION);
    if (partner) return { id: options.id, gates: [partner, point], expiresAtTick: options.tick + PORTAL_LIFETIME_TICKS };
    candidates.push(point);
  }
  return undefined;
}

export interface PortalTransitOptions {
  pair: PortalPair | undefined;
  tick: number;
  from: PortalPoint;
  to: PortalPoint;
  heading: number;
  cooldownUntilTick: number;
  bounds: PortalBounds;
  riderRadius: number;
  isSafeExit: PortalSafetyCheck;
}
export interface PortalTransit {
  entryGateIndex: 0 | 1;
  entryPoint: PortalPoint;
  exitPoint: PortalPoint;
  heading: number;
  cooldownUntilTick: number;
  graceUntilTick: number;
}

/** Find an outside-to-inside swept entry; standing in a gate is not a fresh entry. */
function entryFraction(from: PortalPoint, to: PortalPoint, center: PortalPoint, radius: number): number | undefined {
  const fx = from.x - center.x;
  const fy = from.y - center.y;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return undefined;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return undefined;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return undefined;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : undefined;
}

/** Call after ordinary collision resolution, only for living riders. No state or trail mutation. */
export function findPortalTransit(options: PortalTransitOptions): PortalTransit | undefined {
  const { pair, tick, from, to, bounds, riderRadius } = options;
  if (!pair || tick >= pair.expiresAtTick || tick < options.cooldownUntilTick) return undefined;
  const entries = pair.gates.map((gate, index) => ({
    index: index as 0 | 1,
    fraction: entryFraction(from, to, gate, PORTAL_RADIUS + riderRadius),
  })).filter((entry): entry is { index: 0 | 1; fraction: number } => entry.fraction !== undefined)
    .sort((a, b) => a.fraction - b.fraction);
  const entry = entries[0];
  if (!entry) return undefined;
  if (bounds.maxX - bounds.minX < 2 * riderRadius || bounds.maxY - bounds.minY < 2 * riderRadius) return undefined;
  const linked = pair.gates[entry.index === 0 ? 1 : 0];
  const exitPoint = {
    x: Math.max(bounds.minX + riderRadius, Math.min(bounds.maxX - riderRadius, linked.x)),
    y: Math.max(bounds.minY + riderRadius, Math.min(bounds.maxY - riderRadius, linked.y)),
  };
  if (!options.isSafeExit(exitPoint, riderRadius)) return undefined;
  return {
    entryGateIndex: entry.index,
    entryPoint: { x: from.x + (to.x - from.x) * entry.fraction, y: from.y + (to.y - from.y) * entry.fraction },
    exitPoint,
    heading: options.heading,
    cooldownUntilTick: tick + PORTAL_COOLDOWN_TICKS,
    graceUntilTick: tick + PORTAL_GRACE_TICKS,
  };
}
