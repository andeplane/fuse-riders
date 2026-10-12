import { GOAL_DEFAULT, UNITS_PER_HOUR, WEEK_UNITS } from "./basics.js";
import { ASSET_COUNT } from "./data/economy.js";
import { DURABLES, RENT, type DurableId } from "./data/items.js";
import { COURSES, JOBS, LESSONS } from "./data/jobs.js";
import { ROOMSHARE, TOWER } from "./data/places.js";
import type { Economy } from "./economy.js";
import { STREETS } from "./streets.js";

/** One owned durable: how many, what the last one cost and whether it came from the discount store. */
export interface Owned {
  n: number;
  paid: number;
  cheap: boolean;
}

/** Flags that reset each week. */
export const RELAXED = 1,
  GROCERY_HAPPY = 2,
  MEAL_HAPPY = 4,
  DRINK_HAPPY = 8,
  WORKED = 16,
  EXTENDED = 32,
  TRIED_EXTENSION = 64,
  ASKED_RAISE = 128,
  FLAG_MASK = 255;

/** The four goals, in this order everywhere: Wealth, Happiness, Education, Career. */
export type Goals = [number, number, number, number];
export const GOAL_NAMES = [
  "Wealth",
  "Happiness",
  "Education",
  "Career",
] as const;

export interface PlayerState {
  // Where they are this week.
  /** The step of the streets they stand on, 0..STEPS-1 (`streets.ts`). */
  pos: number;
  /** The place they are walking to, or -1. */
  dest: number;
  /** The place they are inside, or -1 on the road. */
  inside: number;
  /** Clock units used this week, 0..WEEK_UNITS (15 to the hour). */
  time: number;
  /** Their week is over: out of hours, called it a week, or the timer ran out. */
  done: boolean;
  /** Tapped READY in the Monday briefing. */
  ready: boolean;
  /** Hours the coming week starts with already used (starving, the doctor). */
  penalty: number;

  // Money.
  cash: number;
  bank: number;
  /** Units held per asset (`ASSET_NAMES`). */
  holdings: number[];

  // Life.
  happiness: number;
  /** Rest, 10..50: break-in odds and burnout. */
  relax: number;
  /** 0 Roomshare, 1 The Tower. */
  home: number;
  /** Rent per 4 weeks, locked when the lease was signed. */
  rent: number;
  rentWeeks: number;
  rentOwed: number;
  /** Extensions granted; -1 after a garnishment (never again). */
  rentExt: number;
  /** The rent week's debt has been booked (the original's `turnedOver`). */
  rentBooked: boolean;
  /** Moving out before this week costs a month's rent. */
  leaseEnd: number;
  groceries: number;
  /** Fast food eaten this week feeds the coming Monday only. */
  meal: number;
  /** Weeks left per clothing level: casual, smart, business. */
  clothes: number[];
  durables: Partial<Record<DurableId, Owned>>;

  // Work.
  /** `JOBS` index, or -1. */
  job: number;
  wage: number;
  raises: number;
  dep: number;
  exp: number;
  maxExp: number;
  minDep: number;
  eduCredit: number;
  expCredit: number;
  /** Jobs whose luck roll failed this week: they fail again until Monday. */
  failed: number[];

  // Study: lessons per course, -1 when not enrolled, `LESSONS` once graduated.
  courses: number[];

  flags: number;
  goals: Goals;
  /** The week they met every goal, 0 while still playing. */
  finished: number;
  /** This Monday's private notices. */
  notices: string[];
  /** The latest answer to something they did, and a counter that changes with each one. */
  msg: string;
  msgN: number;
  msgBad: boolean;
  /** The tick a bot acts next. */
  botAt: number;
  /** Actions a bot took this week, a runaway guard. */
  botActs: number;
  /**
   * Looks only: this week's walks, three numbers each (the clock unit it set off, the step it set off from and the
   * place it headed for), so the board can replay a finished player's week beside the one still playing. At most
   * `TRAIL_WALKS` walks.
   */
  trail: number[];
  /** Shifts and classes this week. */
  weekShifts: number;
  weekClasses: number;

  // Tallies for results and accounts.
  shifts: number;
  bestWorth: number;
}

/** The most walks a week's trail keeps. */
export const TRAIL_WALKS = 64;

export const HOME_PLACE = [ROOMSHARE, TOWER] as const;
/** The place a home index (0 Roomshare, 1 The Tower) is. */
export const homePlace = (home: number): number =>
  home === 1 ? TOWER : ROOMSHARE;

export function createPlayer(
  goals: Goals,
  rent: number = RENT[0],
): PlayerState {
  return {
    pos: STREETS.start,
    dest: -1,
    inside: -1,
    time: 0,
    done: false,
    ready: false,
    penalty: 0,
    cash: 200,
    bank: 0,
    holdings: Array.from({ length: ASSET_COUNT }, () => 0),
    happiness: 0,
    relax: 25,
    home: 0,
    rent,
    rentWeeks: 3,
    rentOwed: 0,
    rentExt: 0,
    rentBooked: false,
    leaseEnd: 0,
    groceries: 0,
    meal: 0,
    clothes: [6, 0, 0],
    durables: {},
    job: -1,
    wage: 0,
    raises: 0,
    dep: 20,
    exp: 10,
    maxExp: 10,
    minDep: 0,
    eduCredit: 0,
    expCredit: 0,
    failed: [],
    courses: COURSES.map(() => -1),
    flags: 0,
    goals: [...goals],
    finished: 0,
    notices: [],
    msg: "",
    msgN: 0,
    msgBad: false,
    botAt: 0,
    botActs: 0,
    trail: [],
    weekShifts: 0,
    weekClasses: 0,
    shifts: 0,
    bestWorth: 200,
  };
}
export const defaultGoals = (): Goals => [
  GOAL_DEFAULT,
  GOAL_DEFAULT,
  GOAL_DEFAULT,
  GOAL_DEFAULT,
];

export const owns = (player: PlayerState, item: DurableId): boolean =>
  (player.durables[item]?.n ?? 0) > 0;
export const hoursLeft = (player: PlayerState): number =>
  (WEEK_UNITS - player.time) / UNITS_PER_HOUR;
export const degrees = (player: PlayerState): number =>
  player.courses.filter((lessons) => lessons >= LESSONS).length;
/** Lessons a degree needs: 10, one fewer each for study books and a laptop. */
export const lessonsNeeded = (player: PlayerState): number =>
  LESSONS - (owns(player, "books") ? 1 : 0) - (owns(player, "laptop") ? 1 : 0);
/** The best clothing level they still have weeks of, or -1 with nothing to wear. */
export function wearing(player: PlayerState): number {
  for (let level = player.clothes.length - 1; level >= 0; level--)
    if (player.clothes[level]! > 0) return level;
  return -1;
}
export const dressedFor = (player: PlayerState, uniform: number): boolean =>
  wearing(player) >= uniform;
export const hasDegree = (player: PlayerState, course: number): boolean =>
  (player.courses[course] ?? -1) >= LESSONS;
export const fed = (player: PlayerState): boolean =>
  player.groceries > 0 || player.meal > 0;
export const employer = (player: PlayerState): number =>
  player.job >= 0 ? JOBS[player.job]!.employer : -1;

/**
 * Investments at market value: the impact-free price, so pushing a quote up with your own order (or down with a
 * sale) never shows as wealth. Only the week's price step moves what holdings are worth.
 */
export const investments = (player: PlayerState, economy: Economy): number =>
  player.holdings.reduce(
    (sum, qty, asset) => sum + Math.floor(qty * economy.price[asset]!),
    0,
  );
/** Cash + savings + investments − rent owed: what the Wealth goal counts. */
export const liquid = (player: PlayerState, economy: Economy): number =>
  player.cash + player.bank + investments(player, economy) - player.rentOwed;
export const goods = (player: PlayerState): number =>
  DURABLES.reduce((sum, id) => {
    const owned = player.durables[id];
    return sum + (owned ? owned.n * owned.paid : 0);
  }, 0);
export const netWorth = (player: PlayerState, economy: Economy): number =>
  liquid(player, economy) + goods(player);

/** Career: 10 × ⌊dependability / 8⌋ while employed, capped at 100. */
export const career = (player: PlayerState): number =>
  player.job >= 0 ? Math.min(100, 10 * Math.floor(player.dep / 8)) : 0;
/** Education: 1 + 9 × degrees (0 with none). */
export const education = (player: PlayerState): number => {
  const count = degrees(player);
  return count === 0 ? 0 : Math.min(100, 1 + 9 * count);
};
export const wealth = (player: PlayerState, economy: Economy): number =>
  Math.max(0, Math.min(100, Math.floor(liquid(player, economy) / 100)));
/** The four goal stats, in `GOAL_NAMES` order. */
export const stats = (player: PlayerState, economy: Economy): Goals => [
  wealth(player, economy),
  player.happiness,
  education(player),
  career(player),
];
export const meetsGoals = (player: PlayerState, economy: Economy): boolean =>
  stats(player, economy).every((value, index) => value >= player.goals[index]!);
/** Progress toward the goals, 0..1: each stat counts up to its goal only (the original's thermometer). */
export function progress(player: PlayerState, economy: Economy): number {
  const values = stats(player, economy);
  const total = player.goals.reduce((sum, goal) => sum + goal, 0);
  const met = values.reduce(
    (sum, value, index) => sum + Math.min(value, player.goals[index]!),
    0,
  );
  return total > 0 ? met / total : 0;
}
/** How far past their goals they are: the first tie-break between same-week winners. */
export const overshoot = (player: PlayerState, economy: Economy): number =>
  stats(player, economy).reduce(
    (sum, value, index) => sum + value - player.goals[index]!,
    0,
  );

export const addHappiness = (player: PlayerState, delta: number): void => {
  player.happiness = Math.max(0, Math.min(100, player.happiness + delta));
};
export const spendHours = (player: PlayerState, hours: number): void => {
  player.time = Math.min(WEEK_UNITS, player.time + hours * UNITS_PER_HOUR);
};
export function say(player: PlayerState, text: string, bad = false): void {
  player.msg = text;
  player.msgN++;
  player.msgBad = bad;
}
export function notify(player: PlayerState, text: string): void {
  if (player.notices.length < 12) player.notices.push(text);
}
