/**
 * The match feed: each hero's kills, deaths and assists for the scoreboard, and for this seat the gold pop-ups of its
 * last hits and the notices of its kills, assists and deaths. Built from engine events, each accepted once per match
 * however often rollback delivers it. The tally counts what this device saw: a device that joins a match late counts
 * from then. Presentation only; nothing here feeds the simulation.
 */
import {
  ASSIST_RADIUS,
  GOLD,
  NEUTRAL,
  teamOf,
  type WorldView,
} from "../engine/index.js";
import { EventDedupe, type StampedEvent } from "../render/cues.js";

export interface Tally {
  kills: number;
  deaths: number;
  assists: number;
}
/** A pop-up where a body fell, in sub-pixels, and a notice line; `good` news is this side's. */
export interface Float {
  text: string;
  x: number;
  y: number;
}
export interface Notice {
  text: string;
  good: boolean;
}

/** Hero hits remembered for assists, at most. */
export const HITS_KEPT = 64;
/** Units' first shooters remembered before older steps' are dropped. */
export const SHOTS_KEPT = 256;

export class MatchFeed {
  private readonly dedupe = new EventDedupe();
  private matchId = "";
  private readonly tallies = new Map<number, Tally>();
  /** By unit, the first hero to shoot it on the latest step it was shot; and each hero hit on a hero as [attacker, victim, step]. */
  private readonly shotAt = new Map<number, { step: number; seat: number }>();
  private hits: [number, number, number][] = [];

  /** Takes an engine event for `seat`; returns its pop-up or notice, if any. */
  event(
    matchId: string,
    stamped: StampedEvent,
    world: WorldView | undefined,
    seat: number,
  ): { float?: Float; notice?: Notice } {
    if (matchId !== this.matchId) {
      this.matchId = matchId;
      this.tallies.clear();
      this.shotAt.clear();
      this.hits = [];
    }
    if (!this.dedupe.accept(matchId, stamped)) return {};
    const { event, step } = stamped;
    if (event.type === "shot" && event.from.of === "hero") {
      // The engine's striker is the first hero whose shot lands on the unit that step, in shot order.
      const first = this.shotAt.get(event.to.id);
      if (event.to.of === "unit" && first?.step !== step) {
        this.shotAt.set(event.to.id, { step, seat: event.from.id });
        if (this.shotAt.size > SHOTS_KEPT)
          for (const [id, at] of this.shotAt)
            if (at.step < step) this.shotAt.delete(id);
      }
      if (event.to.of === "hero") {
        this.hits.push([event.from.id, event.to.id, step]);
        if (this.hits.length > HITS_KEPT) this.hits.shift();
      }
      return {};
    }
    if (event.type === "death") {
      const first = this.shotAt.get(event.id);
      const mine = seat >= 0 && first?.step === step && first.seat === seat;
      this.shotAt.delete(event.id);
      // The engine pays the first hero whose shot lands on the step a unit dies (`gold.ts`); a spell's kill shows none.
      const friend =
        event.owner !== NEUTRAL && teamOf(event.owner) === teamOf(seat);
      if (!mine || friend) return {};
      const gold =
        event.owner === NEUTRAL ? GOLD.guard : GOLD.lastHit[event.kind];
      return { float: { text: `+${gold}`, x: event.x, y: event.y } };
    }
    if (event.type !== "heroDeath") return {};
    const { seat: victim, killer } = event;
    this.of(victim).deaths++;
    if (killer >= 0 && teamOf(killer) !== teamOf(victim))
      this.of(killer).kills++;
    const helpers = this.assists(event, step, world);
    for (const helper of helpers) this.of(helper).assists++;
    // A watcher (or a rider away) gets no notices: a camp's kill credits seat -1 too.
    if (seat < 0) return {};
    const name = (s: number) =>
      (world?.heroes.find((h) => h.seat === s)?.kind ?? "hero").toUpperCase();
    if (victim === seat)
      return {
        notice: {
          text: `Destroyed by ${killer >= 0 ? name(killer) : "the enemy"}`,
          good: false,
        },
      };
    if (killer === seat)
      return { notice: { text: `KILL · ${name(victim)}`, good: true } };
    if (helpers.includes(seat))
      return { notice: { text: `ASSIST · ${name(victim)}`, good: true } };
    return {};
  }

  /**
   * As the engine's assist (`heroBounty`): the killer's teammates that hit the victim in the last `assistWindow`
   * steps and stand alive within `ASSIST_RADIUS` of it. Spell hits leave no shot, so they are missed here.
   */
  private assists(
    death: { seat: number; killer: number; x: number; y: number },
    step: number,
    world: WorldView | undefined,
  ): number[] {
    const out: number[] = [];
    if (death.killer < 0) return out;
    const team = teamOf(death.killer);
    for (const [by, victim, at] of this.hits) {
      if (victim !== death.seat || by === death.killer || out.includes(by))
        continue;
      if (teamOf(by) !== team || step - at >= GOLD.assistWindow) continue;
      const hero = world?.heroes.find((h) => h.seat === by && h.hp > 0);
      if (!hero) continue;
      const [dx, dy] = [hero.x - death.x, hero.y - death.y];
      if (dx * dx + dy * dy <= ASSIST_RADIUS * ASSIST_RADIUS) out.push(by);
    }
    this.hits = this.hits.filter(([, victim]) => victim !== death.seat);
    return out;
  }

  private of(seat: number): Tally {
    let tally = this.tallies.get(seat);
    if (!tally)
      this.tallies.set(seat, (tally = { kills: 0, deaths: 0, assists: 0 }));
    return tally;
  }

  /** A seat's tally this match (zeros before its first). */
  tally(seat: number): Tally {
    return this.tallies.get(seat) ?? { kills: 0, deaths: 0, assists: 0 };
  }
}
