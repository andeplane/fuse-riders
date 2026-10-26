/**
 * Which effect an engine event plays, how loud and where (`cueOf`, `spatial`), and which of the many get through
 * (`CueGate`, `Limiter`). Rollback re-runs steps and delivers their events again, so a cue comes only from an event
 * the shared `EventDedupe` accepts once per match, and only while its step is recent: a device catching up, or a
 * rollback reaching far back, plays nothing stale. Presentation only; nothing here feeds the simulation.
 */
import {
  DRAW,
  ITEMS,
  NO_WINNER,
  STEPS_PER_SECOND,
  SUB,
  TILE_PX,
  teamOf,
  type BuildingView,
  type CombatEvent,
  type WorldView,
} from "../../engine/index.js";
import { EventDedupe, type StampedEvent } from "../../render/cues.js";
import { SOUNDS, type CueKind } from "./sounds.js";

/** The camera's box in fractions of the map (`Renderer.box`). */
export type Camera = { x: number; y: number; w: number; h: number };
/** A cue to play: `at` (sub-pixels) places it in the stereo field; none is heard the same anywhere. */
export type Cue = { kind: CueKind; at?: { x: number; y: number } };

/** Events more than half a second behind the newest step are too late to sound. */
export const LATE_STEPS = STEPS_PER_SECOND / 2;
/** Below this a spatial cue is not worth a voice. */
export const MIN_GAIN = 0.06;
/** Live effect sounds (a few voices each) across all kinds; the rest are dropped so 300 units fighting never clip. */
export const MAX_VOICES = 24;

/** The world's units and buildings by id, once per view (a big fight brings hundreds of events a frame). */
// prettier-ignore
const indexes = new WeakMap<WorldView, { units: Map<number, string>; buildings: Map<number, BuildingView> }>();
function indexOf(world: WorldView) {
  let index = indexes.get(world);
  if (!index) {
    index = {
      units: new Map(world.units.map((u) => [u.id, u.kind])),
      buildings: new Map(world.buildings.map((b) => [b.id, b])),
    };
    indexes.set(world, index);
  }
  return index;
}

// prettier-ignore
const GUN: Readonly<Record<string, CueKind>> = { grunt: "rifle", torch: "flamer", lightTank: "cannon", sentry: "sentry" };

/** The cues one event plays for `seat` (-1 watches): the sound of it where it happened, and this seat's alerts. */
export function cuesOf(
  event: CombatEvent,
  world: WorldView | undefined,
  seat: number,
): Cue[] {
  const mine = seat >= 0;
  const team = mine ? teamOf(seat) : -1;
  // Built only for the events that need it. A shooter missing from the shown world (dead, or not yet shown) rifles.
  const index = () => world && indexOf(world);
  switch (event.type) {
    case "shot": {
      const { from, to } = event;
      const at = { x: from.x, y: from.y };
      const gun: CueKind =
        from.of === "hero"
          ? "heroShot"
          : from.of === "building"
            ? "tower"
            : (GUN[index()?.units.get(from.id) ?? "grunt"] ?? "rifle");
      const hit =
        to.of === "building" ? index()?.buildings.get(to.id) : undefined;
      const defended =
        mine &&
        hit?.team === team &&
        (hit.kind === "turret" || hit.kind === "fort");
      return defended
        ? [{ kind: gun, at }, { kind: "underAttack" }]
        : [{ kind: gun, at }];
    }
    case "death": {
      const tank = event.kind === "lightTank";
      return [{ kind: tank ? "tankDeath" : "robotDeath", at: event }];
    }
    case "destroyed": {
      const building = index()?.buildings.get(event.building);
      const tile = SUB * TILE_PX;
      const at = building && {
        x: (building.x + 0.5) * tile,
        y: (building.y + 0.5) * tile,
      };
      const cues: Cue[] = [{ kind: "structure", at }];
      if (mine && building?.team === team) cues.push({ kind: "structureLost" });
      return cues;
    }
    case "heroDeath":
      return [
        event.seat === seat
          ? { kind: "myDeath" }
          : { kind: "heroDeath", at: event },
      ];
    case "respawn":
      return event.seat === seat ? [{ kind: "respawn" }] : [];
    case "levelUp":
      return event.seat === seat ? [{ kind: "levelUp" }] : [];
    case "cast": {
      // Where it lands (DASH's `to` is its start, so it whooshes where the hero went).
      const dash = event.effect === "dash";
      return [
        {
          kind: event.effect,
          at: dash ? event : { x: event.toX, y: event.toY },
        },
      ];
    }
    case "capture": {
      // Lost only while the shown world still has it on this side: an enemy taking a neutral flag is no sting.
      const owner = world?.sectorOwners[event.sector] ?? -1;
      if (!mine) return [];
      if (teamOf(event.seat) === team) return [{ kind: "flagTaken" }];
      return owner >= 0 && teamOf(owner) === team ? [{ kind: "flagLost" }] : [];
    }
    case "item":
      return [{ kind: ITEMS[event.item]?.active ?? "item", at: event }];
    case "mine":
      return [{ kind: "mineBlast", at: event }];
    case "won": {
      // A draw is nobody's win; a watcher hears the winner's fanfare.
      const lost = event.winner === DRAW || (mine && event.winner !== team);
      return event.winner === NO_WINNER
        ? []
        : [{ kind: lost ? "defeat" : "victory" }];
    }
  }
}

/**
 * Gain and pan of a sound at `at` (sub-pixels) heard from `camera` over a `width` × `height` tile map: full and panned
 * across the screen while on it, fading with distance past its edge. Distances are in screen halves, so zooming out
 * brings more of the fight on screen at full level, and zooming in leaves more of it off to the sides, quieter.
 */
export function spatial(
  at: { x: number; y: number },
  camera: Camera,
  { width, height }: { width: number; height: number },
): { gain: number; pan: number } {
  const tile = SUB * TILE_PX;
  const halfW = Math.max(camera.w, 1e-3) / 2,
    halfH = Math.max(camera.h, 1e-3) / 2;
  const dx = (at.x / (width * tile) - camera.x - halfW) / halfW;
  const dy = (at.y / (height * tile) - camera.y - halfH) / halfH;
  const off = Math.max(0, Math.max(Math.abs(dx), Math.abs(dy)) - 1);
  const gain = 1 / (1 + 2 * off) ** 2;
  return { gain, pan: Math.max(-1, Math.min(1, dx)) * 0.7 };
}

/** Accepts each stamped event once per match, and only while it is no more than `LATE_STEPS` behind the newest. */
export class CueGate {
  private readonly dedupe = new EventDedupe();
  private matchId = "";
  private newest = 0;
  accept(matchId: string, stamped: StampedEvent, shownStep = 0): boolean {
    if (matchId !== this.matchId) {
      this.matchId = matchId;
      this.newest = 0;
    }
    this.newest = Math.max(this.newest, shownStep);
    if (!this.dedupe.accept(matchId, stamped)) return false;
    this.newest = Math.max(this.newest, stamped.step);
    return this.fresh(stamped.step);
  }
  /** Whether `step` of the current match is still recent enough to sound. */
  fresh(step: number): boolean {
    return step >= this.newest - LATE_STEPS;
  }
}

/** Per kind: seconds between two of it, and most of it sounding at once. Unlisted kinds: 0.08 s and 3. */
// prettier-ignore
export const LIMITS: Partial<Record<CueKind, readonly [gap: number, voices: number]>> = {
  rifle: [0.05, 4], flamer: [0.1, 2], cannon: [0.12, 3], sentry: [0.08, 2], heroShot: [0.07, 3], tower: [0.25, 2],
  robotDeath: [0.07, 4], tankDeath: [0.15, 2], structure: [0.3, 2], underAttack: [10, 1], wave: [5, 1],
  gold: [0.05, 3], hover: [0.06, 1], click: [0.03, 2], invalid: [0.25, 1],
};

/** How long each sound lasts: its last voice's end. */
const LENGTHS = new Map(
  Object.entries(SOUNDS).map(([kind, { voices }]) => [
    kind,
    Math.max(...voices.map((voice) => (voice.at ?? 0) + voice.dur)),
  ]),
);

/**
 * Lets a cue through when its kind's gap has passed, its kind has a voice free, and (for effects) the whole mix
 * does: alerts and the interface skip the global cap, never their own limits.
 */
export class Limiter {
  private readonly last = new Map<CueKind, number>();
  private readonly ends = new Map<CueKind, number[]>();
  allow(kind: CueKind, now: number): boolean {
    const [gap, voices] = LIMITS[kind] ?? [0.08, 3];
    if (now - (this.last.get(kind) ?? -Infinity) < gap) return false;
    const live = (this.ends.get(kind) ?? []).filter((end) => end > now);
    if (live.length >= voices) return false;
    if (SOUNDS[kind].bus === "effects" && this.sounding(now) >= MAX_VOICES)
      return false;
    this.last.set(kind, now);
    live.push(now + LENGTHS.get(kind)!);
    this.ends.set(kind, live);
    return true;
  }
  /** Sounds still playing at `now`, across every kind. */
  sounding(now: number): number {
    let n = 0;
    for (const [kind, ends] of this.ends)
      if (SOUNDS[kind].bus === "effects")
        for (const end of ends) if (end > now) n++;
    return n;
  }
  reset(): void {
    this.last.clear();
    this.ends.clear();
  }
}
