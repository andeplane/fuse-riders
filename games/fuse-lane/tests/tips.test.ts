import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLEGE,
  EXTENDED,
  FRESHCO,
  GADGET,
  JOBHUB,
  JOBS,
  KEYNEST,
  MONO,
  NEOBANK,
  ROOMSHARE,
  THREADS,
  TRIED_EXTENSION,
  WALK,
  WORKPLACE,
  type PlayerState,
} from "../src/game/index.js";
import { LocalMatch, type LocalSetup } from "../src/app/local.js";
import { present, type Viewer } from "../src/app/presenter.js";
import { tips } from "../src/app/tips.js";

const setup: LocalSetup = {
  humans: [{ name: "Ada", avatar: "fox" }],
  bots: 0,
  level: 2,
  goals: [50, 50, 50, 50],
  weekSeconds: 45,
  seed: "tips-1",
};
const LOCAL: Viewer = {
  me: "",
  host: true,
  solo: true,
  display: false,
  shared: false,
  local: true,
};
const COOK = JOBS.findIndex((job) => job.title === "Line Cook");
const SHIFT_LEAD = JOBS.findIndex((job) => job.title === "Shift Lead");

/** A fresh match whose player is changed by `edit`, and the tips that follow. */
function tipsAfter(edit: (me: PlayerState) => void = () => {}) {
  const match = LocalMatch.create(setup);
  edit(match.room.players.p1!);
  return tips(match.view(), "p1");
}
/** A player with the basics in hand: a job, dressed, fed, rested, rent paid, a shift done, modest cash. */
const settled = (me: PlayerState) => {
  me.job = COOK;
  me.wage = 4;
  me.groceries = 2;
  me.weekShifts = 1;
  me.failed = JOBS.map((_, index) => index);
  me.goals = [0, 0, 0, 0];
  me.cash = 100;
};

test("a new player is told to get a job first, at the Job Hub", () => {
  const [first] = tipsAfter();
  assert.equal(first!.place, JOBHUB);
  assert.match(first!.text, /^Get a job: the Job Hub lists every opening/);
});

test("with only the sure thing left, the tip names it; with nothing left, gig work", () => {
  const sure = tipsAfter((me) => {
    me.failed = JOBS.map((_, index) => index).filter((index) => index !== COOK);
  });
  assert.match(sure[0]!.text, /Line Cook at Mono Burger is a sure thing/);
  const none = tipsAfter((me) => {
    me.failed = JOBS.map((_, index) => index);
  });
  assert.match(none[0]!.text, /gig work at the Job Hub/);
  assert.equal(none[0]!.place, JOBHUB);
});

test("rent: pay it, fetch cash from the bank for it, ask for time, or clear arrears", () => {
  const find = (list: ReturnType<typeof tips>, pattern: RegExp) =>
    list.find((tip) => pattern.test(tip.text));
  const due = tipsAfter((me) => {
    me.rentWeeks = 0;
    me.cash = 500;
  });
  assert.equal(find(due, /Rent is due: pay \$325 at KeyNest/)?.place, KEYNEST);
  const bank = tipsAfter((me) => {
    me.rentWeeks = 0;
    me.cash = 100;
    me.bank = 400;
  });
  assert.equal(find(bank, /take cash out at Neobank/)?.place, NEOBANK);
  const short = tipsAfter((me) => {
    me.rentWeeks = 0;
    me.cash = 10;
  });
  assert.equal(find(short, /ask KeyNest for more time/)?.place, KEYNEST);
  // Once you have asked, or KeyNest won't hear you, it says how much you are short and where to earn it.
  for (const flags of [TRIED_EXTENSION, 0]) {
    const asked = tipsAfter((me) => {
      me.rentWeeks = 0;
      me.cash = 10;
      me.flags |= flags;
      if (!flags) me.rentExt = -1;
    });
    assert.equal(find(asked, /more time/), undefined);
    assert.equal(
      find(asked, /Rent is due and you are \$315 short/)?.place,
      JOBHUB,
    );
  }
  const working = tipsAfter((me) => {
    me.rentWeeks = 0;
    me.cash = 10;
    me.flags |= TRIED_EXTENSION;
    me.job = 0;
  });
  assert.equal(
    find(working, /you are \$315 short/)?.place,
    WORKPLACE[JOBS[0]!.employer],
  );
  const extended = tipsAfter((me) => {
    me.rentWeeks = 0;
    me.cash = 10;
    me.flags |= TRIED_EXTENSION | EXTENDED;
  });
  assert.equal(find(extended, /Rent/), undefined, "KeyNest gave you time");
  const owed = tipsAfter((me) => {
    me.rentOwed = 120;
  });
  assert.equal(find(owed, /You owe \$120 in back rent/)?.place, KEYNEST);
});

test("food for Monday: Mono Burger without a fridge, FreshCo with one, nothing once fed", () => {
  const hungry = tipsAfter(settledHungry);
  assert.equal(hungry[0]!.place, MONO);
  assert.match(hungry[0]!.text, /lose 20 hours to hunger/);
  const fridge = tipsAfter((me) => {
    settledHungry(me);
    me.durables.fridge = { n: 1, paid: 600, cheap: false };
  });
  assert.equal(fridge[0]!.place, FRESHCO);
  assert.ok(!tipsAfter(settled).some((tip) => /hunger/.test(tip.text)));
});
function settledHungry(me: PlayerState) {
  settled(me);
  me.groceries = 0;
}

test("clothes: the job's level, worn out next week, or nothing to wear", () => {
  const smart = tipsAfter((me) => {
    settled(me);
    me.job = SHIFT_LEAD;
  });
  assert.equal(smart[0]!.place, THREADS);
  assert.match(smart[0]!.text, /needs smart casual clothes/);
  const thin = tipsAfter((me) => {
    settled(me);
    me.clothes = [1, 0, 0];
  });
  assert.match(thin[0]!.text, /wear out next week/);
  const bare = tipsAfter((me) => {
    me.clothes = [0, 0, 0];
  });
  assert.ok(bare.some((tip) => /nothing to wear/.test(tip.text)));
});

test("with a job: a shift where you work, then a better opening when you qualify", () => {
  const shift = tipsAfter((me) => {
    settled(me);
    me.weekShifts = 0;
  });
  assert.equal(shift[0]!.place, MONO);
  assert.match(shift[0]!.text, /Work a shift at Mono Burger: 6 hours/);
  const better = tipsAfter((me) => {
    settled(me);
    me.failed = [];
    me.exp = 20;
    me.dep = 30;
  });
  const up = better.find((tip) => /You qualify for/.test(tip.text))!;
  assert.equal(up.place, JOBHUB);
  assert.match(
    up.text,
    /^You qualify for .+ at \$\d+\/h: apply at the Job Hub\.$/,
  );
});

test("worn out: rest at home before the doctor sends a bill", () => {
  const tired = tipsAfter((me) => {
    settled(me);
    me.relax = 12;
  });
  assert.equal(tired[0]!.place, ROOMSHARE);
  assert.match(tired[0]!.text, /relax at Roomshare/);
});

test("short of the education goal: enroll, then go to class", () => {
  const enroll = tipsAfter((me) => {
    settled(me);
    me.goals = [0, 0, 50, 0];
  });
  assert.equal(enroll[0]!.place, COLLEGE);
  assert.match(enroll[0]!.text, /^Enroll in Trade Cert/);
  const study = tipsAfter((me) => {
    settled(me);
    me.goals = [0, 0, 50, 0];
    me.courses[0] = 3;
  });
  assert.match(study[0]!.text, /3 of 10 lessons done in Trade Cert/);
  const broke = tipsAfter((me) => {
    settled(me);
    me.goals = [0, 0, 50, 0];
    me.cash = 0;
  });
  assert.ok(!broke.some((tip) => tip.place === COLLEGE));
});

test("spare cash: nice things while unhappy, savings when flush", () => {
  const rich = tipsAfter((me) => {
    settled(me);
    me.goals = [0, 50, 0, 0];
    me.cash = 900;
  });
  assert.deepEqual(
    rich.map((tip) => tip.place),
    [GADGET, NEOBANK],
  );
});

test("all in hand: work more or call it a week; nothing once the week is over", () => {
  const calm = tipsAfter(settled);
  assert.equal(calm.length, 1);
  assert.equal(calm[0]!.place, MONO);
  assert.match(calm[0]!.text, /call it a week: spare hours become sleep/);
  assert.deepEqual(
    tipsAfter((me) => {
      me.done = true;
    }),
    [],
  );
  const match = LocalMatch.create(setup);
  assert.deepEqual(tips(match.view(), "nobody"), []);
});

test("the board shows the top tip until you walk; the you panel lists up to three", () => {
  const match = LocalMatch.create(setup);
  const model = present(match.view(), LOCAL);
  assert.equal(model.tip?.place, JOBHUB);
  assert.ok(model.hud!.tips.length >= 1 && model.hud!.tips.length <= 3);
  assert.equal(model.hud!.tips[0], model.tip!.text);
  match.play([WALK, 1, JOBHUB]);
  match.step();
  assert.equal(present(match.view(), LOCAL).tip, undefined, "walking");
});
