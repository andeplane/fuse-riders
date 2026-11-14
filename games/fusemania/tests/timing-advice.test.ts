import test from "node:test";
import assert from "node:assert/strict";
import { adviseRun } from "../src/app/timing-advice.js";

const BEAT = 400;
/** A run's taps: `lag` ms after every tick, wobbling by `wobble` either way. */
const taps = (lag: number, count = 75, wobble = 6) =>
  Array.from(
    { length: count },
    (_, index) => index * BEAT + lag + ((index % 5) - 2) * (wobble / 2),
  );
const run = (kind: "ear" | "eye", list: readonly number[]) => ({
  kind,
  taps: list,
  beatMs: BEAT,
  ticks: 75,
});
const none = { audioMs: 0, inputMs: 0, visualMs: 0 };

test("by ear, a small lag is the input offset: one line on what was measured, one on what APPLY sets", () => {
  const advice = adviseRun(run("ear", taps(27)), none);
  assert.equal(advice.verdict, "apply");
  assert.match(
    advice.measured,
    /^Your taps land 27 ms late \(±\d+ ms over 75 taps\)\.$/,
  );
  assert.equal(advice.advice, "APPLY sets the input offset to +27 ms.");
  assert.deepEqual(advice.apply, { inputMs: 27, audioMs: 0 });
  assert.equal(Math.round(advice.lagMs), 27);

  const early = adviseRun(run("ear", taps(-12)), none);
  assert.match(early.measured, /land 12 ms early/);
  assert.deepEqual(early.apply, { inputMs: -12, audioMs: 0 });
});

test("the taps are heard without the input offset: what is already set is not counted twice", () => {
  // The same fingers after APPLY: the lag is still 27 ms, and the offset already covers it.
  const settled = adviseRun(run("ear", taps(27)), { ...none, inputMs: 27 });
  assert.equal(settled.verdict, "good");
  assert.equal(settled.apply, undefined);
  assert.match(settled.measured, /^You tap on the tick: 0 ms/);
  assert.match(settled.advice, /Nothing to change/);
  // A little off the offset in use: the new offset is the whole lag, not the remainder.
  const moved = adviseRun(run("ear", taps(35)), { ...none, inputMs: 27 });
  assert.match(moved.measured, /land 8 ms late/);
  assert.deepEqual(moved.apply, { inputMs: 35, audioMs: 0 });
});

test("a lag too large for a keyboard is the sound's: it goes to the audio offset", () => {
  const advice = adviseRun(run("ear", taps(150)), none);
  assert.equal(advice.verdict, "apply");
  assert.deepEqual(advice.apply, { inputMs: 0, audioMs: 150 });
  assert.match(
    advice.advice,
    /the sound arrives late here\. APPLY sets the audio offset to \+150 ms and the input offset to 0 ms\./,
  );
});

test("a lag near half a tick is flagged: it may be the tick before's", () => {
  // 130 ms at 2.5 ticks a second is a third of a beat.
  const advice = adviseRun(run("ear", taps(130)), none);
  assert.equal(advice.verdict, "apply");
  assert.match(
    advice.advice,
    /read the wrong way round: check it at 2 ticks a second\.$/,
  );
  assert.doesNotMatch(
    adviseRun(run("ear", taps(100)), none).advice,
    /wrong way/,
  );
});

test("too few taps or scattered ones are no measurement", () => {
  const few = adviseRun(run("ear", taps(27, 5)), none);
  assert.equal(few.verdict, "few");
  assert.equal(few.apply, undefined);
  assert.equal(few.measured, "Only 5 of 75 ticks were tapped.");
  assert.match(few.advice, /tap on every tick/);
  assert.equal(adviseRun(run("ear", []), none).verdict, "few");

  const wild = adviseRun(run("ear", taps(0, 75, 150)), none);
  assert.equal(wild.verdict, "scattered");
  assert.equal(wild.apply, undefined);
  assert.match(wild.advice, /go by the sound/);
  assert.match(adviseRun(run("eye", taps(0, 75, 150)), none).advice, /arrow/);
});

test("by eye, what is left against the lag by ear is the picture's", () => {
  // By ear 27 ms was found and applied; by eye the same fingers are 48 ms behind the tick.
  const offsets = { audioMs: 0, inputMs: 27, visualMs: 5 };
  const advice = adviseRun(run("eye", taps(48)), offsets);
  assert.equal(advice.verdict, "apply");
  assert.match(
    advice.measured,
    /^By eye you tap 21 ms later than by ear \(.*\): the arrows are late\.$/,
  );
  assert.equal(advice.advice, "APPLY sets the visual offset to +26 ms.");
  assert.deepEqual(advice.apply, { visualMs: 26 });
  // A by-ear run that was not applied is what by eye is compared with.
  assert.deepEqual(adviseRun(run("eye", taps(48)), none, 40).apply, {
    visualMs: 8,
  });
  const early = adviseRun(run("eye", taps(10)), offsets);
  assert.match(early.measured, /17 ms earlier than by ear.*arrows are early/);
  assert.deepEqual(early.apply, { visualMs: -12 });

  const same = adviseRun(run("eye", taps(28)), offsets);
  assert.equal(same.verdict, "good");
  assert.match(same.advice, /the arrows are on the sound/);
  // The visual offset stops at its limit, and says so instead of offering nothing.
  const far = adviseRun(run("eye", taps(140)), { ...offsets, visualMs: 200 });
  assert.equal(far.verdict, "good");
  assert.match(far.advice, /as far as it goes \(\+200 ms\)/);
});
