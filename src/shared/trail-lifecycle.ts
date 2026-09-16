import { hypot2 } from './deterministic-math.js';
import type { TrailSegment } from './protocol.js';

export const TRAIL_DECAY_PAUSE_TICKS = 20;
export const TRAIL_DECAY_PER_TICK = 37.5 / 20;
export const MAX_TRAIL_SEGMENTS = 2048;
type AllocatePiece = () => number;

/** History order and identity matter: a crossing cannot reconnect two pieces. */
export function trailSegmentsConnect(a: TrailSegment, b: TrailSegment): boolean {
  return a.detached?.id === b.detached?.id && b.createdTick === a.createdTick + 1 &&
    a.x2 === b.x1 && a.y2 === b.y1;
}

function detachRuns(segments: readonly TrailSegment[], decayStartTick: number, allocate: AllocatePiece): TrailSegment[] {
  let detached: TrailSegment['detached'];
  return segments.map((segment, index) => {
    if (!index || !trailSegmentsConnect(segments[index - 1]!, segment)) detached = { id: allocate(), decayStartTick };
    return { ...segment, detached };
  });
}

/** Death preserves every existing piece's clock, including debris detached this tick. */
export function detachTrail(trail: readonly TrailSegment[], tick: number, allocate: AllocatePiece): TrailSegment[] {
  const result: TrailSegment[] = [];
  let active: TrailSegment[] = [];
  const flush = () => { result.push(...detachRuns(active, tick + TRAIL_DECAY_PAUSE_TICKS, allocate)); active = []; };
  for (const segment of trail) {
    if (segment.detached) { flush(); result.push(segment); }
    else active.push(segment);
  }
  flush();
  return result;
}

/**
 * Apply geometry in history order. Every removed interval breaks the link to the head,
 * even when surviving coordinates touch. Uncut portal gaps keep that logical link.
 * The final chunk is active only if its original head-facing endpoint survived.
 */
export function cutTrail(trail: readonly TrailSegment[], tick: number,
  cut: (segment: TrailSegment) => readonly TrailSegment[], allocate: AllocatePiece): TrailSegment[] {
  const chunks: TrailSegment[][] = [];
  let chunk: TrailSegment[] = [], changed = false;
  const flush = () => { if (chunk.length) chunks.push(chunk); chunk = []; };
  let previous: TrailSegment | undefined;
  for (const segment of trail) {
    if (previous?.detached?.id !== segment.detached?.id) flush();
    const parts = cut(segment);
    if (parts.length !== 1 || parts[0]!.x1 !== segment.x1 || parts[0]!.y1 !== segment.y1 ||
        parts[0]!.x2 !== segment.x2 || parts[0]!.y2 !== segment.y2) changed = true;
    if (!parts.length) flush();
    for (const part of parts) {
      if (part.x1 !== segment.x1 || part.y1 !== segment.y1) flush();
      chunk.push(part);
      if (part.x2 !== segment.x2 || part.y2 !== segment.y2) flush();
    }
    previous = segment;
  }
  const attached = chunk;
  flush();
  if (!changed) return [...trail];
  const counts = new Map<number, number>();
  for (const group of chunks) {
    const id = group[0]!.detached?.id;
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return boundTrail(chunks.flatMap(group => {
    const source = group[0]!.detached;
    if (!source && group === attached) return group;
    if (source && counts.get(source.id) === 1) return group;
    return detachRuns(group, source?.decayStartTick ?? tick + TRAIL_DECAY_PAUSE_TICKS, allocate);
  }));
}

/** Consume both budgets against the same pre-step arc length; zero-length runs vanish. */
export function erodeTrailPiece(piece: readonly TrailSegment[], distance: number): TrailSegment[] {
  const lengths = piece.map(s => hypot2(s.x2 - s.x1, s.y2 - s.y1));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 2 * distance) return [];
  let offset = 0;
  const result: TrailSegment[] = [];
  for (let i = 0; i < piece.length; i++) {
    const segment = piece[i]!, length = lengths[i]!;
    const from = Math.max(0, distance - offset), to = Math.min(length, total - distance - offset);
    if (length === 0 && offset > distance && offset < total - distance) result.push(segment);
    if (length > 0 && to > from) {
      const at = (a: number, b: number, d: number) => a + (b - a) * (d / length);
      result.push({ ...segment,
        x1: from === 0 ? segment.x1 : at(segment.x1, segment.x2, from),
        y1: from === 0 ? segment.y1 : at(segment.y1, segment.y2, from),
        x2: to === length ? segment.x2 : at(segment.x1, segment.x2, to),
        y2: to === length ? segment.y2 : at(segment.y1, segment.y2, to) });
    }
    offset += length;
  }
  return result;
}

/** Called once per playing tick, before weapons and collision checks. */
export function advanceTrail(trail: readonly TrailSegment[], tick: number, previousTick = tick - 1): TrailSegment[] {
  const result: TrailSegment[] = [];
  for (let i = 0; i < trail.length;) {
    const first = trail[i]!;
    if (!first.detached) { if (first.expiresAtTick > tick) result.push(first); i++; continue; }
    let end = i + 1;
    while (end < trail.length && trail[end]!.detached?.id === first.detached.id) end++;
    const piece = trail.slice(i, end);
    result.push(...(tick > first.detached.decayStartTick ? erodeTrailPiece(piece, TRAIL_DECAY_PER_TICK * Math.max(0, tick - Math.max(previousTick, first.detached.decayStartTick))) : piece));
    i = end;
  }
  return result;
}

/** Saturation removes oldest debris first, never borrowing capacity from the active tail. */
export function boundTrail(trail: TrailSegment[]): TrailSegment[] {
  let excess = trail.length - MAX_TRAIL_SEGMENTS;
  if (excess <= 0) return trail;
  return trail.filter(segment => !(segment.detached && excess-- > 0)).slice(-MAX_TRAIL_SEGMENTS);
}
