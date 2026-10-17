/**
 * Turns engine events into short-lived effects (tracers, flames, explosions, rings, scorch decals). Rollback can
 * re-run a step and deliver its events again, so each event is accepted once per match by its step stamp and content;
 * a re-run that changes what happened yields a new event, which plays. Presentation only: wall-clock milliseconds.
 */
import { SUB, TILE_PX, type CombatEvent } from "../engine/view.js";

/** An engine event with the world step it happened on (`FrontEvent` in the netcode). */
export interface StampedEvent {
  step: number;
  event: CombatEvent;
}

export interface Effect {
  kind: "tracer" | "flame" | "boom" | "ring" | "scorch";
  /** Art pixels; (x2, y2) is a shot's far end. */
  x: number;
  y: number;
  x2: number;
  y2: number;
  /** Explosion, scorch or final ring radius in art pixels. */
  size: number;
  colour: string;
  born: number;
  /** Milliseconds; a scorch (0) is a decal, not a live effect. */
  life: number;
}

/** Steps of stamps kept: well past the deepest rollback the netcode allows. */
export const KEEP_STEPS = 400;
/** Live effects at most; the oldest go first. */
export const MAX_EFFECTS = 400;

const RING: Readonly<Record<string, string>> = {
  shockwave: "#f8d030",
  rally: "#7cfc5a",
  ironHide: "#60d0ff",
  orbitalDrop: "#ff5a30",
};

/** Accepts each stamped event once per match. Bounded: stamps older than `KEEP_STEPS` behind the newest are dropped. */
export class EventDedupe {
  private matchId = "";
  private newest = 0;
  private readonly seen = new Map<string, number>();
  accept(matchId: string, { step, event }: StampedEvent): boolean {
    if (matchId !== this.matchId) {
      this.matchId = matchId;
      this.seen.clear();
      this.newest = 0;
    }
    const key = `${step}|${JSON.stringify(event)}`;
    if (step < this.newest - KEEP_STEPS || this.seen.has(key)) return false;
    this.seen.set(key, step);
    if (step > this.newest) {
      this.newest = step;
      for (const [k, at] of this.seen)
        if (at < step - KEEP_STEPS) this.seen.delete(k);
    }
    return true;
  }
  get size(): number {
    return this.seen.size;
  }
}

/**
 * The effects one event starts at `now`. `site` finds a building's foot in art pixels; a shot from a unit `torch`
 * names is a flame, every other shot a tracer.
 */
export function effectsOf(
  event: CombatEvent,
  now: number,
  site: (id: number) => { x: number; y: number } | undefined,
  torch: (unitId: number) => boolean,
): Effect[] {
  // prettier-ignore
  const fx = (kind: Effect["kind"], x: number, y: number, size: number, life = 0, x2 = x, y2 = y): Effect =>
    ({ kind, x, y, x2, y2, size, colour: "", born: now, life });
  const boom = (x: number, y: number, r: number, life: number) => [
    fx("boom", x, y - r / 2, r, life),
    fx("scorch", x, y, r),
  ];
  const at = "x" in event ? { x: event.x / SUB, y: event.y / SUB } : undefined;
  if (event.type === "shot") {
    const { from, to } = event;
    const kind = from.of === "unit" && torch(from.id) ? "flame" : "tracer";
    // prettier-ignore
    return [fx(kind, from.x / SUB, from.y / SUB - 4, 0, 140, to.x / SUB, to.y / SUB - 4)];
  }
  if (event.type === "death")
    return boom(at!.x, at!.y, event.kind === "lightTank" ? 7 : 4, 480);
  if (event.type === "heroDeath") return boom(at!.x, at!.y, 8, 560);
  if (event.type === "destroyed") {
    const foot = site(event.building);
    return foot ? boom(foot.x, foot.y, 12, 720) : [];
  }
  if (event.type !== "cast") return [];
  const ring = fx("ring", at!.x, at!.y, 3 * TILE_PX, 420);
  ring.colour = RING[event.effect] ?? "#ffffff";
  return event.effect === "orbitalDrop"
    ? [ring, ...boom(at!.x, at!.y, 10, 640)]
    : [ring];
}

/** The live effects: new ones join, finished ones leave, and the list never grows past `MAX_EFFECTS`. */
export class Effects {
  readonly live: Effect[] = [];
  add(effects: readonly Effect[]): void {
    this.live.push(...effects);
    if (this.live.length > MAX_EFFECTS)
      this.live.splice(0, this.live.length - MAX_EFFECTS);
  }
  /** Drops finished effects. */
  prune(now: number): void {
    let keep = 0;
    for (const effect of this.live)
      if (now - effect.born < effect.life) this.live[keep++] = effect;
    this.live.length = keep;
  }
  clear(): void {
    this.live.length = 0;
  }
}
