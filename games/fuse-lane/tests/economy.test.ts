import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSET_COUNT,
  CATEGORIES,
  COMPANIES,
  ECONOMY,
  GADGETS,
  HOURS,
  INDEX_FUND,
  NEOBANK,
  TRADE_BUY,
  TRADE_SELL,
  UNITS_PER_HOUR,
  WEEK_UNITS,
  act,
  IMPACT_MAX,
  IMPACT_MIN,
  applyTrade,
  buyCost,
  createEconomy,
  createPlayer,
  createRoom,
  defaultGoals,
  fill,
  investments,
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

test("trades pay the spread and fill along their own impact, which decays weekly", () => {
  const economy = createEconomy();
  const fund = quote(economy, INDEX_FUND);
  const price = economy.price[INDEX_FUND]!;
  assert.equal(fund, price, "no impact yet");
  const half = ECONOMY.spread[INDEX_FUND] / 2;
  // One unit barely moves the quote: it costs the quote plus half the spread, rounded up.
  assert.equal(buyCost(economy, INDEX_FUND, 1), Math.ceil(fund * (1 + half)));
  assert.ok(
    sellValue(economy, INDEX_FUND, 10) < buyCost(economy, INDEX_FUND, 10),
  );
  // A big order moves the quote by impact × value / liquidity, and pays the average of before and after.
  const units = 500,
    move = (ECONOMY.impact * price * units) / ECONOMY.liquidity[INDEX_FUND]!;
  const order = fill(economy, INDEX_FUND, units, true);
  assert.ok(Math.abs(order.impact - move) < 1e-12);
  assert.ok(Math.abs(order.value - price * units * (1 + move / 2)) < 1e-6);
  assert.equal(
    buyCost(economy, INDEX_FUND, units),
    Math.ceil(order.value * (1 + half)),
  );
  applyTrade(economy, INDEX_FUND, units, true);
  assert.ok(quote(economy, INDEX_FUND) > fund);
  // The quote stops at the impact bound, and the units past it fill there.
  const huge = fill(economy, INDEX_FUND, 10_000_000, true);
  assert.equal(huge.impact, IMPACT_MAX);
  assert.ok(huge.value > price * 10_000_000 * 1.99);
  assert.equal(fill(economy, INDEX_FUND, 10_000_000, false).impact, IMPACT_MIN);
  const impact = economy.impact[INDEX_FUND]!;
  stepEconomy(economy, { rng: 1 }, 4);
  assert.ok(
    Math.abs(economy.impact[INDEX_FUND]! - impact * ECONOMY.impactDecay) < 1e-4,
  );
});

/** A seeded order book for the money-pump property: sizes from one unit to far past the impact bound. */
function orders(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 2 ** 32;
  };
}

test("no sequence of trades in one week makes money against its own impact", () => {
  for (let trial = 0; trial < 3000; trial++) {
    const roll = orders(trial + 1),
      economy = createEconomy(),
      asset = Math.floor(roll() * ASSET_COUNT);
    // Any impact left from last week, from the floor to the cap.
    economy.impact[asset] =
      IMPACT_MIN + (IMPACT_MAX - IMPACT_MIN) * roll() ** 2;
    let cash = 0,
      held = 0;
    const steps = 1 + Math.floor(roll() * 40);
    for (let step = 0; step < steps; step++) {
      const big = roll() < 0.2;
      if (held === 0 || roll() < 0.5) {
        const qty = 1 + Math.floor(roll() ** 3 * (big ? 200_000 : 2_000));
        cash -= buyCost(economy, asset, qty);
        applyTrade(economy, asset, qty, true);
        held += qty;
      } else {
        const qty = big ? held : 1 + Math.floor(roll() * held);
        cash += sellValue(economy, asset, qty);
        applyTrade(economy, asset, qty, false);
        held -= qty;
      }
    }
    if (held > 0) cash += sellValue(economy, asset, held);
    assert.ok(cash <= 0, `trial ${trial}: a round trip made $${cash}`);
    assert.ok(Number.isFinite(cash));
  }
  // The pump the old pricing allowed: many small buys walk the quote up, then one big sale at the top.
  const economy = createEconomy();
  let cash = 0;
  for (let step = 0; step < 50; step++) {
    cash -= buyCost(economy, 0, 20);
    applyTrade(economy, 0, 20, true);
  }
  cash += sellValue(economy, 0, 1000);
  assert.ok(cash < 0, `small buys then one sale made $${cash}`);
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

test("at Neobank each order costs an hour, and buying then selling never adds to cash and holdings", () => {
  const room = createRoom("pump", {
      weekSeconds: 60,
      display: false,
      turns: false,
      level: 1,
    }),
    player = createPlayer(defaultGoals());
  player.cash = 20_000;
  player.inside = NEOBANK;
  room.players.a = player;
  const wealth = () => player.cash + investments(player, room.economy);
  let trades = 0;
  // The old pump: buy all you can, sell it back at the quote your buy pushed up, again and again.
  while (player.time < WEEK_UNITS) {
    const before = player.time,
      start = wealth();
    const units = Math.floor(player.cash / buyCost(room.economy, 0, 1)) - 5;
    act(room, player, NEOBANK, TRADE_BUY, 0, units);
    assert.ok(wealth() < start, "the buy paid more than its units are worth");
    act(room, player, NEOBANK, TRADE_SELL, 0, player.holdings[0]!);
    assert.ok(wealth() < start, "and the round trip lost money");
    assert.equal(player.time - before, 2 * HOURS.trade * UNITS_PER_HOUR);
    trades += 2;
  }
  assert.equal(trades, WEEK_UNITS / UNITS_PER_HOUR / HOURS.trade);
  assert.ok(player.cash < 20_000);
  // Out of hours, the desk is closed.
  act(room, player, NEOBANK, TRADE_BUY, 0, 1);
  assert.equal(player.holdings[0], 0);
});
