import type { RosterMember } from "fuse-ui";
import {
  ACT,
  APPLY,
  ASSET_NAMES,
  BORROW,
  BUY,
  BUY_USED,
  CAPACITY,
  CLASS,
  CRYPTO,
  CLOTHING_NAMES,
  COMPANIES,
  COURSES,
  CYCLES,
  DEPOSIT,
  DURABLES,
  DURABLE_NAMES,
  durableName,
  EMPLOYERS,
  END_WEEK,
  ENROLL,
  EXTEND,
  FUN_HAPPY,
  GIG,
  GOAL_NAMES,
  GREETINGS,
  HOURS,
  ITEMS,
  JOBS,
  MOVE,
  PAID_HOURS,
  PAY_ARREARS,
  PAY_RENT,
  PAWN,
  PLACES,
  QUIT,
  RAISE,
  READY,
  REDEEM,
  RELAX,
  RENT,
  REPAY,
  SCRATCH,
  SCRATCH_PER_WEEK,
  SCRATCH_PRICE,
  SCRATCH_PRIZES,
  TICKS_PER_SECOND,
  TRADE_BUY,
  UNITS_PER_HOUR,
  TRADE_SELL,
  TRIED_EXTENSION,
  WALK,
  WEEK_HOURS,
  WITHDRAW,
  WORK,
  WORKPLACE,
  buyCost,
  creditLeft,
  creditLine,
  enrollFee,
  loanPayment,
  loanRate,
  pawnValue,
  redeemPrice,
  gigWage,
  hireOdds,
  hiring,
  homePlace,
  lessonsNeeded,
  marketWage,
  missing,
  quote,
  rentPrice,
  sellValue,
  shelfPrice,
  walkSteps,
  type Economy,
  type FuseLanePlayerView,
  type FuseLaneView,
  type PlayerState,
  FLU,
  NO_EVENT,
  PICKPOCKETS,
  eventChip,
} from "../game/index.js";
import { tips, type Tip } from "./tips.js";
import type { ChecklistModel } from "./checklist.js";

/**
 * What the Fuse Lane screen shows, as a pure function of the view and who this device is. The screen renders from
 * the view every frame, never from events: a rollback can change a purchase or a hire after it was shown.
 */
export interface Viewer {
  /** This device's member id ("solo" alone, "" before the room service admitted it). */
  me: string;
  host: boolean;
  solo: boolean;
  /** The shared screen (`?display=1`): it shows the board and never plays. */
  display: boolean;
  /** The room is one shared screen with phones as controllers. */
  shared: boolean;
  /**
   * A match on this device (solo or hot-seat): `me` follows whoever's turn it is, Monday's READY is everyone's, and
   * private news shows only on its owner's turn when several people share the device.
   */
  local?: boolean;
}

export const COLORS = ["#4cc9f0", "#ff6b6b", "#3ddc84", "#ffd23f", "#b388ff"];
export const colorOf = (slot: number): string => COLORS[slot % COLORS.length]!;

export interface Card {
  key: string;
  title: string;
  detail: string;
  /** "$120", "+$64" or "". */
  price: string;
  /** "6h" or "". */
  hours: string;
  /** An art id, drawn with its placeholder when the file is missing. */
  icon: string;
  /** The play entry body this card logs, without seq and tick. */
  entry?: unknown[];
  enabled: boolean;
  /** Why it is disabled, or a status ("Owned", "Held by Ada"). */
  note: string;
}
export interface Section {
  title: string;
  cards: Card[];
  /** A line above the cards. */
  info?: string;
}
export interface PanelModel {
  place: number;
  name: string;
  greeting: string;
  keeper: string;
  sections: Section[];
}
export interface GoalBar {
  name: string;
  icon: string;
  value: number;
  goal: number;
  met: boolean;
}
export interface HudModel {
  week: number;
  hoursUsed: number;
  hoursLeft: number;
  /** Hours used, 0..1, for the ring. */
  ring: number;
  cash: number;
  bank: number;
  seconds: number;
  /** Real time left in the week, 1..0. */
  timer: number;
  goals: GoalBar[];
  done: boolean;
  where: string;
  job: string;
  /** Short life status chips: food, clothes, rent. */
  chips: { label: string; warn: boolean }[];
  /** This week's town event under the clock, or "" (`warn` for a hazard). */
  event: { label: string; warn: boolean };
  /** What to do next, most pressing first (the you panel's Tips). */
  tips: string[];
  /** Whose week this is (hot-seat), and this Monday's private news for them. */
  name: string;
  color: string;
  notices: string[];
}
export interface BoardPlayer {
  id: string;
  name: string;
  color: string;
  avatar: string;
  pos: number;
  dest: number;
  inside: number;
  done: boolean;
  you: boolean;
}
export interface BoardPlace {
  index: number;
  id: string;
  name: string;
  /** Hours to walk there and go in, for this device's player (0 inside or when nobody plays here). */
  hours: number;
  /** This device's player is inside, or walking there. */
  here: boolean;
  dest: boolean;
  /** This device's player works here. */
  work: boolean;
}
export interface Ticker {
  label: string;
  value: string;
  up: boolean | undefined;
}
export interface BriefingModel {
  week: number;
  headlines: string[];
  ticker: Ticker[];
  notices: string[];
  history: number[];
  ready: boolean;
  readyCount: number;
  total: number;
  seconds: number;
}
export interface ScoreRow {
  id: string;
  name: string;
  color: string;
  avatar: string;
  goals: GoalBar[];
  progress: number;
  cash: number;
  hoursLeft: number;
  done: boolean;
  you: boolean;
  present: boolean;
  /** Hot-seat: "Playing", "Up next", "Done" or "". */
  turn: string;
  bot: boolean;
}
export interface HandoffModel {
  id: string;
  name: string;
  color: string;
  avatar: string;
  week: number;
  /** "Turn 2 of 3". */
  step: string;
}
export interface ResultModel {
  title: string;
  lines: string[];
  host: boolean;
  waiting: string;
}
export interface LobbyModel {
  members: RosterMember[];
  canStart: boolean;
  showStart: boolean;
  note: string;
  canAddBot: boolean;
  removable: string[];
  /** This device's goal picks, and whether it may change them. */
  goals: number[];
  canPickGoals: boolean;
  weekSeconds: number;
  canSetWeek: boolean;
}
export interface ScreenModel {
  screen: "lobby" | "game" | "over";
  /** A phone in a shared-screen room is a controller: no board, big place buttons. */
  layout: "board" | "controller" | "tv";
  seated: boolean;
  askName: boolean;
  hud?: HudModel;
  board: { players: BoardPlayer[]; places: BoardPlace[] };
  panel?: PanelModel;
  briefing?: BriefingModel;
  handoff?: HandoffModel;
  scores: ScoreRow[];
  result?: ResultModel;
  lobby: LobbyModel;
  /**
   * Your latest message: `n` counts every message you have had, so the screen shows one when it goes up. Present
   * whenever you play, also before your first message, so the screen knows where your count started.
   */
  toast?: { owner: string; n: number; text: string; bad: boolean };
  /** The "Getting started" checklist, which the page adds: it is kept on the device, not in the match. */
  checklist?: ChecklistModel;
  /** The most pressing tip while you are not walking, shown on the board when no panel is open: a tap walks you to its place. */
  tip?: Tip;
  canEndWeek: boolean;
  endWeekEntry?: unknown[];
  readyEntry?: unknown[];
  /** Where a tap on a place sends this player, or nothing when they cannot walk now. */
  walk?: (place: number) => unknown[];
  headline: string;
}

const money = (value: number) =>
  `${value < 0 ? "-" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const hours = (value: number) => `${value}h`;
const GOAL_ICONS = ["ui-wealth", "ui-happiness", "ui-education", "ui-career"];

export function goalBars(player: FuseLanePlayerView): GoalBar[] {
  return GOAL_NAMES.map((name, index) => ({
    name,
    icon: GOAL_ICONS[index]!,
    value: player.stats[index]!,
    goal: player.state.goals[index]!,
    met: player.stats[index]! >= player.state.goals[index]!,
  }));
}

const actEntry = (
  view: FuseLaneView,
  place: number,
  action: number,
  a = 0,
  b = 0,
): unknown[] => [ACT, view.week, place, action, a, b];

function card(fields: Partial<Card> & Pick<Card, "key" | "title">): Card {
  return {
    detail: "",
    price: "",
    hours: "",
    icon: "",
    enabled: true,
    note: "",
    ...fields,
  };
}

// ---- place panels --------------------------------------------------------------------------------------------

function shopCards(view: FuseLaneView, me: PlayerState, place: number): Card[] {
  const economy = view.economy;
  return ITEMS.flatMap((item, index) => {
    if (item.place !== place) return [];
    const price = shelfPrice(economy, item),
      owned =
        item.durable !== undefined && (me.durables[item.durable]?.n ?? 0) > 0,
      firstTime =
        item.durable !== undefined && me.durables[item.durable] === undefined,
      wentOut = item.kind === "fun" && (me.flags & FUN_HAPPY) !== 0;
    const happy =
      item.happy > 0 && (item.kind !== "durable" || firstTime)
        ? ` · +${item.happy} ☺`
        : item.happy < 0
          ? ` · ${item.happy} ☺`
          : "";
    return [
      card({
        key: `buy-${index}`,
        title: item.name,
        detail: `${item.effect}${happy}`,
        price: money(price),
        hours: item.hours ? hours(item.hours) : "",
        icon: `icon-${item.icon}`,
        entry: actEntry(view, place, BUY, index),
        enabled: !owned && !wentOut && me.cash >= price,
        note: owned
          ? "Owned"
          : wentOut
            ? "Done this week"
            : me.cash < price
              ? "Not enough cash"
              : "",
      }),
    ];
  });
}

function workCard(
  view: FuseLaneView,
  me: PlayerState,
  place: number,
): Card | undefined {
  if (me.job < 0 || WORKPLACE[JOBS[me.job]!.employer] !== place) return;
  const job = JOBS[me.job]!;
  const dressed = me.clothes.slice(job.uniform).some((weeks) => weeks > 0);
  return card({
    key: "work",
    title: `Work a shift · ${job.title}`,
    detail: `Paid ${PAID_HOURS}h at $${me.wage.toFixed(2)}/h. Dependability +1`,
    price: `+${money(Math.round(me.wage * PAID_HOURS))}`,
    hours: hours(HOURS.work),
    icon: "ui-work",
    entry: actEntry(view, place, WORK),
    enabled: dressed,
    note: dressed
      ? ""
      : `Needs ${CLOTHING_NAMES[job.uniform]!.toLowerCase()} clothes`,
  });
}

function jobHub(
  view: FuseLaneView,
  me: PlayerState,
  players: FuseLanePlayerView[],
  place: number,
): Section[] {
  const economy = view.economy;
  const mine = me.job >= 0 ? JOBS[me.job]! : undefined;
  const yours: Card[] = [
    card({
      key: "gig",
      title: "Gig work",
      detail: "Deliveries and rides. Pays now, builds nothing",
      price: `+${money(Math.round(gigWage(economy) * PAID_HOURS))}`,
      hours: hours(HOURS.gig),
      icon: "ui-work",
      entry: actEntry(view, place, GIG),
    }),
  ];
  if (mine) {
    const market = marketWage(economy, mine);
    yours.unshift(
      card({
        key: "raise",
        title: "Ask for a raise",
        detail: `You earn $${me.wage.toFixed(2)}/h; the market pays $${market.toFixed(2)}/h`,
        hours: hours(HOURS.raise),
        icon: "ui-career",
        entry: actEntry(view, place, RAISE),
        enabled: market > me.wage,
        note: market > me.wage ? "" : "You're already above market",
      }),
      card({
        key: "quit",
        title: "Quit your job",
        detail: `${mine.title} at ${EMPLOYERS[mine.employer]}`,
        icon: "ui-career",
        entry: actEntry(view, place, QUIT),
      }),
    );
  }
  const list = postings(view, me, players, place, JOBS.keys());
  return [
    {
      title: "You",
      cards: yours,
      info: mine
        ? `${mine.title} at ${EMPLOYERS[mine.employer]}, $${me.wage.toFixed(2)}/h`
        : "Unemployed",
    },
    { title: "Postings", cards: list },
  ];
}

/**
 * Whether a toast is news on this page: each player's message count as last seen here, where their first frame is the
 * baseline (a message from before the page loaded, or from before their turn came round, is old news) and every
 * message after that is new.
 */
export function toastTracker(): (
  toast: NonNullable<ScreenModel["toast"]>,
) => boolean {
  const seen = new Map<string, number>();
  return ({ owner, n }) => {
    const last = seen.get(owner);
    seen.set(owner, n);
    return last !== undefined && n > last;
  };
}

/**
 * Job postings as cards, the ones you qualify for first, then by wage: every job at the Job Hub, an employer's own at
 * its gate (the factory, the docks).
 */
function postings(
  view: FuseLaneView,
  me: PlayerState,
  players: FuseLanePlayerView[],
  place: number,
  jobs: Iterable<number>,
): Card[] {
  const economy = view.economy;
  const nameOf = (id: string) =>
    players.find((player) => player.id === id)?.name ?? "someone";
  const rows = [...jobs].map((index) => {
    const job = JOBS[index]!;
    const held = view.holders[index],
      reasons = missing(me, job),
      wage = marketWage(economy, job);
    const open = hiring(economy, job.employer);
    const needs = [
      job.degrees.length
        ? job.degrees.map((course) => COURSES[course]!.name).join(" + ")
        : "",
      `dep ${job.dep === 10 ? 0 : job.dep}`,
      `exp ${job.exp}`,
      CLOTHING_NAMES[job.uniform]!.toLowerCase(),
    ].filter(Boolean);
    const posting = card({
      key: `job-${index}`,
      title: `${job.title} · ${EMPLOYERS[job.employer]}`,
      detail: `Needs ${needs.join(", ")}`,
      price: `$${wage.toFixed(2)}/h`,
      hours: hours(HOURS.apply),
      icon: "ui-career",
      entry: actEntry(view, place, APPLY, index),
      enabled:
        held === undefined &&
        me.job !== index &&
        open &&
        !me.failed.includes(index),
      note:
        me.job === index
          ? "Your job"
          : held !== undefined
            ? `Held by ${nameOf(held)}`
            : !open
              ? "Hiring freeze"
              : me.failed.includes(index)
                ? "No openings this week"
                : reasons.length
                  ? `Missing ${reasons.join(", ")}`
                  : job.sure
                    ? "Sure thing"
                    : `${Math.max(0, Math.min(100, hireOdds(economy, me)))}% odds`,
    });
    return { posting, qualified: reasons.length === 0, wage };
  });
  // Ordered by what you qualify for, never by whether you just applied: a posting you tried stays where you tapped it
  // and shows the answer, rather than jumping away.
  rows.sort(
    (a, b) => Number(b.qualified) - Number(a.qualified) || b.wage - a.wage,
  );
  return rows.map((row) => row.posting);
}

/** An employer's gate: its own jobs, applied for on the spot. */
function gate(
  view: FuseLaneView,
  me: PlayerState,
  players: FuseLanePlayerView[],
  place: number,
): Section[] {
  const employer = PLACES[place]!.employer;
  const ladder = [...JOBS.keys()].filter(
    (index) => JOBS[index]!.employer === employer,
  );
  return [
    {
      title: `Jobs at ${EMPLOYERS[employer]}`,
      info: "Apply here, or for any job at the Job Hub.",
      cards: postings(view, me, players, place, ladder),
    },
  ];
}

function college(
  view: FuseLaneView,
  me: PlayerState,
  place: number,
): Section[] {
  const need = lessonsNeeded(me);
  const cards = COURSES.map((course, index) => {
    const fee = enrollFee(view.economy, index),
      lessons = me.courses[index]!,
      prereq = course.prereq;
    if (lessons >= 10)
      return card({
        key: `course-${index}`,
        title: course.name,
        detail: "Graduated",
        icon: "ui-education",
        enabled: false,
        note: "Degree earned",
      });
    if (lessons >= 0)
      return card({
        key: `course-${index}`,
        title: `Attend ${course.name}`,
        detail: `Lesson ${lessons + 1} of ${need}`,
        hours: hours(HOURS.class),
        icon: "ui-study",
        entry: actEntry(view, place, CLASS, index),
      });
    const locked = prereq >= 0 && me.courses[prereq]! < 10;
    return card({
      key: `course-${index}`,
      title: `Enroll: ${course.name}`,
      detail: locked
        ? `Needs ${COURSES[prereq]!.name}`
        : `${need} lessons to a degree`,
      price: money(fee),
      icon: "ui-education",
      entry: actEntry(view, place, ENROLL, index),
      enabled: !locked && me.cash >= fee,
      note: locked ? "Locked" : me.cash < fee ? "Not enough cash" : "",
    });
  });
  cards.sort(
    (a, b) =>
      Number(Boolean(b.hours)) - Number(Boolean(a.hours)) ||
      Number(b.enabled) - Number(a.enabled),
  );
  return [
    {
      title: "Courses",
      cards,
      info: "Study books and a laptop each cut one lesson per degree.",
    },
  ];
}

function keyNest(
  view: FuseLaneView,
  me: PlayerState,
  place: number,
): Section[] {
  const economy = view.economy;
  const cards: Card[] = [];
  const weeks = me.rentWeeks === 0 ? 4 - (view.week % 4) : 4;
  cards.push(
    card({
      key: "pay-rent",
      title: "Pay rent",
      detail: `${weeks} more weeks at ${PLACES[homePlace(me.home)]!.name}`,
      price: money(me.rent),
      icon: "ui-rent",
      entry: actEntry(view, place, PAY_RENT),
      enabled: me.cash >= me.rent && me.rentWeeks < 9,
      note:
        me.rentWeeks >= 9
          ? "Paid far enough ahead"
          : me.cash < me.rent
            ? "Not enough cash"
            : "",
    }),
  );
  if (me.rentWeeks === 0)
    cards.push(
      card({
        key: "extend",
        title: "Ask for more time",
        detail: ["Always granted", "75% odds", "50% odds", "25% odds"][
          Math.min(3, Math.max(0, me.rentExt))
        ]!,
        icon: "ui-rent",
        entry: actEntry(view, place, EXTEND),
        enabled: me.rentExt >= 0 && (me.flags & TRIED_EXTENSION) === 0,
        note:
          me.rentExt < 0
            ? "Not after a garnishment"
            : (me.flags & TRIED_EXTENSION) !== 0
              ? "Asked this week"
              : "",
      }),
    );
  if (me.rentOwed > 0)
    cards.push(
      card({
        key: "arrears",
        title: "Pay off arrears",
        detail: "Stops the garnishment",
        price: money(me.rentOwed),
        icon: "ui-rent",
        entry: actEntry(view, place, PAY_ARREARS),
        enabled: me.cash >= me.rentOwed,
        note: me.cash < me.rentOwed ? "Not enough cash" : "",
      }),
    );
  for (const home of [0, 1]) {
    if (home === me.home) continue;
    const price = rentPrice(economy, home),
      penalty = view.week < me.leaseEnd ? me.rent : 0;
    cards.push(
      card({
        key: `move-${home}`,
        title: `Move to ${PLACES[homePlace(home)]!.name}`,
        detail: `${money(price)} per 4 weeks, locked for 12${home === 0 ? ". Break-ins happen" : ". Doorman, no break-ins"}${penalty ? `. Lease break fee ${money(penalty)}` : ""}`,
        price: money(price + penalty),
        icon: "ui-rent",
        entry: actEntry(view, place, MOVE, home),
        enabled: me.cash >= price + penalty,
        note: me.cash < price + penalty ? "Not enough cash" : "",
      }),
    );
  }
  return [
    {
      title: "Your lease",
      info: `Rent ${money(me.rent)} per 4 weeks · ${me.rentWeeks} weeks paid${me.rentOwed ? ` · ${money(me.rentOwed)} owed` : ""}. Base rents ${money(RENT[0])} / ${money(RENT[1])}`,
      cards,
    },
  ];
}

function neobank(
  view: FuseLaneView,
  me: PlayerState,
  place: number,
): Section[] {
  const economy = view.economy;
  const amounts = (have: number) =>
    [100, 500].filter((amount) => amount < have).concat(have > 0 ? [have] : []);
  const cash: Card[] = [
    ...amounts(me.cash).map((amount) =>
      card({
        key: `deposit-${amount === me.cash ? "all" : amount}`,
        title: amount === me.cash ? "Deposit all" : `Deposit ${money(amount)}`,
        detail: "Safe from pickpockets, earns interest",
        price: money(amount),
        icon: "ui-bank",
        entry: actEntry(view, place, DEPOSIT, amount),
      }),
    ),
    ...amounts(me.bank).map((amount) =>
      card({
        key: `withdraw-${amount === me.bank ? "all" : amount}`,
        title:
          amount === me.bank ? "Withdraw all" : `Withdraw ${money(amount)}`,
        detail: "",
        price: `+${money(amount)}`,
        icon: "ui-cash",
        entry: actEntry(view, place, WITHDRAW, amount),
      }),
    ),
  ];
  const left = creditLeft(me),
    rate = loanRate(economy).toFixed(1);
  const loans: Card[] = [
    ...[200, 500]
      .filter((amount) => amount < left)
      .concat(left > 0 ? [left] : [])
      .map((amount) =>
        card({
          key: `borrow-${amount === left ? "max" : amount}`,
          title: `Borrow ${money(amount)}`,
          detail: `${rate}% a year · counts against Wealth until repaid`,
          price: `+${money(amount)}`,
          hours: hours(HOURS.trade),
          icon: "ui-cash",
          entry: actEntry(view, place, BORROW, amount),
        }),
      ),
    ...(left <= 0 && me.loan === 0
      ? [
          card({
            key: "borrow-none",
            title: "Borrow",
            detail: me.job < 0 ? "Neobank lends against a payslip" : "",
            icon: "ui-cash",
            enabled: false,
            note: me.loanLate > 0 ? "Payments missed" : "No credit yet",
          }),
        ]
      : []),
    ...[100]
      .filter((amount) => amount < me.loan)
      .concat(me.loan > 0 ? [me.loan] : [])
      .map((amount) =>
        card({
          key: `repay-${amount === me.loan ? "all" : amount}`,
          title:
            amount === me.loan ? "Pay off the loan" : `Repay ${money(amount)}`,
          detail: amount === me.loan ? "Debt free, and Wealth goes up" : "",
          price: money(amount),
          icon: "ui-bank",
          entry: actEntry(view, place, REPAY, amount),
          enabled: me.cash >= amount,
          note: me.cash < amount ? "Not enough cash" : "",
        }),
      ),
  ];
  const assets = ASSET_NAMES.map((name, asset) => {
    const price = quote(economy, asset),
      held = me.holdings[asset]!,
      cost = buyCost(economy, asset, 1);
    const company =
      asset < COMPANIES.length
        ? COMPANIES[asset]!.name
        : name === "CITY500"
          ? "Index fund"
          : name[0] + name.slice(1).toLowerCase();
    return [
      card({
        key: `buy-${asset}`,
        title: `Buy ${name}`,
        detail: `${company} · ${money(price)}${held ? ` · you hold ${held}` : ""}`,
        price: money(cost),
        icon: "ui-stocks",
        entry: actEntry(
          view,
          place,
          TRADE_BUY,
          asset,
          Math.max(1, Math.floor(Math.min(me.cash, 1000) / Math.max(1, cost))),
        ),
        enabled: me.cash >= cost,
        note:
          me.cash >= cost
            ? `${Math.max(1, Math.floor(Math.min(me.cash, 1000) / Math.max(1, cost)))} units`
            : "Not enough cash",
      }),
      ...(held
        ? [
            card({
              key: `sell-${asset}`,
              title: `Sell all ${name}`,
              detail: `${held} units`,
              price: `+${money(sellValue(economy, asset, held))}`,
              icon: "ui-stocks",
              entry: actEntry(view, place, TRADE_SELL, asset, held),
            }),
          ]
        : []),
    ];
  }).flat();
  return [
    {
      title: "Accounts",
      info: `Cash ${money(me.cash)} · Savings ${money(me.bank)} · Savings rate ${Math.max(0, economy.policyRate - 1).toFixed(2)}%`,
      cards: cash,
    },
    {
      title: "Loans",
      info:
        me.loan > 0
          ? `You owe ${money(me.loan)}${me.loanLate > 0 ? " · payments missed: half of each shift goes to Neobank" : ` · Monday payment ${money(loanPayment(me.loan))}`} · credit line ${money(creditLine(me))}`
          : `Credit line ${money(creditLine(me))} (${me.job >= 0 ? "about four weeks' pay" : "more with a job"}) · paid back a tenth each Monday`,
      cards: loans,
    },
    {
      title: "Markets",
      info: "Spreads apply; big orders move the price.",
      cards: assets,
    },
  ];
}

/** An item's picture: its full-price shop card's icon. */
const durableIcon = (item: number): string =>
  `icon-${ITEMS.find((data) => data.durable === DURABLES[item])?.icon ?? "fridge"}`;

function secondLife(
  view: FuseLaneView,
  me: PlayerState,
  place: number,
): Section[] {
  const shelf = view.shelf.map((offer, slot) => {
    const id = DURABLES[offer.item]!,
      owned = (me.durables[id]?.n ?? 0) > 0;
    return card({
      key: `used-${slot}-${offer.item}`,
      title: `${DURABLE_NAMES[id]} (used)`,
      detail: "Second-hand: breaks down a bit more often",
      price: money(offer.price),
      icon: durableIcon(offer.item),
      entry: actEntry(view, place, BUY_USED, slot, offer.item),
      enabled: !owned && me.cash >= offer.price,
      note: owned
        ? "You have one"
        : me.cash < offer.price
          ? "Not enough cash"
          : "",
    });
  });
  const pawnable = DURABLES.flatMap((id, item) =>
    (me.durables[id]?.n ?? 0) > 0
      ? [
          card({
            key: `pawn-${item}`,
            title: `Pawn your ${durableName(id)}`,
            detail: `Buy it back for ${money(redeemPrice(me.durables[id]!.paid))} within 3 weeks`,
            price: `+${money(pawnValue(me, item))}`,
            icon: durableIcon(item),
            entry: actEntry(view, place, PAWN, item),
            enabled: me.pawned.length < 4,
            note: me.pawned.length >= 4 ? "4 tickets at most" : "",
          }),
        ]
      : [],
  );
  const tickets = me.pawned.map((ticket, index) => {
    const id = DURABLES[ticket.item]!,
      price = redeemPrice(ticket.paid),
      home = (me.durables[id]?.n ?? 0) > 0;
    return card({
      key: `redeem-${index}-${ticket.item}`,
      title: `Redeem your ${durableName(id)}`,
      detail: `Until the end of week ${ticket.due}, then it goes on the shelf`,
      price: money(price),
      icon: durableIcon(ticket.item),
      entry: actEntry(view, place, REDEEM, index),
      enabled: !home && me.cash >= price,
      note: home ? "You have one" : me.cash < price ? "Not enough cash" : "",
    });
  });
  return [
    {
      title: "Used goods",
      info: view.shelf.length
        ? "First come, first served: whatever is pawned and never redeemed ends up here."
        : "The shelf is empty. Check back next week.",
      cards: shelf,
    },
    ...(tickets.length ? [{ title: "Your pawn tickets", cards: tickets }] : []),
    {
      title: "Pawn",
      info: pawnable.length
        ? "Quick cash for things you own: 40% of what you paid."
        : "Nothing to pawn: Second Life takes appliances and gadgets.",
      cards: pawnable,
    },
  ];
}

export function panelFor(
  view: FuseLaneView,
  you: FuseLanePlayerView,
  players: FuseLanePlayerView[],
): PanelModel | undefined {
  const me = you.state,
    place = me.inside;
  if (place < 0 || view.part !== "week" || me.done) return;
  const data = PLACES[place]!;
  let sections: Section[] = [];
  switch (data.kind) {
    case "home":
      sections =
        place === homePlace(me.home)
          ? [
              {
                title: "Home",
                info: `Rest ${me.relax}/50`,
                cards: [
                  card({
                    key: "relax",
                    title: "Relax",
                    detail: "Rest +3 · +2 ☺ once a week",
                    hours: hours(HOURS.relax),
                    icon: "ui-relax",
                    entry: actEntry(view, place, RELAX),
                  }),
                ],
              },
            ]
          : [
              {
                title: "Not your place",
                info: "You don't live here. Yet.",
                cards: [],
              },
            ];
      break;
    case "rent":
      sections = keyNest(view, me, place);
      break;
    case "grocery":
    case "food":
    case "clothes":
    case "gadgets":
    case "discount":
      sections = [{ title: "For sale", cards: shopCards(view, me, place) }];
      if (data.kind === "grocery")
        sections[0]!.cards.push(
          card({
            key: "lottery",
            title: "Scratch card",
            detail: `Top prize ${money(SCRATCH_PRIZES[0].prize)} · 1 in ${Math.round(1000 / SCRATCH_PRIZES.reduce((sum, prize) => sum + prize.odds, 0))} wins something`,
            price: money(SCRATCH_PRICE),
            icon: "ui-happiness",
            entry: actEntry(view, place, SCRATCH),
            enabled:
              me.scratched < SCRATCH_PER_WEEK && me.cash >= SCRATCH_PRICE,
            note:
              me.scratched >= SCRATCH_PER_WEEK
                ? `${SCRATCH_PER_WEEK} a week`
                : me.cash < SCRATCH_PRICE
                  ? "Not enough cash"
                  : `${me.scratched} of ${SCRATCH_PER_WEEK} this week`,
          }),
        );
      break;
    case "bank":
      sections = neobank(view, me, place);
      break;
    case "jobs":
      sections = jobHub(view, me, players, place);
      break;
    case "college":
      sections = college(view, me, place);
      break;
    case "factory":
    case "port":
      sections = gate(view, me, players, place);
      break;
    case "resale":
      sections = secondLife(view, me, place);
      break;
  }
  const work = workCard(view, me, place);
  if (work) sections.unshift({ title: "Your job", cards: [work] });
  const lines = GREETINGS[place]!;
  return {
    place,
    name: data.name,
    greeting: lines[view.week % lines.length]!,
    keeper: `keeper-${data.id}`,
    sections,
  };
}

// ---- the rest of the screen ----------------------------------------------------------------------------------

function hud(
  view: FuseLaneView,
  you: FuseLanePlayerView,
  news: boolean,
): HudModel {
  const me = you.state;
  const used = Math.round(you.hours * 10) / 10;
  const job = me.job >= 0 ? JOBS[me.job]! : undefined;
  const where = me.done
    ? "Week over. Sleeping it off"
    : me.dest >= 0
      ? `Walking to ${PLACES[me.dest]!.name}`
      : me.inside >= 0
        ? `At ${PLACES[me.inside]!.name}`
        : "Out in Fusetown";
  const fedNext = me.groceries > 0 || me.meal > 0;
  const best = [2, 1, 0].find((level) => me.clothes[level]! > 0);
  return {
    week: view.week,
    hoursUsed: used,
    hoursLeft: Math.max(0, Math.round((WEEK_HOURS - used) * 10) / 10),
    ring: Math.min(1, used / WEEK_HOURS),
    cash: me.cash,
    bank: me.bank,
    seconds:
      view.part === "week" ? Math.ceil(view.timerTicks / TICKS_PER_SECOND) : 0,
    timer:
      view.part === "week"
        ? Math.max(0, Math.min(1, view.timerTicks / view.partTicks))
        : 0,
    goals: goalBars(you),
    done: me.done,
    name: you.name,
    color: colorOf(you.slot),
    notices: news ? [...me.notices] : [],
    tips: tips(view, you.id)
      .slice(0, 3)
      .map((tip) => tip.text),
    where,
    job: job
      ? `${job.title}, ${EMPLOYERS[job.employer]} · $${me.wage.toFixed(2)}/h`
      : "Unemployed",
    chips: [
      {
        label: fedNext
          ? me.groceries > 0
            ? `Food ${me.groceries}w`
            : "Fed"
          : "No food",
        warn: !fedNext,
      },
      {
        label:
          best === undefined
            ? "No clothes"
            : `${CLOTHING_NAMES[best]} ${me.clothes[best]}w`,
        warn: best === undefined || me.clothes[best]! <= 1,
      },
      {
        label:
          me.rentOwed > 0
            ? `Owes ${money(me.rentOwed)}`
            : me.rentWeeks === 0
              ? "Rent due"
              : `Rent ${me.rentWeeks}w`,
        warn: me.rentOwed > 0 || me.rentWeeks === 0,
      },
      ...(me.loan > 0
        ? [{ label: `Loan ${money(me.loan)}`, warn: me.loanLate > 0 }]
        : []),
    ],
    // This week's town event, all week: a hazard warns, an opportunity does not.
    event: {
      label:
        view.economy.event === NO_EVENT
          ? ""
          : eventChip(view.economy.event, view.economy.eventArg),
      warn: view.economy.event === PICKPOCKETS || view.economy.event === FLU,
    },
  };
}

function ticker(economy: Economy): Ticker[] {
  const fund = economy.history,
    last = fund.at(-1) ?? 100,
    before = fund.at(-2) ?? last;
  return [
    {
      label: "Economy",
      value: CYCLES[economy.cycle]!,
      up: economy.cycle === 0 || economy.cycle === 1,
    },
    {
      label: "City500",
      value: last.toFixed(1),
      up: last === before ? undefined : last > before,
    },
    {
      label: "Rate",
      value: `${economy.policyRate.toFixed(2)}%`,
      up: undefined,
    },
    {
      label: "Inflation",
      value: `${(economy.inflation * 52).toFixed(1)}%/yr`,
      up: undefined,
    },
    {
      label: "Jobless",
      value: `${economy.unemployment.toFixed(1)}%`,
      up: undefined,
    },
    {
      label: "Crypto",
      value: `$${quote(economy, CRYPTO).toFixed(0)}`,
      up: undefined,
    },
    {
      label: "Hiring",
      value: `${COMPANIES.filter((_, index) => hiring(economy, index)).length}/${COMPANIES.length} firms`,
      up: undefined,
    },
  ];
}

function lobby(view: FuseLaneView, viewer: Viewer): LobbyModel {
  const players = view.players,
    host = viewer.host && !viewer.display;
  const mine = view.goals[viewer.me] ?? [50, 50, 50, 50];
  const seated = players.some((player) => player.id === viewer.me);
  return {
    members: players.map((player) => ({
      id: player.id,
      name:
        player.id === viewer.me && player.name !== "You"
          ? `${player.name} (you)`
          : player.name,
      status: player.bot ? "BOT" : player.present ? "READY" : "AWAY",
      avatar: player.avatarId,
      color: colorOf(player.slot),
    })),
    canStart: host && players.length >= 2,
    showStart: host,
    note:
      players.length >= 2
        ? host
          ? ""
          : "Waiting for the host to start"
        : viewer.display || !host
          ? "Waiting for players"
          : "Add a bot or invite a friend: two players start a match",
    canAddBot: host && players.length < CAPACITY,
    removable: host
      ? players.filter((player) => player.bot).map((player) => player.id)
      : [],
    goals: [...mine],
    canPickGoals: seated && !viewer.display,
    weekSeconds: view.weekSeconds,
    canSetWeek: host,
  };
}

/** What the board draws from one frame: every avatar where it is, and the places marked for this device. */
export function boardModel(
  view: FuseLaneView,
  viewer: Viewer,
): ScreenModel["board"] {
  const id = viewer.local ? view.current : viewer.me;
  const you = view.players.find((player) => player.id === id);
  const me = you && !viewer.display ? you.state : undefined;
  return {
    // A hot-seat week shows the player on the move; the others wait at home or where their week ended.
    players: view.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: colorOf(player.slot),
      avatar: player.avatarId,
      pos: player.state.pos,
      dest: player.state.dest,
      inside: player.state.inside,
      done: player.state.done,
      you: player.id === id,
    })),
    places: PLACES.map((place, index) => ({
      index,
      id: place.id,
      name: place.name,
      hours:
        me === undefined || me.inside === index
          ? 0
          : walkSteps(me.pos, index) / UNITS_PER_HOUR + HOURS.enter,
      here: me?.inside === index,
      dest: me?.dest === index,
      work:
        me !== undefined &&
        me.job >= 0 &&
        WORKPLACE[JOBS[me.job]!.employer] === index,
    })),
  };
}

export function present(view: FuseLaneView, viewer: Viewer): ScreenModel {
  const players = view.players;
  const people = players.filter((player) => !player.bot);
  const humans = people.length;
  // On one device, "you" is whoever's turn it is (or the only person there is).
  if (viewer.local)
    viewer = {
      ...viewer,
      me: view.current || (humans === 1 ? people[0]!.id : ""),
    };
  const you = players.find((player) => player.id === viewer.me);
  const sharedDevice = viewer.local === true && humans > 1;
  const seated = you !== undefined && !viewer.display;
  const playing = view.phase === "running";
  const inWeek = playing && view.part === "week";
  const layout: ScreenModel["layout"] = viewer.display
    ? "tv"
    : viewer.shared && seated
      ? "controller"
      : "board";
  const me = seated ? you.state : undefined;
  const board = boardModel(view, viewer);
  const scores: ScoreRow[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    color: colorOf(player.slot),
    avatar: player.avatarId,
    goals: goalBars(player),
    progress: player.progress,
    cash: player.liquid,
    hoursLeft: Math.max(0, WEEK_HOURS - Math.round(player.hours)),
    done: player.state.done,
    you: player.id === viewer.me,
    present: player.present,
    bot: player.bot,
    turn:
      !view.turns || !playing || view.part === "briefing"
        ? ""
        : player.id === view.current
          ? view.part === "handoff"
            ? "Up next"
            : "Playing"
          : player.state.done
            ? "Done"
            : "Waiting",
  }));
  let briefing: BriefingModel | undefined;
  if (playing && view.part === "briefing") {
    const active = players.filter((player) => player.present);
    briefing = {
      week: view.week,
      headlines: view.headlines,
      ticker: ticker(view.economy),
      // Several people on one device: each sees their own news on their own turn, not here.
      notices: me && !sharedDevice ? me.notices : [],
      history: view.economy.history,
      ready: viewer.local
        ? players.every((player) => player.bot || player.state.ready)
        : (me?.ready ?? false),
      readyCount: active.filter((player) => player.state.ready).length,
      total: active.length,
      seconds: Math.ceil(view.timerTicks / TICKS_PER_SECOND),
    };
  }
  const name = (id: string | undefined) =>
    players.find((player) => player.id === id)?.name ?? "Someone";
  let result: ResultModel | undefined;
  if (view.phase === "over") {
    const host = viewer.host && !viewer.display;
    const won = view.winners.filter(
      (id) =>
        (players.find((player) => player.id === id)?.state.finished ?? 0) > 0,
    );
    result = {
      title:
        won.length === 0
          ? `${name(view.winners[0]).toUpperCase()} LEADS AFTER ${view.week} WEEKS`
          : viewer.local
            ? humans > 1 || won.length > 1
              ? `${won.map(name).join(" & ").toUpperCase()} ${won.length > 1 ? "WIN" : "WINS"}`
              : players.find((player) => player.id === won[0])?.bot
                ? `${name(won[0]).toUpperCase()} WINS`
                : "YOU WIN!"
            : won[0] === viewer.me && seated
              ? "YOU WIN!"
              : `${name(won[0]).toUpperCase()} WINS`,
      lines: view.ranking.map((id, index) => {
        const player = players.find((row) => row.id === id)!;
        const finished = player.state.finished;
        return `${index + 1}. ${player.name}: ${finished ? `all goals in week ${finished}` : `${Math.round(player.progress * 100)}% of goals`}, net worth ${money(player.netWorth)}`;
      }),
      host,
      waiting: host ? "" : "Waiting for the host to start a rematch",
    };
  }
  let handoff: HandoffModel | undefined;
  if (playing && view.part === "handoff" && you && viewer.local) {
    const index = view.order.indexOf(you.id);
    handoff = {
      id: you.id,
      name: you.name,
      color: colorOf(you.slot),
      avatar: you.avatarId,
      week: view.week,
      step: `Turn ${index + 1} of ${view.order.length}`,
    };
  }
  const toast = me
    ? { owner: you!.id, n: me.msgN, text: me.msg, bad: me.msgBad }
    : undefined;
  const canAct = inWeek && me !== undefined && !me.done;
  const panel = seated && canAct ? panelFor(view, you, players) : undefined;
  // The screen hides it while a place's panel is open; closed, it shows again outside that place.
  const tip = canAct && me.dest < 0 ? tips(view, you!.id)[0] : undefined;
  return {
    screen:
      view.phase === "lobby"
        ? "lobby"
        : view.phase === "over"
          ? "over"
          : "game",
    layout,
    seated,
    askName: !seated && !viewer.display && viewer.me !== "",
    ...(me && view.part !== "handoff"
      ? { hud: hud(view, you!, sharedDevice) }
      : {}),
    ...(handoff ? { handoff } : {}),
    board,
    ...(panel ? { panel } : {}),
    ...(briefing ? { briefing } : {}),
    scores,
    ...(result ? { result } : {}),
    lobby: lobby(view, viewer),
    ...(toast ? { toast } : {}),
    ...(tip ? { tip } : {}),
    canEndWeek: canAct,
    ...(canAct
      ? {
          endWeekEntry: [END_WEEK, view.week],
          walk: (place: number) => [WALK, view.week, place],
        }
      : {}),
    ...(handoff
      ? { readyEntry: [READY, view.week, view.turn] }
      : briefing && (viewer.local ? !briefing.ready : me && !me.ready)
        ? { readyEntry: [READY, view.week] }
        : {}),
    headline:
      view.phase === "lobby"
        ? "PICK YOUR GOALS"
        : briefing
          ? `MONDAY · WEEK ${view.week}`
          : inWeek
            ? `WEEK ${view.week}`
            : "",
  };
}

/** The index fund's weekly history as an SVG polyline's points, in a `width` × `height` box. */
export function sparkline(
  history: readonly number[],
  width: number,
  height: number,
): string {
  if (history.length < 2) return "";
  const lo = Math.min(...history),
    hi = Math.max(...history),
    span = hi - lo || 1;
  return history
    .map(
      (value, index) =>
        `${((index / (history.length - 1)) * width).toFixed(1)},${(height - ((value - lo) / span) * height).toFixed(1)}`,
    )
    .join(" ");
}
