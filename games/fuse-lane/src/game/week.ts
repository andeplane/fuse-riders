import { MAX_WEEKS, WEEK_UNITS } from "./basics.js";
import { COMPANIES } from "./data/economy.js";
import { BOLTED_DOWN, DURABLES, DURABLE_NAMES } from "./data/items.js";
import { CLOTHING_NAMES, JOBS } from "./data/jobs.js";
import { COLLEGE_EMPLOYER, PLACES } from "./data/places.js";
import { sleep } from "./actions.js";
import { interest, stepEconomy } from "./economy.js";
import { chance, randInt } from "./random.js";
import { active, playerOrder, type FuseLaneRoom } from "./room.js";
import {
  EXTENDED,
  homePlace,
  addHappiness,
  employer,
  meetsGoals,
  netWorth,
  notify,
  overshoot,
  owns,
  progress,
  wearing,
  type PlayerState,
} from "./state.js";

/**
 * The weekend and Monday: everything between two weeks, in the original's order (turn-engine notes §3–§4) with its
 * bugs fixed. Sleep, then the end-of-week bookkeeping (dependability decay, rent debt), then the economy, the goal
 * check, and the Monday upkeep (food, break-ins, clothes, rent, breakdowns).
 */

/** The end of a player's week: dependability decays and unpaid rent becomes debt. */
function endOfWeek(room: FuseLaneRoom, player: PlayerState): void {
  player.dep = Math.max(0, player.dep - 3);
  const rentWeek = room.week % 4 === 0;
  if (player.rentWeeks === 0 && (player.flags & EXTENDED) === 0) {
    if (rentWeek ? !player.rentBooked : player.rentOwed === 0) {
      player.rentOwed += player.rent;
      player.rentBooked = true;
      notify(
        player,
        `Rent unpaid: $${player.rent} added to your arrears. KeyNest will garnish your pay.`,
      );
    }
  }
}

function layOff(player: PlayerState, why: string): void {
  player.job = -1;
  player.wage = 0;
  addHappiness(player, -7);
  notify(player, why);
}

/** Monday upkeep for one player (from week 2 on). */
function upkeep(room: FuseLaneRoom, player: PlayerState): void {
  if (owns(player, "stove") || owns(player, "airfryer"))
    addHappiness(player, 1);
  if (owns(player, "laptop") && chance(room, 1 / 7)) {
    const fee = randInt(room, 20, 100);
    player.cash += fee;
    addHappiness(player, 3);
    notify(player, `Your laptop landed a side gig: +$${fee}.`);
  }
  if (!owns(player, "hottub")) player.relax = Math.max(10, player.relax - 1);

  // Break-ins: Roomshare only, 1 in (rest + 1).
  const portable = DURABLES.filter(
    (id) => owns(player, id) && !BOLTED_DOWN.includes(id),
  );
  if (
    player.home === 0 &&
    DURABLES.some((id) => owns(player, id)) &&
    randInt(room, 0, player.relax) === 0
  ) {
    const taken = portable.filter(() => randInt(room, 0, 3) !== 0);
    for (const id of taken) player.durables[id]!.n = 0;
    if (taken.length) {
      addHappiness(player, -4);
      notify(
        player,
        `Break-in at Roomshare! Gone: ${taken.map((id) => DURABLE_NAMES[id]).join(", ")}.`,
      );
    }
  }

  // Food.
  let spoiled = false;
  const hadMeal = player.meal > 0;
  if (player.groceries > 0) {
    if (!owns(player, "fridge")) {
      player.groceries = 0;
      addHappiness(player, -2);
      notify(player, "No fridge: your groceries spoiled. You ate them anyway.");
      spoiled = !hadMeal;
    } else {
      const cap = owns(player, "freezer") ? 12 : 6;
      if (player.groceries > cap) {
        player.groceries = cap;
        addHappiness(player, -1);
        notify(player, `Your fridge holds ${cap} weeks. The rest went off.`);
      }
    }
  }
  const eaten = hadMeal || player.groceries > 0 || spoiled;
  player.meal = 0;
  if (player.groceries > 0) player.groceries--;
  let doctor = false;
  if (!eaten) {
    addHappiness(player, -2);
    player.penalty += 20;
    notify(player, "You went hungry. Lost 20 hours to a hunger fog.");
    doctor = randInt(room, 0, 3) === 0;
  } else if (spoiled) doctor = randInt(room, 0, 1) === 0;
  if (player.relax <= 10 && randInt(room, 0, 4) === 0) doctor = true;
  if (doctor && player.cash > 0) {
    const cap = player.cash < 500 ? 50 : 200;
    const bill = Math.min(
      player.cash,
      cap <= 30 ? cap : randInt(room, 30, cap),
    );
    player.cash -= bill;
    addHappiness(player, -4);
    player.penalty += 10;
    notify(
      player,
      `Urgent care visit: -$${bill} and 10 hours in the waiting room.`,
    );
  }

  // Clothes wear out together, a week per stack.
  player.clothes = player.clothes.map((weeks) => Math.max(0, weeks - 1));
  const best = wearing(player);
  if (best < 0)
    notify(player, "You have nothing left to wear. Threads opens at 9.");
  else if (player.clothes[best] === 1)
    notify(
      player,
      `Your ${CLOTHING_NAMES[best]!.toLowerCase()} clothes have one week left.`,
    );

  // Rent.
  if (player.rentWeeks > 0) player.rentWeeks--;
  if (room.week % 4 === 0 && player.rentWeeks === 0) {
    player.rentBooked = false;
    notify(player, `Rent day: $${player.rent} due at KeyNest this week.`);
  }

  // One breakdown at most, and only for someone who can pay for it.
  if (player.cash > 500)
    for (const id of DURABLES) {
      const owned = player.durables[id];
      if (!owned || owned.n === 0 || id === "books") continue;
      if (randInt(room, 0, owned.cheap ? 35 : 50) !== 0) continue;
      const bill = Math.min(
        player.cash,
        randInt(room, Math.floor(owned.paid / 20), Math.floor(owned.paid / 4)),
      );
      player.cash -= bill;
      addHappiness(player, -1);
      notify(
        player,
        `Your ${DURABLE_NAMES[id].toLowerCase()} broke. Repair: $${bill}.`,
      );
      break;
    }
}

/** Orders two players: winners by overshoot then net worth, the rest by goal progress then net worth; 0 is a tie. */
function compare(room: FuseLaneRoom, a: string, b: string): number {
  const economy = room.economy,
    pa = room.players[a]!,
    pb = room.players[b]!;
  const wa = pa.finished > 0 ? 1 : 0,
    wb = pb.finished > 0 ? 1 : 0;
  if (wa !== wb) return wb - wa;
  if (wa && pa.finished !== pb.finished) return pa.finished - pb.finished;
  const first = wa
    ? overshoot(pb, economy) - overshoot(pa, economy)
    : progress(pb, economy) - progress(pa, economy);
  return first || netWorth(pb, economy) - netWorth(pa, economy);
}
/** Every player's finish, best first (`compare`), ties in seat order. */
export function rank(room: FuseLaneRoom): string[] {
  return playerOrder(room).sort((a, b) => compare(room, a, b));
}
/**
 * Who won: the top of the ranking. Several players meeting every goal in the same week do not all win; only an exact
 * tie with the top (the same overshoot and the same net worth) shares the win.
 */
export function winnersOf(room: FuseLaneRoom, ranking: string[]): string[] {
  const top = ranking[0];
  return top === undefined
    ? []
    : ranking.filter((id) => compare(room, id, top) === 0);
}

/**
 * Between two weeks. Returns true when the match is over (someone met all goals, or the week limit).
 */
export function endWeek(room: FuseLaneRoom): boolean {
  const ids = playerOrder(room),
    economy = room.economy;
  for (const id of ids) {
    const player = room.players[id]!;
    player.notices = [];
    const presses = sleep(player);
    if (presses > 0 && active(room.seats.get(id)))
      notify(
        player,
        `You slept off ${presses * 6} spare hours. Rest +${presses * 3}.`,
      );
    endOfWeek(room, player);
  }

  const living = ids.filter((id) => active(room.seats.get(id))).length;
  const news = stepEconomy(economy, room, Math.max(1, living));
  room.headlines = news.headlines;
  room.week++;

  for (const id of ids) {
    const player = room.players[id]!;
    const savings = interest(economy, player.bank);
    if (savings > 0) player.bank += savings;
    news.dividends.forEach((perShare, company) => {
      const paid = Math.floor(perShare * player.holdings[company]!);
      if (paid > 0) {
        player.cash += paid;
        notify(player, `Dividend from ${COMPANIES[company]!.name}: +$${paid}.`);
      }
    });
  }
  // Layoffs: the least dependable player on each struggling company's staff; a crash hits everyone's job.
  for (const company of news.layoffs) {
    const staff = ids
      .filter((id) => employer(room.players[id]!) === company)
      .sort((a, b) => room.players[a]!.dep - room.players[b]!.dep);
    if (staff[0])
      layOff(
        room.players[staff[0]]!,
        `${COMPANIES[company]!.name} is cutting staff. You were laid off.`,
      );
  }
  if (news.crash)
    for (const id of ids) {
      const player = room.players[id]!;
      if (
        player.job >= 0 &&
        JOBS[player.job]!.employer !== COLLEGE_EMPLOYER &&
        chance(room, 1 / 3)
      )
        layOff(player, "The crash took your job with it. Laid off.");
    }

  // The goal check, every Monday.
  const winners = ids.filter((id) => {
    const player = room.players[id]!;
    return (
      player.finished === 0 &&
      active(room.seats.get(id)) &&
      meetsGoals(player, economy)
    );
  });
  for (const id of winners) room.players[id]!.finished = room.week;
  for (const id of ids) {
    const player = room.players[id]!;
    player.bestWorth = Math.max(player.bestWorth, netWorth(player, economy));
  }
  if (winners.length || room.week > MAX_WEEKS) {
    room.ranking = rank(room);
    room.winners = winnersOf(room, room.ranking);
    room.stage = "over";
    return true;
  }

  for (const id of ids) {
    const player = room.players[id]!;
    upkeep(room, player);
    // Monday: home, a fresh clock (minus hunger or the doctor), and the week's flags cleared.
    player.pos = PLACES[homePlace(player.home)]!.ring;
    player.dest = -1;
    player.inside = -1;
    player.time = Math.min(WEEK_UNITS, player.penalty * 15);
    player.penalty = 0;
    player.done = player.time >= WEEK_UNITS;
    player.ready = false;
    player.flags = 0;
    player.failed = [];
    player.botActs = 0;
    player.weekShifts = 0;
    player.weekClasses = 0;
  }
  return false;
}
