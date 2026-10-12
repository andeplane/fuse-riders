import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLY,
  ASKED_RAISE,
  BUY,
  CLASS,
  COLLEGE,
  DEPOSIT,
  ENROLL,
  EXTEND,
  EXTENDED,
  FRESHCO,
  GADGET,
  GIG,
  GIGAFACTORY,
  HOURS,
  ITEMS,
  JOBHUB,
  JOBS,
  KEYNEST,
  MEGAMART,
  MONO,
  MOVE,
  NEOBANK,
  PAY_ARREARS,
  PAY_RENT,
  PLACES,
  QUIT,
  RAISE,
  RELAX,
  ROOMSHARE,
  THREADS,
  TOWER,
  TRADE_BUY,
  TRADE_SELL,
  TRIED_EXTENSION,
  UNITS_PER_HOUR,
  WEEK_UNITS,
  WITHDRAW,
  WORK,
  buyCost,
  doorOf,
  enrollFee,
  gigWage,
  marketWage,
  nextStep,
  rentPrice,
  resolveApplications,
  shelfPrice,
  sleep,
  type FuseLaneRoom,
  type PlayerState,
} from "../src/game/index.js";
import { act, fold, started, walk } from "./fixtures/lane.js";

/** Item indices, by name, so a reordering of the shop data fails loudly here. */
const item = (name: string): number => {
  const index = ITEMS.findIndex((entry) => entry.name === name);
  assert.ok(index >= 0, name);
  return index;
};
const job = (title: string, employer?: number): number => {
  const index = JOBS.findIndex(
    (entry) =>
      entry.title === title &&
      (employer === undefined || entry.employer === employer),
  );
  assert.ok(index >= 0, title);
  return index;
};
const COOK = job("Line Cook");
const MEGA = 6,
  MONO_CO = 3;

/** Puts `id` inside `place` with a fresh clock, as if they had just walked in. */
function standIn(
  room: FuseLaneRoom,
  id: string,
  place: number,
  time = 0,
): PlayerState {
  const player = room.players[id]!;
  player.pos = doorOf(place);
  player.dest = -1;
  player.inside = place;
  player.time = time;
  return player;
}
/** Logs one action for `id` at the next tick and folds it. */
function doing(
  room: FuseLaneRoom,
  id: string,
  place: number,
  action: number,
  a = 0,
  b = 0,
): PlayerState {
  fold(room, { [id]: [act(room, place, action, a, b)] });
  return room.players[id]!;
}
/** Nothing happened: no answer, no hours, no money. */
function unchanged(player: PlayerState, run: () => void): void {
  const { msgN, time, cash, bank } = player;
  run();
  assert.deepEqual(
    [player.msgN, player.time, player.cash, player.bank],
    [msgN, time, cash, bank],
  );
}
function hireCook(room: FuseLaneRoom, id = "a"): PlayerState {
  standIn(room, id, JOBHUB);
  const player = doing(room, id, JOBHUB, APPLY, COOK);
  assert.equal(player.job, COOK);
  player.time = 0;
  return player;
}

test("a purchase you cannot afford names the price, and nothing changes hands", () => {
  const room = started();
  const a = standIn(room, "a", FRESHCO);
  a.cash = 10;
  const spend = [...room.economy.spend];
  const groceries = item("Groceries · 1 week");
  const price = shelfPrice(room.economy, ITEMS[groceries]!);
  doing(room, "a", FRESHCO, BUY, groceries);
  assert.equal(a.msg, `You need $${price}. You have $10.`);
  assert.ok(a.msgBad);
  assert.equal(a.cash, 10);
  assert.equal(a.groceries, 0);
  assert.deepEqual(room.economy.spend, spend);
});

test("food: groceries stack with a happiness once a week, a meal feeds Monday without stacking, a shake is a treat", () => {
  const room = started();
  const a = standIn(room, "a", FRESHCO);
  a.cash = 1000;
  const groceries = item("Groceries · 1 week");
  doing(room, "a", FRESHCO, BUY, groceries);
  doing(room, "a", FRESHCO, BUY, groceries);
  assert.equal(a.groceries, 2);
  assert.equal(a.happiness, 1, "the grocery happiness is once a week");
  assert.equal(
    a.msg,
    `Groceries · 1 week: -$${shelfPrice(room.economy, ITEMS[groceries]!)}.`,
  );
  assert.equal(
    room.economy.companies[2]!.spend,
    2 * shelfPrice(room.economy, ITEMS[groceries]!),
    "FreshCo books the sale",
  );

  standIn(room, "a", MONO);
  const burger = item("Mono Burger"),
    double = item("Double Mono"),
    shake = item("Thick shake");
  doing(room, "a", MONO, BUY, burger);
  assert.equal(a.meal, 1);
  assert.equal(a.happiness, 1, "a plain burger is no treat");
  doing(room, "a", MONO, BUY, double);
  doing(room, "a", MONO, BUY, double);
  assert.equal(a.meal, 1, "a second meal does not stack");
  assert.equal(a.happiness, 2, "the meal happiness is once a week");
  doing(room, "a", MONO, BUY, shake);
  assert.match(a.msg, /^Thick shake: -\$\d+, \+1 happiness\.$/);
  doing(room, "a", MONO, BUY, shake);
  assert.match(a.msg, /^Thick shake: -\$\d+\.$/);
  assert.equal(a.happiness, 3);
  assert.equal(a.msgBad, false);
});

test("clothes add weeks every time; a durable is owned once, its first-owner happiness once; a joke costs happiness", () => {
  const room = started();
  const a = standIn(room, "a", THREADS);
  a.cash = 5000;
  const suit = item("Business suit");
  doing(room, "a", THREADS, BUY, suit);
  doing(room, "a", THREADS, BUY, suit);
  assert.deepEqual(a.clothes, [6, 0, 26]);
  assert.equal(a.happiness, 4, "clothes cheer you up every time");

  standIn(room, "a", GADGET);
  const tv = item("Smart TV");
  doing(room, "a", GADGET, BUY, tv);
  assert.deepEqual(a.durables.tv, {
    n: 1,
    paid: shelfPrice(room.economy, ITEMS[tv]!),
    cheap: false,
  });
  assert.equal(a.happiness, 6);
  doing(room, "a", GADGET, BUY, tv);
  assert.equal(a.msg, "You already own one.");
  assert.ok(a.msgBad);
  // Stolen: a replacement from the discount store is cheap, and no first-owner bonus.
  a.durables.tv!.n = 0;
  standIn(room, "a", MEGAMART);
  doing(room, "a", MEGAMART, BUY, item("Smart TV (budget)"));
  assert.equal(a.durables.tv!.cheap, true);
  assert.equal(a.durables.tv!.n, 1);
  assert.equal(a.happiness, 6);

  const nft = item("Sandwich NFT");
  doing(room, "a", MEGAMART, BUY, nft);
  assert.match(a.msg, /^Sandwich NFT: -\$\d+, -1 happiness\. Regret\.$/);
  assert.ok(a.msgBad);
  assert.equal(a.happiness, 5);
  // An item from another shop, or none at all, is not sold here.
  unchanged(a, () => doing(room, "a", MEGAMART, BUY, tv));
  unchanged(a, () => doing(room, "a", MEGAMART, BUY, ITEMS.length));
});

test("a raise needs the market above your wage and a record of showing up", () => {
  const room = started();
  const a = hireCook(room);
  a.exp = 0; // no seniority step due: only the market moves the wage here
  const wage = a.wage;
  room.economy.wageIndex *= 1.5;
  const market = marketWage(room.economy, JOBS[COOK]!);
  doing(room, "a", JOBHUB, RAISE);
  assert.equal(a.msg, `Raise! Now $${market.toFixed(2)}/h.`);
  assert.equal(a.wage, market);
  assert.ok(market > wage);
  assert.equal(a.raises, 1);
  assert.equal(a.time, HOURS.raise * UNITS_PER_HOUR);
  assert.ok(a.flags & ASKED_RAISE);
  doing(room, "a", JOBHUB, RAISE);
  assert.equal(
    a.msg,
    `The market pays $${market.toFixed(2)}/h. You already get more. Put in more shifts first.`,
  );
  assert.ok(a.msgBad);
  room.economy.wageIndex *= 1.5;
  a.dep = 12; // a second raise needs 10 + 5
  doing(room, "a", JOBHUB, RAISE);
  assert.equal(a.msg, "Not now. Show up more and ask again.");
  assert.equal(a.wage, market);
  // Only at the Job Hub, and only with a job.
  standIn(room, "a", MONO);
  unchanged(a, () => doing(room, "a", MONO, RAISE));
  const b = standIn(room, "b", JOBHUB);
  unchanged(b, () => doing(room, "b", JOBHUB, RAISE));
});

test("quitting at the Job Hub ends the job; gig work pays at once, prorated on the week's last hours", () => {
  const room = started();
  const a = hireCook(room);
  doing(room, "a", JOBHUB, QUIT);
  assert.equal(a.job, -1);
  assert.equal(a.wage, 0);
  assert.match(a.msg, /You quit/);
  unchanged(a, () => doing(room, "a", JOBHUB, QUIT));

  const full = Math.round(gigWage(room.economy) * 8);
  const cash = a.cash;
  doing(room, "a", JOBHUB, GIG);
  assert.equal(a.cash, cash + full);
  assert.equal(a.msg, `Delivered 14 burritos: +$${full}.`);
  assert.equal(a.time, HOURS.gig * UNITS_PER_HOUR);
  a.time = WEEK_UNITS - 3 * UNITS_PER_HOUR;
  doing(room, "a", JOBHUB, GIG);
  assert.equal(a.cash, cash + full + Math.floor((full * 3) / 6));
  assert.equal(a.time, WEEK_UNITS);
  assert.ok(a.done, "out of hours, the week is over");
  const b = standIn(room, "b", MONO);
  unchanged(b, () => doing(room, "b", MONO, GIG));
});

test("an application answers why not: your own job, a freeze, missing requirements, a failed roll", () => {
  const room = started();
  const a = hireCook(room);
  doing(room, "a", JOBHUB, APPLY, COOK);
  assert.equal(a.msg, "You already work there. Ask for a raise instead.");
  assert.equal(a.time, 0, "and costs no hours");

  const floor = job("Floor Associate");
  room.economy.companies[MEGA]!.health = -1;
  doing(room, "a", JOBHUB, APPLY, floor);
  assert.equal(a.msg, "MegaMart has a hiring freeze.");
  assert.equal(a.time, HOURS.apply * UNITS_PER_HOUR, "asking still costs");
  room.economy.companies[MEGA]!.health = 0.2;

  const b = standIn(room, "b", JOBHUB);
  b.clothes = [0, 0, 0];
  doing(room, "b", JOBHUB, APPLY, job("Store Manager", MEGA));
  assert.equal(
    b.msg,
    "Not yet: you need a degree, work history, experience, the right clothes.",
  );
  b.clothes = [6, 0, 0];

  // Mass unemployment: the luck roll cannot succeed, and the posting stays shut this week.
  room.economy.unemployment = 60;
  doing(room, "b", JOBHUB, APPLY, floor);
  assert.equal(b.msg, "No openings right now. Try another posting.");
  assert.deepEqual(b.failed, [floor]);
  room.economy.unemployment = 0;
  doing(room, "b", JOBHUB, APPLY, floor);
  assert.equal(b.msg, "Still no openings. Try next week.");
  assert.equal(b.job, -1);

  // The factory gate takes the factory's own jobs only.
  standIn(room, "b", GIGAFACTORY);
  unchanged(b, () => doing(room, "b", GIGAFACTORY, APPLY, floor));
});

test("equal applicants in the same slot are ordered by id, so every replica hires the same one", () => {
  for (const order of [
    ["b", "a"],
    ["a", "b"],
  ]) {
    const room = started();
    standIn(room, "a", JOBHUB);
    standIn(room, "b", JOBHUB);
    resolveApplications(
      room,
      order.map((id) => ({ id, job: COOK, slot: 0 })),
    );
    assert.equal(room.players.a!.job, COOK);
    assert.match(room.players.b!.msg, /Ada holds that job/);
  }
});

test("a shift needs the uniform; slipping dependability draws a warning, then the sack", () => {
  const room = started();
  const a = hireCook(room);
  standIn(room, "a", MONO);
  a.clothes = [0, 0, 0];
  doing(room, "a", MONO, WORK);
  assert.equal(a.msg, "You're not dressed for this job. Threads can fix that.");
  assert.equal(a.shifts, 0);
  a.clothes = [6, 0, 0];

  const company = room.economy.companies[MONO_CO]!;
  const gross = Math.round(a.wage * 8);
  doing(room, "a", MONO, WORK);
  assert.equal(a.msg, `Shift done: +$${gross}.`);
  assert.equal(company.wages, gross);
  assert.ok(company.output > 0);

  a.dep = 7;
  a.flags = 0;
  doing(room, "a", MONO, WORK);
  assert.equal(
    a.msg,
    `Shift done: $${gross}. Your boss says: show up more, or else.`,
  );
  assert.ok(a.msgBad);
  assert.equal(a.dep, 8);

  // Arrears smaller than half the pay are taken whole.
  a.rentOwed = 5;
  a.time = 0;
  const cash = a.cash;
  doing(room, "a", MONO, WORK);
  assert.equal(a.cash, cash + gross - 5);
  assert.equal(a.rentOwed, 0);
  assert.equal(a.msg, `Shift done: $${gross - 5} (KeyNest garnished $5).`);
  assert.equal(room.economy.companies[7]!.spend, 5);

  a.dep = 4;
  a.time = 0;
  doing(room, "a", MONO, WORK);
  assert.equal(a.msg, "You missed too much work. You're fired!");
  assert.equal(a.job, -1);
  assert.equal(a.wage, 0);
  unchanged(a, () => doing(room, "a", MONO, WORK));
});

test("the college's own staff are paid outside the company books, and only at the college", () => {
  const room = started();
  const custodian = job("Custodian");
  const b = standIn(room, "b", JOBHUB);
  doing(room, "b", JOBHUB, APPLY, custodian);
  if (b.job !== custodian) {
    // The luck roll: retry with odds made certain.
    b.failed = [];
    b.dep = 200;
    doing(room, "b", JOBHUB, APPLY, custodian);
  }
  assert.equal(b.job, custodian);
  unchanged(b, () => doing(room, "b", JOBHUB, WORK));
  standIn(room, "b", COLLEGE);
  const books = room.economy.companies.map((company) => company.wages);
  doing(room, "b", COLLEGE, WORK);
  assert.equal(b.shifts, 1);
  assert.deepEqual(
    room.economy.companies.map((company) => company.wages),
    books,
  );
});

test("study: enrolling needs the fee and an open course, a class needs enrolment, and books and a laptop cut lessons", () => {
  const room = started();
  const a = standIn(room, "a", COLLEGE);
  a.cash = 10;
  doing(room, "a", COLLEGE, ENROLL, 0);
  assert.equal(a.msg, `You need $${enrollFee(room.economy, 0)}. You have $10.`);
  assert.equal(a.courses[0], -1);
  doing(room, "a", COLLEGE, CLASS, 0);
  assert.equal(a.msg, "Enroll first.");
  a.cash = 1000;
  doing(room, "a", COLLEGE, ENROLL, 0);
  assert.equal(a.msg, "Enrolled in Trade Cert.");
  unchanged(a, () => doing(room, "a", COLLEGE, ENROLL, 0));
  unchanged(a, () => doing(room, "a", COLLEGE, ENROLL, 99));
  unchanged(a, () => doing(room, "a", COLLEGE, CLASS, 99));

  doing(room, "a", COLLEGE, CLASS, 0);
  assert.equal(a.msg, "Class done. 9 to go.");
  a.durables.books = { n: 1, paid: 160, cheap: false };
  a.durables.laptop = { n: 1, paid: 1599, cheap: false };
  a.courses[0] = 7;
  a.time = 0;
  doing(room, "a", COLLEGE, CLASS, 0);
  assert.equal(a.msg, "Graduated: Trade Cert! Hat toss.");
  assert.equal(a.courses[0], 10, "eight lessons with books and a laptop");
  assert.equal(a.happiness, 5);
  unchanged(a, () => doing(room, "a", COLLEGE, CLASS, 0));
  standIn(room, "a", JOBHUB);
  unchanged(a, () => doing(room, "a", JOBHUB, ENROLL, 4));
});

test("rent: pay ahead up to a cap, the first payment after rent day covers the rest of the period", () => {
  const room = started();
  const a = standIn(room, "a", KEYNEST);
  a.cash = 5000;
  doing(room, "a", KEYNEST, PAY_RENT);
  assert.equal(a.rentWeeks, 7);
  assert.equal(a.msg, "Rent paid: 7 weeks covered.");
  doing(room, "a", KEYNEST, PAY_RENT);
  assert.equal(a.rentWeeks, 11);
  unchanged(a, () => doing(room, "a", KEYNEST, PAY_RENT));

  const b = standIn(room, "b", KEYNEST);
  b.rentWeeks = 0;
  room.week = 2;
  b.cash = 10;
  doing(room, "b", KEYNEST, PAY_RENT);
  assert.equal(b.msg, `You need $${b.rent}. You have $10.`);
  b.cash = 1000;
  doing(room, "b", KEYNEST, PAY_RENT);
  assert.equal(b.rentWeeks, 2, "week 2 of the period: two weeks left");
  standIn(room, "b", NEOBANK);
  unchanged(b, () => doing(room, "b", NEOBANK, PAY_RENT));
});

test("an extension is asked once a week, granted with falling odds, and never after a garnishment", () => {
  const room = started();
  const a = standIn(room, "a", KEYNEST);
  unchanged(a, () => doing(room, "a", KEYNEST, EXTEND));
  a.rentWeeks = 0;
  doing(room, "a", KEYNEST, EXTEND);
  assert.equal(a.msg, "Fine. One more week. Don't make it a habit.");
  assert.equal(a.rentExt, 1);
  assert.ok(a.flags & EXTENDED);
  assert.ok(a.flags & TRIED_EXTENSION);
  assert.equal(a.happiness, 1);
  unchanged(a, () => doing(room, "a", KEYNEST, EXTEND));

  // The odds below take hundreds of folds: keep the week from timing out under them.
  room.phaseEnd = Number.MAX_SAFE_INTEGER;
  a.flags = 0;
  a.rentExt = -1;
  doing(room, "a", KEYNEST, EXTEND);
  assert.equal(a.msg, "No extension. The landlord has spoken.");
  assert.equal(a.happiness, 0);

  // Each extension already granted makes the next less likely: 12, 9, 6 and 3 in 12.
  const granted = [0, 1, 2, 3].map((extensions) => {
    let yes = 0;
    for (let seed = 0; seed < 600; seed++) {
      a.flags = 0;
      a.rentExt = extensions;
      room.rng = seed * 7919;
      doing(room, "a", KEYNEST, EXTEND);
      if (a.rentExt > extensions) yes++;
    }
    return yes / 600;
  });
  assert.equal(granted[0], 1);
  for (const [index, expected] of [0.75, 0.5, 0.25].entries())
    assert.ok(
      Math.abs(granted[index + 1]! - expected) < 0.08,
      `${index + 1} extensions: ${granted[index + 1]}`,
    );
});

test("arrears are cleared in one payment; moving home signs a 12-week lease, and breaking it costs a month", () => {
  const room = started();
  const a = standIn(room, "a", KEYNEST);
  unchanged(a, () => doing(room, "a", KEYNEST, PAY_ARREARS));
  a.rentOwed = 300;
  doing(room, "a", KEYNEST, PAY_ARREARS);
  assert.equal(a.msg, "You need $300. You have $200.");
  a.cash = 5000;
  doing(room, "a", KEYNEST, PAY_ARREARS);
  assert.equal(a.rentOwed, 0);
  assert.equal(a.cash, 4700);
  assert.equal(a.msg, "Arrears cleared. KeyNest smiles (briefly).");

  unchanged(a, () => doing(room, "a", KEYNEST, MOVE, 0));
  unchanged(a, () => doing(room, "a", KEYNEST, MOVE, 2));
  const tower = rentPrice(room.economy, 1);
  doing(room, "a", KEYNEST, MOVE, 1);
  assert.equal(
    a.msg,
    `Moved to The Tower: $${tower} per 4 weeks, locked 12 weeks.`,
  );
  assert.deepEqual(
    [a.home, a.rent, a.rentWeeks, a.leaseEnd, a.cash],
    [1, tower, 4, room.week + 12, 4700 - tower],
  );
  const roomshare = rentPrice(room.economy, 0);
  doing(room, "a", KEYNEST, MOVE, 0);
  assert.equal(
    a.msg,
    `Moved to Roomshare: $${roomshare} per 4 weeks, locked 12 weeks, $${tower} lease break fee.`,
  );
  assert.equal(a.cash, 4700 - tower - roomshare - tower);
  a.cash = 0;
  doing(room, "a", KEYNEST, MOVE, 1);
  assert.equal(a.home, 0);
  assert.ok(a.msgBad);
});

test("you relax only at your own home", () => {
  const room = started();
  const a = standIn(room, "a", TOWER);
  unchanged(a, () => doing(room, "a", TOWER, RELAX));
  a.home = 1;
  doing(room, "a", TOWER, RELAX);
  assert.equal(a.relax, 28);
  assert.equal(a.msg, "Feet up. Rest +3.");
  doing(room, "a", TOWER, RELAX);
  assert.equal(a.happiness, 2, "the relax happiness is once a week");
  standIn(room, "a", ROOMSHARE);
  unchanged(a, () => doing(room, "a", ROOMSHARE, RELAX));
});

test("Neobank: savings move both ways within what you have; an order needs the cash or the holding", () => {
  const room = started();
  const a = standIn(room, "a", NEOBANK);
  doing(room, "a", NEOBANK, DEPOSIT, 150);
  assert.deepEqual([a.cash, a.bank, a.msg], [50, 150, "Saved $150."]);
  doing(room, "a", NEOBANK, WITHDRAW, 100);
  assert.deepEqual([a.cash, a.bank, a.msg], [150, 50, "Withdrew $100."]);
  doing(room, "a", NEOBANK, DEPOSIT, 151);
  assert.equal(a.msg, "Not enough money for that.");
  doing(room, "a", NEOBANK, WITHDRAW, 51);
  assert.equal(a.msg, "Not enough money for that.");
  assert.deepEqual([a.cash, a.bank], [150, 50]);
  unchanged(a, () => doing(room, "a", NEOBANK, DEPOSIT, 0));

  const cost = buyCost(room.economy, 0, 100);
  doing(room, "a", NEOBANK, TRADE_BUY, 0, 100);
  assert.equal(a.msg, `That costs $${cost}.`);
  doing(room, "a", NEOBANK, TRADE_SELL, 0, 1);
  assert.equal(a.msg, "You don't hold that many.");
  unchanged(a, () => doing(room, "a", NEOBANK, TRADE_BUY, 99, 1));
  unchanged(a, () => doing(room, "a", NEOBANK, TRADE_BUY, 0, 0));
  standIn(room, "a", JOBHUB);
  unchanged(a, () => doing(room, "a", JOBHUB, DEPOSIT, 10));
});

test("walking: a place off the map goes nowhere, and a walk that ends on the week's last unit stays outside", () => {
  const room = started();
  const a = room.players.a!;
  const pos = a.pos;
  fold(room, { a: [walk(room, PLACES.length)] });
  assert.deepEqual([a.pos, a.dest, a.time], [pos, -1, 0]);

  // One step from the Job Hub's door with one unit of the week left.
  const door = doorOf(JOBHUB);
  const before = room.players.b!;
  let from = before.pos;
  while (nextStep(from, JOBHUB) !== door) from = nextStep(from, JOBHUB);
  before.pos = from;
  before.time = WEEK_UNITS - 1;
  fold(room, { b: [walk(room, JOBHUB)] });
  assert.equal(before.pos, door);
  assert.equal(before.time, WEEK_UNITS);
  assert.equal(before.inside, -1, "no hours left to go in");
  assert.equal(before.dest, -1);
  assert.ok(before.done);
});

test("sleep: no spare six hours, no rest", () => {
  const room = started();
  const a = room.players.a!;
  a.time = WEEK_UNITS - 5 * UNITS_PER_HOUR;
  assert.equal(sleep(a), 0);
  assert.equal(a.relax, 25);
  assert.equal(a.happiness, 0);
});
