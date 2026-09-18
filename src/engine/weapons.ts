/**
 * The weapons a pickup arms, as one table. A rider always has the ordinary lobbed bomb; a pickup adds a weapon to what
 * it holds (`armWeapon`), and the next trigger pull decides what it fires from the table alone:
 *
 * - the first armed weapon with a `projectile`, in `WEAPON_KINDS` order, fires instead of the lob and is spent;
 * - the first armed weapon with a `volley` widens the pull (the lob, or the projectile's fan), and every armed volley
 *   weapon is spent with it;
 * - the pull is labelled with the first of those two that exists, or `bomb`.
 *
 * `WEAPON_KINDS` is therefore the priority ladder: Gun, then Shell, then Five, then Triple. A new weapon is a
 * `WEAPON_KINDS` entry, a row, and a pickup row that arms it; `launchWeapons` needs no new branch.
 */
import type { TickContext } from "./sim/context.js";
import type { PlayerState } from "./state.js";
import type { Weapon } from "./shot-log.js";
import { GUN_TRACER_TICKS } from "./gun.js";
import { SHELL_SPEED } from "./shell.js";
import { cos, sin } from "./deterministic-math.js";

/** Every weapon a pickup arms, in priority order. */
export const WEAPON_KINDS = ["gun", "shell", "five", "triple"] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

/** One trigger pull of a projectile weapon: its bombs' headings, and the shot id every one of them names. */
export interface ProjectilePull {
  ctx: Pick<TickContext, "state" | "events" | "facts">;
  player: PlayerState;
  angles: readonly number[];
  shot: number;
}

export interface WeaponRule {
  /** What the shot log calls a pull this weapon decides. */
  label: Weapon;
  /** Bombs this adds to a pull: a lob or a projectile's fan (only the first volley armed counts). */
  volley?: number;
  /** Fires this instead of the lob. */
  projectile?: {
    /** The pull's fan is turned by the rider's held sight (`gunAim`), and pressing with it armed raises the sight. */
    aims?: true;
    /** Puts the pull's projectiles on the board, one per heading, and reports each placement. */
    launch: (pull: ProjectilePull) => void;
  };
}

export const WEAPONS: Readonly<Record<WeaponKind, WeaponRule>> = {
  gun: {
    label: "gun",
    projectile: {
      aims: true,
      launch: (pull) =>
        launchProjectiles(
          pull,
          1,
          pull.ctx.state.tick + GUN_TRACER_TICKS,
          true,
        ),
    },
  },
  shell: {
    label: "shell",
    projectile: {
      launch: (pull) =>
        launchProjectiles(pull, SHELL_SPEED, Number.MAX_SAFE_INTEGER, false),
    },
  },
  five: { label: "five", volley: 4 },
  triple: { label: "triple", volley: 2 },
};

// ---------------------------------------------------------------------------------------------------------------------
// Storage. Until the state carries `armed`, each weapon lives in the flag it always had.

/** The per-weapon flags a rider carries. */
export interface ArmedHolder {
  gunArmed?: boolean;
  shellArmed?: boolean;
  fiveShotArmed: boolean;
  tripleShotArmed: boolean;
}
const FLAG: Record<WeaponKind, keyof ArmedHolder> = {
  gun: "gunArmed",
  shell: "shellArmed",
  five: "fiveShotArmed",
  triple: "tripleShotArmed",
};

export function isArmed(
  player: Readonly<ArmedHolder>,
  kind: WeaponKind,
): boolean {
  return player[FLAG[kind]] === true;
}

/** A pickup's weapon joins what the rider holds; holding it twice is holding it once. */
export function armWeapon(player: ArmedHolder, kind: WeaponKind): void {
  player[FLAG[kind]] = true;
}

function disarmWeapon(player: ArmedHolder, kind: WeaponKind): void {
  player[FLAG[kind]] = false;
}

// ---------------------------------------------------------------------------------------------------------------------
// The pull, from the table.

/** The projectile weapon a pull would fire now: the first armed one with a `projectile`. */
export function armedProjectile(
  player: Readonly<ArmedHolder>,
): WeaponKind | undefined {
  return WEAPON_KINDS.find(
    (kind) => WEAPONS[kind].projectile && isArmed(player, kind),
  );
}

/** The volley weapon that widens a pull now: the first armed one with a `volley`. */
export function armedVolley(
  player: Readonly<ArmedHolder>,
): WeaponKind | undefined {
  return WEAPON_KINDS.find(
    (kind) => WEAPONS[kind].volley !== undefined && isArmed(player, kind),
  );
}

/** Bombs the armed volley adds to the next pull. */
export function volleyBombs(player: Readonly<ArmedHolder>): number {
  const volley = armedVolley(player);
  return volley === undefined ? 0 : WEAPONS[volley].volley!;
}

/** The pull's label: the projectile it fires, else the volley that widens it, else the plain lob. */
export function pullLabel(player: Readonly<ArmedHolder>): Weapon {
  const decided = armedProjectile(player) ?? armedVolley(player);
  return decided === undefined ? "bomb" : WEAPONS[decided].label;
}

/** What a pull spends: the projectile it fired, if any, and every volley weapon (only the first widened it). */
export function spendPull(
  player: ArmedHolder,
  projectile: WeaponKind | undefined,
): void {
  if (projectile !== undefined) disarmWeapon(player, projectile);
  for (const kind of WEAPON_KINDS)
    if (WEAPONS[kind].volley !== undefined) disarmWeapon(player, kind);
}

/** A projectile per heading, flying at `speed` until `deadline`; a Gun's bullets are marked as tracers. */
function launchProjectiles(
  { ctx: { state, events, facts }, player, angles, shot }: ProjectilePull,
  speed: number,
  deadline: number,
  gun: boolean,
): void {
  for (const angle of angles) {
    const id = state.nextBombId++;
    state.bombs.set(id, {
      id,
      ownerId: player.id,
      launchX: player.x,
      launchY: player.y,
      x: player.x,
      y: player.y,
      launchedTick: state.tick,
      placedTick: state.tick,
      landsAtTick: deadline,
      explodeAtTick: deadline,
      blastRange: 0,
      flightPath: [],
      shot,
      shell: {
        vx: cos(angle) * speed,
        vy: sin(angle) * speed,
        ...(gun ? { gun: true } : {}),
      },
    });
    facts.push({ kind: "bombPlaced", playerId: player.id });
    events.push({
      type: "bombPlaced",
      bombId: id,
      playerId: player.id,
      ...(gun ? { gun: true } : {}),
    });
  }
}
