/**
 * Every coefficient of the Fuse Lane economy (docs: modern-jones `docs/design/economy-sim.md`), in one typed table so a
 * balance pass edits numbers here and nowhere else. Rates are percent: `growth` and `inflation` per week,
 * `policyRate` per year. Money is dollars.
 */

export const CYCLES = ["expansion", "boom", "slowdown", "recession"] as const;
export type Cycle = 0 | 1 | 2 | 3;
export const EXPANSION = 0,
  BOOM = 1,
  SLOWDOWN = 2,
  RECESSION = 3;

export const CATEGORIES = [
  "food",
  "housing",
  "gadgets",
  "clothing",
  "services",
  "education",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const FOOD = 0,
  HOUSING = 1,
  GADGETS = 2,
  CLOTHING = 3,
  SERVICES = 4,
  EDUCATION = 5;

export interface CompanyData {
  id: string;
  name: string;
  ticker: string;
  /** The price category its sales are in, or -1 for a company that sells to other companies. */
  category: number;
  /** Weekly revenue from the non-player city at demand 1 and price index 1. */
  baseline: number;
  /** Its normal profit margin; health is measured against it. */
  margin: number;
  /** How hard the business cycle moves its sales: revenue × (1 + beta × output gap). */
  beta: number;
  /** Shares outstanding: earnings per share = yearly profit / shares. */
  shares: number;
}

/** The nine listed employers, in the order assets and companies are indexed. City College is public and not listed. */
export const COMPANIES: readonly CompanyData[] = [
  {
    id: "gigafactory",
    name: "Gigafactory",
    ticker: "GIGA",
    category: -1,
    baseline: 90_000,
    margin: 0.09,
    beta: 1.5,
    shares: 60_000,
  },
  {
    id: "neobank",
    name: "Neobank",
    ticker: "NEO",
    category: -1,
    baseline: 60_000,
    margin: 0.14,
    beta: 1.1,
    shares: 90_000,
  },
  {
    id: "freshco",
    name: "FreshCo",
    ticker: "FRSH",
    category: FOOD,
    baseline: 50_000,
    margin: 0.06,
    beta: 0.4,
    shares: 50_000,
  },
  {
    id: "mono",
    name: "Mono Burger",
    ticker: "MONO",
    category: SERVICES,
    baseline: 30_000,
    margin: 0.08,
    beta: 0.7,
    shares: 40_000,
  },
  {
    id: "gadget",
    name: "Gadget Garage",
    ticker: "GADG",
    category: GADGETS,
    baseline: 40_000,
    margin: 0.1,
    beta: 1.3,
    shares: 50_000,
  },
  {
    id: "threads",
    name: "Threads",
    ticker: "THRD",
    category: CLOTHING,
    baseline: 25_000,
    margin: 0.11,
    beta: 1.2,
    shares: 30_000,
  },
  {
    id: "megamart",
    name: "MegaMart",
    ticker: "MEGA",
    category: GADGETS,
    baseline: 45_000,
    margin: 0.05,
    beta: 0.6,
    shares: 60_000,
  },
  {
    id: "keynest",
    name: "KeyNest",
    ticker: "KEYN",
    category: HOUSING,
    baseline: 35_000,
    margin: 0.16,
    beta: 0.5,
    shares: 45_000,
  },
  {
    // The harbour moves other companies' goods: trade swings with the cycle harder than almost anything in town.
    id: "port",
    name: "Fusetown Port",
    ticker: "PORT",
    category: -1,
    baseline: 55_000,
    margin: 0.12,
    beta: 1.4,
    shares: 55_000,
  },
];

/** Tradable assets: the nine shares, then these, in this order. */
export const INDEX_FUND = 9,
  BONDS = 10,
  GOLD = 11,
  CRYPTO = 12,
  ASSET_COUNT = 13;
export const ASSET_NAMES = [
  ...COMPANIES.map((company) => company.ticker),
  "CITY500",
  "BONDS",
  "GOLD",
  "CRYPTO",
] as const;

export const ECONOMY = {
  /** Weekly Markov odds from each cycle (rows) to each cycle (columns); rows sum to 1. */
  transitions: [
    [0.925, 0.035, 0.032, 0.008],
    [0.06, 0.88, 0.045, 0.015],
    [0.08, 0, 0.855, 0.065],
    [0.11, 0, 0.02, 0.87],
  ] as const satisfies readonly (readonly number[])[],
  growth: {
    /** Mean weekly growth per cycle, %. */
    mean: [0.2, 0.4, 0, -0.4] as const,
    noise: 0.12,
    /** The growth rate demand returns to. */
    trend: 0.15,
  },
  /** Output: demand moves by (growth − trend) × gain each week and drifts back to 1. */
  demand: { gain: 2.5, revert: 0.06, min: 0.8, max: 1.2 },
  inflation: {
    start: 0.05,
    target: 0.05,
    revert: 0.25,
    /** Push per cycle, % per week. */
    cycle: [0, 0.03, 0, -0.04] as const,
    /** Push per unit of players' spending over the baseline (−1..2). */
    spending: 0.01,
    noise: 0.01,
    min: -0.3,
    max: 0.6,
  },
  policy: {
    start: 3,
    /**
     * Taylor-style: target = neutral + inflationGain × (inflation − target) × 52 + growthGain × (growth − trend) × 13,
     * and the rate moves toward it by at most `step` a week (the lag).
     */
    neutral: 3,
    inflationGain: 1.5,
    growthGain: 0.5,
    step: 0.25,
    min: 0,
    max: 12,
  },
  unemployment: {
    start: 5,
    target: [5, 3.5, 6.5, 9] as const,
    speed: 0.15,
  },
  sentiment: {
    keep: 0.75,
    noise: 0.05,
    crashShock: -0.6,
    boomShock: 0.2,
  },
  prices: {
    /** What one player spends in a category in a normal week: the NPC baseline demand pressure is measured from. */
    baseline: [24, 85, 35, 15, 22, 10] as const,
    /** Demand pressure per unit of relative overspend, clamped. */
    pressure: 0.006,
    pressureMax: 0.012,
    noise: 0.004,
    /** How fast a category's price returns to the general price level, per week. */
    revert: 0.12,
    /** No category price moves more than this in one week. */
    cap: 0.08,
    min: 0.5,
    max: 3,
  },
  companies: {
    /** Share of a company's costs that follows the wage index; the rest follows its category's prices. */
    wageCost: 0.55,
    /** A player's shift brings in its pay × this, so staff are worth hiring. */
    productivity: 1.25,
    revenueNoise: 0.03,
    /** health ← keep × health + (1 − keep) × margin. */
    healthKeep: 0.75,
    /** Health factor = 1 + (health − normal margin) × gain, clamped. */
    healthGain: 2.5,
    healthMin: 0.8,
    healthMax: 1.25,
    /** Below these health factors a company stops hiring, and may lay off its least dependable player. */
    freezeBelow: 0.88,
    layoffBelow: 0.84,
    layoffChance: 0.15,
    /** Every this many weeks, a company pays this share of the period's profit as dividends. */
    dividendWeeks: 12,
    payout: 0.4,
  },
  stocks: {
    /** price-earnings multiple = base × (1 + sentiment × sentimentGain) × (1 − (rate − neutralRate) × rateGain). */
    multiple: 14,
    sentimentGain: 0.35,
    rateGain: 0.04,
    neutralRate: 3,
    /** The price moves this share of the way to its target each week. */
    pull: 0.4,
    /** Shares are priced from at least this share of normal earnings: a bad quarter is not a bankruptcy. */
    earningsFloor: 0.25,
    noise: 0.03,
    /** A crash knocks shares down by a share between these. */
    crash: [0.15, 0.35] as const,
    floor: 1,
  },
  bonds: { start: 100, spread: 0.5, duration: 5 },
  gold: { start: 400, inflationGain: 1.5, fearGain: 0.6, noise: 0.012 },
  crypto: {
    start: 50,
    noise: 0.09,
    hype: 0.03,
    jumpChance: 0.05,
    jump: 0.3,
    floor: 1,
    crash: 0.4,
  },
  savings: { below: 1 },
  /** Bid/ask spread per asset, as a fraction (half each side). */
  spread: [
    0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0.005, 0,
    0.01, 0.03,
  ] as const,
  /**
   * Market impact: a trade of value v (at the impact-free price) moves the quote by impact × v / liquidity and fills
   * at the average of the quote before and after (`fill` in `../economy.ts`), decaying by `impactDecay` a week.
   */
  impact: 0.04,
  liquidity: [
    20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
    100_000, 200_000, 50_000, 12_000,
  ] as const,
  impactDecay: 0.5,
  wages: {
    /** The wage index follows inflation with this weight a week, and gains this much per point of unemployment under 5. */
    inflationPass: 0.8,
    tightness: 0.0005,
    /** Gig work pays this per hour (× wage index), builds nothing. */
    gig: 5,
  },
  /** Hiring luck gets this much harder per point of unemployment over 5. */
  hiringSlack: 2,
  /** Crash: the share of player employees laid off. */
  crashLayoff: 1 / 3,
} as const;

/** How many weeks of price history the briefing sparkline keeps. */
export const HISTORY = 16;
