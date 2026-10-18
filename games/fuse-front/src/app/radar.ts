/**
 * Where the camera keys and the minimap send attention: this seat's fort (Home), the latest fight near its side (Tab)
 * and pings when its flags come under fire or fall. Built from engine events, each accepted once per match however
 * often rollback delivers it. Presentation only; nothing here feeds the simulation.
 */
import {
  SUB,
  TILE_PX,
  teamOf,
  type CombatEvent,
  type WorldView,
} from "../engine/index.js";
import { EventDedupe, type StampedEvent } from "../render/cues.js";

const TILE = SUB * TILE_PX;
/** Shots remembered for Tab: enough for the last few seconds of a big battle. */
export const SHOTS_KEPT = 96;
/** Tiles from one of this side's bodies a fight counts as near it, and shots within this of a fight's newest belong to it. */
export const NEAR_SIDE = 12,
  CLUSTER = 8;
/** Tiles from a flag a shot counts as fighting over it, and steps before the same flag pings for fire again. */
export const FLAG_REACH = 5,
  PING_GAP = 200;

type Pos = { x: number; y: number };
export type Ping = Pos & { kind: "attack" | "lost" };

/** The tile under fractions `fx`, `fy` of a `width` × `height` minimap, kept on the map. */
export function minimapTile(
  fx: number,
  fy: number,
  width: number,
  height: number,
): Pos {
  const at = (f: number, size: number) =>
    Math.min(size - 1, Math.max(0, Math.floor(f * size)));
  return { x: at(fx, width), y: at(fy, height) };
}

/** The centre of `seat`'s side's fort in tiles, or undefined once it is gone (or the seat only watches). */
export function homeOf(world: WorldView, seat: number): Pos | undefined {
  if (seat < 0) return undefined;
  const fort = world.buildings.find(
    (b) => b.kind === "fort" && b.team === teamOf(seat) && b.hp > 0,
  );
  return fort && { x: fort.x + 0.5, y: fort.y + 0.5 };
}

const shotAt = (e: CombatEvent): Pos | undefined =>
  e.type === "shot" ? { x: e.to.x / TILE, y: e.to.y / TILE } : undefined;
const near = (a: Pos, b: Pos, r: number) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r * r;

export class Radar {
  private readonly dedupe = new EventDedupe();
  private matchId = "";
  private shots: Pos[] = [];
  /** Each flag's side when last seen, so a capture can tell a loss from a neutral flag taken. */
  private readonly owners = new Map<number, number>();
  /** Each flag's side before its latest change. */
  private readonly before = new Map<number, number>();
  private readonly fired = new Map<number, number>();

  /** Notes the flags' sides in the newest world shown. */
  watch(world: WorldView): void {
    for (const f of world.flags) {
      const was = this.owners.get(f.sector);
      if (was !== undefined && was !== f.team) this.before.set(f.sector, was);
      this.owners.set(f.sector, f.team);
    }
  }

  /** Takes an engine event; returns a ping for `seat`'s minimap when one of its side's flags is fought over or lost. */
  event(
    matchId: string,
    stamped: StampedEvent,
    world: WorldView | undefined,
    seat: number,
  ): Ping | undefined {
    if (matchId !== this.matchId) {
      [this.matchId, this.shots] = [matchId, []];
      this.fired.clear();
    }
    if (!this.dedupe.accept(matchId, stamped) || !world) return undefined;
    const { event, step } = stamped;
    const team = seat < 0 ? -1 : teamOf(seat);
    if (event.type === "capture") {
      // A world showing the capture may have been watched before its event arrived: then the side before it counts.
      const now = this.owners.get(event.sector);
      const was =
        now === teamOf(event.seat) ? this.before.get(event.sector) : now;
      if (now !== teamOf(event.seat)) this.before.set(event.sector, now ?? -1);
      this.owners.set(event.sector, teamOf(event.seat));
      const flag = world.flags.find((f) => f.sector === event.sector);
      return flag && team >= 0 && was === team && teamOf(event.seat) !== team
        ? { x: flag.x + 0.5, y: flag.y + 0.5, kind: "lost" }
        : undefined;
    }
    const at = shotAt(event);
    if (!at) return undefined;
    this.shots.push(at);
    if (this.shots.length > SHOTS_KEPT) this.shots.shift();
    if (team < 0) return undefined;
    for (const f of world.flags) {
      const centre = { x: f.x + 0.5, y: f.y + 0.5 };
      if (f.team !== team || !near(centre, at, FLAG_REACH)) continue;
      if (step - (this.fired.get(f.sector) ?? -Infinity) < PING_GAP) return;
      this.fired.set(f.sector, step);
      return { ...centre, kind: "attack" };
    }
    return undefined;
  }

  /**
   * The latest fight for Tab, in tiles: the newest shot that landed near one of `seat`'s side's bodies (or the newest
   * at all), averaged with the remembered shots around it. Undefined before any shot.
   */
  fight(world: WorldView, seat: number): Pos | undefined {
    // A watcher has no side: Tab follows the newest shot of all.
    const team = seat < 0 ? -2 : teamOf(seat);
    const ours: Pos[] = [
      ...world.units.filter((u) => u.team === team),
      ...world.heroes.filter((h) => h.team === team && h.hp > 0),
    ].map((b) => ({ x: b.x / TILE, y: b.y / TILE }));
    for (const b of world.buildings)
      if (b.team === team && b.hp > 0) ours.push({ x: b.x, y: b.y });
    let newest = this.shots.at(-1);
    for (let i = this.shots.length - 1; i >= 0; i--)
      if (ours.some((o) => near(o, this.shots[i]!, NEAR_SIDE))) {
        newest = this.shots[i];
        break;
      }
    if (!newest) return undefined;
    const cluster = this.shots.filter((s) => near(s, newest, CLUSTER));
    const mean = (k: "x" | "y") =>
      cluster.reduce((sum, s) => sum + s[k], 0) / cluster.length;
    return { x: mean("x"), y: mean("y") };
  }
}
