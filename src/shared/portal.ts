export const PORTAL_WALL_HALF_WIDTH = 4;
export const PORTAL_MAX_LENGTH = 300;
export const PORTAL_MIN_SEPARATION = 400;
export const PORTAL_LIFETIME_TICKS = 200;
export const PORTAL_COOLDOWN_TICKS = 15;
export const PORTAL_GRACE_TICKS = 10;
export const PORTAL_PLACEMENT_ATTEMPTS = 24;
/** Simultaneous gate pairs. Each new pickup opens one more; past the cap the oldest makes room. */
export const MAX_PORTAL_PAIRS = 3;

export interface PortalPoint {
  x: number;
  y: number;
}
export interface PortalGate extends PortalPoint {
  halfLength: number;
}
/** Interior wall coordinates, before subtracting rider/gate clearance. */
export interface PortalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface PortalPair {
  id: string;
  gates: readonly [PortalGate, PortalGate];
  expiresAtTick: number;
}
export type PortalSafetyCheck = (point: PortalPoint, radius: number) => boolean;
/** Exit safety also names the pair in use, whose own walls the exit is allowed to hug. */
export type PortalExitCheck = (
  point: PortalPoint,
  radius: number,
  pairId: string,
) => boolean;

export interface PortalPlacementOptions {
  id: string;
  tick: number;
  bounds: PortalBounds;
  riderRadius: number;
  random: () => number;
  isSafe: PortalSafetyCheck;
}

/** At most 24 candidate sites and 48 RNG samples, including unsuccessful placement. */
export function createPortalPair(
  options: PortalPlacementOptions,
): PortalPair | undefined {
  const { bounds, riderRadius, random, isSafe } = options;
  const clearance = PORTAL_WALL_HALF_WIDTH + riderRadius + 1;
  const halfLength =
    Math.min(PORTAL_MAX_LENGTH, (bounds.maxY - bounds.minY) / 3) / 2;
  const minX = bounds.minX + clearance;
  const minY = bounds.minY + clearance + halfLength;
  const width = bounds.maxX - clearance - minX;
  const height = bounds.maxY - clearance - halfLength - minY;
  if (width < PORTAL_MIN_SEPARATION || height < 0 || halfLength <= 0)
    return undefined;
  const candidates: PortalGate[] = [];
  for (let attempt = 0; attempt < PORTAL_PLACEMENT_ATTEMPTS; attempt += 1) {
    const gate = {
      x: minX + random() * width,
      y: minY + random() * height,
      halfLength,
    };
    // Any point in the clearance capsule is within clearance + spacing/2 of a sample.
    const intervals = Math.max(1, Math.ceil((2 * halfLength) / clearance));
    const spacing = (2 * halfLength) / intervals;
    let safe = true;
    for (let sample = 0; sample <= intervals; sample += 1) {
      if (
        !isSafe(
          { x: gate.x, y: gate.y - halfLength + sample * spacing },
          clearance + spacing / 2,
        )
      ) {
        safe = false;
        break;
      }
    }
    if (!safe) continue;
    const partner = candidates.find(
      (other) => Math.abs(other.x - gate.x) >= PORTAL_MIN_SEPARATION,
    );
    if (partner)
      return {
        id: options.id,
        gates: [partner, gate],
        expiresAtTick: options.tick + PORTAL_LIFETIME_TICKS,
      };
    candidates.push(gate);
  }
  return undefined;
}

export interface PortalTransitOptions {
  pairs: readonly PortalPair[];
  tick: number;
  from: PortalPoint;
  to: PortalPoint;
  heading: number;
  cooldownUntilTick: number;
  bounds: PortalBounds;
  riderRadius: number;
  isSafeExit: PortalExitCheck;
}
export interface PortalTransit {
  pairId: string;
  entryGateIndex: 0 | 1;
  entryPoint: PortalPoint;
  exitPoint: PortalPoint;
  heading: number;
  cooldownUntilTick: number;
  graceUntilTick: number;
}

/** Shrink wall geometry without moving it into reclaimed horizontal territory. */
export function fitPortalPair(
  pair: PortalPair,
  bounds: PortalBounds,
  riderRadius: number,
): PortalPair | undefined {
  const margin = PORTAL_WALL_HALF_WIDTH + riderRadius + 1;
  const maximumLength = Math.min(
    PORTAL_MAX_LENGTH,
    (bounds.maxY - bounds.minY) / 3,
  );
  const gates: PortalGate[] = [];
  for (const gate of pair.gates) {
    if (gate.x < bounds.minX + margin || gate.x > bounds.maxX - margin)
      return undefined;
    const top = Math.max(gate.y - gate.halfLength, bounds.minY + margin);
    const bottom = Math.min(gate.y + gate.halfLength, bounds.maxY - margin);
    if (bottom <= top || maximumLength <= 0) return undefined;
    gates.push({
      x: gate.x,
      y: (top + bottom) / 2,
      halfLength: Math.min(bottom - top, maximumLength) / 2,
    });
  }
  return { ...pair, gates: [gates[0]!, gates[1]!] };
}

function circleEntry(
  from: PortalPoint,
  to: PortalPoint,
  center: PortalPoint,
  radius: number,
): number | undefined {
  const fx = from.x - center.x;
  const fy = from.y - center.y;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return undefined;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * (fx * fx + fy * fy - radius * radius);
  if (discriminant < 0) return undefined;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : undefined;
}

/** Earliest contact with an expanded vertical capsule, including both rounded ends. */
function entryFraction(
  from: PortalPoint,
  to: PortalPoint,
  gate: PortalGate,
  radius: number,
): number | undefined {
  const top = gate.y - gate.halfLength;
  const bottom = gate.y + gate.halfLength;
  const closestY = Math.max(top, Math.min(bottom, from.y));
  if ((from.x - gate.x) ** 2 + (from.y - closestY) ** 2 <= radius ** 2)
    return undefined;
  const candidates: number[] = [];
  const dx = to.x - from.x;
  if (dx !== 0) {
    for (const side of [-1, 1]) {
      const t = (gate.x + side * radius - from.x) / dx;
      const y = from.y + (to.y - from.y) * t;
      if (t >= 0 && t <= 1 && y >= top && y <= bottom) candidates.push(t);
    }
  }
  for (const y of [top, bottom]) {
    const t = circleEntry(from, to, { x: gate.x, y }, radius);
    if (t !== undefined) candidates.push(t);
  }
  return candidates.length ? Math.min(...candidates) : undefined;
}

/**
 * Call after ordinary collision resolution, only for living riders. No state or trail mutation.
 * The earliest wall met along the step wins, so overlapping pairs never swap a rider's destination,
 * and a rider always leaves through the partner of the gate actually entered.
 */
export function findPortalTransit(
  options: PortalTransitOptions,
): PortalTransit | undefined {
  const { pairs, tick, from, to, bounds, riderRadius } = options;
  if (tick < options.cooldownUntilTick) return undefined;
  let entry: { pair: PortalPair; index: 0 | 1; fraction: number } | undefined;
  for (const candidate of pairs) {
    if (tick >= candidate.expiresAtTick) continue;
    for (const [index, gate] of candidate.gates.entries()) {
      const fraction = entryFraction(
        from,
        to,
        gate,
        PORTAL_WALL_HALF_WIDTH + riderRadius,
      );
      if (fraction === undefined || (entry && fraction >= entry.fraction))
        continue;
      entry = { pair: candidate, index: index as 0 | 1, fraction };
    }
  }
  if (!entry) return undefined;
  if (
    bounds.maxX - bounds.minX < 2 * riderRadius ||
    bounds.maxY - bounds.minY < 2 * riderRadius
  )
    return undefined;
  const gate = entry.pair.gates[entry.index];
  const linked = entry.pair.gates[entry.index === 0 ? 1 : 0];
  const entryPoint = {
    x: from.x + (to.x - from.x) * entry.fraction,
    y: from.y + (to.y - from.y) * entry.fraction,
  };
  const proportion = Math.max(
    -1,
    Math.min(1, (entryPoint.y - gate.y) / gate.halfLength),
  );
  const direction = Math.sign(to.x - from.x) || Math.sign(from.x - gate.x) || 1;
  const exitPoint = {
    x: linked.x + direction * (PORTAL_WALL_HALF_WIDTH + riderRadius + 1),
    y: linked.y + proportion * linked.halfLength,
  };
  if (
    exitPoint.x < bounds.minX + riderRadius ||
    exitPoint.x > bounds.maxX - riderRadius ||
    exitPoint.y < bounds.minY + riderRadius ||
    exitPoint.y > bounds.maxY - riderRadius
  )
    return undefined;
  if (!options.isSafeExit(exitPoint, riderRadius, entry.pair.id))
    return undefined;
  return {
    pairId: entry.pair.id,
    entryGateIndex: entry.index,
    entryPoint,
    exitPoint,
    heading: options.heading,
    cooldownUntilTick: tick + PORTAL_COOLDOWN_TICKS,
    graceUntilTick: tick + PORTAL_GRACE_TICKS,
  };
}
