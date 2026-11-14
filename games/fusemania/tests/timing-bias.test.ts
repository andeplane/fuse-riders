import test from "node:test";
import assert from "node:assert/strict";
import {
  BOO,
  DRUNK,
  GREAT,
  HELD,
  MISS,
  PERFECT,
  STAR,
  type Effect,
  type PlayerView,
} from "../src/engine/index.js";
import {
  BIAS_MIN_HITS,
  HISTORY_MS,
  HISTORY_SONGS,
  TIMING_KEY,
  createHitCollector,
  loadHistory,
  measureBias,
  parseHistory,
  proposalText,
  propose,
  remember,
  saveHistory,
  type Hit,
  type RunEstimate,
} from "../src/app/timing-bias.js";

/** A seeded generator, so every run of the tests sees the same hits. */
function seeded(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  /** Roughly normal, mean 0 and standard deviation 1. */
  return () => next() + next() + next() + next() + next() + next() - 3;
}
/** `count` hits a quarter second apart, off by `bias(at)` and a scatter of `sigma` ms. */
function run(
  count: number,
  bias: number | ((at: number) => number),
  sigma: number,
  seed = 7,
): Hit[] {
  const noise = seeded(seed);
  return Array.from({ length: count }, (_, i) => {
    const at = i * 250;
    return {
      at,
      off: Math.round(
        (typeof bias === "number" ? bias : bias(at)) +
          noise() * sigma * Math.SQRT2,
      ),
    };
  });
}
const NOW = 1_800_000_000_000;
const estimate = (
  song: string,
  estimateMs: number,
  more: Partial<RunEstimate> = {},
): RunEstimate => ({
  song,
  estimateMs,
  used: 120,
  at: NOW,
  deviceMs: 10,
  ...more,
});

test("a player who is steadily early gets a clear bias near their offset", () => {
  const bias = measureBias(run(150, -18, 14));
  assert.equal(bias.verdict, "clear");
  assert.ok(Math.abs(bias.biasMs + 18) < 3, `bias ${bias.biasMs}`);
  assert.ok(bias.spreadMs > 8 && bias.spreadMs < 22, `spread ${bias.spreadMs}`);
  assert.ok(bias.halves.every((half) => half < -10));
});

test("a centred player, and a bias too small to matter, propose nothing", () => {
  assert.equal(measureBias(run(200, 0, 15)).verdict, "centred");
  assert.equal(measureBias(run(400, 4, 10)).verdict, "centred");
});

test("too few hits say nothing, however one-sided", () => {
  const bias = measureBias(run(BIAS_MIN_HITS - 1, 30, 5));
  assert.equal(bias.verdict, "few");
});

test("a bias that chance could give that few scattered hits is not clear", () => {
  // 45 hits scattered 45 ms: the standard error is about 7 ms, so 12 ms is under three of them.
  assert.equal(measureBias(run(45, 12, 45)).verdict, "centred");
});

test("wildly scattered hits are not read", () => {
  assert.equal(measureBias(run(200, 25, 80)).verdict, "scattered");
});

test("stray presses far from the rest are cut and do not move the bias", () => {
  const hits = run(120, 20, 8);
  for (let i = 0; i < 12; i++) hits.push({ at: i * 2000 + 100, off: -170 });
  const bias = measureBias(hits);
  assert.equal(bias.verdict, "clear");
  assert.equal(bias.total, 132);
  assert.equal(bias.used, 120);
  assert.ok(Math.abs(bias.biasMs - 20) < 2, `bias ${bias.biasMs}`);
});

test("a chart with one half out of sync is unsteady, not a player's offset", () => {
  // The first half is on the beat, the second is 40 ms late: 20 ms on average, but not the player's.
  const bias = measureBias(run(160, (at) => (at < 20_000 ? 0 : 40), 8));
  assert.equal(bias.verdict, "unsteady");
  // And a chart that drifts from early to late averages out or is unsteady, never clear.
  const drift = measureBias(run(160, (at) => -10 + at / 1000, 8));
  assert.notEqual(drift.verdict, "clear");
});

test("values that are not numbers are ignored", () => {
  const bias = measureBias([
    ...run(60, 15, 5),
    { at: Number.NaN, off: 3 },
    { at: 5, off: Number.POSITIVE_INFINITY },
  ]);
  assert.equal(bias.total, 60);
  assert.equal(bias.verdict, "clear");
});

test("the first song offers its own bias, on top of the offset in use", () => {
  const proposal = propose(estimate("a", 12 - 18), [], 12, 400);
  assert.deepEqual(proposal, {
    kind: "apply",
    offsetMs: -6,
    biasMs: -18,
    songs: 1,
  });
  assert.equal(
    proposalText(proposal, 142),
    "You hit about 18 ms early on average (142 steps). Set the input offset to −6 ms?",
  );
});

test("songs that agree offer their median", () => {
  const proposal = propose(
    estimate("c", 24),
    [estimate("a", 18), estimate("b", 20), estimate("d", 90)],
    0,
    400,
  );
  assert.deepEqual(proposal, {
    kind: "apply",
    offsetMs: 20,
    biasMs: 20,
    songs: 3,
  });
  assert.equal(
    proposalText(proposal, 99),
    "You hit about 20 ms late across your last 3 songs. Set the input offset to +20 ms?",
  );
});

test("one song off while the others agree with each other is the chart: nothing is offered", () => {
  const proposal = propose(
    estimate("odd", 30),
    [estimate("a", 2), estimate("b", -3)],
    0,
    400,
  );
  assert.deepEqual(proposal, { kind: "chart", biasMs: 30, songs: 2 });
  assert.match(proposalText(proposal, 80), /30 ms late on this song only/);
  assert.match(proposalText(proposal, 80), /left alone/);
});

test("a second song that agrees after a change of headphones is the device", () => {
  // Two old songs at 0, then two songs at +150 on the same reported latency.
  const old = [estimate("a", 0), estimate("b", 1)];
  const first = estimate("c", 150);
  assert.equal(propose(first, old, 0, 400).kind, "chart");
  const second = propose(estimate("d", 146), remember(old, first), 0, 400);
  assert.deepEqual(second, {
    kind: "apply",
    offsetMs: 148,
    biasMs: 148,
    songs: 2,
  });
});

test("runs on another audio device, old runs and the same song are not compared with", () => {
  const others = [
    estimate("a", 0, { deviceMs: 180 }),
    estimate("b", 1, { deviceMs: 180 }),
    estimate("c", 0, { at: NOW - HISTORY_MS - 1 }),
    estimate("d", 2, { at: NOW - HISTORY_MS - 1 }),
    estimate("now", 0),
  ];
  assert.deepEqual(propose(estimate("now", 25), others, 0, 400), {
    kind: "apply",
    offsetMs: 25,
    biasMs: 25,
    songs: 1,
  });
});

test("an agreed offset close to the one in use offers nothing", () => {
  // This run says +9, the others +2 and +3: the median is 3, under the least change worth making.
  // (9 and 2 are within the agreeing distance.)
  assert.deepEqual(
    propose(estimate("c", 9), [estimate("a", 2), estimate("b", 3)], 0, 400),
    { kind: "none" },
  );
  assert.equal(proposalText({ kind: "none" }, 50), "");
});

test("an offer never leaves the range the setting allows", () => {
  const proposal = propose(estimate("a", 520), [], 380, 400);
  assert.deepEqual(proposal, {
    kind: "apply",
    offsetMs: 400,
    biasMs: 20,
    songs: 1,
  });
});

test("history keeps the newest run of each song, the newest songs only", () => {
  let history: RunEstimate[] = [];
  for (let i = 0; i < HISTORY_SONGS + 3; i++)
    history = remember(history, estimate(`song-${i}`, i));
  assert.equal(history.length, HISTORY_SONGS);
  assert.equal(history[0]!.song, `song-${HISTORY_SONGS + 2}`);
  history = remember(history, estimate(history[3]!.song, 99));
  assert.equal(history.length, HISTORY_SONGS);
  assert.equal(history[0]!.estimateMs, 99);
});

test("history survives a round trip and refuses what is not history", () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  assert.deepEqual(loadHistory(store), []);
  const history = [estimate("a", 12.5), estimate("b", -4)];
  saveHistory(store, history);
  assert.deepEqual(loadHistory(store), history);
  data.set(TIMING_KEY, "{not json");
  assert.deepEqual(loadHistory(store), []);
  assert.deepEqual(
    parseHistory([
      null,
      7,
      { song: "", estimateMs: 1, used: 1, at: 1, deviceMs: 1 },
      { song: "x", estimateMs: "1", used: 1, at: 1, deviceMs: 1 },
      { song: "x", estimateMs: 5000, used: 1, at: 1, deviceMs: 1 },
      { song: "x", estimateMs: Number.NaN, used: 1, at: 1, deviceMs: 1 },
      estimate("ok", 3),
      estimate("ok", 4),
    ]),
    [estimate("ok", 3)],
  );
  assert.deepEqual(parseHistory({ song: "a" }), []);
  const refusing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadHistory(refusing), []);
  saveHistory(refusing, history);
});

/** A rider's view with `counts` judgments and the newest one as given. */
function player(
  hits: number,
  judged: number,
  judgedAt: number,
  judgedOff: number,
  effects: Effect[] = [],
): PlayerView {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  counts[PERFECT] = hits;
  return {
    id: "me",
    slot: 0,
    bot: false,
    chart: 0,
    score: 0,
    rating: 0,
    place: 1,
    combo: 0,
    worst: -1,
    best: 0,
    counts,
    next: [0, 0, 0, 0],
    hold: [-1, -1, -1, -1],
    let: [0, 0, 0, 0],
    down: [false, false, false, false],
    hits: [],
    judged,
    judgedAt,
    judgedOff,
    item: 0,
    itemAt: 0,
    effects,
    shield: 0,
    blocked: 0,
  };
}

test("the collector takes each new hit once, with its error", () => {
  const collector = createHitCollector();
  collector.observe(player(0, -1, 0, 0), "1:0");
  collector.observe(player(1, PERFECT, 1000, -30), "1:0");
  collector.observe(player(1, PERFECT, 1000, -30), "1:0");
  collector.observe(player(2, GREAT, 1500, 60), "1:0");
  collector.observe(player(3, BOO, 2000, 170), "1:0");
  assert.deepEqual(collector.hits(), [
    { at: 1000, off: -30 },
    { at: 1500, off: 60 },
    { at: 2000, off: 170 },
  ]);
});

test("misses, hold ends, a Star's steps and steps under an attack are not hits", () => {
  const collector = createHitCollector();
  collector.observe(player(0, -1, 0, 0), "1:0");
  // A miss and a kept hold change the newest judgment without a new hit.
  collector.observe(player(0, MISS, 900, 0), "1:0");
  collector.observe(player(0, HELD, 950, 0), "1:0");
  // A hit and a hold end in the same frame: the newest judgment is not the hit's.
  collector.observe(player(1, HELD, 1000, 0), "1:0");
  collector.observe(
    player(2, PERFECT, 5000, 0, [[STAR, 4000, 9000, 0]]),
    "1:0",
  );
  collector.observe(
    player(3, PERFECT, 12_000, 44, [[DRUNK, 11_000, 20_000, 1]]),
    "1:0",
  );
  collector.observe(
    player(4, PERFECT, 21_000, 9, [[DRUNK, 11_000, 20_000, 1]]),
    "1:0",
  );
  assert.deepEqual(collector.hits(), [{ at: 21_000, off: 9 }]);
});

test("a new match, a new offset and a rollback of the count start clean", () => {
  const collector = createHitCollector();
  collector.observe(player(0, -1, 0, 0), "1:0");
  collector.observe(player(1, PERFECT, 1000, 5), "1:0");
  // The offset changed mid-song: what was measured belongs to the old one.
  collector.observe(player(2, PERFECT, 1500, 6), "1:10");
  assert.deepEqual(collector.hits(), []);
  collector.observe(player(3, PERFECT, 2000, 7), "1:10");
  assert.deepEqual(collector.hits(), [{ at: 2000, off: 7 }]);
  // The count going back (the match restarted under the same name) drops what was collected.
  collector.observe(player(0, -1, 0, 0), "1:10");
  assert.deepEqual(collector.hits(), []);
  collector.observe(player(1, PERFECT, 500, 1), "1:10");
  collector.reset();
  assert.deepEqual(collector.hits(), []);
});

test("the collector is bounded", () => {
  const collector = createHitCollector(3);
  collector.observe(player(0, -1, 0, 0), "1:0");
  for (let i = 1; i <= 10; i++)
    collector.observe(player(i, PERFECT, i * 100, i), "1:0");
  assert.equal(collector.hits().length, 3);
});
