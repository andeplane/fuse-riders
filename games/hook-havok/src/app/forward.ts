import {
  createCorrectionSmoother,
  createLeadClock,
  ticksAhead,
  type CorrectionSmoother,
  type FrameTiming,
} from "fuse-netcode";
import { stepArena, type Arena } from "../engine/arena.js";
import { planBots } from "../engine/bot.js";
import type { Mind } from "../engine/bot-mind.js";
import type { KeeperView } from "../engine/view.js";
import { NEUTRAL, type Input } from "../engine/world.js";
import { hookGame, stepInputs, type Room, type View } from "../online/game.js";
import { interpolate } from "../render/interpolation.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded room is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * log tick the clock has run past it, with the input each keeper holds (this device's own live, logged or not), and
 * draws that. A press shows on the next animation frame instead of 50–100 ms later, and what is drawn is what the
 * fold will produce unless another keeper's input changes first. The copy is thrown away: nothing here reaches the
 * room.
 *
 * Only what keepers do is played forward: how they move, hook, charge and throw. What happens to them stays the
 * room's (`confirmed`): knockouts, blasts, pickups, hits, tallies and the contest are shown as the room last folded
 * them, and the forward run never crosses a change of the contest's phase.
 */
export interface ForwardInputs {
  /** This device's keeper, "" when it has none, and what its player holds right now. */
  me: string;
  live: Input;
  /** What every bot plays for the log tick that starts at `arena`, as the fold's `planBots` answers. */
  bots(arena: Arena): Map<string, Input>;
}

/** Engine steps per log tick. */
const STEPS = hookGame.maxSteps;

/** The three steps' inputs of the log tick that starts at `room`, for every keeper, as the fold derives them. */
function plan(
  room: Room,
  inputs: ForwardInputs,
): Map<string, [Input, Input, Input]> {
  const bots = inputs.bots(room.simulation);
  return new Map(
    room.simulation.keepers.map((keeper) => {
      const held = keeper.world.input;
      if (keeper.mind) {
        const planned = bots.get(keeper.id) ?? {
          ...NEUTRAL,
          aimX: held.aimX,
          aimY: held.aimY,
        };
        return [keeper.id, [planned, planned, planned]];
      }
      return [
        keeper.id,
        stepInputs(
          held,
          keeper.connected && keeper.id === inputs.me ? [inputs.live] : [],
        ),
      ];
    }),
  );
}

/** Plays `steps` whole engine steps of `room` on a copy, stopping after one that changes the contest's phase. */
function play(room: Room, steps: number, inputs: ForwardInputs) {
  const copy: Room = {
      ...room,
      simulation: structuredClone(room.simulation),
    },
    phase = room.simulation.contest.phase;
  let controls = new Map<string, [Input, Input, Input]>(),
    taken = 0;
  /** One more engine step; false when it changed the phase. */
  const step = (): boolean => {
    if (taken % STEPS === 0) controls = plan(copy, inputs);
    for (const keeper of copy.simulation.keepers)
      keeper.world.input = { ...controls.get(keeper.id)![taken % STEPS]! };
    stepArena(copy.simulation, true);
    taken++;
    return copy.simulation.contest.phase === phase;
  };
  let crossed = false;
  while (taken < steps && !crossed) crossed = !step();
  return { copy, taken, crossed, step };
}

/** The newest room played forward `ahead` log ticks (0–2, fractional), as a view to draw. */
export function forward(
  room: Room,
  ahead: number,
  inputs: ForwardInputs,
): View {
  const total = Math.max(0, ahead) * STEPS,
    whole = Math.floor(total + 1e-6),
    part = total - whole;
  let run = play(room, whole, inputs);
  // A step that changes the contest's phase is not shown: play again up to the step before it.
  if (run.crossed) return hookGame.view(play(room, run.taken - 1, inputs).copy);
  const view = hookGame.view(run.copy);
  if (part < 0.01 || !run.step()) return view;
  return {
    ...view,
    ...interpolate(view, hookGame.view(run.copy), view.tick + part),
  };
}

/**
 * The bots' plan for a folded room is the same every frame until the next tick is folded or a rollback replaces it,
 * and planning is the most expensive thing the forward run does: ask once per revision and folded tick (`base`, the
 * arena tick the run starts from). Planning also moves each bot's mind on, so a remembered answer puts the minds it
 * left onto the copy being played. A later tick of the run starts from a guess (it depends on what this device holds
 * right now), so its plan is asked for afresh and never kept: the room's next fold must not find a guess in its place.
 */
export function memoBots(
  ask: (arena: Arena) => Map<string, Input> = planBots,
): (revision: number, base: number) => ForwardInputs["bots"] {
  let key = "",
    known: { inputs: Map<string, Input>; minds: Map<string, Mind> } | undefined;
  return (revision, base) => (arena) => {
    if (arena.tick !== base) return ask(arena);
    const id = `${revision}:${base}`;
    if (known && id === key) {
      for (const keeper of arena.keepers) {
        const mind = known.minds.get(keeper.id);
        if (mind && keeper.mind) keeper.mind = structuredClone(mind);
      }
      return known.inputs;
    }
    const inputs = ask(arena);
    key = id;
    known = {
      inputs,
      minds: new Map(
        arena.keepers.flatMap((keeper) =>
          keeper.mind ? [[keeper.id, structuredClone(keeper.mind)]] : [],
        ),
      ),
    };
    return inputs;
  };
}

/** A room view around `keepers`, its own body its first keeper's, as `hookGame.view` builds one. */
function around(view: View, keepers: KeeperView[], room: Partial<View>): View {
  return {
    ...view,
    ...keepers[0]?.body,
    zones: view.zones,
    hit: view.hit,
    bombs: view.bombs,
    blasts: view.blasts,
    knockouts: view.knockouts,
    powers: view.powers,
    pickups: view.pickups,
    pickupEvents: view.pickupEvents,
    shieldPops: view.shieldPops,
    contest: view.contest,
    ...room,
    keepers,
  };
}

/**
 * `ahead`, a forward run's view, with every outcome as the room last folded it (`folded`). A keeper the forward run
 * knocked out or brought back is drawn where the room has it until the room agrees; a bomb the forward run blew up
 * stays until the room's blast replaces it. Keepers still move, hook, charge and throw as played forward.
 */
export function confirmed(ahead: View, folded: View): View {
  const keepers = ahead.keepers.map((keeper): KeeperView => {
    const real = folded.keepers.find(
      (each) => each.id === keeper.id && each.slot === keeper.slot,
    );
    if (!real) return keeper;
    const agrees =
      real.body.deaths === keeper.body.deaths &&
      !real.body.respawn === !keeper.body.respawn;
    return {
      ...real,
      // A keeper's own doing: the throw it just made and the recharge that follows.
      cooldown: keeper.cooldown,
      spawnGuard: keeper.spawnGuard,
      tally: { ...real.tally, thrown: keeper.tally.thrown },
      body: agrees ? keeper.body : real.body,
    };
  });
  const gone = folded.bombs.filter(
    (bomb) => !ahead.bombs.some((each) => each.id === bomb.id),
  );
  return around(ahead, keepers, {
    hit: folded.hit,
    bombs: gone.length ? [...ahead.bombs, ...gone] : ahead.bombs,
    blasts: folded.blasts,
    knockouts: folded.knockouts,
    powers: folded.powers,
    pickups: folded.pickups,
    pickupEvents: folded.pickupEvents,
    shieldPops: folded.shieldPops,
    contest: folded.contest,
    stage: folded.stage,
    seated: folded.seated,
    seats: folded.seats,
    round: folded.round,
  });
}

/**
 * Keeps the room's events audible. The scene plays an event when its tick is past the last view it drew, but a
 * forward run's view is up to two log ticks past the room that folded the event: the event would look old on
 * arrival and never play. Each event is therefore given the tick of the first drawn view that can show it, once,
 * and keeps it: it plays exactly once however the forward run moves around it.
 */
export function createEventLatch(): (view: View, scope: string) => View {
  let key = "",
    through = -1,
    stamps = new Map<string, number>();
  return (view, scope) => {
    // A new round, or a room restored far behind what was drawn, starts again.
    if (scope !== key || view.tick + 12 < through) {
      key = scope;
      through = -1;
      stamps = new Map();
    }
    const at = view.tick > through ? view.tick : through + 1,
      seen = new Map<string, number>();
    through = Math.max(through, view.tick);
    const stamp = <T extends { tick: number }>(name: string, event: T): T => {
      const id = `${name}:${event.tick}`,
        tick = stamps.get(id) ?? at;
      seen.set(id, tick);
      return tick === event.tick ? event : { ...event, tick };
    };
    const all = <T extends { tick: number }>(
      events: T[],
      name: (event: T) => string,
    ): T[] => {
      if (!events.length) return events;
      return events.map((event) => stamp(name(event), event));
    };
    const next = {
      ...view,
      hit: view.hit && stamp(`hit:${view.hit.by}:${view.hit.target}`, view.hit),
      blasts: all(view.blasts, (e) => `blast:${e.id}`),
      knockouts: all(view.knockouts, (e) => `out:${e.target}`),
      pickupEvents: all(view.pickupEvents, (e) => `pick:${e.by}`),
      shieldPops: all(view.shieldPops, (e) => `pop:${e.target}`),
    };
    stamps = seen;
    return next;
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` world units (a respawn) is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 80;

export interface Smoother {
  /**
   * `view` with corrections hidden. `revision` is the runtime's frame revision (a rollback replaced history) and
   * `room` the newest folded room, whose keepers hold what each last logged; `me` is this device's keeper, never
   * smoothed.
   */
  apply(
    view: View,
    revision: number,
    room: Room,
    nowMs: number,
    me: string,
  ): View;
}

/**
 * Hides what the forward run got wrong. Bombs and the other keepers are drawn where the room's newest inputs put
 * them; when a rollback moves them, or a new tick shows another keeper changed what they hold, the screen keeps them
 * where they were and lets the difference decay.
 */
export function createSmoother(
  smoother: CorrectionSmoother = createCorrectionSmoother({
    decayMs: DECAY_MS,
    teleport: TELEPORT,
  }),
): Smoother {
  let revision: number | undefined,
    tick = -1,
    logged = new Map<string, string>(),
    key = "";
  return {
    apply(view, nextRevision, room, nowMs, me) {
      const scope = `${room.matchId}:${room.round}:${view.contest.phase}`;
      // A new round or a countdown places everyone afresh: start again.
      if (scope !== key) {
        key = scope;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision,
        stepped = room.tick !== tick,
        before = logged;
      revision = nextRevision;
      tick = room.tick;
      // A bot is played forward exactly as the fold plays it: only a person's input can surprise the forward run.
      // Where they aim does not move them.
      logged = new Map(
        room.simulation.keepers.flatMap((keeper) => {
          const held = keeper.world.input;
          return keeper.mind
            ? []
            : [
                [
                  keeper.id,
                  `${held.move}:${held.jump}:${held.drop}:${held.fire}:${held.bomb}`,
                ],
              ];
        }),
      );
      let moved = false;
      const keepers = view.keepers.map((keeper) => {
        const body = keeper.body;
        if (keeper.id === me || body.respawn || !keeper.playing) return keeper;
        const was = before.get(keeper.id),
          changed =
            stepped && was !== undefined && was !== logged.get(keeper.id),
          at = smoother.place(
            `keeper:${keeper.id}`,
            { x: body.x, y: body.feet },
            rolled || changed,
          ),
          dx = at.x - body.x,
          dy = at.y - body.feet;
        if (!dx && !dy) return keeper;
        moved = true;
        return {
          ...keeper,
          body: {
            ...body,
            x: at.x,
            feet: at.y,
            wire: body.wire && {
              ...body.wire,
              x: body.wire.x + dx,
              y: body.wire.y + dy,
            },
          },
        };
      });
      let thrown = false;
      const bombs = view.bombs.map((bomb) => {
        const at = smoother.place(`bomb:${bomb.id}`, bomb, rolled);
        if (at.x === bomb.x && at.y === bomb.y) return bomb;
        thrown = true;
        return { ...bomb, ...at };
      });
      if (!moved && !thrown) return view;
      return around(view, moved ? keepers : view.keepers, { bombs });
    },
  };
}

/** What the picture is made from: the runtime's frame timing, its newest folded room and this device's live input. */
export interface LeadSource {
  frameTiming(): FrameTiming<View> | undefined;
  lead(): { room: Room; held: Input } | undefined;
}

/**
 * The whole of drawing at the clock, for one screen: the newest folded room played forward to the clock, outcomes as
 * the room folded them, corrections hidden and events stamped onto the drawn timeline. Undefined when there is
 * nothing to lead with (no running match, or the newest frame is not the room's newest world): the screen then
 * blends the two newest frames a tick behind the clock, as before.
 */
export function createPicture(): (
  source: LeadSource,
  me: string,
  nowMs: number,
) => View | undefined {
  const smoother = createSmoother(),
    leadClock = createLeadClock(),
    bots = memoBots(),
    latch = createEventLatch();
  return (source, me, nowMs) => {
    const timing = source.frameTiming(),
      lead = source.lead();
    if (!timing || !lead || lead.room.simulation.tick !== timing.newer.tick)
      return undefined;
    const revision = timing.revision ?? 0,
      { room } = lead;
    return latch(
      smoother.apply(
        confirmed(
          forward(
            room,
            leadClock(ticksAhead(timing), timing.newer.logTick, nowMs),
            {
              me,
              live: lead.held,
              bots: bots(revision, room.simulation.tick),
            },
          ),
          timing.newer,
        ),
        revision,
        room,
        nowMs,
        me,
      ),
      `${room.matchId}:${room.round}`,
    );
  };
}
