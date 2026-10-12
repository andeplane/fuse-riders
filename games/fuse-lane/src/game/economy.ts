import {
  ASSET_COUNT,
  BONDS,
  BOOM,
  CATEGORIES,
  COMPANIES,
  CRYPTO,
  CYCLES,
  ECONOMY,
  EDUCATION,
  EXPANSION,
  GOLD,
  HISTORY,
  HOUSING,
  INDEX_FUND,
  RECESSION,
  type Cycle,
} from "./data/economy.js";
import { ENROLL_FEE, RENT, type ItemData } from "./data/items.js";
import { COLLEGE_EMPLOYER } from "./data/places.js";
import type { JobData } from "./data/jobs.js";
import {
  chance,
  clamp,
  ln,
  normal,
  r2,
  r4,
  random,
  randInt,
  type Seeded,
} from "./random.js";

/**
 * The city's economy (economy-sim.md §1–§5): a weekly macro step, category prices that players' demand pushes, eight
 * companies whose revenue includes players' spending and whose health sets wages and hiring, and tradable assets.
 * Pure functions over plain data; randomness comes from the room's generator.
 */
export interface CompanyState {
  /** Last week's figures. */
  revenue: number;
  profit: number;
  /** Smoothed profit margin. */
  health: number;
  /** Smoothed weekly profit: what the share price is priced from. */
  earnings: number;
  /** Profit since the last dividend. */
  retained: number;
  /** This week so far: players' spending here, players' shift output and the wages paid to them. */
  spend: number;
  output: number;
  wages: number;
}
export interface Economy {
  cycle: Cycle;
  growth: number;
  inflation: number;
  policyRate: number;
  unemployment: number;
  sentiment: number;
  demand: number;
  wageIndex: number;
  /** The general price level inflation has built up since the start: category prices drift back toward it. */
  level: number;
  /** Price index per category (`CATEGORIES`), 1 at the start. */
  prices: number[];
  /** Players' spending per category this week. */
  spend: number[];
  companies: CompanyState[];
  /** Asset prices before market impact, and the impact (a fraction of the price) trades have left on each. */
  price: number[];
  impact: number[];
  /** The index fund's divisor: the eight companies' starting market cap. */
  indexBase: number;
  /** The index fund's price over the last weeks, oldest first. */
  history: number[];
  /** Weeks stepped. */
  weeks: number;
}

/** What one weekly step did, for headlines and for the player effects the week applies. */
export interface EconomyNews {
  crash: boolean;
  boom: boolean;
  /** Dividends paid per share this week, by company (0 when none). */
  dividends: number[];
  /** Companies laying off this week. */
  layoffs: number[];
  headlines: string[];
}

const C = ECONOMY;

function companyStart(index: number): CompanyState {
  const data = COMPANIES[index]!;
  return {
    revenue: data.baseline,
    profit: Math.round(data.baseline * data.margin),
    health: data.margin,
    earnings: Math.round(data.baseline * data.margin),
    retained: 0,
    spend: 0,
    output: 0,
    wages: 0,
  };
}

function multiple(economy: Economy): number {
  const s = C.stocks;
  return (
    s.multiple *
    (1 + economy.sentiment * s.sentimentGain) *
    Math.max(0.4, 1 - (economy.policyRate - s.neutralRate) * s.rateGain)
  );
}
function targetPrice(economy: Economy, index: number): number {
  const company = economy.companies[index]!,
    data = COMPANIES[index]!;
  const earnings = Math.max(
    company.earnings,
    data.baseline * data.margin * C.stocks.earningsFloor,
  );
  return Math.max(
    C.stocks.floor,
    ((earnings * 52) / data.shares) * multiple(economy),
  );
}
function cap(economy: Economy): number {
  return COMPANIES.reduce(
    (sum, data, index) => sum + economy.price[index]! * data.shares,
    0,
  );
}

export function createEconomy(): Economy {
  const economy: Economy = {
    cycle: EXPANSION,
    growth: C.growth.mean[EXPANSION],
    inflation: C.inflation.start,
    policyRate: C.policy.start,
    unemployment: C.unemployment.start,
    sentiment: 0.1,
    demand: 1,
    wageIndex: 1,
    level: 1,
    prices: CATEGORIES.map(() => 1),
    spend: CATEGORIES.map(() => 0),
    companies: COMPANIES.map((_, index) => companyStart(index)),
    price: Array.from({ length: ASSET_COUNT }, () => 0),
    impact: Array.from({ length: ASSET_COUNT }, () => 0),
    indexBase: 1,
    history: [],
    weeks: 0,
  };
  COMPANIES.forEach((_, index) => {
    economy.price[index] = r2(targetPrice(economy, index));
  });
  economy.indexBase = Math.round(cap(economy));
  economy.price[INDEX_FUND] = 100;
  economy.price[BONDS] = C.bonds.start;
  economy.price[GOLD] = C.gold.start;
  economy.price[CRYPTO] = C.crypto.start;
  economy.history = [100];
  return economy;
}

// ---- prices, wages and quotes --------------------------------------------------------------------------------

/** A company's health as a wage and hiring factor, 0.8–1.25. City College is always 1. */
export function healthFactor(economy: Economy, employer: number): number {
  if (employer === COLLEGE_EMPLOYER || employer < 0) return 1;
  const c = C.companies;
  return r4(
    clamp(
      1 +
        (economy.companies[employer]!.health - COMPANIES[employer]!.margin) *
          c.healthGain,
      c.healthMin,
      c.healthMax,
    ),
  );
}
export const hiring = (economy: Economy, employer: number): boolean =>
  healthFactor(economy, employer) >= C.companies.freezeBelow;

/** A shelf price: base × the category's index, at least $1. */
export const shelfPrice = (economy: Economy, item: ItemData): number =>
  Math.max(1, Math.round(item.price * economy.prices[item.category]!));
export const rentPrice = (economy: Economy, home: number): number =>
  Math.round(RENT[home]! * economy.prices[HOUSING]!);
export const enrollFee = (economy: Economy): number =>
  Math.round(ENROLL_FEE * economy.prices[EDUCATION]!);
/** What an employer offers for a position now: base × wage index × its health. */
export const marketWage = (economy: Economy, job: JobData): number =>
  r2(job.wage * economy.wageIndex * healthFactor(economy, job.employer));
export const gigWage = (economy: Economy): number =>
  r2(C.wages.gig * economy.wageIndex);

/** The quoted price of an asset, impact included. */
export const quote = (economy: Economy, asset: number): number =>
  r2(economy.price[asset]! * (1 + economy.impact[asset]!));
/** The bounds of an asset's market impact, as a fraction of its price. */
export const IMPACT_MIN = -0.5,
  IMPACT_MAX = 1;

/** An order against the market before the spread: what its units fill for in all, and the impact it leaves. */
export interface Fill {
  value: number;
  impact: number;
}
/**
 * An order of `qty` units. Each unit moves the impact by impact × price / liquidity (linear in units, so a trade of
 * value v at the impact-free price moves it by impact × v / liquidity), and every unit fills on the way: the order
 * pays the average of the quote before and after it, not the quote it started at. The quote is then a function of
 * the units traded on net only, so no sequence of trades within a week can buy low and sell high against its own
 * impact: a round trip costs at least the spread. Past the impact bounds the quote stops moving and the remaining
 * units fill at the bound, which only ever costs the trader.
 */
export function fill(
  economy: Economy,
  asset: number,
  qty: number,
  buy: boolean,
): Fill {
  const price = economy.price[asset]!,
    from = economy.impact[asset]!,
    step = (C.impact * price) / C.liquidity[asset]!;
  const to = clamp(from + (buy ? step : -step) * qty, IMPACT_MIN, IMPACT_MAX);
  const moving = step > 0 ? Math.min(qty, Math.abs(to - from) / step) : qty;
  return {
    value: price * (moving * (1 + (from + to) / 2) + (qty - moving) * (1 + to)),
    impact: to,
  };
}
/** Cost of buying `qty` units now: the filled value with the spread on top. */
export const buyCost = (economy: Economy, asset: number, qty: number): number =>
  Math.ceil(fill(economy, asset, qty, true).value * (1 + C.spread[asset]! / 2));
/** Proceeds of selling `qty` units now: the filled value with the spread taken. */
export const sellValue = (
  economy: Economy,
  asset: number,
  qty: number,
): number =>
  Math.floor(
    fill(economy, asset, qty, false).value * (1 - C.spread[asset]! / 2),
  );
/** Applies an order's market impact (`fill`): the quote moves up for a buy and down for a sale. */
export function applyTrade(
  economy: Economy,
  asset: number,
  qty: number,
  buy: boolean,
): void {
  economy.impact[asset] = fill(economy, asset, qty, buy).impact;
}
/** Savings interest this week on `balance`: (policy rate − 1%) a year. */
export const interest = (economy: Economy, balance: number): number =>
  Math.floor(
    (balance * Math.max(0, economy.policyRate - C.savings.below)) / 100 / 52,
  );

// ---- the weekly step -----------------------------------------------------------------------------------------

const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

function nextCycle(economy: Economy, seeded: Seeded): Cycle {
  const row = C.transitions[economy.cycle]!;
  let roll = random(seeded);
  for (let next = 0; next < row.length; next++) {
    roll -= row[next]!;
    if (roll < 0) return next as Cycle;
  }
  return economy.cycle;
}

/**
 * One week of the economy, from last week's players' spending (`economy.spend`, company `spend`/`output`/`wages`).
 * `players` is how many players live in the city: the baseline their spending is compared with scales by it.
 */
export function stepEconomy(
  economy: Economy,
  seeded: Seeded,
  players: number,
): EconomyNews {
  const news: EconomyNews = {
    crash: false,
    boom: false,
    dividends: COMPANIES.map(() => 0),
    layoffs: [],
    headlines: [],
  };
  economy.weeks++;
  const before = economy.cycle,
    cycle = nextCycle(economy, seeded);
  economy.cycle = cycle;
  if (cycle !== before) {
    if (cycle === RECESSION && before !== 2) news.crash = true;
    if (cycle === BOOM) news.boom = true;
    news.headlines.push(
      news.crash
        ? "MARKETS CRASH: the city tips into recession overnight"
        : cycle === BOOM
          ? "BOOM TIMES: shoppers are back and hiring is hot"
          : cycle === RECESSION
            ? "It's official: the slowdown is now a recession"
            : cycle === 2
              ? "Economists spot a slowdown. Sales are cooling"
              : "Recovery! The economy is growing again",
    );
  }

  // Macro.
  const oldGrowth = economy.growth;
  economy.growth = r4(C.growth.mean[cycle] + normal(seeded) * C.growth.noise);
  economy.demand = r4(
    clamp(
      economy.demand +
        ((economy.growth - C.growth.trend) / 100) * C.demand.gain +
        (1 - economy.demand) * C.demand.revert,
      C.demand.min,
      C.demand.max,
    ),
  );
  const baseline = C.prices.baseline.reduce((sum, value) => sum + value, 0),
    spent = economy.spend.reduce((sum, value) => sum + value, 0),
    over = clamp(
      players > 0 ? (spent - baseline * players) / (baseline * players) : 0,
      -1,
      2,
    );
  const inflation = C.inflation;
  economy.inflation = r4(
    clamp(
      economy.inflation +
        (inflation.target - economy.inflation) * inflation.revert +
        inflation.cycle[cycle] +
        over * inflation.spending +
        normal(seeded) * inflation.noise,
      inflation.min,
      inflation.max,
    ),
  );
  const oldRate = economy.policyRate;
  const p = C.policy;
  const rateTarget = clamp(
    p.neutral +
      p.inflationGain * (economy.inflation - inflation.target) * 52 +
      p.growthGain * (economy.growth - C.growth.trend) * 13,
    p.min,
    p.max,
  );
  economy.policyRate =
    Math.round(
      clamp(
        economy.policyRate +
          clamp(rateTarget - economy.policyRate, -p.step, p.step),
        p.min,
        p.max,
      ) * 20,
    ) / 20;
  const rateMove = economy.policyRate - oldRate;
  if (Math.abs(rateMove) >= 0.25)
    news.headlines.push(
      `Central bank ${rateMove > 0 ? "hikes" : "cuts"} rates to ${economy.policyRate.toFixed(2)}%`,
    );
  economy.unemployment = r4(
    economy.unemployment +
      (C.unemployment.target[cycle] - economy.unemployment) *
        C.unemployment.speed,
  );
  const sentimentBefore = economy.sentiment;
  economy.sentiment = r4(
    clamp(
      economy.sentiment * C.sentiment.keep +
        (1 - C.sentiment.keep) * clamp(economy.growth / 0.4, -1, 1) +
        normal(seeded) * C.sentiment.noise +
        (news.crash ? C.sentiment.crashShock : 0) +
        (news.boom ? C.sentiment.boomShock : 0),
      -1,
      1,
    ),
  );
  economy.wageIndex = r4(
    economy.wageIndex *
      (1 +
        (economy.inflation / 100) * C.wages.inflationPass +
        (5 - economy.unemployment) * C.wages.tightness),
  );

  economy.level = r4(economy.level * (1 + economy.inflation / 100));
  // Category prices: inflation, a shock, and players' demand against the city's baseline; ±8% a week at most.
  const pr = C.prices;
  economy.prices = economy.prices.map((index, category) => {
    const base = pr.baseline[category]! * Math.max(1, players),
      pressure = clamp(
        ((economy.spend[category]! - base) / base) * pr.pressure,
        -pr.pressureMax,
        pr.pressureMax,
      ),
      move = clamp(
        economy.inflation / 100 +
          normal(seeded) * pr.noise +
          pressure -
          (index / economy.level - 1) * pr.revert,
        -pr.cap,
        pr.cap,
      );
    if (Math.abs(move) >= 0.03)
      news.headlines.push(
        `${CATEGORIES[category]![0]!.toUpperCase()}${CATEGORIES[category]!.slice(1)} prices ${move > 0 ? "jump" : "slide"} ${pct(move * 100)}${pressure * move > 0 && Math.abs(pressure) > 0.01 ? ": shoppers did that" : ""}`,
      );
    return r4(clamp(index * (1 + move), pr.min, pr.max));
  });

  // Companies.
  const cc = C.companies,
    gap = economy.demand - 1;
  let bestMover = -1,
    bestShare = 0;
  economy.companies.forEach((company, index) => {
    const data = COMPANIES[index]!,
      categoryIndex =
        data.category >= 0
          ? economy.prices[data.category]!
          : 1 + (economy.wageIndex - 1) * 0.5,
      npc =
        data.baseline *
        (1 + data.beta * gap) *
        categoryIndex *
        (1 + normal(seeded) * cc.revenueNoise),
      revenue = Math.round(npc + company.spend + company.output),
      costs = Math.round(
        data.baseline *
          (1 - data.margin) *
          (cc.wageCost * economy.wageIndex +
            (1 - cc.wageCost) * categoryIndex) +
          company.wages,
      ),
      profit = revenue - costs;
    const share = company.spend / Math.max(1, data.baseline);
    if (share > bestShare) {
      bestShare = share;
      bestMover = index;
    }
    company.revenue = revenue;
    company.profit = profit;
    company.health = r4(
      cc.healthKeep * company.health +
        (1 - cc.healthKeep) * (revenue > 0 ? profit / revenue : -1),
    );
    company.earnings = Math.round(0.7 * company.earnings + 0.3 * profit);
    company.retained += profit;
    company.spend = 0;
    company.output = 0;
    company.wages = 0;
    if (economy.weeks % cc.dividendWeeks === 0) {
      news.dividends[index] = r2(
        Math.max(0, (company.retained * cc.payout) / data.shares),
      );
      company.retained = 0;
    }
    const factor = healthFactor(economy, index);
    if (factor < cc.layoffBelow && chance(seeded, cc.layoffChance))
      news.layoffs.push(index);
  });
  if (bestMover >= 0 && bestShare >= 0.01)
    news.headlines.push(
      `${COMPANIES[bestMover]!.name} sales up thanks to local shoppers`,
    );
  economy.spend = economy.spend.map(() => 0);

  // Asset prices.
  const s = C.stocks;
  COMPANIES.forEach((_, index) => {
    let price = economy.price[index]!;
    price += (targetPrice(economy, index) - price) * s.pull;
    price *= 1 + normal(seeded) * s.noise;
    if (news.crash)
      price *= 1 - (s.crash[0] + random(seeded) * (s.crash[1] - s.crash[0]));
    if (news.boom) price *= 1.05;
    economy.price[index] = r2(Math.max(s.floor, price));
  });
  economy.price[INDEX_FUND] = r2((100 * cap(economy)) / economy.indexBase);
  const yieldNow = economy.policyRate + C.bonds.spread,
    yieldBefore = oldRate + C.bonds.spread;
  economy.price[BONDS] = r2(
    economy.price[BONDS]! *
      (1 +
        yieldNow / 100 / 52 -
        (C.bonds.duration * (yieldNow - yieldBefore)) / 100),
  );
  const g = C.gold;
  economy.price[GOLD] = r2(
    Math.max(
      1,
      economy.price[GOLD]! *
        (1 +
          (economy.inflation * g.inflationGain) / 100 -
          ((economy.sentiment - sentimentBefore) * g.fearGain) / 10 +
          normal(seeded) * g.noise),
    ),
  );
  const k = C.crypto;
  let crypto =
    economy.price[CRYPTO]! *
    (1 + normal(seeded) * k.noise + economy.sentiment * k.hype);
  if (chance(seeded, k.jumpChance))
    crypto *=
      random(seeded) < 0.5 + economy.sentiment * 0.3 ? 1 + k.jump : 1 - k.jump;
  if (news.crash) crypto *= 1 - k.crash;
  economy.price[CRYPTO] = r2(Math.max(k.floor, crypto));
  economy.impact = economy.impact.map((value) => r4(value * C.impactDecay));
  economy.history.push(economy.price[INDEX_FUND]!);
  if (economy.history.length > HISTORY) economy.history.shift();
  if (oldGrowth > 0 && economy.growth < 0 && cycle !== RECESSION)
    news.headlines.push("Growth dips below zero this week");
  if (news.headlines.length === 0)
    news.headlines.push(
      [
        "Quiet week on Lane Street. Suspiciously quiet",
        `City500 ${economy.price[INDEX_FUND]! >= (economy.history.at(-2) ?? 100) ? "edges up" : "drifts down"}; analysts shrug`,
        `Unemployment at ${economy.unemployment.toFixed(1)}%`,
        `Crypto ${economy.price[CRYPTO]! >= k.start ? "moons" : "naps"}, influencers ${randInt(seeded, 0, 1) ? "thrilled" : "silent"}`,
      ][economy.weeks % 4]!,
    );
  news.headlines.length = Math.min(news.headlines.length, 5);
  return news;
}

export const cycleName = (economy: Economy): string => CYCLES[economy.cycle];
