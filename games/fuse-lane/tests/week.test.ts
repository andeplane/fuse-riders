import test from "node:test";
import assert from "node:assert/strict";
import {
  JOBS,
  MAX_WEEKS,
  UNITS_PER_HOUR,
  WEEK_UNITS,
  matchResult,
  type FuseLaneRoom,
  type PlayerState,
} from "../src/game/index.js";
import { endWeek, rank, winnersOf } from "../src/game/week.js";
import { started } from "./fixtures/lane.js";

/**
 * The weekend and Monday, one `endWeek` at a time. Its dice come from the room's generator, so a test that needs an
 * event (a break-in, a layoff, a crash) looks for the first seed that brings it: the same seed every run.
 */
const MEGA = 6;
const job = (title: string, employer: number): number =>
  JOBS.findIndex(
    (entry) => entry.title === title && entry.employer === employer,
  );
const FLOOR = job("Floor Associate", MEGA),
  SHIFT_LEAD = job("Shift Lead", MEGA),
  CUSTODIAN = job("Custodian", 9);

/** A player with nothing random pending: fed, no spare hours to sleep, rested, with little cash. */
function calm(player: PlayerState): PlayerState {
  player.meal = 1;
  player.time = WEEK_UNITS;
  player.relax = 30;
  return player;
}
function monday(seed: number, setup: (room: FuseLaneRoom) => void) {
  const room = started();
  calm(room.players.a!);
  calm(room.players.b!);
  setup(room);
  room.rng = seed;
  const over = endWeek(room);
  return { room, over, a: room.players.a!, b: room.players.b! };
}
/** The first seed whose Monday `found` holds for, and every Monday looked at before it. */
function search(
  setup: (room: FuseLaneRoom) => void,
  found: (result: ReturnType<typeof monday>) => boolean,
  most = 4000,
) {
  const seen: ReturnType<typeof monday>[] = [];
  for (let seed = 1; seed <= most; seed++) {
    const result = monday(seed * 2_654_435_761, setup);
    seen.push(result);
    if (found(result)) return { hit: result, seen };
  }
  assert.fail("no seed brought the event");
}
const has = (player: PlayerState, pattern: RegExp) =>
  player.notices.some((line) => pattern.test(line));

test("a stove or an air fryer cheers you each Monday, a hot tub keeps your rest, a laptop lands side gigs", () => {
  const { a, b } = monday(1, (room) => {
    const a = room.players.a!,
      b = room.players.b!;
    a.home = b.home = 1; // The Tower: no break-ins to muddy the count
    a.durables.stove = { n: 1, paid: 570, cheap: false };
    a.durables.hottub = { n: 1, paid: 1255, cheap: false };
    b.durables.airfryer = { n: 1, paid: 330, cheap: false };
  });
  assert.equal(a.happiness, 1);
  assert.equal(b.happiness, 1);
  assert.equal(a.relax, 30, "a hot tub: no rest lost");
  assert.equal(b.relax, 29);

  let gigs = 0;
  const tries = 700;
  for (let seed = 1; seed <= tries; seed++) {
    const { a } = monday(seed * 40_503, (room) => {
      const a = room.players.a!;
      a.home = 1;
      a.durables.laptop = { n: 1, paid: 1599, cheap: false };
    });
    if (has(a, /^Your laptop landed a side gig: \+\$\d+\.$/)) {
      gigs++;
      assert.ok(a.cash >= 220 && a.cash <= 300, `a fee of 20..100: ${a.cash}`);
      assert.equal(a.happiness, 3);
    } else assert.equal(a.cash, 200);
  }
  assert.ok(Math.abs(gigs / tries - 1 / 7) < 0.04, `side gigs ${gigs}`);
});

test("a break-in at Roomshare takes portable goods and never the bolted-down ones; The Tower has a doorman", () => {
  const goods = (player: PlayerState) => {
    player.relax = 10; // worn out: the door is left open more often
    player.durables.fridge = { n: 1, paid: 876, cheap: false };
    player.durables.tv = { n: 1, paid: 525, cheap: false };
    player.durables.console = { n: 1, paid: 333, cheap: false };
  };
  const { hit, seen } = search(
    (room) => {
      goods(room.players.a!);
      goods(room.players.b!);
      room.players.b!.home = 1;
    },
    ({ a }) => has(a, /^Break-in at Roomshare! Gone: /),
  );
  const { a } = hit;
  assert.equal(a.durables.fridge!.n, 1, "too heavy to carry off");
  const gone = (["tv", "console"] as const).filter(
    (id) => a.durables[id]!.n === 0,
  );
  assert.ok(gone.length > 0);
  assert.ok(
    a.notices.includes(
      `Break-in at Roomshare! Gone: ${gone.map((id) => ({ tv: "Smart TV", console: "Game console" })[id]).join(", ")}.`,
    ),
  );
  assert.equal(a.happiness, 0, "−4, floored at zero");
  for (const { b } of seen) {
    assert.equal(b.durables.tv!.n, 1, "The Tower is never broken into");
    assert.equal(b.durables.console!.n, 1);
  }
});

test("a freezer doubles what a fridge keeps, and the rest goes off", () => {
  const { a, b } = monday(3, (room) => {
    for (const player of [room.players.a!, room.players.b!]) {
      player.home = 1;
      player.groceries = 20;
      player.happiness = 10;
      player.durables.fridge = { n: 1, paid: 876, cheap: false };
    }
    room.players.a!.durables.freezer = { n: 1, paid: 513, cheap: false };
  });
  assert.equal(a.groceries, 11, "12 kept, a week eaten");
  assert.ok(
    a.notices.includes("Your fridge holds 12 weeks. The rest went off."),
  );
  assert.equal(b.groceries, 5);
  assert.ok(
    b.notices.includes("Your fridge holds 6 weeks. The rest went off."),
  );
  assert.equal(a.happiness, 9);
});

test("worn out, you may end up at urgent care: the bill fits your cash and costs 10 hours of next week", () => {
  const worn = (room: FuseLaneRoom) => {
    room.players.a!.relax = 10;
    room.players.a!.cash = 900;
    room.players.b!.relax = 10;
    room.players.b!.cash = 20;
  };
  const { hit } = search(worn, ({ a }) => has(a, /Urgent care/));
  const { a } = hit;
  const bill = 900 - a.cash;
  assert.ok(bill >= 30 && bill <= 200, `bill ${bill}`);
  assert.ok(
    a.notices.includes(
      `Urgent care visit: -$${bill} and 10 hours in the waiting room.`,
    ),
  );
  assert.equal(a.time, 10 * UNITS_PER_HOUR);
  const poor = search(worn, ({ b }) => has(b, /Urgent care/)).hit.b;
  assert.equal(poor.cash, 0, "never more than you have");
});

test("something breaks now and then, only for someone with $500 to spare; budget goods more often, books never", () => {
  let cheap = 0,
    sturdy = 0;
  const tries = 3000;
  for (let seed = 1; seed <= tries; seed++) {
    const { a, b } = monday(seed * 7_368_787, (room) => {
      const a = room.players.a!,
        b = room.players.b!;
      a.home = b.home = 1;
      a.cash = b.cash = 5000;
      a.durables.tv = { n: 1, paid: 349, cheap: true };
      b.durables.tv = { n: 1, paid: 525, cheap: false };
      a.durables.books = b.durables.books = { n: 1, paid: 160, cheap: false };
    });
    for (const [player, paid] of [
      [a, 349],
      [b, 525],
    ] as const) {
      const line = player.notices.find((notice) => /broke/.test(notice));
      if (!line) continue;
      assert.match(line, /^Your smart tv broke\. Repair: \$\d+\.$/);
      const bill = 5000 - player.cash;
      assert.ok(
        bill >= Math.floor(paid / 20) && bill <= Math.floor(paid / 4),
        `bill ${bill} for ${paid}`,
      );
      if (player === a) cheap++;
      else sturdy++;
    }
  }
  assert.ok(cheap > sturdy, `budget ${cheap}, regular ${sturdy}`);
  assert.ok(sturdy > 0);
  for (let seed = 1; seed <= 400; seed++) {
    const { a } = monday(seed, (room) => {
      room.players.a!.cash = 500;
      room.players.a!.durables.tv = { n: 1, paid: 349, cheap: true };
    });
    assert.ok(!has(a, /broke/), "$500 is not enough to need a repair");
  }
});

test("dividends are paid on holdings every 12 weeks", () => {
  const { a, b } = monday(5, (room) => {
    room.economy.weeks = 11;
    room.economy.companies[0]!.retained = 1_000_000;
    room.players.a!.holdings[0] = 50;
  });
  const line = a.notices.find((notice) => notice.startsWith("Dividend"));
  assert.ok(line, a.notices.join(" | "));
  const paid = Number(/\+\$(\d+)\.$/.exec(line)![1]);
  assert.equal(line, `Dividend from Gigafactory: +$${paid}.`);
  assert.equal(a.cash, 200 + paid);
  assert.equal(b.cash, 200, "nothing held, nothing paid");
});

test("a struggling company lays off its least dependable worker; a company with nobody on staff lays off nobody", () => {
  const { hit } = search(
    (room) => {
      const a = room.players.a!,
        b = room.players.b!;
      a.job = FLOOR;
      b.job = SHIFT_LEAD;
      a.wage = b.wage = 5;
      a.happiness = b.happiness = 10;
      a.dep = 40;
      b.dep = 25;
      room.economy.companies[MEGA]!.health = -5;
      room.economy.companies[5]!.health = -5; // Threads: struggling, nobody to cut
    },
    ({ a, b }) => a.job < 0 || b.job < 0,
  );
  const { a, b } = hit;
  assert.equal(a.job, FLOOR, "the more dependable one stays");
  assert.equal(b.job, -1);
  assert.equal(b.wage, 0);
  assert.equal(b.happiness, 3);
  assert.ok(
    b.notices.includes("MegaMart is cutting staff. You were laid off."),
  );
});

test("a crash can take any job except the college's", () => {
  let crashes = 0,
    lost = 0;
  for (let seed = 1; seed <= 6000 && lost < 3; seed++) {
    const { room, a, b } = monday(seed * 97, (room) => {
      room.economy.cycle = 0;
      room.players.a!.job = FLOOR;
      room.players.b!.job = CUSTODIAN;
      room.players.a!.wage = room.players.b!.wage = 4;
    });
    if (!room.headlines[0]?.startsWith("MARKETS CRASH")) continue;
    crashes++;
    assert.equal(b.job, CUSTODIAN, "the college keeps its staff");
    if (a.job < 0) {
      lost++;
      assert.ok(
        a.notices.includes("The crash took your job with it. Laid off."),
      );
    }
  }
  assert.ok(crashes > lost && lost > 0, `${crashes} crashes, ${lost} lost`);
});

test("the ranking puts earlier finishers first, then overshoot; with nobody ranked there are no winners", () => {
  const room = started();
  const a = room.players.a!,
    b = room.players.b!;
  a.finished = 5;
  b.finished = 3;
  assert.deepEqual(rank(room), ["b", "a"]);
  assert.deepEqual(winnersOf(room, rank(room)), ["b"]);
  a.finished = 0;
  assert.deepEqual(rank(room), ["b", "a"], "a winner before everyone else");
  assert.deepEqual(winnersOf(room, []), []);
});

test("the week limit ends a match with the leader on goal progress", () => {
  const { room, over } = monday(9, (room) => {
    room.week = MAX_WEEKS;
    room.players.b!.happiness = 30;
  });
  assert.equal(over, true);
  assert.equal(room.stage, "over");
  assert.equal(room.week, MAX_WEEKS + 1);
  assert.deepEqual(room.ranking, ["b", "a"]);
  assert.deepEqual(room.winners, ["b"]);
  assert.equal(room.players.b!.finished, 0, "a leader, not a finisher");
  const result = matchResult(room)!;
  assert.equal(result.winnerId, "b");
  assert.deepEqual(
    result.players.map((row) => row.weeks),
    [MAX_WEEKS + 1, MAX_WEEKS + 1],
  );
});
