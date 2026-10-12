import { UNITS_PER_HOUR, WALK_SPEED, WEEK_UNITS } from "./basics.js";
import { COMPANIES, ECONOMY, EDUCATION, HOUSING } from "./data/economy.js";
import { FESTIVAL } from "./data/events.js";
import { ITEMS } from "./data/items.js";
import { COURSES, JOBS, type JobData } from "./data/jobs.js";
import { borrow, garnishLoan, repay, scratch } from "./credit.js";
import { buyUsed, pawn, redeem } from "./resale.js";
import {
  COLLEGE,
  EMPLOYERS,
  FRESHCO,
  JOBHUB,
  KEYNEST,
  NEOBANK,
  PLACES,
  RESALE,
  WORKPLACE,
  hiresAtGate,
} from "./data/places.js";
import {
  applyTrade,
  buyCost,
  enrollFee,
  fill,
  gigWage,
  hiring,
  marketWage,
  rentPrice,
  sellValue,
  shelfPrice,
  shiftBonus,
  type Economy,
} from "./economy.js";
import { r2, randInt } from "./random.js";
import { nameOf, type FuseLaneRoom } from "./room.js";
import { doorOf, nextStep } from "./streets.js";
import {
  ASKED_RAISE,
  DRINK_HAPPY,
  EXTENDED,
  FUN_HAPPY,
  GROCERY_HAPPY,
  homePlace,
  MEAL_HAPPY,
  RELAXED,
  TRIED_EXTENSION,
  WORKED,
  addHappiness,
  degrees,
  dressedFor,
  hasDegree,
  hoursLeft,
  lessonsNeeded,
  say,
  spendHours,
  type PlayerState,
} from "./state.js";

/**
 * Everything a player does during a week: walking Fusetown's streets and the actions inside each place. Each function
 * validates against the room and does nothing (or answers why not) when the action does not apply, so a stale or
 * hostile entry can never corrupt the room.
 */
export const RELAX = 1,
  WORK = 2,
  APPLY = 3,
  RAISE = 4,
  GIG = 5,
  ENROLL = 6,
  CLASS = 7,
  BUY = 8,
  PAY_RENT = 9,
  EXTEND = 10,
  PAY_ARREARS = 11,
  MOVE = 12,
  DEPOSIT = 13,
  WITHDRAW = 14,
  TRADE_BUY = 15,
  TRADE_SELL = 16,
  QUIT = 17,
  BORROW = 18,
  REPAY = 19,
  SCRATCH = 20,
  PAWN = 21,
  REDEEM = 22,
  BUY_USED = 23,
  LAST_ACTION = 23;

/** Hours each action costs (`HOURS.enter` to walk in the door). */
export const HOURS = {
  enter: 2,
  work: 6,
  class: 6,
  relax: 6,
  apply: 4,
  raise: 4,
  gig: 6,
  /** One order at Neobank's trading desk, so trades are a choice with a cost in time, not a free loop. */
  trade: 1,
} as const;
/** Paid hours per shift: 6 on the clock, 8 on the payslip. */
export const PAID_HOURS = 8;
/** The most a player can prepay in rent weeks. */
export const MAX_PREPAID = 12;

const busy = (player: PlayerState) => player.done || player.time >= WEEK_UNITS;

// ---- walking -------------------------------------------------------------------------------------------------

/** Head for `place`: leaves the building you are in; a place you stand at is entered at once. */
export function walkTo(player: PlayerState, place: number): void {
  if (busy(player) || place < 0 || place >= PLACES.length) return;
  if (player.inside === place) return;
  player.inside = -1;
  player.dest = place;
  if (player.pos === doorOf(place)) arrive(player);
}
function arrive(player: PlayerState): void {
  const place = player.dest;
  player.dest = -1;
  if (player.time >= WEEK_UNITS) return;
  player.inside = place;
  spendHours(player, HOURS.enter);
}
/** One log tick of walking: up to `WALK_SPEED` steps along the shortest way through the streets, each a clock unit. */
export function walkTick(player: PlayerState): void {
  if (player.dest < 0 || busy(player)) return;
  const target = doorOf(player.dest);
  for (let step = 0; step < WALK_SPEED && player.pos !== target; step++) {
    if (player.time >= WEEK_UNITS) return;
    player.pos = nextStep(player.pos, player.dest);
    player.time++;
  }
  if (player.pos === target) arrive(player);
}

// ---- money flows into the economy ----------------------------------------------------------------------------

function spendAt(
  room: FuseLaneRoom,
  place: number,
  category: number,
  amount: number,
): void {
  room.economy.spend[category]! += amount;
  const company = PLACES[place]!.company;
  if (company >= 0) room.economy.companies[company]!.spend += amount;
}
function pay(
  room: FuseLaneRoom,
  player: PlayerState,
  amount: number,
  place: number,
  category: number,
): boolean {
  if (player.cash < amount) {
    say(player, `You need $${amount}. You have $${player.cash}.`, true);
    return false;
  }
  player.cash -= amount;
  spendAt(room, place, category, amount);
  return true;
}

// ---- jobs ----------------------------------------------------------------------------------------------------

/** Who holds a position, or undefined: one player per position. */
export function holder(room: FuseLaneRoom, job: number): string | undefined {
  for (const [id, player] of Object.entries(room.players))
    if (player.job === job) return id;
  return undefined;
}
/** The hiring requirements a player misses, in words; empty when only luck stands between them and the job. */
export function missing(player: PlayerState, job: JobData): string[] {
  const reasons: string[] = [];
  if (!job.degrees.every((course) => hasDegree(player, course)))
    reasons.push("a degree");
  if (player.dep < (job.dep === 10 ? 0 : job.dep)) reasons.push("work history");
  if (player.exp < job.exp) reasons.push("experience");
  if (!dressedFor(player, job.uniform)) reasons.push("the right clothes");
  return reasons;
}
/** How strong an applicant is: who wins when several apply for one opening at once. */
export const strength = (player: PlayerState): number =>
  player.dep + player.exp + 8 * degrees(player);
/** The luck roll's bar: (dep + exp + 8 × degrees + 10) / 3 + 30, harder when unemployment is high. */
export function hireOdds(economy: Economy, player: PlayerState): number {
  const slack = Math.max(0, economy.unemployment - 5) * ECONOMY.hiringSlack;
  return Math.floor((strength(player) + 10) / 3) + 30 - Math.floor(slack);
}

function hire(room: FuseLaneRoom, player: PlayerState, index: number): void {
  const job = JOBS[index]!;
  player.job = index;
  player.raises = 0;
  player.exp += 2;
  // Experience keeps growing on the job well past its bar: it opens seniority raises and the next rung.
  player.maxExp = job.exp + 25;
  player.minDep = job.dep;
  player.dep = Math.max(player.dep, 10);
  player.wage = marketWage(room.economy, job);
  addHappiness(player, 3);
  say(
    player,
    `Hired! ${job.title} at ${EMPLOYERS[job.employer]}, $${player.wage.toFixed(2)}/h.`,
  );
}

/**
 * The applications of one log tick, resolved together: for each position the strongest applicant goes first (then the
 * lower slot), so two players applying in the same moment get the same answer on every device.
 */
export function resolveApplications(
  room: FuseLaneRoom,
  applications: { id: string; job: number; slot: number }[],
): void {
  const byJob = new Map<number, typeof applications>();
  for (const application of applications) {
    const list = byJob.get(application.job) ?? [];
    list.push(application);
    byJob.set(application.job, list);
  }
  for (const job of [...byJob.keys()].sort((a, b) => a - b)) {
    const list = byJob
      .get(job)!
      .sort(
        (a, b) =>
          strength(room.players[b.id]!) - strength(room.players[a.id]!) ||
          a.slot - b.slot ||
          (a.id < b.id ? -1 : 1),
      );
    for (const { id } of list) apply(room, id, job);
  }
}
/** Where a player can apply for a job: the Job Hub, or the gate of an employer that hires there (the factory, the docks). */
export const appliesAt = (place: number, job: JobData): boolean =>
  place === JOBHUB || (place === WORKPLACE[job.employer] && hiresAtGate(place));

function apply(room: FuseLaneRoom, id: string, index: number): void {
  const player = room.players[id]!,
    job = JOBS[index]!;
  if (busy(player) || !appliesAt(player.inside, job)) return;
  if (player.job === index)
    return say(
      player,
      "You already work there. Ask for a raise instead.",
      true,
    );
  const taken = holder(room, index);
  spendHours(player, HOURS.apply);
  if (taken) return say(player, `${nameOf(room, taken)} holds that job.`, true);
  if (!hiring(room.economy, job.employer))
    return say(player, `${EMPLOYERS[job.employer]} has a hiring freeze.`, true);
  const reasons = missing(player, job);
  if (reasons.length)
    return say(player, `Not yet: you need ${reasons.join(", ")}.`, true);
  if (player.failed.includes(index))
    return say(player, "Still no openings. Try next week.", true);
  if (!job.sure && randInt(room, 1, 100) > hireOdds(room.economy, player)) {
    player.failed.push(index);
    return say(player, "No openings right now. Try another posting.", true);
  }
  hire(room, player, index);
}

/** Seniority steps a position pays on top of the market, at most. */
export const MAX_SENIORITY = 4;
/**
 * The wage a seniority raise would give: +8% for each step, with experience past the job's bar (6 a step) and at
 * most `MAX_SENIORITY` steps; the current wage when no step is due. Hard work pays without a degree, slowly.
 */
export function seniorityRaise(player: PlayerState, job: JobData): number {
  const steps = Math.min(
    MAX_SENIORITY,
    Math.floor(Math.max(0, player.exp - job.exp) / 6),
  );
  return player.raises < steps ? r2(player.wage * 1.08) : player.wage;
}

// ---- shifts --------------------------------------------------------------------------------------------------

/** Pay for one shift worth `full` dollars with `left` hours on the clock: prorated when under 6 remain. */
const prorate = (full: number, left: number): number =>
  left >= HOURS.work ? full : Math.floor((full * left) / HOURS.work);

function work(room: FuseLaneRoom, player: PlayerState): void {
  if (player.job < 0) return;
  const job = JOBS[player.job]!;
  if (player.inside !== WORKPLACE[job.employer]) return;
  if (!dressedFor(player, job.uniform))
    return say(
      player,
      "You're not dressed for this job. Threads can fix that.",
      true,
    );
  if (player.dep < player.minDep - 5) {
    player.job = -1;
    player.wage = 0;
    return say(player, "You missed too much work. You're fired!", true);
  }
  const warn = player.dep < player.minDep - 2 && (player.flags & WORKED) === 0;
  if (player.exp < player.maxExp + player.expCredit) player.exp++;
  if (player.dep < player.minDep + 20 + player.eduCredit) player.dep++;
  player.flags |= WORKED;
  const gross = prorate(
    Math.round(
      player.wage * PAID_HOURS * shiftBonus(room.economy, job.employer),
    ),
    hoursLeft(player),
  );
  let net = gross;
  let garnished = 0;
  // The original garnished from full-shift pay even on a short shift; this uses what the shift actually paid.
  if (player.rentOwed > 0 && gross > 0) {
    garnished =
      gross / 2 > player.rentOwed ? player.rentOwed : Math.floor(gross / 2);
    player.rentOwed -= garnished;
    net = gross - garnished;
    player.rentExt = -1;
    room.economy.companies[7]!.spend += garnished;
  }
  // A loan in arrears: Neobank takes half of what is left.
  const toBank = garnishLoan(player, net);
  net -= toBank;
  player.cash += net;
  player.shifts++;
  player.weekShifts++;
  spendHours(player, HOURS.work);
  if (job.employer < COMPANIES.length) {
    const company = room.economy.companies[job.employer]!;
    company.wages += gross;
    company.output += Math.round(gross * ECONOMY.companies.productivity);
  }
  say(
    player,
    toBank
      ? `Shift done: $${net} (Neobank took $${toBank} for your loan${garnished ? `, KeyNest $${garnished}` : ""}).`
      : garnished
        ? `Shift done: $${net} (KeyNest garnished $${garnished}).`
        : warn
          ? `Shift done: $${net}. Your boss says: show up more, or else.`
          : `Shift done: +$${net}.${shiftBonus(room.economy, job.employer) > 1 ? " Rush pay!" : ""}`,
    garnished > 0 || toBank > 0 || warn,
  );
}

// ---- the action dispatcher -----------------------------------------------------------------------------------

/**
 * One action inside a place. `place` must be where the player is; APPLY is not handled here (applications resolve
 * together at the end of the tick, `resolveApplications`).
 */
export function act(
  room: FuseLaneRoom,
  player: PlayerState,
  place: number,
  action: number,
  a: number,
  b: number,
): void {
  if (busy(player) || player.inside !== place) return;
  const economy = room.economy;
  switch (action) {
    case RELAX: {
      if (place !== homePlace(player.home)) return;
      player.relax = Math.min(50, player.relax + 3);
      if ((player.flags & RELAXED) === 0) {
        player.flags |= RELAXED;
        addHappiness(player, 2);
      }
      spendHours(player, HOURS.relax);
      return say(player, "Feet up. Rest +3.");
    }
    case WORK:
      return work(room, player);
    case RAISE: {
      if (place !== JOBHUB || player.job < 0) return;
      const job = JOBS[player.job]!,
        market = marketWage(economy, job);
      player.flags |= ASKED_RAISE;
      spendHours(player, HOURS.raise);
      if (player.dep < job.dep + 5 * player.raises)
        return say(player, "Not now. Show up more and ask again.", true);
      // Behind the market: matched to it. At or above it: a loyal, experienced hand earns a seniority step on top.
      const senior = seniorityRaise(player, job);
      const wage = market > player.wage ? market : senior;
      if (wage <= player.wage)
        return say(
          player,
          `The market pays $${market.toFixed(2)}/h. You already get more. Put in more shifts first.`,
          true,
        );
      player.wage = wage;
      player.raises++;
      return say(player, `Raise! Now $${wage.toFixed(2)}/h.`);
    }
    case QUIT: {
      if (place !== JOBHUB || player.job < 0) return;
      player.job = -1;
      player.wage = 0;
      return say(player, "You quit. Freedom tastes like instant noodles.");
    }
    case GIG: {
      if (place !== JOBHUB) return;
      const gross = prorate(
        Math.round(gigWage(economy) * PAID_HOURS),
        hoursLeft(player),
      );
      const toBank = garnishLoan(player, gross);
      player.cash += gross - toBank;
      spendHours(player, HOURS.gig);
      return say(
        player,
        `Delivered 14 burritos: +$${gross - toBank}.${toBank ? ` Neobank took $${toBank} for the loan.` : ""}`,
      );
    }
    case ENROLL: {
      const course = COURSES[a];
      if (place !== COLLEGE || !course || player.courses[a]! >= 0) return;
      if (course.prereq >= 0 && !hasDegree(player, course.prereq))
        return say(
          player,
          `${course.name} needs ${COURSES[course.prereq]!.name} first.`,
          true,
        );
      if (!pay(room, player, enrollFee(economy, a), place, EDUCATION)) return;
      player.courses[a] = 0;
      return say(player, `Enrolled in ${course.name}.`);
    }
    case CLASS: {
      const course = COURSES[a],
        lessons = player.courses[a] ?? -1;
      if (place !== COLLEGE || !course) return;
      if (lessons < 0) return say(player, "Enroll first.", true);
      if (lessons >= lessonsNeeded(player) || lessons >= 10) return;
      player.courses[a] = lessons + 1;
      player.weekClasses++;
      spendHours(player, HOURS.class);
      if (lessons + 1 >= lessonsNeeded(player)) {
        player.courses[a] = 10;
        addHappiness(player, 5);
        player.dep += 5;
        player.eduCredit += 5;
        player.expCredit += 5;
        return say(player, `Graduated: ${course.name}! Hat toss.`);
      }
      return say(
        player,
        `Class done. ${lessonsNeeded(player) - lessons - 1} to go.`,
      );
    }
    case BUY:
      return buy(room, player, place, a);
    case PAY_RENT: {
      if (place !== KEYNEST || player.rentWeeks >= MAX_PREPAID - 3) return;
      const weeks = player.rentWeeks === 0 ? 4 - (room.week % 4) : 4;
      if (!pay(room, player, player.rent, place, HOUSING)) return;
      player.rentWeeks += weeks;
      return say(player, `Rent paid: ${player.rentWeeks} weeks covered.`);
    }
    case EXTEND: {
      if (
        place !== KEYNEST ||
        player.rentWeeks > 0 ||
        (player.flags & TRIED_EXTENSION) !== 0
      )
        return;
      player.flags |= TRIED_EXTENSION;
      const bar = [0, 3, 6, 9][Math.min(3, player.rentExt)] ?? 12;
      if (player.rentExt >= 0 && randInt(room, 1, 12) > bar) {
        player.rentExt++;
        player.flags |= EXTENDED;
        addHappiness(player, 1);
        return say(player, "Fine. One more week. Don't make it a habit.");
      }
      addHappiness(player, -1);
      return say(player, "No extension. The landlord has spoken.", true);
    }
    case PAY_ARREARS: {
      if (place !== KEYNEST || player.rentOwed <= 0) return;
      if (!pay(room, player, player.rentOwed, place, HOUSING)) return;
      player.rentOwed = 0;
      return say(player, "Arrears cleared. KeyNest smiles (briefly).");
    }
    case MOVE: {
      if (place !== KEYNEST || (a !== 0 && a !== 1) || a === player.home)
        return;
      const price = rentPrice(economy, a),
        penalty = room.week < player.leaseEnd ? player.rent : 0;
      if (!pay(room, player, price + penalty, place, HOUSING)) return;
      player.home = a;
      player.rent = price;
      player.rentWeeks = 4;
      player.leaseEnd = room.week + 12;
      return say(
        player,
        `Moved to ${PLACES[homePlace(a)]!.name}: $${price} per 4 weeks, locked 12 weeks${penalty ? `, $${penalty} lease break fee` : ""}.`,
      );
    }
    case DEPOSIT:
    case WITHDRAW: {
      if (place !== NEOBANK || !Number.isSafeInteger(a) || a <= 0) return;
      const deposit = action === DEPOSIT;
      if ((deposit ? player.cash : player.bank) < a)
        return say(player, "Not enough money for that.", true);
      player.cash += deposit ? -a : a;
      player.bank += deposit ? a : -a;
      return say(player, deposit ? `Saved $${a}.` : `Withdrew $${a}.`);
    }
    case BORROW: {
      if (place !== NEOBANK || !Number.isSafeInteger(a) || a <= 0) return;
      const before = player.loan;
      borrow(room, player, a);
      if (player.loan > before) spendHours(player, HOURS.trade);
      return;
    }
    case REPAY:
      if (place !== NEOBANK || !Number.isSafeInteger(a)) return;
      return repay(player, a);
    case SCRATCH:
      if (place !== FRESHCO) return;
      return scratch(room, player);
    case PAWN:
      if (place !== RESALE) return;
      return pawn(player, a, room.week);
    case REDEEM:
      if (place !== RESALE) return;
      return redeem(player, a);
    case BUY_USED:
      if (place !== RESALE) return;
      return buyUsed(room, player, a, b);
    case TRADE_BUY:
    case TRADE_SELL: {
      if (
        place !== NEOBANK ||
        a < 0 ||
        a >= player.holdings.length ||
        !Number.isSafeInteger(b) ||
        b <= 0
      )
        return;
      // The order fills along its own impact (`fill`), and the spread on top of that is Neobank's revenue.
      if (action === TRADE_BUY) {
        const cost = buyCost(economy, a, b);
        if (player.cash < cost)
          return say(player, `That costs $${cost}.`, true);
        player.cash -= cost;
        player.holdings[a]! += b;
        economy.companies[1]!.spend += Math.max(
          0,
          cost - Math.floor(fill(economy, a, b, true).value),
        );
        applyTrade(economy, a, b, true);
        spendHours(player, HOURS.trade);
        return say(player, `Bought ${b} for $${cost}.`);
      }
      if (player.holdings[a]! < b)
        return say(player, "You don't hold that many.", true);
      const value = sellValue(economy, a, b);
      player.holdings[a]! -= b;
      player.cash += value;
      economy.companies[1]!.spend += Math.max(
        0,
        Math.floor(fill(economy, a, b, false).value) - value,
      );
      applyTrade(economy, a, b, false);
      spendHours(player, HOURS.trade);
      return say(player, `Sold ${b} for $${value}.`);
    }
  }
}

function buy(
  room: FuseLaneRoom,
  player: PlayerState,
  place: number,
  index: number,
): void {
  const item = ITEMS[index];
  if (!item || item.place !== place) return;
  if (item.durable && (player.durables[item.durable]?.n ?? 0) > 0)
    return say(player, "You already own one.", true);
  if (item.kind === "fun" && (player.flags & FUN_HAPPY) !== 0)
    return say(player, "You already had your night out this week.", true);
  if (item.hours && hoursLeft(player) < item.hours)
    return say(
      player,
      `That takes ${item.hours} hours. Not enough left this week.`,
      true,
    );
  const price = shelfPrice(room.economy, item);
  if (!pay(room, player, price, place, item.category)) return;
  if (item.hours) spendHours(player, item.hours);
  let happy = 0;
  switch (item.kind) {
    case "groceries":
      player.groceries += item.weeks!;
      if ((player.flags & GROCERY_HAPPY) === 0) {
        player.flags |= GROCERY_HAPPY;
        happy = item.happy;
      }
      break;
    case "meal":
      // One meal feeds one week; a second one does not stack (the original's Astro Chicken did by accident).
      player.meal = 1;
      if (item.happy && (player.flags & MEAL_HAPPY) === 0) {
        player.flags |= MEAL_HAPPY;
        happy = item.happy;
      }
      break;
    case "fun":
      if ((player.flags & FUN_HAPPY) === 0) {
        player.flags |= FUN_HAPPY;
        happy = item.happy * (room.economy.event === FESTIVAL ? 2 : 1);
      }
      break;
    case "drink":
      if ((player.flags & DRINK_HAPPY) === 0) {
        player.flags |= DRINK_HAPPY;
        happy = item.happy;
      }
      break;
    case "clothes":
      player.clothes[item.level!]! += item.weeks!;
      happy = item.happy;
      break;
    case "durable": {
      const first = player.durables[item.durable!] === undefined;
      player.durables[item.durable!] = {
        n: 1,
        paid: price,
        cheap: item.cheap === true,
      };
      if (first) happy = item.happy;
      break;
    }
    case "joke":
      happy = item.happy;
      break;
  }
  addHappiness(player, happy);
  say(
    player,
    `${item.name}: -$${price}${happy > 0 ? `, +${happy} happiness` : happy < 0 ? `, ${happy} happiness. Regret` : ""}.`,
    happy < 0,
  );
}

/** The week's leftover hours become sleep: one relax press per 6 unused hours, with the relax happiness once. */
export function sleep(player: PlayerState): number {
  const presses = Math.floor(
    (WEEK_UNITS - player.time) / UNITS_PER_HOUR / HOURS.relax,
  );
  if (presses <= 0) return 0;
  player.relax = Math.min(50, player.relax + 3 * presses);
  if ((player.flags & RELAXED) === 0) {
    player.flags |= RELAXED;
    addHappiness(player, 2);
  }
  return presses;
}
