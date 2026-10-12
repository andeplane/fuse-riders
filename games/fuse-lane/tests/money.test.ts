import test from "node:test";
import assert from "node:assert/strict";
import {
  BORROW,
  BUY,
  BUY_USED,
  COURSES,
  DURABLES,
  FRESHCO,
  ITEMS,
  JOBS,
  MONO,
  NEOBANK,
  PAWN,
  PAWN_WEEKS,
  RAISE,
  JOBHUB,
  REDEEM,
  REPAY,
  RESALE,
  SCRATCH,
  SCRATCH_PER_WEEK,
  SCRATCH_PRICE,
  SCRATCH_PRIZES,
  WORK,
  WORKPLACE,
  creditLine,
  decodeRoom,
  encodeRoom,
  hashRoom,
  liquid,
  marketWage,
  stats,
  careerCap,
  career,
  type FuseLaneRoom,
} from "../src/game/index.js";
import { comfort, fading } from "../src/game/week.js";
import { act, enter, fold, nextWeek, started } from "./fixtures/lane.js";

const FLOOR = JOBS.findIndex((job) => job.title === "Floor Associate");
const FRIDGE = DURABLES.indexOf("fridge");
const TV = DURABLES.indexOf("tv");

/** `a` holds the Floor Associate job at the market wage, dressed for it. */
function employed(room: FuseLaneRoom): void {
  const a = room.players.a!;
  a.job = FLOOR;
  a.wage = marketWage(room.economy, JOBS[FLOOR]!);
  a.minDep = JOBS[FLOOR]!.dep;
}

test("loans: a credit line from the payslip, cash now, and the debt counts against Wealth", () => {
  const room = started();
  const a = room.players.a!;
  assert.equal(creditLine(a), 200, "a little credit without a job");
  employed(room);
  const line = creditLine(a);
  assert.equal(line, Math.floor((a.wage * 4 * 24) / 100) * 100);
  enter(room, "a", NEOBANK);
  const before = liquid(a, room.economy),
    hours = a.time;
  fold(room, { a: [act(room, NEOBANK, BORROW, line + 100)] });
  assert.equal(a.loan, 0, "nothing past the line");
  assert.match(a.msg, /up to \$\d+ more/);
  fold(room, { a: [act(room, NEOBANK, BORROW, 200)] });
  assert.equal(a.loan, 200);
  assert.equal(a.cash, 400);
  assert.equal(a.time - hours, 15, "an hour of paperwork");
  assert.equal(liquid(a, room.economy), before, "borrowed cash is not wealth");
  fold(room, { a: [act(room, NEOBANK, REPAY, 50)] });
  assert.equal(a.loan, 150);
  assert.equal(a.cash, 350);
  fold(room, { a: [act(room, NEOBANK, REPAY, 1000)] });
  assert.equal(a.loan, 0, "repaying more than owed pays it off");
  assert.equal(a.cash, 200);
  assert.match(a.msg, /Debt free/);
});

test("loans: Monday adds interest and takes a payment; a missed one stops credit and garnishes shifts", () => {
  const room = started();
  employed(room);
  const a = room.players.a!;
  a.loan = 1000;
  a.cash = 500;
  nextWeek(room);
  assert.ok(a.loan < 1000, "a payment was made");
  assert.ok(a.loan > 900, "only a tenth, plus interest");
  assert.equal(a.loanLate, 0);
  assert.ok(a.notices.some((line) => /Loan payment/.test(line)));

  a.cash = 0;
  a.bank = 0;
  const owed = a.loan;
  nextWeek(room);
  assert.equal(a.loanLate, 1);
  assert.ok(a.loan > owed, "interest piles on");
  assert.equal(creditLine(a), 0, "no new credit while late");
  assert.ok(a.notices.some((line) => /Missed a loan payment/.test(line)));

  // A shift now pays half to Neobank.
  a.clothes = [5, 0, 0];
  enter(room, "a", WORKPLACE[JOBS[FLOOR]!.employer]!);
  const loan = a.loan;
  fold(room, {
    a: [act(room, WORKPLACE[JOBS[FLOOR]!.employer]!, WORK)],
  });
  const gross = Math.round(a.wage * 8);
  assert.equal(a.loan, loan - Math.floor(gross / 2));
  assert.equal(a.cash, gross - Math.floor(gross / 2));
  assert.match(a.msg, /Neobank took/);
});

test("scratch cards: $5 each, five a week, prizes from the seeded generator, the same on every replica", () => {
  const play = () => {
    const room = started();
    const a = room.players.a!;
    a.cash = 1000;
    enter(room, "a", FRESHCO);
    for (let card = 0; card < SCRATCH_PER_WEEK + 1; card++)
      fold(room, { a: [act(room, FRESHCO, SCRATCH)] });
    return room;
  };
  const one = play(),
    two = play();
  assert.equal(hashRoom(one), hashRoom(two));
  const a = one.players.a!;
  assert.equal(a.scratched, SCRATCH_PER_WEEK);
  assert.match(a.msg, /cuts you off/);
  assert.ok(a.cash >= 1000 - SCRATCH_PER_WEEK * SCRATCH_PRICE);
  nextWeek(one);
  assert.equal(a.scratched, 0, "a new week, new cards");
});

test("scratch cards pay back about 80% on average", () => {
  const expected = SCRATCH_PRIZES.reduce(
    (sum, { odds, prize }) => sum + (odds / 1000) * prize,
    0,
  );
  assert.ok(Math.abs(expected / SCRATCH_PRICE - 0.8) < 0.01);
});

test("Second Life: a used fridge from day one, first come first served", () => {
  const room = started();
  const shelf = room.shelf.map((offer) => DURABLES[offer.item]);
  assert.deepEqual(shelf, ["fridge", "tv", "airfryer"]);
  const a = room.players.a!,
    b = room.players.b!;
  a.cash = b.cash = 1000;
  enter(room, "a", RESALE);
  enter(room, "b", RESALE);
  const price = room.shelf[0]!.price;
  assert.ok(price < ITEMS.find((item) => item.durable === "fridge")!.price);
  // Both reach for the fridge in the same tick: slot order decides.
  fold(room, {
    a: [act(room, RESALE, BUY_USED, 0, FRIDGE)],
    b: [act(room, RESALE, BUY_USED, 0, FRIDGE)],
  });
  assert.deepEqual(a.durables.fridge, { n: 1, paid: price, cheap: true });
  assert.equal(a.cash, 1000 - price);
  assert.equal(b.durables.fridge, undefined);
  assert.equal(b.cash, 1000);
  assert.match(b.msg, /beat you to it/);
  assert.equal(room.shelf.length, 2);
});

test("Second Life: pawn for 40%, redeem for 50% within three weeks, or lose it to the shelf", () => {
  const room = started();
  const a = room.players.a!;
  a.durables.tv = { n: 1, paid: 500, cheap: false };
  a.durables.console = { n: 1, paid: 300, cheap: false };
  a.home = 1; // The Tower: no break-ins to muddle the test.
  enter(room, "a", RESALE);
  const cash = a.cash;
  fold(room, { a: [act(room, RESALE, PAWN, TV)] });
  assert.equal(a.cash, cash + 200);
  assert.equal(a.durables.tv!.n, 0);
  assert.deepEqual(a.pawned, [
    { item: TV, paid: 500, cheap: false, due: room.week + PAWN_WEEKS },
  ]);
  fold(room, { a: [act(room, RESALE, REDEEM, 0)] });
  assert.equal(a.durables.tv!.n, 1, "redeemed");
  assert.equal(a.cash, cash + 200 - 250);
  assert.deepEqual(a.pawned, []);

  fold(room, {
    a: [act(room, RESALE, PAWN, DURABLES.indexOf("console"))],
  });
  const due = room.players.a!.pawned[0]!.due;
  while (room.week <= due) nextWeek(room);
  assert.deepEqual(a.pawned, [], "forfeited");
  assert.ok(
    room.shelf.some(
      (offer) =>
        offer.item === DURABLES.indexOf("console") && offer.price === 180,
    ),
    "on the shelf at 60% of what was paid",
  );
  assert.ok(a.notices.some((line) => /went on sale at Second Life/.test(line)));
});

test("a night out: hours, money and happiness, once a week", () => {
  const room = started();
  const a = room.players.a!;
  const night = ITEMS.findIndex((item) => item.kind === "fun");
  enter(room, "a", MONO);
  const time = a.time,
    cash = a.cash,
    happy = a.happiness;
  fold(room, { a: [act(room, MONO, BUY, night)] });
  assert.equal(a.time - time, ITEMS[night]!.hours! * 15);
  assert.equal(a.cash, cash - ITEMS[night]!.price);
  assert.equal(a.happiness, happy + ITEMS[night]!.happy);
  fold(room, { a: [act(room, MONO, BUY, night)] });
  assert.equal(a.cash, cash - ITEMS[night]!.price, "not twice in a week");
  assert.match(a.msg, /already had your night out/);
});

test("happiness fades a point per 15 each Monday; home comforts top it up", () => {
  assert.equal(fading(14), 0);
  assert.equal(fading(50), 3);
  assert.equal(fading(100), 6);
  const room = started();
  const a = room.players.a!;
  assert.equal(comfort(a), 0);
  a.durables.stove = { n: 1, paid: 1, cheap: false };
  a.durables.tv = { n: 1, paid: 1, cheap: false };
  a.durables.console = { n: 1, paid: 1, cheap: false };
  assert.equal(comfort(a), 2, "one for the kitchen, one for the screens");
});

test("career is capped by the rung of the job held", () => {
  const room = started();
  const a = room.players.a!;
  employed(room);
  a.dep = 100;
  assert.equal(careerCap(FLOOR), 30);
  assert.equal(career(a), 30);
  const director = JOBS.findIndex((job) => job.title === "Plant Director");
  a.job = director;
  assert.equal(career(a), 90);
  assert.equal(stats(a, room.economy)[3], 90);
});

test("a seniority raise: +8% for each six points of experience past the job's bar", () => {
  const room = started();
  employed(room);
  const a = room.players.a!;
  const wage = a.wage;
  a.exp = JOBS[FLOOR]!.exp + 6;
  a.dep = 40;
  enter(room, "a", JOBHUB);
  fold(room, { a: [act(room, JOBHUB, RAISE)] });
  assert.equal(a.wage, Math.round(wage * 108) / 100);
  assert.equal(a.raises, 1);
  a.flags = 0;
  fold(room, { a: [act(room, JOBHUB, RAISE)] });
  assert.equal(a.raises, 1, "no second step without more experience");
  assert.match(a.msg, /more shifts first/);
});

test("tuition depends on the course", () => {
  assert.ok(COURSES.every((course) => course.fee >= 100));
  assert.ok(
    COURSES[5]!.fee > COURSES[4]!.fee,
    "an MBA costs more than college",
  );
});

test("loans, pawn tickets, scratch counts and the shelf survive a checkpoint, and a bad shelf is refused", () => {
  const room = started();
  const a = room.players.a!;
  a.loan = 300;
  a.loanLate = 1;
  a.scratched = 2;
  a.pawned = [{ item: TV, paid: 500, cheap: false, due: 4 }];
  const copy = decodeRoom(encodeRoom(room), room.tick)!;
  assert.ok(copy);
  assert.equal(hashRoom(copy), hashRoom(room));
  const fields = encodeRoom(room) as [
    unknown,
    unknown,
    unknown,
    Record<string, unknown>,
  ];
  fields[3] = { ...fields[3], shelf: [{ item: 99, price: 10 }] };
  assert.equal(decodeRoom(fields, room.tick), undefined);
  const players = structuredClone(room.players);
  players.a!.scratched = SCRATCH_PER_WEEK + 1;
  const tooMany = encodeRoom(room) as [
    unknown,
    unknown,
    unknown,
    Record<string, unknown>,
  ];
  tooMany[3] = { ...tooMany[3], players };
  assert.equal(decodeRoom(tooMany, room.tick), undefined);
});
