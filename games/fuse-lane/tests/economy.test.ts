import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_COUNT,
  CATEGORIES,
  COMPANIES,
  ECONOMY,
  GADGETS,
  INDEX_FUND,
  applyImpact,
  buyCost,
  createEconomy,
  ln,
  quote,
  sellValue,
  stepEconomy,
  type Economy,
} from "../src/game/index.js";

function run(
  seed: number,
  weeks: number,
  spend?: (economy: Economy) => void,
): Economy[] {
  const economy = createEconomy(),
    seeded = { rng: seed },
    trail: Economy[] = [];
  for (let week = 0; week < weeks; week++) {
    spend?.(economy);
    stepEconomy(economy, seeded, 4);
    trail.push(structuredClone(economy));
  }
  return trail;
}

test("the deterministic log matches Math.log closely without calling it", () => {
  for (const x of [1e-6, 0.01, 0.5, 1, 1.5, 2, 3, 10, 1234.5, 1e9])
    assert.ok(Math.abs(ln(x) - Math.log(x)) < 1e-12, `ln(${x})`);
  assert.equal(ln(0), 0);
});

test("the same seed steps the same economy; another seed another one", () => {
  const one = run(42, 60),
    two = run(42, 60),
    other = run(43, 60);
  assert.deepEqual(one, two);
  assert.notDeepEqual(one.at(-1), other.at(-1));
});

test("over many seeds the economy stays in its ranges: rates, prices, cycles and a weekly cap of 8%", () => {
  const cycles = new Set<number>();
  for (let seed = 1; seed <= 40; seed++) {
    let previous = createEconomy();
    for (const economy of run(seed, 120)) {
      cycles.add(economy.cycle);
      assert.ok(economy.policyRate >= 0 && economy.policyRate <= 12);
      assert.ok(economy.unemployment > 2 && economy.unemployment < 10);
      assert.ok(economy.sentiment >= -1 && economy.sentiment <= 1);
      economy.prices.forEach((index, category) => {
        assert.ok(
          index >= 0.5 && index <= 3,
          `${CATEGORIES[category]} index ${index}`,
        );
        const move = index / previous.prices[category]! - 1;
        assert.ok(
          Math.abs(move) <= 0.0801,
          `${CATEGORIES[category]} moved ${move}`,
        );
      });
      for (let asset = 0; asset < ASSET_COUNT; asset++)
        assert.ok(economy.price[asset]! >= 1);
      previous = economy;
    }
  }
  assert.equal(cycles.size, 4, "every phase of the cycle shows up");
});

test("players' spending is company revenue and pushes that category's prices up", () => {
  const quiet = run(7, 10).at(-1)!,
    busy = run(7, 10, (economy) => {
      economy.spend[GADGETS] = 5000;
      economy.companies[4]!.spend += 5000;
    }).at(-1)!;
  assert.ok(busy.prices[GADGETS]! > quiet.prices[GADGETS]!);
  assert.ok(
    busy.companies[4]!.health > quiet.companies[4]!.health,
    "Gadget Garage is healthier",
  );
  assert.ok(busy.price[4]! > quiet.price[4]!, "and its shares are worth more");
});

test("trades pay the spread and move the quote by the log of their size, decaying weekly", () => {
  const economy = createEconomy();
  const fund = quote(economy, INDEX_FUND);
  assert.equal(
    buyCost(economy, INDEX_FUND, 10),
    Math.ceil(fund * (1 + ECONOMY.spread[INDEX_FUND] / 2) * 10),
  );
  assert.ok(
    sellValue(economy, INDEX_FUND, 10) < buyCost(economy, INDEX_FUND, 10),
  );
  applyImpact(economy, INDEX_FUND, 50_000, true);
  const small = quote(economy, INDEX_FUND);
  applyImpact(economy, INDEX_FUND, 500_000, true);
  const big = quote(economy, INDEX_FUND);
  assert.ok(small > fund && big > small);
  // A tenfold bigger trade moves the price far less than tenfold more: the log.
  assert.ok((big - small) / (small - fund) < 5);
  const impact = economy.impact[INDEX_FUND]!;
  stepEconomy(economy, { rng: 1 }, 4);
  assert.ok(
    Math.abs(economy.impact[INDEX_FUND]! - impact * ECONOMY.impactDecay) < 1e-4,
  );
});

test("dividends are paid every 12 weeks from retained profit", () => {
  const economy = createEconomy(),
    seeded = { rng: 5 };
  let paid: number[] = [];
  for (let week = 1; week <= 12; week++) {
    const news = stepEconomy(economy, seeded, 4);
    if (week < 12) assert.ok(news.dividends.every((value) => value === 0));
    else paid = news.dividends;
  }
  assert.equal(paid.length, COMPANIES.length);
  assert.ok(paid.some((value) => value > 0));
  assert.ok(economy.companies.every((company) => company.retained === 0));
});
