import test from "node:test";
import assert from "node:assert/strict";
import {
  BORROW,
  BUY,
  FUN_HAPPY,
  DEPOSIT,
  EXTEND,
  FRESHCO,
  GADGET,
  INDEX_FUND,
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
  RAISE,
  SCRATCH_PER_WEEK,
  TOWER,
  TRADE_BUY,
  TRADE_SELL,
  TRIED_EXTENSION,
  WITHDRAW,
  WORK,
  botMove,
  doorOf,
  marketWage,
  rentPrice,
  shelfPrice,
  type FuseLaneRoom,
  type PlayerState,
} from "../src/game/index.js";
import { started } from "./fixtures/lane.js";

/**
 * The bot's priorities, one decision at a time: `botMove` reads only the room, so each test sets up a player whose
 * earlier priorities are all settled and checks the move the next one makes.
 */
const FLOOR = JOBS.findIndex((job) => job.title === "Floor Associate");

/**
 * A bot with nothing pressing: employed at MegaMart and paid the market rate, dressed, fed, rent paid, its shifts and
 * classes done (more than any style and lean ask for), no scratch cards left this week, rested, content and living in The Tower, with a little cash. Its only move is more work.
 */
function settled(room: FuseLaneRoom, id = "a"): PlayerState {
  const player = room.players[id]!;
  Object.assign(player, {
    job: FLOOR,
    wage: marketWage(room.economy, JOBS[FLOOR]!),
    raises: 3,
    maxExp: 100,
    clothes: [6, 0, 0],
    meal: 1,
    rentWeeks: 3,
    weekShifts: 7,
    weekClasses: 7,
    relax: 30,
    happiness: 10,
    goals: [10, 10, 10, 10],
    home: 1,
    cash: 500,
    scratched: SCRATCH_PER_WEEK,
  });
  room.shelf = [];
  return player;
}
function inside(player: PlayerState, place: number): void {
  player.pos = doorOf(place);
  player.inside = place;
}
const act = (place: number, action: number, a = 0, b = 0) => ({
  kind: "act",
  place,
  action,
  a,
  b,
});

test("a settled bot works more while it is short of its wealth goal, and then calls it a week", () => {
  const room = started();
  const a = settled(room);
  assert.deepEqual(botMove(room, "a"), { kind: "walk", place: MEGAMART });
  inside(a, MEGAMART);
  assert.deepEqual(botMove(room, "a"), act(MEGAMART, WORK));
  a.goals = [0, 10, 10, 10];
  assert.deepEqual(botMove(room, "a"), { kind: "end" });
});

test("rent comes first: paid from cash, or from savings, or an extension asked once; arrears once there is a cushion", () => {
  const room = started();
  const a = settled(room);
  a.rentWeeks = 0;
  a.cash = 400;
  inside(a, KEYNEST);
  assert.deepEqual(botMove(room, "a"), act(KEYNEST, PAY_RENT));

  a.cash = 100;
  a.bank = 500;
  assert.deepEqual(botMove(room, "a"), { kind: "walk", place: NEOBANK });
  inside(a, NEOBANK);
  assert.deepEqual(botMove(room, "a"), act(NEOBANK, WITHDRAW, a.rent - 100));

  a.bank = 0;
  assert.deepEqual(
    botMove(room, "a"),
    act(NEOBANK, BORROW, Math.ceil((a.rent - 100) / 100) * 100),
    "a loan for the rest",
  );
  a.loanLate = 1; // no credit while a loan payment is missed
  assert.deepEqual(botMove(room, "a"), { kind: "walk", place: KEYNEST });
  inside(a, KEYNEST);
  assert.deepEqual(botMove(room, "a"), act(KEYNEST, EXTEND));
  a.flags |= TRIED_EXTENSION;
  assert.notDeepEqual(botMove(room, "a"), act(KEYNEST, EXTEND));
  a.flags = 0;
  a.rentExt = -1;
  assert.notDeepEqual(botMove(room, "a"), act(KEYNEST, EXTEND));

  a.rentWeeks = 3;
  a.rentOwed = 200;
  a.cash = 400;
  assert.notDeepEqual(
    botMove(room, "a"),
    act(KEYNEST, PAY_ARREARS),
    "not without $300 to spare",
  );
  a.cash = 600;
  assert.deepEqual(botMove(room, "a"), act(KEYNEST, PAY_ARREARS));
});

test("food: with a fridge it stocks up as far as its cash allows; without, a burger, or savings to buy one", () => {
  const room = started();
  const a = settled(room);
  a.meal = 0;
  a.durables.fridge = { n: 1, paid: 876, cheap: false };
  inside(a, FRESHCO);
  const groceries = (weeks: number) =>
    ITEMS.findIndex((item) => item.place === FRESHCO && item.weeks === weeks);
  for (const [cash, weeks] of [
    [150, 1],
    [300, 2],
    [500, 4],
  ] as const) {
    a.cash = cash;
    assert.deepEqual(
      botMove(room, "a"),
      act(FRESHCO, BUY, groceries(weeks)),
      `$${cash}`,
    );
  }

  delete a.durables.fridge;
  const burger = ITEMS.findIndex(
    (item) => item.place === MONO && item.kind === "meal",
  );
  a.cash = shelfPrice(room.economy, ITEMS[burger]!);
  assert.deepEqual(botMove(room, "a"), { kind: "walk", place: MONO });
  a.cash = 5;
  a.bank = 80;
  inside(a, NEOBANK);
  assert.deepEqual(botMove(room, "a"), act(NEOBANK, WITHDRAW, 80));
  a.bank = 300;
  assert.deepEqual(botMove(room, "a"), act(NEOBANK, WITHDRAW, 100));
});

test("climbing: it asks for a raise once the market pays 5% more and its record allows", () => {
  const room = started();
  const a = settled(room);
  a.raises = 0;
  a.dep = 10;
  room.economy.wageIndex *= 1.2;
  inside(a, JOBHUB);
  assert.deepEqual(botMove(room, "a"), act(JOBHUB, RAISE));
  a.raises = 1;
  a.wage = marketWage(room.economy, JOBS[FLOOR]!) / 1.2;
  assert.notDeepEqual(
    botMove(room, "a"),
    act(JOBHUB, RAISE),
    "10 for the job + 5 per raise had",
  );
  a.dep = 15;
  assert.deepEqual(botMove(room, "a"), act(JOBHUB, RAISE));
  room.level = 0; // an easy bot never asks
  assert.notDeepEqual(botMove(room, "a"), act(JOBHUB, RAISE));
});

test("comfort: spare cash buys the next appliance; with a fridge and a stove it moves to The Tower", () => {
  const room = started();
  const a = settled(room);
  a.happiness = 0;
  a.flags |= FUN_HAPPY; // its night out is done
  a.cash = 1500;
  inside(a, GADGET);
  const fridge = ITEMS.findIndex(
    (item) => item.place === GADGET && item.durable === "fridge",
  );
  assert.deepEqual(botMove(room, "a"), act(GADGET, BUY, fridge));
  a.cash = 1200; // not the fridge's price and $400 more
  assert.notDeepEqual(botMove(room, "a"), act(GADGET, BUY, fridge));

  a.happiness = 10;
  a.home = 0;
  a.durables.fridge = { n: 1, paid: 876, cheap: false };
  a.durables.stove = { n: 1, paid: 570, cheap: false };
  a.cash = rentPrice(room.economy, 1) + 901;
  inside(a, KEYNEST);
  assert.deepEqual(botMove(room, "a"), act(KEYNEST, MOVE, 1));
  a.leaseEnd = room.week + 1;
  assert.notDeepEqual(
    botMove(room, "a"),
    act(KEYNEST, MOVE, 1),
    "the lease holds",
  );
  assert.equal(TOWER, 2);
});

test("investing: a bot sells the index fund when the mood sours and buys when it is bullish; otherwise it saves", () => {
  const room = started();
  const a = settled(room);
  a.goals = [0, 10, 10, 10];
  inside(a, NEOBANK);
  a.holdings[INDEX_FUND] = 12;
  room.economy.sentiment = -0.5;
  assert.deepEqual(
    botMove(room, "a"),
    act(NEOBANK, TRADE_SELL, INDEX_FUND, 12),
  );

  a.holdings[INDEX_FUND] = 0;
  a.cash = 3000;
  room.economy.sentiment = 0.5;
  const move = botMove(room, "a");
  assert.equal(move.kind, "act");
  assert.ok(
    move.kind === "act" &&
      move.action === TRADE_BUY &&
      move.a === INDEX_FUND &&
      move.b > 0,
  );

  room.economy.sentiment = -0.2;
  assert.deepEqual(botMove(room, "a"), act(NEOBANK, DEPOSIT, 2300));
  room.level = 0; // an easy bot does not trade
  room.economy.sentiment = 0.5;
  assert.deepEqual(botMove(room, "a"), act(NEOBANK, DEPOSIT, 2300));
});

test("a bot level the room does not know plays as the hard bot", () => {
  const room = started();
  const a = settled(room);
  a.botActs = 30;
  room.level = 1;
  assert.deepEqual(
    botMove(room, "a"),
    { kind: "end" },
    "a normal bot stops at 30",
  );
  room.level = 9;
  assert.notDeepEqual(botMove(room, "a"), { kind: "end" });
  a.botActs = 60;
  assert.deepEqual(botMove(room, "a"), { kind: "end" });
});
