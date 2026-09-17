/**
 * Every trigger pull of the current round and the riders each one killed, so product analytics can report one
 * event per kill and one per miss for a round every replica has confirmed.
 *
 * Statistics only: nothing in the simulation reads the log. It lives in `GameState` rather than being derived from
 * events because events are emitted speculatively — a replica simulates ahead of confirmed input and a rollback
 * cannot retract an event already reported — while the log is part of the deterministic state every replica agrees
 * on. The current round's log is cleared at the start of every round, which bounds it; the moment a round is
 * decided its log is kept as `DecidedRound` until the next round is decided, so a device that catches up past the
 * round-over pause in one jump still finds it, and reports it once the decision tick is confirmed.
 */

/**
 * What a pull fired. `bomb` is the ordinary lobbed bomb every rider always has — the baseline the powerups are
 * judged against; the rest are the weapon pickups a pull spends. The round-long upgrades (Power, Extra Bomb,
 * Shorter Fuse, GRIP) are deliberately absent: they sharpen every shot rather than being spent by one.
 *
 * A rider can hold several weapons and a pull spends only some of them, so `applyBombActions` labels the pull with
 * the first of `gun`, `shell`, `target`, `five`, `triple`, `bomb` that it spent; whatever it did not
 * spend stays armed for the next pull.
 */
export const WEAPONS = [
  "bomb",
  "triple",
  "five",
  "target",
  "gun",
  "shell",
] as const;
export type Weapon = (typeof WEAPONS)[number];

export interface ShotKill {
  victimId: string;
  /** Ticks into the round when the victim died, which for a shell or a lobbed bomb is later than the pull. */
  elapsed: number;
}

export interface RoundShot {
  /** The id of the first bomb the pull launched; bomb ids restart every round, and so does the log. */
  shot: number;
  shooterId: string;
  weapon: Weapon;
  /** Ticks into the round when the trigger was pulled. */
  elapsed: number;
  /** Bombs the pull put in the air: 1 for Target, more for a volley or with Extra Bomb, which fan out Gun and Shell too. */
  bombs: number;
  /** The shooter's round-long upgrades at the moment of the pull, so outcomes can be split by them. */
  power: number;
  extraBombs: number;
  fuseLevel: number;
  grip: boolean;
  /** Empty for a miss. A rider dies once per round, so one pull can kill at most every other rider. */
  kills: ShotKill[];
}

/**
 * A bound for untrusted checkpoints, not a budget play approaches. A round ends at the 1800-tick draw, and a rider
 * cannot pull while its own lobbed bomb is still in the air, so ordinary bombs allow a pull every sixty
 * ticks or so; only spent pickups (Target, Shell, Gun) come faster, down to the 20-tick minimum reload. A pull past the
 * cap goes unlogged rather than displacing one already logged.
 */
export const MAX_ROUND_SHOTS = 512;

/** A round's log from the moment it was decided, kept until the next round is decided. */
export interface DecidedRound {
  matchId: string;
  round: number;
  /** The tick the round was decided at; the log is final once every replica has confirmed it. */
  tick: number;
  shots: RoundShot[];
}

/**
 * The log as it stands when the round is decided, less the pulls that never got an outcome: a pull that killed
 * nobody while one of its bombs was still in the air was interrupted by the round's end, not a miss. A pull that
 * already killed stays, with the kills it made.
 */
export function decideRound(
  matchId: string,
  round: number,
  tick: number,
  shots: readonly RoundShot[],
  inFlight: ReadonlySet<number>,
): DecidedRound {
  return {
    matchId,
    round,
    tick,
    shots: shots
      .filter((shot) => shot.kills.length > 0 || !inFlight.has(shot.shot))
      .map((shot) => ({
        ...shot,
        kills: shot.kills.map((kill) => ({ ...kill })),
      })),
  };
}

export function recordShot(shots: RoundShot[], shot: RoundShot): void {
  if (shots.length < MAX_ROUND_SHOTS) shots.push(shot);
}

export function recordShotKill(
  shots: readonly RoundShot[],
  shot: number,
  kill: ShotKill,
): void {
  shots.find((entry) => entry.shot === shot)?.kills.push(kill);
}
