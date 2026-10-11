import type { FrameTiming } from "fuse-netcode";
import type { RoundView, TickEvent } from "../engine/index.js";
import type { View } from "../online/game.js";
import type { RoundSource } from "../render/round-scene.js";

/** Events kept for the next frame at most, the newest: a page that stops drawing must not hoard them (`online.ts` also
 * stops handing them over while the tab is hidden, so nothing stale plays on return). */
export const MAX_EVENTS = 512;
const TAU = 2 * Math.PI;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const slide = <T extends { x: number; y: number }>(
  a: T | undefined,
  b: T,
  t: number,
): T => (a ? { ...b, x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) } : b);

/** A round `t` (0–1) from `older` to `newer`: ships, launchers (the short way round) and rockets slide, the clock is
 * fractional (gates and crates move by it), the rest is `newer`'s. Frames of two rounds are not blended. */
export function blendRound(
  older: RoundView | null | undefined,
  newer: RoundView,
  t: number,
): RoundView {
  if (!older || older.config.seed !== newer.config.seed || !(t < 1))
    return newer;
  const rockets = new Map(older.rockets.map((r) => [r.id, r]));
  const ghosts = new Map(older.ghosts.map((g) => [g.owner, g]));
  return {
    ...newer,
    tick: mix(older.tick, newer.tick, t),
    castles: newer.castles.map((c) => {
      const was = older.castles[c.id];
      if (!was) return c;
      const turn = c.angle - was.angle,
        short = turn - TAU * Math.round(turn / TAU);
      return { ...slide(was, c, t), angle: was.angle + short * t };
    }),
    ghosts: newer.ghosts.map((g) => slide(ghosts.get(g.owner), g, t)),
    rockets: newer.rockets.map((r) => slide(rockets.get(r.id), r, t)),
  };
}

/** The round scene's source online, no simulation of its own: the runtime's newest frames blended to the presentation
 * tick, and the events delivered since for the round it shows. `follow` is this device's gunship. */
export class OnlineSource implements RoundSource {
  round = "";
  follow: number | undefined;
  private events: { round: string; event: TickEvent }[] = [];
  constructor(
    private readonly timing: () => FrameTiming<View> | undefined,
    private readonly me: () => string,
    public view: RoundView,
  ) {
    this.advance();
  }

  /** The runtime delivered `event` of `matchId`'s `round` (it never delivers one twice, rollbacks included). */
  push(event: TickEvent, matchId: string, round: number): void {
    if (this.events.length >= MAX_EVENTS) this.events.shift(); // the newest matter: the oldest are already stale
    this.events.push({ round: `${matchId}:${round}`, event });
  }

  advance(): readonly TickEvent[] {
    const timing = this.timing();
    const { newer, older } = timing ?? {};
    if (timing && newer?.world) {
      const from = older?.tick ?? newer.tick;
      const t =
        newer.tick > from ? (timing.tick - from) / (newer.tick - from) : 1;
      this.view = blendRound(older?.world, newer.world, Math.max(0, t));
      this.round = `${newer.matchId}:${newer.round}`;
      const ship = newer.ships.indexOf(this.me());
      this.follow = ship < 0 ? undefined : ship;
    }
    const events = this.events.filter((e) => e.round === this.round);
    this.events = [];
    return events.map((e) => e.event);
  }
}
