/**
 * From simulation events to what the screen and the speakers do about them. Nothing here draws or plays: `planEvent`
 * says which effects, sounds, shake and freeze an event deserves, and `EventLedger` makes sure a step that is fed
 * again (a rollback re-simulates steps the renderer has already seen) does not fire them twice.
 */
import type { GameEvent, RoundView, UnitView } from "../engine/index.js";
import { teamName } from "./manifest.js";
import type { Sizes } from "./metrics.js";

export type SoundName =
  | "flap"
  | "jump"
  | "pickup"
  | "deposit"
  | "kick"
  | "bounce"
  | "gateEnter"
  | "gateUse"
  | "gateClaim"
  | "kill"
  | "queenKill"
  | "snailMount"
  | "snailEat"
  | "respawn"
  | "regrow"
  | "victoryMilitary"
  | "victoryEconomy"
  | "victorySnail";

export interface SoundCue {
  readonly name: SoundName;
  /** 0 to 1; things the local player did are louder than things that happened elsewhere. */
  readonly volume: number;
  /** -1 (left) to 1 (right), from where on the screen it happened. */
  readonly pan: number;
}

export type Tone = "team" | "berry" | "gold" | "white";

/** A sheet from the manifest played once at a point. */
export interface SpriteEffect {
  readonly kind: "sprite";
  readonly sheet: string;
  readonly x: number;
  readonly y: number;
  readonly flip: boolean;
}

/** Square pixels thrown outward. */
export interface BurstEffect {
  readonly kind: "burst";
  readonly x: number;
  readonly y: number;
  readonly tone: Tone;
  readonly team: number;
  readonly count: number;
  /** Pixels per second at launch, and seconds each lives. */
  readonly speed: number;
  readonly life: number;
}

/** An expanding outline. */
export interface RingEffect {
  readonly kind: "ring";
  readonly x: number;
  readonly y: number;
  readonly tone: Tone;
  readonly team: number;
  readonly radius: number;
}

/** A few characters that rise and fade. */
export interface TextEffect {
  readonly kind: "text";
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly tone: Tone;
  readonly team: number;
}

export type Effect = SpriteEffect | BurstEffect | RingEffect | TextEffect;

export interface Plan {
  readonly effects: readonly Effect[];
  readonly sounds: readonly SoundCue[];
  /** Camera trauma to add, 0 to 1. */
  readonly shake: number;
  /** Milliseconds the picture holds still. */
  readonly hitStop: number;
  /** Strength of a white flash over the whole screen, 0 to 1. */
  readonly flash: number;
}

const NOTHING: Plan = {
  effects: [],
  sounds: [],
  shake: 0,
  hitStop: 0,
  flash: 0,
};

/** Height of a unit's middle above its feet, for effects centred on the body. The art's, not the hitbox's. */
export const bodyLift = (unit: UnitView, sizes: Sizes): number =>
  Math.round(sizes[unit.kind] / 2);

const panOf = (x: number): number =>
  Math.max(-1, Math.min(1, (x - 240) / 240)) * 0.7;

/** A plain key of one event on one step: the same event fed again gives the same key. */
export const eventKey = (step: number, event: GameEvent): string =>
  `${step}:${Object.values(event).join(",")}`;

/**
 * Remembers which events and flaps have already fired. Keys are the step plus the event's own content, so a step
 * fed again is silent, while a rollback that changes what happened on that step still shows the new outcome.
 */
export class EventLedger {
  private readonly seen = new Map<string, number>();
  private newest = 0;

  constructor(private readonly horizon = 600) {}

  /** The events of `view` that have not fired before, in order. */
  fresh(view: RoundView): GameEvent[] {
    this.reach(view.step);
    return view.events.filter((event) =>
      // A round is won once: a rollback may move the winning step, and the sting must not play again for it.
      event.type === "victory"
        ? this.first(`won:${event.team},${event.kind}`, Infinity)
        : this.first(eventKey(view.step, event), view.step),
    );
  }

  /** A new round: everything may happen again. */
  clear(): void {
    this.seen.clear();
    this.newest = 0;
  }

  /** The slots that flapped or jumped on this step and have not been reported for it before. */
  freshFlaps(view: RoundView): number[] {
    this.reach(view.step);
    return view.units
      .filter(
        (unit) =>
          unit.flapped &&
          !unit.dead &&
          this.first(`${view.step}:flap,${unit.slot}`, view.step),
      )
      .map((unit) => unit.slot);
  }

  private first(key: string, step: number): boolean {
    if (this.seen.has(key)) return false;
    this.seen.set(key, step);
    return true;
  }

  /** A step far behind the newest one is a new round: forget everything. Otherwise drop what is too old to return. */
  private reach(step: number): void {
    if (step < this.newest - this.horizon) this.seen.clear();
    if (step < this.newest - this.horizon || step > this.newest)
      this.newest = step;
    if (this.seen.size > this.horizon * 4)
      for (const [key, at] of this.seen)
        if (at < this.newest - this.horizon) this.seen.delete(key);
  }

  get size(): number {
    return this.seen.size;
  }
}

function loudness(localSlot: number, ...slots: number[]): number {
  return slots.includes(localSlot) ? 1 : 0.55;
}

const VICTORY_SOUND = {
  military: "victoryMilitary",
  economy: "victoryEconomy",
  snail: "victorySnail",
} as const;

/** What one event starts. `view` is the step the event happened on; positions come from it. */
export function planEvent(
  event: GameEvent,
  view: RoundView,
  localSlot: number,
  sizes: Sizes,
): Plan {
  const unit = (slot: number): UnitView | undefined => view.units[slot];
  switch (event.type) {
    case "kill": {
      const victim = unit(event.victim);
      if (!victim) return NOTHING;
      const y = victim.y - bodyLift(victim, sizes);
      // A Queen's death is announced by its own event on the same step.
      if (victim.kind === "queen") return NOTHING;
      const mine = event.victim === localSlot || event.killer === localSlot;
      return {
        effects: [
          {
            kind: "sprite",
            sheet: `kill-burst-${teamName(victim.team)}`,
            x: victim.x,
            y,
            flip: false,
          },
          {
            kind: "burst",
            x: victim.x,
            y,
            tone: "team",
            team: victim.team,
            count: 14,
            speed: 90,
            life: 0.55,
          },
        ],
        sounds: [
          {
            name: "kill",
            volume: loudness(localSlot, event.victim, event.killer),
            pan: panOf(victim.x),
          },
        ],
        shake: mine ? 0.45 : 0.3,
        hitStop: mine ? 60 : 35,
        flash: 0,
      };
    }
    case "queenKill": {
      const victim = unit(event.victim);
      if (!victim) return NOTHING;
      const y = victim.y - bodyLift(victim, sizes);
      return {
        effects: [
          {
            kind: "sprite",
            sheet: `queen-death-${teamName(victim.team)}`,
            x: victim.x,
            y,
            flip: false,
          },
          {
            kind: "burst",
            x: victim.x,
            y,
            tone: "team",
            team: victim.team,
            count: 36,
            speed: 150,
            life: 0.9,
          },
          {
            kind: "burst",
            x: victim.x,
            y,
            tone: "gold",
            team: victim.team,
            count: 12,
            speed: 110,
            life: 1.1,
          },
          {
            kind: "ring",
            x: victim.x,
            y,
            tone: "white",
            team: victim.team,
            radius: 70,
          },
          {
            kind: "ring",
            x: victim.x,
            y,
            tone: "team",
            team: victim.team,
            radius: 44,
          },
        ],
        sounds: [{ name: "queenKill", volume: 1, pan: panOf(victim.x) }],
        shake: 1,
        hitStop: 130,
        flash: 0.3,
      };
    }
    case "bounce": {
      const a = unit(event.a),
        b = unit(event.b);
      if (!a || !b) return NOTHING;
      const x = a.x + (b.x - a.x) / 2;
      return {
        effects: [
          {
            kind: "burst",
            x: Math.abs(b.x - a.x) > 240 ? a.x : x,
            y: (a.y - bodyLift(a, sizes) + b.y - bodyLift(b, sizes)) / 2,
            tone: "white",
            team: -1,
            count: 6,
            speed: 70,
            life: 0.25,
          },
        ],
        sounds: [
          {
            name: "bounce",
            volume: loudness(localSlot, event.a, event.b) * 0.8,
            pan: panOf(a.x),
          },
        ],
        shake: 0.12,
        hitStop: 0,
        flash: 0,
      };
    }
    case "bump": {
      const target = unit(event.target);
      if (!target) return NOTHING;
      return {
        effects: [
          {
            kind: "burst",
            x: target.x,
            y: target.y - bodyLift(target, sizes),
            tone: "white",
            team: -1,
            count: 5,
            speed: 60,
            life: 0.25,
          },
        ],
        sounds: [
          {
            name: "bounce",
            volume: loudness(localSlot, event.worker, event.target) * 0.7,
            pan: panOf(target.x),
          },
        ],
        shake: 0.08,
        hitStop: 0,
        flash: 0,
      };
    }
    case "berryPickup": {
      const who = unit(event.slot);
      if (!who) return NOTHING;
      return {
        effects: [
          {
            kind: "sprite",
            sheet: "berry-pop",
            x: who.x,
            y: who.y - sizes[who.kind] - 3,
            flip: false,
          },
        ],
        sounds: [
          {
            name: "pickup",
            volume: loudness(localSlot, event.slot) * 0.8,
            pan: panOf(who.x),
          },
        ],
        shake: 0,
        hitStop: 0,
        flash: 0,
      };
    }
    case "berryDrop":
      return NOTHING;
    case "berryKick": {
      const who = unit(event.slot);
      if (!who) return NOTHING;
      return {
        effects: [
          {
            kind: "burst",
            x: who.x + who.facing * 6,
            y: who.y - 4,
            tone: "berry",
            team: -1,
            count: 4,
            speed: 50,
            life: 0.25,
          },
        ],
        sounds: [
          {
            name: "kick",
            volume: loudness(localSlot, event.slot) * 0.8,
            pan: panOf(who.x),
          },
        ],
        shake: 0,
        hitStop: 0,
        flash: 0,
      };
    }
    case "berryDeposit":
    case "berryKickIn": {
      const hole = view.hives[event.team]?.[event.hole];
      if (!hole) return NOTHING;
      // No number here: the hive's plaque counts.
      return {
        effects: [
          {
            kind: "sprite",
            sheet: "berry-pop",
            x: hole.x,
            y: hole.y,
            flip: false,
          },
          {
            kind: "burst",
            x: hole.x,
            y: hole.y,
            tone: "berry",
            team: -1,
            count: 8,
            speed: 55,
            life: 0.4,
          },
          {
            kind: "ring",
            x: hole.x,
            y: hole.y,
            tone: "team",
            team: event.team,
            radius: 14,
          },
        ],
        sounds: [
          {
            name: "deposit",
            volume: loudness(localSlot, event.slot) * 0.9,
            pan: panOf(hole.x),
          },
        ],
        shake: event.type === "berryKickIn" ? 0.15 : 0.05,
        hitStop: 0,
        flash: 0,
      };
    }
    case "berryRegrow":
      return {
        effects: view.piles.map((pile) => ({
          kind: "ring" as const,
          x: pile.x,
          y: pile.y - 8,
          tone: "berry" as const,
          team: -1,
          radius: 22,
        })),
        sounds: [{ name: "regrow", volume: 0.7, pan: 0 }],
        shake: 0,
        hitStop: 0,
        flash: 0,
      };
    case "gateUse": {
      const gate = view.gates[event.gate];
      const who = unit(event.slot);
      if (!gate || !who) return NOTHING;
      return {
        effects: [
          {
            kind: "sprite",
            sheet: "gate-sparkle",
            x: gate.x,
            y: gate.y - 1,
            flip: false,
          },
          {
            kind: "burst",
            x: gate.x,
            y: gate.y - Math.round(sizes.gate / 2),
            tone: event.kind === "speed" ? "gold" : "team",
            team: who.team,
            count: 18,
            speed: 85,
            life: 0.6,
          },
          {
            kind: "ring",
            x: gate.x,
            y: gate.y - Math.round(sizes.gate / 2),
            tone: "white",
            team: who.team,
            radius: 30,
          },
        ],
        sounds: [
          {
            name: "gateUse",
            volume: loudness(localSlot, event.slot),
            pan: panOf(gate.x),
          },
        ],
        shake: 0.18,
        hitStop: 0,
        flash: 0,
      };
    }
    case "gateClaim": {
      const gate = view.gates[event.gate];
      if (!gate) return NOTHING;
      return {
        effects: [
          {
            kind: "sprite",
            sheet: "gate-sparkle",
            x: gate.x,
            y: gate.y - 1,
            flip: event.team === 1,
          },
          {
            kind: "ring",
            x: gate.x,
            y: gate.y - Math.round(sizes.gate / 2),
            tone: "team",
            team: event.team,
            radius: 26,
          },
          {
            kind: "burst",
            x: gate.x,
            y: gate.y - sizes.gate,
            tone: "team",
            team: event.team,
            count: 8,
            speed: 60,
            life: 0.45,
          },
        ],
        sounds: [
          {
            name: "gateClaim",
            volume: loudness(localSlot, event.slot) * 0.9,
            pan: panOf(gate.x),
          },
        ],
        shake: 0.06,
        hitStop: 0,
        flash: 0,
      };
    }
    case "snailMount":
      return {
        effects: [
          {
            kind: "ring",
            x: view.snail.x,
            y: view.snail.y - Math.round(sizes.snail / 2),
            tone: "team",
            team: unit(event.slot)?.team ?? -1,
            radius: 20,
          },
        ],
        sounds: [
          {
            name: "snailMount",
            volume: loudness(localSlot, event.slot) * 0.9,
            pan: panOf(view.snail.x),
          },
        ],
        shake: 0,
        hitStop: 0,
        flash: 0,
      };
    case "snailEat": {
      const victim = unit(event.victim);
      return {
        effects: [
          {
            kind: "burst",
            x: view.snail.x + view.snail.facing * sizes.snailFront,
            y: view.snail.y - Math.round(sizes.snail / 3),
            tone: "team",
            team: victim?.team ?? -1,
            count: 10,
            speed: 60,
            life: 0.5,
          },
        ],
        sounds: [
          {
            name: "snailEat",
            volume: loudness(localSlot, event.victim, event.rider),
            pan: panOf(view.snail.x),
          },
        ],
        shake: 0.2,
        hitStop: 0,
        flash: 0,
      };
    }
    case "snailFree":
      return NOTHING;
    case "respawn": {
      const who = unit(event.slot);
      if (!who) return NOTHING;
      return {
        effects: [
          {
            kind: "sprite",
            sheet: `respawn-${teamName(who.team)}`,
            x: who.x,
            y: who.y - 1,
            flip: false,
          },
        ],
        sounds: [
          {
            name: "respawn",
            volume: loudness(localSlot, event.slot) * 0.7,
            pan: panOf(who.x),
          },
        ],
        shake: 0,
        hitStop: 0,
        flash: 0,
      };
    }
    case "victory":
      return {
        effects: [],
        sounds: [{ name: VICTORY_SOUND[event.kind], volume: 1, pan: 0 }],
        shake: 0.35,
        hitStop: 0,
        flash: 0.25,
      };
  }
}

/** The puff and the sound of one flap or jump. */
export function planFlap(unit: UnitView, localSlot: number): Plan {
  const winged = unit.kind !== "worker";
  return {
    effects: [
      {
        kind: "sprite",
        sheet: "flap-puff",
        x: unit.x - (winged ? unit.facing * 4 : 0),
        y: unit.y - (winged ? 2 : 1),
        flip: unit.facing < 0,
      },
    ],
    sounds: [
      {
        name: winged ? "flap" : "jump",
        volume: unit.slot === localSlot ? 0.7 : 0.22,
        pan: panOf(unit.x),
      },
    ],
    shake: 0,
    hitStop: 0,
    flash: 0,
  };
}

/** Several plans as one: effects and sounds in order, the strongest shake, freeze and flash. */
export function mergePlans(plans: readonly Plan[]): Plan {
  return {
    effects: plans.flatMap((plan) => plan.effects),
    sounds: plans.flatMap((plan) => plan.sounds),
    shake: Math.max(0, ...plans.map((plan) => plan.shake)),
    hitStop: Math.max(0, ...plans.map((plan) => plan.hitStop)),
    flash: Math.max(0, ...plans.map((plan) => plan.flash)),
  };
}
