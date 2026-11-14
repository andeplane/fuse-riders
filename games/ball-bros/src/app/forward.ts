import {
  createCorrectionSmoother,
  type CorrectionSmoother,
} from "fuse-netcode";
import { botControl } from "../engine/bots.js";
import { atan2, cos, sin } from "../engine/math.js";
import {
  control,
  PADDLE_MAX,
  PADDLE_MIN,
  type ArenaState,
  type Base,
  type Control,
} from "../engine/state.js";
import { step } from "../engine/step.js";
import { viewRules } from "../engine/view.js";
import { interpolate } from "../render/present.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded arena is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * log tick the clock has run past it, with the controls each paddle holds (this device's own live, logged or not),
 * and draws that. A press shows on the next animation frame instead of 50–100 ms later, and what is drawn is what
 * the fold will produce unless another player's controls change first. The copy is thrown away: nothing here reaches
 * the room.
 *
 * Only motion is played forward. Outcomes stay the room's: the forward run never crosses a lost core or a change of
 * phase, and armor blocks and pickups are drawn as the room last folded them, so a break or a pickup shows together
 * with its sparks and sound, never on a guess.
 */
export interface ForwardInputs {
  /** What `base` is given for the tick being played; undefined keeps the controls the arena already holds for it. */
  control(arena: ArenaState, base: Base): Control | undefined;
}

const NEUTRAL: Control = { steer: 0, radial: 0, launch: false };

/** One log tick as the fold runs it: everyone's controls, then the step. */
function tick(arena: ArenaState, inputs: ForwardInputs): void {
  for (const base of arena.bases) {
    const given = inputs.control(arena, base);
    if (given) control(arena, base.id, given);
  }
  step(arena);
}

const blended = (a: ArenaState, b: ArenaState, part: number): ArenaState =>
  interpolate(
    { tick: 0, matchId: "", arena: a, rules: viewRules },
    { tick: 1, matchId: "", arena: b, rules: viewRules },
    part,
  ).arena!;

/** The newest arena played forward `ahead` log ticks (0–2, fractional), as an arena to draw. */
export function forward(
  arena: ArenaState,
  ahead: number,
  inputs: ForwardInputs,
): ArenaState {
  // A step that loses a core or changes the phase is not shown: the picture waits at the step before it.
  const crossed = (now: ArenaState) =>
    now.phase !== arena.phase ||
    now.bases.some((base, index) => base.alive !== arena.bases[index]!.alive);
  let drawn = structuredClone(arena),
    left = Math.max(0, ahead);
  for (; left > 0.001; left -= 1) {
    const next = structuredClone(drawn);
    tick(next, inputs);
    if (crossed(next)) break;
    if (left < 1) {
      drawn = blended(drawn, next, left);
      break;
    }
    drawn = next;
  }
  // Outcomes are the room's to show.
  drawn.pickups = structuredClone(arena.pickups);
  drawn.bases.forEach((base, index) =>
    base.blocks.forEach(
      (block, at) => (block.alive = arena.bases[index]!.blocks[at]!.alive),
    ),
  );
  return drawn;
}

/**
 * The controls the forward run plays: a bot answers as the fold would, an absent player holds nothing, this device's
 * own paddle follows what its player holds right now, and every other player keeps what they last logged.
 */
export function forwardInputs(
  connected: (id: string) => boolean,
  me: string,
  live: Control,
): ForwardInputs {
  return {
    control(arena, base) {
      if (base.bot) return botControl(arena, base);
      if (!connected(base.id)) return NEUTRAL;
      return base.id === me ? live : undefined;
    },
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` arena units is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 90;

export interface Smoother {
  /**
   * `arena` (a forward run's own copy, changed in place) with corrections hidden. `revision` is the runtime's frame
   * revision (a rollback replaced history) and `folded` the room's newest arena; `me` is this device's player, never
   * smoothed.
   */
  apply(
    arena: ArenaState,
    revision: number,
    folded: ArenaState,
    matchId: string,
    nowMs: number,
    me: string,
  ): ArenaState;
}

/**
 * Hides what the forward run got wrong. Balls and the other players' paddles are drawn where the room's newest
 * inputs put them; when a rollback moves them, or a new tick shows another player changed what they hold, the
 * screen keeps them where they were and lets the difference decay.
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
    apply(arena, nextRevision, folded, matchId, nowMs, me) {
      const match = `${matchId}:${folded.phase}`;
      // A new round or a countdown places everything afresh: start again.
      if (match !== key) {
        key = match;
        smoother.reset();
      }
      smoother.begin(nowMs);
      const rolled = revision !== undefined && nextRevision !== revision,
        stepped = folded.tick !== tick,
        before = logged;
      revision = nextRevision;
      tick = folded.tick;
      // A bot is played forward exactly as the fold plays it: only a person's controls can surprise the forward run.
      logged = new Map(
        folded.bases
          .filter((base) => !base.bot)
          .map((base) => [base.id, `${base.steer}:${base.radial}`]),
      );
      const shift = new Map<string, { x: number; y: number }>();
      for (const base of arena.bases) {
        if (!base.alive || base.id === me) continue;
        const was = before.get(base.id),
          changed = stepped && was !== undefined && was !== logged.get(base.id);
        // The paddle's middle is the body: a point on the screen, with no angle to wrap.
        const x = base.x + cos(base.angle) * base.radius,
          y = base.y + sin(base.angle) * base.radius,
          at = smoother.place(`paddle:${base.id}`, { x, y }, rolled || changed);
        if (at.x === x && at.y === y) continue;
        shift.set(base.id, { x: at.x - x, y: at.y - y });
        base.angle = atan2(at.y - base.y, at.x - base.x);
        base.radius = Math.max(
          PADDLE_MIN,
          Math.min(PADDLE_MAX, Math.hypot(at.x - base.x, at.y - base.y)),
        );
      }
      for (const ball of arena.balls) {
        if (ball.held) {
          // A ball a paddle holds rides that paddle, wherever it is drawn.
          const moved = shift.get(ball.held);
          if (moved) {
            ball.x += moved.x;
            ball.y += moved.y;
          }
          continue;
        }
        Object.assign(ball, smoother.place(`ball:${ball.id}`, ball, rolled));
      }
      return arena;
    },
  };
}
