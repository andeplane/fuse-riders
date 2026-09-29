/**
 * Thrown-bomb rule values (11B). Ticks are 60 Hz engine steps; lengths are
 * world units unless named in subunits. Presentation receives the ones it
 * draws through the view.
 */
/** A charge is full after 0.6 s of holding; holding longer stays full. */
export const CHARGE_TICKS = 36;
/** Launch speed in units/s at a tap and at full charge, before the carry. */
export const TAP_SPEED = 450,
  FULL_SPEED = 950;
/** Share of the keeper's own velocity the bomb carries, so a swing slings it. */
export const CARRY = 0.5;
/** Fuse from the throw, 1.5 s. */
export const FUSE_TICKS = 90;
/** From the release; longer than the fuse, so one bomb per keeper is out. */
export const COOLDOWN_TICKS = 150;
/** Bomb body and blast radii, units. */
export const BOMB_RADIUS = 10,
  BLAST_RADIUS = 80;
/** A bomb caught in a blast goes off this many ticks later. */
export const CHAIN_TICKS = 8;
/** A bomb knockout returns after 1 s with 1 s of spawn protection. */
export const KO_RESPAWN = 60,
  KO_SHIELD = 60;
/** Fall returns keep their original timing. */
export const FALL_RESPAWN = 30,
  FALL_SHIELD = 30;
/**
 * Hard cap on live bombs: five keepers, three bomblets each. A keeper's
 * bomblets always burn out before their cooldown lets them throw again, so the
 * rules never reach it; a split beyond it keeps only the bomblets that fit.
 */
export const MAX_BOMBS = 15;
/** Cluster bomb (11D): three bomblets on the first contact, 0.6× the blast, a 0.6 s fuse. */
export const BOMBLETS = 3,
  BOMBLET_BLAST = 48,
  BOMBLET_FUSE = 36;
/** Bomblet spread sideways and pop upward from the bounce, units per tick. */
export const BOMBLET_SPREAD = 3,
  BOMBLET_POP = 5;
/** Blast and knockout events stay in the state this long for presentation. */
export const EVENT_TICKS = 30,
  MAX_EVENTS = 8;
/** Normal speed kept by a bounce, and tangential speed kept by a bounce or roll. */
export const RESTITUTION = 0.45,
  BOUNCE_FRICTION = 0.8,
  ROLL_FRICTION = 0.95;
/** Units per tick: bounces slower than this rest, rolls slower than STILL stop. */
export const REST_SPEED = 1.5,
  STILL_SPEED = 0.1;
/** Terminal speed in units per tick (1800 units/s). */
export const MAX_BOMB_SPEED = 30;
/** Bombs this far below the arena fizzle; the ceiling keeps them in bounds. */
export const BOMB_FLOOR = 940,
  BOMB_CEILING = -3000;
