import test from "node:test";
import assert from "node:assert/strict";
import { ACTION, JOIN, PRESENCE } from "fuse-netcode";
import {
  ACT,
  APPLY,
  BRIEFING,
  BUY,
  CLASS,
  COLLEGE,
  DEPOSIT,
  END_WEEK,
  ENROLL,
  EXTEND,
  FRESHCO,
  GADGET,
  GIGAFACTORY,
  HANDOFF,
  ITEMS,
  JOBHUB,
  JOBS,
  KEYNEST,
  MAX_WEEKS,
  MEGAMART,
  MONO,
  MOVE,
  NEOBANK,
  PAY_ARREARS,
  PAY_RENT,
  READY,
  RELAX,
  RESALE,
  ROOMSHARE,
  THREADS,
  TOWER,
  TRADE_SELL,
  TRIED_EXTENSION,
  WITHDRAW,
  createRoom,
  doorOf,
  enrollFee,
  fuseLaneView,
  marketWage,
  rentPrice,
  shelfPrice,
  type FuseLaneRoom,
  type PlayerState,
} from "../src/game/index.js";
import {
  boardModel,
  colorOf,
  panelFor,
  present,
  sparkline,
  type Card,
  type PanelModel,
  type Viewer,
} from "../src/app/presenter.js";
import {
  FAST,
  TURNS,
  addBot,
  endWeekEntry,
  fold,
  nextWeek,
  ready,
  runWhile,
  started,
} from "./fixtures/lane.js";

/** Ada's phone in an online room she created. */
const ADA: Viewer = {
  me: "a",
  host: true,
  solo: false,
  display: false,
  shared: false,
};
const BO: Viewer = { ...ADA, me: "b", host: false };
const TV: Viewer = { ...ADA, me: "tv", host: false, display: true };
const DEVICE: Viewer = {
  me: "",
  host: true,
  solo: true,
  display: false,
  shared: false,
  local: true,
};
const COOK = JOBS.findIndex((job) => job.title === "Line Cook");

/** Ada inside `place` in a running week, with `tweak` applied, and the panel she sees. */
function panelAt(
  room: FuseLaneRoom,
  place: number,
  tweak: (player: PlayerState) => void = () => {},
): PanelModel {
  const a = room.players.a!;
  a.pos = doorOf(place);
  a.inside = place;
  tweak(a);
  const panel = present(fuseLaneView(room), ADA).panel;
  assert.ok(panel, `a panel at ${place}`);
  return panel;
}
const cards = (panel: PanelModel): Card[] =>
  panel.sections.flatMap((section) => section.cards);
const card = (panel: PanelModel, key: string): Card => {
  const found = cards(panel).find((entry) => entry.key === key);
  assert.ok(found, key);
  return found;
};
const itemIndex = (name: string) =>
  ITEMS.findIndex((entry) => entry.name === name);

test("shops: their own goods with price and effect; owned goods and empty pockets disabled; scratch cards coming soon", () => {
  const room = started();
  const fresh = panelAt(room, FRESHCO, (a) => (a.cash = 60));
  assert.equal(fresh.name, "FreshCo");
  assert.equal(fresh.keeper, "keeper-freshco");
  assert.match(fresh.greeting, /\w/);
  const one = card(fresh, "buy-0");
  assert.equal(one.detail, "1 week of food · +1 ☺");
  assert.deepEqual(one.entry, [ACT, 1, FRESHCO, BUY, 0, 0]);
  assert.ok(one.enabled);
  const four = card(fresh, `buy-${itemIndex("Groceries · 4 weeks")}`);
  assert.equal(four.enabled, false);
  assert.equal(four.note, "Not enough cash");
  assert.deepEqual(
    [card(fresh, "lottery").enabled, card(fresh, "lottery").note],
    [false, "Coming soon"],
  );

  const gadget = panelAt(room, GADGET, (a) => {
    a.cash = 5000;
    a.durables.tv = { n: 1, paid: 525, cheap: false };
    a.durables.fridge = { n: 0, paid: 876, cheap: false }; // stolen
  });
  const tv = card(gadget, `buy-${itemIndex("Smart TV")}`);
  assert.deepEqual([tv.enabled, tv.note], [false, "Owned"]);
  const fridge = card(gadget, `buy-${itemIndex("Smart fridge")}`);
  assert.equal(
    fridge.detail,
    "Stores 6 weeks of groceries",
    "no first-owner bonus twice",
  );
  assert.ok(fridge.enabled);
  assert.equal(
    fridge.price,
    `$${shelfPrice(room.economy, ITEMS[itemIndex("Smart fridge")]!).toLocaleString("en-US")}`,
  );
  const mega = panelAt(room, MEGAMART);
  assert.equal(
    card(mega, `buy-${itemIndex("Glitter phone case")}`).detail,
    "Why though · -1 ☺",
  );
  assert.equal(panelAt(room, THREADS).sections[0]!.title, "For sale");
  assert.equal(panelAt(room, MONO).sections[0]!.cards.length, 3);
});

test("your workplace offers a shift at your wage, and only in the right clothes", () => {
  const room = started();
  const working = (a: PlayerState) => {
    a.job = COOK;
    a.wage = 4.5;
  };
  const mono = panelAt(room, MONO, working);
  assert.equal(mono.sections[0]!.title, "Your job");
  const shift = card(mono, "work");
  assert.equal(shift.title, "Work a shift · Line Cook");
  assert.equal(shift.detail, "Paid 8h at $4.50/h. Dependability +1");
  assert.equal(shift.price, "+$36");
  assert.equal(shift.hours, "6h");
  assert.ok(shift.enabled);
  const bare = panelAt(room, MONO, (a) => (a.clothes = [0, 0, 0]));
  assert.deepEqual(
    [card(bare, "work").enabled, card(bare, "work").note],
    [false, "Needs casual clothes"],
  );
  assert.ok(
    !cards(panelAt(room, FRESHCO)).some((entry) => entry.key === "work"),
    "no shift at someone else's shop",
  );
});

test("the Job Hub: gig work and every posting; with a job also a raise when the market pays more, and quitting", () => {
  const room = started();
  const idle = panelAt(room, JOBHUB);
  assert.deepEqual(
    idle.sections.map((section) => [section.title, section.cards.length]),
    [
      ["You", 1],
      ["Postings", JOBS.length],
    ],
  );
  assert.equal(idle.sections[0]!.info, "Unemployed");
  assert.equal(card(idle, "gig").entry![3], 5);

  const hired = panelAt(room, JOBHUB, (a) => {
    a.job = COOK;
    a.wage = 100;
  });
  assert.equal(hired.sections[0]!.info, "Line Cook at Mono Burger, $100.00/h");
  const raise = card(hired, "raise");
  assert.deepEqual(
    [raise.enabled, raise.note],
    [false, "You're already above market"],
  );
  assert.equal(card(hired, "quit").detail, "Line Cook at Mono Burger");
  const underpaid = panelAt(room, JOBHUB, (a) => (a.wage = 1));
  assert.ok(card(underpaid, "raise").enabled);
  assert.match(
    card(underpaid, "raise").detail,
    new RegExp(
      `market pays \\$${marketWage(room.economy, JOBS[COOK]!).toFixed(2)}/h`,
    ),
  );

  // Each posting says why you can or cannot apply.
  room.players.b!.job = 0;
  room.economy.companies[2]!.health = -1; // FreshCo freezes hiring
  const why = panelAt(room, JOBHUB, (a) => (a.failed = [37]));
  const note = (index: number) => card(why, `job-${index}`).note;
  assert.equal(note(COOK), "Your job");
  assert.equal(note(0), "Held by Bo");
  assert.equal(note(30), "Hiring freeze");
  assert.equal(note(37), "No openings this week");
  assert.equal(
    note(15),
    "Missing a degree, work history, experience, the right clothes",
  );
  const postings = why.sections[1]!.cards;
  assert.ok(
    postings.findIndex((entry) => entry.key === "job-15") >
      postings.findIndex((entry) => entry.key === "job-37"),
    "what you qualify for comes first",
  );
  assert.deepEqual(card(why, "job-37").entry, [ACT, 1, JOBHUB, APPLY, 37, 0]);
});

test("City College: degrees earned, courses under way first, then what you can enroll in, locked ones and the fee", () => {
  const room = started();
  const college = panelAt(room, COLLEGE, (a) => {
    a.courses[0] = 10;
    a.courses[4] = 3;
    a.cash = 500;
  });
  const fee = enrollFee(room.economy);
  assert.deepEqual(
    [card(college, "course-0").detail, card(college, "course-0").note],
    ["Graduated", "Degree earned"],
  );
  const attend = card(college, "course-4");
  assert.equal(attend.title, "Attend Community College");
  assert.equal(attend.detail, "Lesson 4 of 10");
  assert.deepEqual(attend.entry, [ACT, 1, COLLEGE, CLASS, 4, 0]);
  const iot = card(college, "course-1");
  assert.equal(iot.title, "Enroll: IoT Technician");
  assert.equal(iot.detail, "10 lessons to a degree");
  assert.equal(iot.price, `$${fee}`);
  assert.deepEqual(iot.entry, [ACT, 1, COLLEGE, ENROLL, 1, 0]);
  const engineering = card(college, "course-3");
  assert.deepEqual(
    [engineering.detail, engineering.note, engineering.enabled],
    ["Needs Pre-Engineering", "Locked", false],
  );
  assert.equal(college.sections[0]!.cards[0]!.key, "course-4", "classes first");
  const broke = panelAt(room, COLLEGE, (a) => {
    a.cash = 0;
    a.durables.books = { n: 1, paid: 160, cheap: false };
  });
  assert.equal(card(broke, "course-1").note, "Not enough cash");
  assert.equal(
    card(broke, "course-4").detail,
    "Lesson 4 of 9",
    "books cut a lesson",
  );
});

test("KeyNest: rent ahead, more time, arrears and a move, each saying why not", () => {
  const room = started();
  const lease = panelAt(room, KEYNEST, (a) => (a.cash = 400));
  assert.equal(
    lease.sections[0]!.info,
    "Rent $325 per 4 weeks · 3 weeks paid. Base rents $325 / $475",
  );
  const rent = card(lease, "pay-rent");
  assert.equal(rent.detail, "4 more weeks at Roomshare");
  assert.ok(rent.enabled);
  assert.deepEqual(rent.entry, [ACT, 1, KEYNEST, PAY_RENT, 0, 0]);
  assert.ok(!cards(lease).some((entry) => entry.key === "extend"));
  assert.ok(!cards(lease).some((entry) => entry.key === "arrears"));
  const tower = card(lease, "move-1");
  const price = rentPrice(room.economy, 1);
  assert.equal(tower.title, "Move to The Tower");
  assert.equal(
    tower.detail,
    `$${price} per 4 weeks, locked for 12. Doorman, no break-ins`,
  );
  assert.deepEqual(tower.entry, [ACT, 1, KEYNEST, MOVE, 1, 0]);
  assert.deepEqual([tower.enabled, tower.note], [false, "Not enough cash"]);

  const ahead = panelAt(room, KEYNEST, (a) => (a.rentWeeks = 9));
  assert.deepEqual(
    [card(ahead, "pay-rent").enabled, card(ahead, "pay-rent").note],
    [false, "Paid far enough ahead"],
  );
  const due = panelAt(room, KEYNEST, (a) => {
    a.rentWeeks = 0;
    a.cash = 100;
    a.rentOwed = 120;
  });
  assert.equal(card(due, "pay-rent").detail, "3 more weeks at Roomshare");
  assert.equal(card(due, "pay-rent").note, "Not enough cash");
  assert.deepEqual(
    [card(due, "extend").detail, card(due, "extend").enabled],
    ["Always granted", true],
  );
  assert.deepEqual(card(due, "extend").entry, [ACT, 1, KEYNEST, EXTEND, 0, 0]);
  const arrears = card(due, "arrears");
  assert.deepEqual(
    [arrears.price, arrears.enabled, arrears.note],
    ["$120", false, "Not enough cash"],
  );
  assert.deepEqual(arrears.entry, [ACT, 1, KEYNEST, PAY_ARREARS, 0, 0]);
  assert.match(due.sections[0]!.info!, / · \$120 owed\./);
  for (const [rentExt, flags, detail, note] of [
    [2, 0, "50% odds", ""],
    [5, 0, "25% odds", ""],
    [-1, 0, "Always granted", "Not after a garnishment"],
    [1, TRIED_EXTENSION, "75% odds", "Asked this week"],
  ] as const) {
    const extend = card(
      panelAt(room, KEYNEST, (a) => Object.assign(a, { rentExt, flags })),
      "extend",
    );
    assert.deepEqual([extend.detail, extend.note], [detail, note]);
  }

  const moved = panelAt(room, KEYNEST, (a) => {
    Object.assign(a, {
      home: 1,
      leaseEnd: 13,
      rent: 475,
      cash: 5000,
      flags: 0,
    });
  });
  const back = card(moved, "move-0");
  const roomshare = rentPrice(room.economy, 0);
  assert.equal(
    back.detail,
    `$${roomshare} per 4 weeks, locked for 12. Break-ins happen. Lease break fee $475`,
  );
  assert.equal(back.price, `$${roomshare + 475}`);
  assert.ok(back.enabled);
  assert.match(card(moved, "pay-rent").detail, /at The Tower$/);
});

test("Neobank: deposits and withdrawals in steps up to all you have, loans coming soon, and every market", () => {
  const room = started();
  const bank = panelAt(room, NEOBANK, (a) => {
    a.cash = 750;
    a.bank = 100;
    a.holdings[9] = 4;
  });
  const keys = bank.sections[0]!.cards.map((entry) => entry.key);
  assert.deepEqual(keys, [
    "deposit-100",
    "deposit-500",
    "deposit-all",
    "withdraw-all",
    "loan",
  ]);
  assert.equal(card(bank, "deposit-all").title, "Deposit all");
  assert.deepEqual(card(bank, "deposit-500").entry, [
    ACT,
    1,
    NEOBANK,
    DEPOSIT,
    500,
    0,
  ]);
  assert.deepEqual(card(bank, "withdraw-all").entry, [
    ACT,
    1,
    NEOBANK,
    WITHDRAW,
    100,
    0,
  ]);
  assert.deepEqual(
    [card(bank, "loan").enabled, card(bank, "loan").note],
    [false, "Coming soon"],
  );
  assert.match(
    bank.sections[0]!.info!,
    /^Cash \$750 · Savings \$100 · Savings rate \d+\.\d\d%$/,
  );
  const markets = bank.sections[1]!;
  assert.equal(markets.title, "Markets");
  assert.match(card(bank, "buy-0").detail, /^Gigafactory · \$\d+/);
  assert.match(card(bank, "buy-9").detail, /^Index fund · \$\d+ · you hold 4$/);
  assert.match(card(bank, "buy-10").detail, /^Bonds · /);
  assert.match(card(bank, "buy-12").detail, /^Crypto · /);
  const sell = card(bank, "sell-9");
  assert.deepEqual([sell.title, sell.detail], ["Sell all CITY500", "4 units"]);
  assert.deepEqual(sell.entry, [ACT, 1, NEOBANK, TRADE_SELL, 9, 4]);
  assert.match(card(bank, "buy-0").note, /^\d+ units$/);
  const broke = panelAt(room, NEOBANK, (a) => {
    a.cash = 0;
    a.bank = 0;
  });
  assert.deepEqual(
    broke.sections[0]!.cards.map((entry) => entry.key),
    ["loan"],
  );
  assert.deepEqual(
    [card(broke, "buy-0").enabled, card(broke, "buy-0").note],
    [false, "Not enough cash"],
  );
});

test("homes, the factory gate and Second Life; no panel on the street, on Monday or after the week", () => {
  const room = started();
  const home = panelAt(room, ROOMSHARE);
  assert.equal(home.sections[0]!.info, "Rest 25/50");
  assert.deepEqual(card(home, "relax").entry, [ACT, 1, ROOMSHARE, RELAX, 0, 0]);
  assert.deepEqual(panelAt(room, TOWER).sections, [
    { title: "Not your place", info: "You don't live here. Yet.", cards: [] },
  ]);
  const gate = panelAt(room, GIGAFACTORY);
  assert.equal(gate.sections[0]!.title, "Jobs at Gigafactory");
  assert.ok(
    gate.sections[0]!.cards.every((entry) =>
      entry.title.endsWith("· Gigafactory"),
    ),
  );
  assert.equal(panelAt(room, RESALE).sections[0]!.title, "Second Life");

  const view = fuseLaneView(room);
  const ada = view.players.find((player) => player.id === "a")!;
  assert.equal(
    panelFor({ ...view, part: "briefing" }, ada, view.players),
    undefined,
  );
  ada.state.done = true;
  assert.equal(panelFor(view, ada, view.players), undefined);
  ada.state.done = false;
  ada.state.inside = -1;
  assert.equal(panelFor(view, ada, view.players), undefined);
});

test("the HUD says where you are and what is running low: food, clothes and rent", () => {
  const room = started();
  const hud = (tweak: (a: PlayerState) => void) => {
    tweak(room.players.a!);
    return present(fuseLaneView(room), ADA).hud!;
  };
  const start = hud(() => {});
  assert.equal(start.where, "Out in Fusetown");
  assert.equal(start.job, "Unemployed");
  assert.deepEqual(start.chips, [
    { label: "No food", warn: true },
    { label: "Casual 6w", warn: false },
    { label: "Rent 3w", warn: false },
  ]);
  assert.equal(hud((a) => (a.dest = JOBHUB)).where, "Walking to Job Hub");
  assert.equal(
    hud((a) => Object.assign(a, { dest: -1, inside: FRESHCO })).where,
    "At FreshCo",
  );
  const fed = hud((a) => {
    a.meal = 1;
    a.clothes = [0, 1, 0];
    a.rentWeeks = 0;
    a.job = COOK;
    a.wage = 4.5;
  });
  assert.deepEqual(fed.chips, [
    { label: "Fed", warn: false },
    { label: "Smart casual 1w", warn: true },
    { label: "Rent due", warn: true },
  ]);
  assert.equal(fed.job, "Line Cook, Mono Burger · $4.50/h");
  const stocked = hud((a) => {
    a.groceries = 3;
    a.clothes = [0, 0, 0];
    a.rentOwed = 1200;
  });
  assert.deepEqual(stocked.chips, [
    { label: "Food 3w", warn: false },
    { label: "No clothes", warn: true },
    { label: "Owes $1,200", warn: true },
  ]);
  const done = hud((a) => (a.done = true));
  assert.equal(done.where, "Week over. Sleeping it off");
  assert.equal(done.done, true);
  assert.equal(present(fuseLaneView(room), ADA).canEndWeek, false);
});

test("Monday: the ticker reads the economy, READY is yours until you tap it, and the shared screen only watches", () => {
  const room = started();
  fold(room, { a: [endWeekEntry(room)], b: [endWeekEntry(room)] });
  const view = fuseLaneView(room);
  assert.equal(view.part, "briefing");
  const model = present(view, ADA);
  assert.equal(model.headline, "MONDAY · WEEK 2");
  assert.equal(model.hud!.seconds, 0);
  assert.equal(model.hud!.timer, 0);
  assert.deepEqual(model.readyEntry, [READY, 2]);
  assert.equal(model.briefing!.total, 2);
  const ticker = (economy: Partial<typeof view.economy>) =>
    present({ ...view, economy: { ...view.economy, ...economy } }, ADA)
      .briefing!.ticker;
  const labels = ticker({}).map((entry) => entry.label);
  assert.deepEqual(labels, [
    "Economy",
    "City500",
    "Rate",
    "Inflation",
    "Jobless",
    "Crypto",
    "Hiring",
  ]);
  const city = (history: number[]) =>
    ticker({ history }).find((entry) => entry.label === "City500")!;
  assert.deepEqual(city([100, 104]), {
    label: "City500",
    value: "104.0",
    up: true,
  });
  assert.equal(city([104, 100]).up, false);
  assert.equal(city([100]).up, undefined);
  assert.deepEqual(city([]), {
    label: "City500",
    value: "100.0",
    up: undefined,
  });
  assert.equal(ticker({ cycle: 1 })[0]!.up, true);
  assert.deepEqual(ticker({ cycle: 3 })[0], {
    label: "Economy",
    value: "recession",
    up: false,
  });
  assert.match(ticker({}).at(-1)!.value, /^\d\/9 firms$/);

  room.players.a!.ready = true;
  const tapped = present(fuseLaneView(room), ADA);
  assert.equal(tapped.readyEntry, undefined);
  assert.equal(tapped.briefing!.ready, true);
  assert.equal(tapped.briefing!.readyCount, 1);
  const tv = present(fuseLaneView(room), TV);
  assert.equal(tv.layout, "tv");
  assert.equal(tv.briefing!.ready, false);
  assert.deepEqual(tv.briefing!.notices, []);
  assert.equal(tv.readyEntry, undefined);
  assert.equal(tv.hud, undefined);
});

test("the lobby: the host starts with two players and manages bots, a guest waits, the shared screen never picks goals", () => {
  const room = createRoom("m0", FAST);
  fold(room, { a: [[JOIN, "a", "Ada", 0, "fox", 1]] });
  const alone = present(fuseLaneView(room), ADA);
  assert.equal(alone.screen, "lobby");
  assert.equal(alone.headline, "PICK YOUR GOALS");
  assert.deepEqual(alone.lobby.members, [
    {
      id: "a",
      name: "Ada (you)",
      status: "READY",
      avatar: "fox",
      color: colorOf(0),
    },
  ]);
  assert.equal(alone.lobby.canStart, false);
  assert.equal(
    alone.lobby.note,
    "Add a bot or invite a friend: two players start a match",
  );
  assert.deepEqual(alone.lobby.goals, [50, 50, 50, 50]);
  assert.equal(
    present(fuseLaneView(room), TV).lobby.note,
    "Waiting for players",
  );

  fold(room, {
    a: [
      [JOIN, "b", "Bo", 1, "cat", 1],
      addBot("bot:1", 2),
      [4, 0, 30, 40, 50, 60],
    ],
  });
  const host = present(fuseLaneView(room), ADA).lobby;
  assert.deepEqual(
    [host.canStart, host.showStart, host.note, host.canAddBot, host.canSetWeek],
    [true, true, "", true, true],
  );
  assert.deepEqual(host.removable, ["bot:1"]);
  assert.deepEqual(host.goals, [30, 40, 50, 60]);
  assert.deepEqual(
    host.members.map((member) => member.status),
    ["READY", "READY", "BOT"],
  );
  const guest = present(fuseLaneView(room), BO).lobby;
  assert.deepEqual(
    [
      guest.canStart,
      guest.showStart,
      guest.note,
      guest.canAddBot,
      guest.removable,
    ],
    [false, false, "Waiting for the host to start", false, []],
  );
  assert.equal(guest.canPickGoals, true);
  const tv = present(fuseLaneView(room), TV);
  assert.equal(tv.lobby.canPickGoals, false);
  assert.equal(tv.askName, false);
  const stranger = present(fuseLaneView(room), { ...BO, me: "zed" });
  assert.equal(stranger.askName, true);
  assert.equal(stranger.seated, false);
  assert.equal(present(fuseLaneView(room), { ...BO, me: "" }).askName, false);
  // A solo player is called "You" already.
  room.seats.get("a")!.name = "You";
  assert.equal(present(fuseLaneView(room), ADA).lobby.members[0]!.name, "You");
  fold(room, { a: [[13, { ...FAST, display: true }]] });
  assert.equal(room.settings.display, true);
});

test("layouts: the shared screen is a TV that marks nobody's places, a seated phone in a shared room is a controller", () => {
  const room = started();
  room.players.a!.job = COOK;
  room.players.a!.wage = 4;
  const tv = present(fuseLaneView(room), TV);
  assert.equal(tv.layout, "tv");
  assert.ok(tv.board.places.every((place) => place.hours === 0 && !place.work));
  const phone = present(fuseLaneView(room), { ...ADA, shared: true });
  assert.equal(phone.layout, "controller");
  assert.equal(present(fuseLaneView(room), ADA).layout, "board");
  const board = boardModel(fuseLaneView(room), ADA);
  assert.equal(board.places[MONO]!.work, true, "your workplace is marked");
  assert.equal(board.places[FRESHCO]!.work, false);
  assert.ok(board.players.find((player) => player.id === "a")!.you);
});

/** A match that ends on Monday of week 2 with `winners` meeting every goal. */
function finished(room: FuseLaneRoom, winners: string[]): FuseLaneRoom {
  for (const id of winners) {
    const player = room.players[id]!;
    player.goals = [10, 10, 10, 10];
    player.cash = 1000;
    player.happiness = 20;
    player.courses[0] = 10;
    player.job = id === "a" ? 0 : 1;
    player.wage = 4;
    player.dep = 30;
  }
  play(room);
  assert.equal(room.stage, "over");
  return room;
}
/** Plays the match out: every human calls each week as soon as it is theirs, and taps READY on Monday. */
function play(room: FuseLaneRoom): void {
  for (let n = 0; n < 5000 && room.stage === "running"; n++) {
    const humans = ["a", "b"].filter((id) => room.players[id]),
      current = room.order[room.turn] ?? "";
    if (room.phase === HANDOFF)
      fold(room, { [current]: [[READY, room.week, room.turn]] });
    else if (room.phase === BRIEFING)
      fold(room, Object.fromEntries(humans.map((id) => [id, [ready(room)]])));
    else {
      const up = room.settings.turns
        ? humans.filter((id) => id === current)
        : humans;
      fold(
        room,
        Object.fromEntries(up.map((id) => [id, [endWeekEntry(room)]])),
      );
    }
  }
}

test("results online: you win, someone else wins, the leader after the week limit, and a guest waits for a rematch", () => {
  const room = finished(started(), ["a"]);
  const mine = present(fuseLaneView(room), ADA);
  assert.equal(mine.screen, "over");
  assert.equal(mine.result!.title, "YOU WIN!");
  assert.equal(mine.result!.waiting, "");
  assert.equal(mine.headline, "");
  assert.match(
    mine.result!.lines[0]!,
    /^1\. Ada: all goals in week 2, net worth \$[\d,]+$/,
  );
  assert.match(
    mine.result!.lines[1]!,
    /^2\. Bo: \d+% of goals, net worth \$[\d,]+$/,
  );
  const theirs = present(fuseLaneView(room), BO);
  assert.equal(theirs.result!.title, "ADA WINS");
  assert.equal(theirs.result!.host, false);
  assert.equal(
    theirs.result!.waiting,
    "Waiting for the host to start a rematch",
  );
  assert.equal(present(fuseLaneView(room), TV).result!.title, "ADA WINS");

  const long = started();
  long.week = MAX_WEEKS;
  long.players.b!.happiness = 40;
  nextWeek(long);
  assert.equal(long.stage, "over");
  assert.equal(
    present(fuseLaneView(long), ADA).result!.title,
    `BO LEADS AFTER ${MAX_WEEKS + 1} WEEKS`,
  );
});

test("results on one device: the winners by name when several people play, YOU WIN alone, or the AI that beat you", () => {
  const pair = finished(started(TURNS), ["a"]);
  assert.equal(present(fuseLaneView(pair), DEVICE).result!.title, "ADA WINS");
  const both = finished(started(TURNS), ["a", "b"]);
  assert.equal(
    present(fuseLaneView(both), DEVICE).result!.title,
    "ADA & BO WIN",
  );

  const solo = () => {
    const room = createRoom("solo", TURNS);
    fold(room, { a: [[JOIN, "a", "Ada", 0, "fox", 1], addBot("bot:1", 1)] });
    fold(room, { a: [[ACTION, "start", "m1"]] });
    return room;
  };
  assert.equal(
    present(fuseLaneView(finished(solo(), ["a"])), DEVICE).result!.title,
    "YOU WIN!",
  );
  const lost = solo();
  const bot = lost.players["bot:1"]!;
  Object.assign(bot, {
    goals: [10, 10, 10, 10],
    cash: 1000,
    happiness: 20,
    job: 1,
    wage: 4,
    dep: 30,
  });
  bot.courses[0] = 10;
  play(lost);
  assert.equal(present(fuseLaneView(lost), DEVICE).result!.title, "BOT 2 WINS");
});

test("hot-seat score rows say who is playing, who is up next, who is done and who waits", () => {
  const room = started(TURNS, [addBot("bot:1", 2)]);
  runWhile(room, () => room.phase !== 2, 50);
  const turn = (view: ReturnType<typeof fuseLaneView>) =>
    Object.fromEntries(
      present(view, DEVICE).scores.map((row) => [row.id, row.turn]),
    );
  const first = room.order[room.turn]!,
    second = first === "a" ? "b" : "a";
  const handoff = turn(fuseLaneView(room));
  assert.equal(handoff[first], "Up next");
  assert.equal(
    handoff["bot:1"],
    room.players["bot:1"]!.done ? "Done" : "Waiting",
  );
  fold(room, { [first]: [[READY, room.week, room.turn]] });
  const playing = turn(fuseLaneView(room));
  assert.equal(playing[first], "Playing");
  assert.equal(playing[second], "Waiting");
  const model = present(fuseLaneView(room), DEVICE);
  assert.equal(
    model.hud!.name,
    room.players[first] === room.players.a ? "Ada" : "Bo",
  );
  assert.deepEqual(model.endWeekEntry, [END_WEEK, 1]);
  fold(room, { [first]: [[END_WEEK, room.week]] });
  assert.equal(turn(fuseLaneView(room))[first], "Done");
  assert.deepEqual(
    Object.values(turn(fuseLaneView(started()))),
    ["", ""],
    "no turns when everyone plays at once",
  );
});

test("loose ends: withdrawals in steps, a job held by someone who left, a flat chart, an away seat in the lobby", () => {
  const room = started();
  const bank = panelAt(room, NEOBANK, (a) => {
    a.cash = 0;
    a.bank = 750;
  });
  assert.deepEqual(
    bank.sections[0]!.cards.map((entry) => entry.key),
    ["withdraw-100", "withdraw-500", "withdraw-all", "loan"],
  );
  assert.equal(card(bank, "withdraw-500").title, "Withdraw $500");
  assert.equal(card(bank, "withdraw-500").price, "+$500");

  const a = room.players.a!;
  a.pos = doorOf(JOBHUB);
  a.inside = JOBHUB;
  const view = fuseLaneView(room);
  view.holders[0] = "gone";
  const hub = present(view, ADA).panel!;
  assert.equal(card(hub, "job-0").note, "Held by someone");

  assert.equal(
    sparkline([100, 100, 100], 300, 60),
    "0.0,60.0 150.0,60.0 300.0,60.0",
  );

  const lobby = createRoom("m0", FAST);
  fold(lobby, {
    a: [
      [JOIN, "a", "Ada", 0, "fox", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
      [PRESENCE, "b", false, 1],
    ],
  });
  assert.deepEqual(
    present(fuseLaneView(lobby), ADA).lobby.members.map(
      (member) => member.status,
    ),
    ["READY", "AWAY"],
  );
});

test("a leader the view no longer lists is Someone, and never a finisher", () => {
  const room = finished(started(), ["a"]);
  const gone = { ...fuseLaneView(room), winners: ["gone"] };
  assert.equal(
    present(gone, BO).result!.title,
    `SOMEONE LEADS AFTER ${room.week} WEEKS`,
  );
});
