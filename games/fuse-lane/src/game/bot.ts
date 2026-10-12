import { UNITS_PER_HOUR } from "./basics.js";
import { INDEX_FUND } from "./data/economy.js";
import { ITEMS, type DurableId } from "./data/items.js";
import { COURSES, JOBS } from "./data/jobs.js";
import {
  COLLEGE,
  FRESHCO,
  GADGET,
  JOBHUB,
  KEYNEST,
  MEGAMART,
  MONO,
  NEOBANK,
  THREADS,
  WORKPLACE,
  hiresAtGate,
} from "./data/places.js";
import {
  APPLY,
  BUY,
  CLASS,
  DEPOSIT,
  ENROLL,
  EXTEND,
  GIG,
  HOURS,
  MOVE,
  PAY_ARREARS,
  PAY_RENT,
  RAISE,
  RELAX,
  TRADE_BUY,
  TRADE_SELL,
  WITHDRAW,
  WORK,
  holder,
  missing,
} from "./actions.js";
import {
  buyCost,
  enrollFee,
  hiring,
  marketWage,
  quote,
  rentPrice,
  shelfPrice,
} from "./economy.js";
import type { FuseLaneRoom } from "./room.js";
import { walkSteps } from "./streets.js";
import {
  ASKED_RAISE,
  homePlace,
  TRIED_EXTENSION,
  education,
  fed,
  hasDegree,
  hoursLeft,
  owns,
  wealth,
  wearing,
  type PlayerState,
} from "./state.js";

/**
 * The bot: a simplified port of the original's priority list (goals-ai notes §7): keep a job, pay the rent, keep food
 * and clothes, work, climb the ladder, study, buy goods, save and invest, then sleep. It reads only the room and returns
 * the same kind of decision a player's entry makes, so every replica decides alike and a rollback replays it.
 */
export type BotMove =
  | { kind: "walk"; place: number }
  | { kind: "act"; place: number; action: number; a: number; b: number }
  | { kind: "end" };

/** Ticks between a bot's moves, so its play reads as a person tapping. */
export const BOT_DELAY = 5;
/** A bot that has acted this often in one week calls it a week. */
export const BOT_MAX_ACTS = 60;
/**
 * What each bot level (`room.level`: easy, normal, hard) does with its week: how many moves before it calls it a
 * week, the shifts and classes it aims for, and whether it asks for raises, chases better jobs and buys comfort, and
 * whether it trades.
 */
export const BOT_LEVELS = [
  { acts: 14, shifts: 2, classes: 1, climb: false, trade: false },
  { acts: 30, shifts: 3, classes: 2, climb: true, trade: false },
  { acts: BOT_MAX_ACTS, shifts: 3, classes: 3, climb: true, trade: true },
] as const;

/** Courses in the order a bot studies them: the ones that open the most jobs first. */
const STUDY_ORDER = [4, 0, 5, 2, 3, 1, 6, 7, 8, 9, 10];
const APPLIANCES: readonly DurableId[] = [
  "fridge",
  "stove",
  "tv",
  "airfryer",
  "speakers",
  "freezer",
  "console",
];

const itemAt = (place: number, test: (index: number) => boolean): number =>
  ITEMS.findIndex((item, index) => item.place === place && test(index));

/** The best position a player could get now: free, hiring, requirements met, not refused this week. */
export function bestJob(
  room: FuseLaneRoom,
  id: string,
  player: PlayerState,
): number {
  let best = -1,
    bestWage = player.job >= 0 ? player.wage * 1.1 : 0;
  JOBS.forEach((job, index) => {
    if (index === player.job || player.failed.includes(index)) return;
    const taken = holder(room, index);
    if (taken && taken !== id) return;
    if (!hiring(room.economy, job.employer) || missing(player, job).length)
      return;
    const wage = marketWage(room.economy, job);
    if (wage > bestWage) {
      best = index;
      bestWage = wage;
    }
  });
  return best;
}

/** The next position up that a player is missing only clothes for, if any: worth dressing up for. */
function nextUniform(room: FuseLaneRoom, player: PlayerState): number {
  let level = -1;
  for (const job of JOBS) {
    const reasons = missing(player, job);
    if (
      reasons.length === 1 &&
      reasons[0] === "the right clothes" &&
      marketWage(room.economy, job) > player.wage * 1.1
    )
      level = Math.max(level, job.uniform);
  }
  return level;
}

export function botMove(room: FuseLaneRoom, id: string): BotMove {
  const player = room.players[id]!,
    economy = room.economy,
    left = hoursLeft(player),
    cash = player.cash;
  const level = BOT_LEVELS[room.level] ?? BOT_LEVELS[2];
  if (player.botActs >= level.acts) return { kind: "end" };
  const travel = (place: number) =>
    player.inside === place
      ? 0
      : walkSteps(player.pos, place) / UNITS_PER_HOUR + HOURS.enter;
  const fits = (place: number, hours: number) =>
    travel(place) + hours <= left + 0.001;
  const go = (
    place: number,
    action: number,
    a = 0,
    b = 0,
    hours = 0,
  ): BotMove | undefined => {
    if (!fits(place, hours)) return undefined;
    return player.inside === place
      ? { kind: "act", place, action, a, b }
      : { kind: "walk", place };
  };
  const price = (index: number) => shelfPrice(economy, ITEMS[index]!);
  const goals = player.goals;
  const job = player.job >= 0 ? JOBS[player.job]! : undefined;
  const workplace = job ? WORKPLACE[job.employer]! : -1;
  /** Where to apply for a position: its employer's gate when that hires and is no further than the Job Hub. */
  const office = (index: number) => {
    const gate = WORKPLACE[JOBS[index]!.employer]!;
    return gate >= 0 && hiresAtGate(gate) && travel(gate) <= travel(JOBHUB)
      ? gate
      : JOBHUB;
  };

  // 1. Get a job.
  if (!job) {
    const best = bestJob(room, id, player);
    if (best >= 0) {
      const move = go(office(best), APPLY, best, 0, HOURS.apply);
      if (move) return move;
    }
  }

  // 2. The rent.
  if (player.rentWeeks === 0) {
    if (cash >= player.rent) {
      const move = go(KEYNEST, PAY_RENT);
      if (move) return move;
    } else if (player.bank >= player.rent - cash) {
      const move = go(NEOBANK, WITHDRAW, player.rent - cash);
      if (move) return move;
    } else if ((player.flags & TRIED_EXTENSION) === 0 && player.rentExt >= 0) {
      const move = go(KEYNEST, EXTEND);
      if (move) return move;
    }
  }
  if (player.rentOwed > 0 && cash > player.rentOwed + 300) {
    const move = go(KEYNEST, PAY_ARREARS);
    if (move) return move;
  }

  // 3. Food for Monday.
  if (!fed(player)) {
    if (owns(player, "fridge")) {
      const weeks = cash < 200 ? 1 : cash < 400 ? 2 : 4,
        item = itemAt(FRESHCO, (index) => ITEMS[index]!.weeks === weeks);
      if (cash >= price(item)) {
        const move = go(FRESHCO, BUY, item);
        if (move) return move;
      }
    }
    const burger = itemAt(MONO, (index) => ITEMS[index]!.kind === "meal");
    if (cash >= price(burger)) {
      const move = go(MONO, BUY, burger);
      if (move) return move;
    } else if (player.bank > 60) {
      const move = go(NEOBANK, WITHDRAW, Math.min(player.bank, 100));
      if (move) return move;
    }
  }

  // 4. Clothes: the job's level, or the level the next better job needs.
  const need = job?.uniform ?? 0,
    want = Math.max(need, cash > 600 ? nextUniform(room, player) : -1);
  const weeksAtLeast = (level: number) =>
    Math.max(...player.clothes.slice(level));
  for (const level of want > need ? [need, want] : [need]) {
    if (weeksAtLeast(level) > 1) continue;
    const item = itemAt(THREADS, (index) => ITEMS[index]!.level === level);
    if (cash >= price(item)) {
      const move = go(THREADS, BUY, item);
      if (move) return move;
    }
  }

  // 5. Work three shifts a week (more while broke).
  const dressed = job !== undefined && wearing(player) >= job.uniform;
  if (job && dressed && (player.weekShifts < level.shifts || cash < 150)) {
    const move = go(workplace, WORK, 0, 0, Math.min(HOURS.work, left));
    if (move && left >= 1) return move;
  }

  // 6. A raise, or a better job.
  if (
    level.climb &&
    job &&
    (player.flags & ASKED_RAISE) === 0 &&
    player.raises < 3
  ) {
    const market = marketWage(economy, job);
    if (
      market > player.wage * 1.05 &&
      player.dep >= job.dep + 5 * player.raises + 5
    ) {
      const move = go(JOBHUB, RAISE, 0, 0, HOURS.raise);
      if (move) return move;
    }
  }
  if (job && level.climb) {
    const best = bestJob(room, id, player);
    if (best >= 0 && player.exp >= player.maxExp - 2) {
      const move = go(office(best), APPLY, best, 0, HOURS.apply);
      if (move) return move;
    }
  }

  // 7. Study, while education is short of the goal.
  if (education(player) < goals[2] && player.weekClasses < level.classes) {
    const active = player.courses.findIndex(
      (lessons) => lessons >= 0 && lessons < 10,
    );
    if (active >= 0) {
      const move = go(COLLEGE, CLASS, active, 0, HOURS.class);
      if (move) return move;
    } else {
      const next = STUDY_ORDER.find(
        (course) =>
          player.courses[course]! < 0 &&
          (COURSES[course]!.prereq < 0 ||
            hasDegree(player, COURSES[course]!.prereq)),
      );
      if (next !== undefined && cash > enrollFee(economy) + 150) {
        const move = go(COLLEGE, ENROLL, next, 0, HOURS.class);
        if (move) return move;
      }
    }
    const books = itemAt(
      MEGAMART,
      (index) => ITEMS[index]!.durable === "books",
    );
    if (
      !owns(player, "books") &&
      player.durables.books === undefined &&
      cash > price(books) + 400
    ) {
      const move = go(MEGAMART, BUY, books);
      if (move) return move;
    }
  }

  // 8. Rest and goods, while happiness is short of the goal.
  if (player.relax < 17) {
    const move = go(homePlace(player.home), RELAX, 0, 0, HOURS.relax);
    if (move) return move;
  }
  if (level.climb && player.happiness < goals[1] && cash > 900) {
    const want = APPLIANCES.find(
      (durable) => player.durables[durable] === undefined,
    );
    if (want) {
      const item = itemAt(GADGET, (index) => ITEMS[index]!.durable === want);
      if (cash >= price(item) + 400) {
        const move = go(GADGET, BUY, item);
        if (move) return move;
      }
    }
  }
  if (
    player.home === 0 &&
    owns(player, "fridge") &&
    owns(player, "stove") &&
    room.week >= player.leaseEnd &&
    cash > rentPrice(economy, 1) + 900
  ) {
    const move = go(KEYNEST, MOVE, 1);
    if (move) return move;
  }

  // 9. Save and invest the surplus.
  if (
    level.trade &&
    economy.sentiment < -0.3 &&
    player.holdings[INDEX_FUND]! > 0
  ) {
    const move = go(
      NEOBANK,
      TRADE_SELL,
      INDEX_FUND,
      player.holdings[INDEX_FUND]!,
    );
    if (move) return move;
  }
  if (cash > 1400) {
    const fund = quote(economy, INDEX_FUND);
    const units = Math.floor((cash - 900) / 2 / fund);
    if (
      level.trade &&
      economy.sentiment > 0.15 &&
      units > 0 &&
      buyCost(economy, INDEX_FUND, units) < cash - 600
    ) {
      const move = go(NEOBANK, TRADE_BUY, INDEX_FUND, units);
      if (move) return move;
    }
    const move = go(NEOBANK, DEPOSIT, cash - 700);
    if (move) return move;
  }

  // 10. More work while wealth is short, gig work without a job.
  if (job && dressed && wealth(player, economy) < goals[0] && left >= 3) {
    const move = go(workplace, WORK, 0, 0, Math.min(HOURS.work, left));
    if (move) return move;
  }
  if (!job && left >= HOURS.gig) {
    const move = go(JOBHUB, GIG, 0, 0, HOURS.gig);
    if (move) return move;
  }
  return { kind: "end" };
}
