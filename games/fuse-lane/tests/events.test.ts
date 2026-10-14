import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPOSIT,
  EMPLOYERS,
  EVENT_COUNT,
  EVENT_ODDS,
  FESTIVAL,
  FLU,
  GADGET,
  ITEMS,
  JOB_FAIR,
  JOBS,
  MEGAMART,
  MONO,
  NEOBANK,
  NO_EVENT,
  OPEN_WEEK,
  OVERTIME,
  PICKPOCKETS,
  SALE,
  BUY,
  WORK,
  WORKPLACE,
  botMove,
  createEconomy,
  decodeRoom,
  encodeRoom,
  enrollFee,
  hashRoom,
  hiring,
  marketWage,
  shelfPrice,
  stepEconomy,
  type FuseLaneRoom,
} from "../src/game/index.js";
import { fuseLaneView } from "../src/game/game.js";
import { present } from "../src/app/presenter.js";
import { tips } from "../src/app/tips.js";
import { WEEK_UNITS } from "../src/game/basics.js";
import { act, enter, fold, nextWeek, started } from "./fixtures/lane.js";

const FLOOR = JOBS.findIndex((job) => job.title === "Floor Associate");
const MEGAMART_STAFF = JOBS[FLOOR]!.employer;

function event(room: FuseLaneRoom, kind: number, arg = 0): void {
  room.economy.event = kind;
  room.economy.eventArg = arg;
}
function employed(room: FuseLaneRoom): void {
  const a = room.players.a!;
  a.job = FLOOR;
  a.wage = marketWage(room.economy, JOBS[FLOOR]!);
  a.minDep = JOBS[FLOOR]!.dep;
  a.clothes = [5, 0, 0];
}

test("most weeks bring a town event, never the same kind twice running, and the briefing leads with it", () => {
  const economy = createEconomy(),
    seeded = { rng: 7 };
  let events = 0,
    last = NO_EVENT;
  const seen = new Set<number>();
  for (let week = 0; week < 400; week++) {
    const news = stepEconomy(economy, seeded, 4);
    if (economy.event === NO_EVENT) {
      last = NO_EVENT;
      continue;
    }
    events++;
    seen.add(economy.event);
    assert.notEqual(economy.event, last, "not the same kind twice running");
    last = economy.event;
    assert.match(news.headlines[0]!, /\w/);
  }
  assert.equal(seen.size, EVENT_COUNT);
  // Every event the draw makes survives a checkpoint.
  const room = started();
  // (a match lasts at most 150 weeks)
  for (let week = 0; week < 140; week++) {
    stepEconomy(room.economy, room, 4);
    const copy = decodeRoom(encodeRoom(room), room.tick);
    assert.ok(
      copy,
      `week ${week}: ${room.economy.event}/${room.economy.eventArg}`,
    );
  }
  assert.ok(Math.abs(events / 400 - EVENT_ODDS / 100) < 0.08, `${events}`);
});

test("a sale takes 25% off one shop's shelf, and only that shop's", () => {
  const room = started();
  const gadget = ITEMS.find((item) => item.place === GADGET)!,
    mega = ITEMS.find((item) => item.place === MEGAMART)!;
  const full = shelfPrice(room.economy, gadget),
    other = shelfPrice(room.economy, mega);
  event(room, SALE, GADGET);
  assert.equal(
    shelfPrice(room.economy, gadget),
    Math.round(gadget.price * room.economy.prices[gadget.category]! * 0.75),
  );
  assert.ok(shelfPrice(room.economy, gadget) < full);
  assert.equal(shelfPrice(room.economy, mega), other);
});

test("rush pay: a shift at the employer named pays 50% more, elsewhere the same", () => {
  const room = started();
  employed(room);
  const a = room.players.a!;
  event(room, OVERTIME, MEGAMART_STAFF);
  const workplace = WORKPLACE[MEGAMART_STAFF]!;
  enter(room, "a", workplace);
  fold(room, { a: [act(room, workplace, WORK)] });
  assert.equal(a.cash, 200 + Math.round(a.wage * 8 * 1.5));
  assert.match(a.msg, /Rush pay/);

  event(room, OVERTIME, (MEGAMART_STAFF + 1) % (EMPLOYERS.length - 1));
  const cash = a.cash;
  fold(room, { a: [act(room, workplace, WORK)] });
  assert.equal(a.cash, cash + Math.round(a.wage * 8));
});

test("open week halves tuition; a job fair opens every employer; a festival doubles a night out", () => {
  const room = started();
  const fee = enrollFee(room.economy, 0);
  event(room, OPEN_WEEK);
  assert.equal(enrollFee(room.economy, 0), Math.round(fee / 2));

  room.economy.companies.forEach((company) => (company.health = -1));
  event(room, NO_EVENT);
  assert.equal(hiring(room.economy, 0), false);
  event(room, JOB_FAIR);
  assert.ok(EMPLOYERS.every((_, employer) => hiring(room.economy, employer)));

  event(room, FESTIVAL);
  const a = room.players.a!;
  const night = ITEMS.findIndex((item) => item.kind === "fun");
  enter(room, "a", MONO);
  const happy = a.happiness;
  fold(room, { a: [act(room, MONO, BUY, night)] });
  assert.equal(a.happiness, happy + 2 * ITEMS[night]!.happy);
});

test("pickpockets take from unbanked cash at the weekend, never from savings or a thin wallet", () => {
  let robbed = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const room = started();
    room.rng = seed;
    const a = room.players.a!,
      b = room.players.b!;
    a.home = b.home = 1;
    a.meal = b.meal = 1; // fed: no urgent care to muddle the count
    a.cash = 1200;
    a.bank = 1000;
    b.cash = 150;
    event(room, PICKPOCKETS);
    nextWeek(room);
    assert.ok(
      !b.notices.some((line) => /Pickpocketed/.test(line)),
      "a thin wallet is safe",
    );
    assert.ok(a.bank >= 1000, "savings are safe");
    if (a.notices.some((line) => /Pickpocketed/.test(line))) {
      robbed++;
      const taken = 1200 - a.cash;
      assert.ok(taken >= 200 && taken <= 400, `20-40% of $1000: ${taken}`);
    }
  }
  assert.ok(robbed > 8 && robbed < 32, `half the time: ${robbed}`);
});

test("flu finds the tired: low rest risks urgent care, a rested player is safe", () => {
  let sick = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const room = started();
    room.rng = seed;
    const a = room.players.a!,
      b = room.players.b!;
    a.home = b.home = 1;
    a.relax = 12;
    b.relax = 40;
    // A full week played: no spare hours to sleep off into rest.
    a.time = b.time = WEEK_UNITS;
    event(room, FLU);
    nextWeek(room);
    assert.ok(!b.notices.some((line) => /flu got you/.test(line)));
    if (a.notices.some((line) => /flu got you/.test(line))) sick++;
  }
  assert.ok(sick > 8, `${sick}`);
});

test("the event survives a checkpoint, an unknown one is refused, and the HUD shows it all week", () => {
  const room = started();
  event(room, SALE, GADGET);
  const copy = decodeRoom(encodeRoom(room), room.tick)!;
  assert.ok(copy);
  assert.equal(hashRoom(copy), hashRoom(room));
  assert.deepEqual([copy.economy.event, copy.economy.eventArg], [SALE, GADGET]);
  for (const [kind, arg] of [
    [EVENT_COUNT, 0],
    [SALE, MONO], // not a shop that holds sales
    [OVERTIME, EMPLOYERS.length - 1], // City College has no rush
    [FLU, 3], // flu takes no argument
    [NO_EVENT, 1],
  ] as const) {
    event(room, kind, arg);
    assert.equal(
      decodeRoom(encodeRoom(room), room.tick),
      undefined,
      `${kind}/${arg}`,
    );
  }

  const chip = () =>
    present(fuseLaneView(room), {
      me: "a",
      host: true,
      solo: false,
      display: false,
      shared: false,
    }).hud!.event;
  event(room, PICKPOCKETS);
  assert.deepEqual(chip(), { label: "Pickpockets", warn: true });
  event(room, SALE, GADGET);
  assert.deepEqual(chip(), { label: "Sale: Gadget Garage", warn: false });
});

test("a bot that reads the news banks its cash ahead of pickpockets and works the rush", () => {
  const room = started();
  employed(room);
  const a = room.players.a!;
  Object.assign(a, {
    meal: 1,
    rentWeeks: 3,
    weekShifts: 3,
    weekClasses: 9,
    relax: 30,
    happiness: 60,
    goals: [10, 10, 10, 10],
    home: 1,
    cash: 900,
    scratched: 5,
  });
  room.shelf = [];
  a.pos = 0;
  a.inside = NEOBANK;
  event(room, PICKPOCKETS);
  assert.deepEqual(botMove(room, "a"), {
    kind: "act",
    place: NEOBANK,
    action: DEPOSIT,
    a: 700,
    b: 0,
  });
  room.level = 0;
  assert.notDeepEqual(
    botMove(room, "a"),
    { kind: "act", place: NEOBANK, action: DEPOSIT, a: 700, b: 0 },
    "an easy bot does not read the news",
  );

  room.level = 2;
  event(room, OVERTIME, MEGAMART_STAFF);
  a.cash = 300;
  const workplace = WORKPLACE[MEGAMART_STAFF]!;
  a.inside = workplace;
  assert.deepEqual(botMove(room, "a"), {
    kind: "act",
    place: workplace,
    action: WORK,
    a: 0,
    b: 0,
  });
});

test("tips point at the week's event when it touches you", () => {
  const room = started();
  const a = room.players.a!;
  const texts = () => tips(fuseLaneView(room), "a").map((tip) => tip.text);
  a.cash = 900;
  event(room, PICKPOCKETS);
  assert.ok(texts().some((text) => /Pickpockets about/.test(text)));
  a.cash = 300;
  assert.ok(
    !texts().some((text) => /Pickpockets/.test(text)),
    "little to lose",
  );
  event(room, SALE, GADGET);
  assert.ok(texts().some((text) => /Sale at Gadget Garage/.test(text)));
  event(room, JOB_FAIR);
  assert.ok(texts().some((text) => /Job fair/.test(text)));
  employed(room);
  assert.ok(
    !texts().some((text) => /Job fair/.test(text)),
    "not once employed",
  );
  event(room, OVERTIME, MEGAMART_STAFF);
  assert.ok(texts().some((text) => /Rush pay: shifts at MegaMart/.test(text)));
  a.relax = 15;
  event(room, FLU);
  assert.ok(texts().some((text) => /Flu going round/.test(text)));
});
