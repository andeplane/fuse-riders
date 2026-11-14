import test from "node:test";
import assert from "node:assert/strict";
import {
  EYE_MIN_HITS,
  KEEP_PRESSES,
  createErrorBucket,
  createLogWriter,
  createPressLog,
  createTimingLog,
  histogram,
  isLocalHost,
  meanOf,
  visualFromEye,
} from "../src/app/timing-session.js";
import { createFrameLead } from "../src/app/frame-lead.js";

const press = (stamp: number, songMs: number, slackMs?: number) => ({
  source: "key" as const,
  column: 1,
  stamp,
  handled: stamp + 0.5,
  used: true,
  songMs,
  ...(slackMs === undefined ? {} : { slackMs }),
});

test("a press is followed from its stamp to the frame that shows it and the judgment it earned", () => {
  const log = createPressLog();
  const first = log.add(press(1000, 5000.4, 120));
  log.add(press(1004, 5004.2, 118));
  log.frame(1010, 1013);
  const third = log.add(press(1012, 5012.3, -4));
  assert.deepEqual([first.frameMs, first.drawnMs], [10, 13]);
  assert.equal(third.frameMs, undefined, "not shown before its frame");
  log.frame(1018, 1020);
  assert.deepEqual([third.frameMs, third.drawnMs], [6, 8]);
  assert.equal(
    first.frameMs,
    10,
    "a later frame does not move an earlier press",
  );

  // The fold names the press's song time to the millisecond.
  assert.equal(log.judged(5000, 1, -12), first);
  assert.deepEqual([first.judgment, first.offMs], [1, -12]);
  assert.equal(log.judged(5000, 0, 3), undefined, "one judgment a press");
  assert.equal(log.judged(7000, 0, 0), undefined, "no press was made then");
  assert.equal(log.total, 3);
  assert.equal(log.bent, 1, "one press had no room inside its tick");
  assert.equal(log.leastSlackMs, -4);
  log.reset();
  assert.deepEqual([log.total, log.bent, log.leastSlackMs], [0, 0, undefined]);
});

test("a press without a usable stamp has no delays, and the log keeps only the newest presses", () => {
  const log = createPressLog();
  const blind = log.add({ ...press(0, 100), used: false });
  log.frame(50, 52);
  assert.equal(blind.frameMs, undefined);
  for (let index = 0; index < KEEP_PRESSES + 10; index++)
    log.add(press(100 + index, 200 + index));
  log.frame(5000, 5001);
  assert.equal(log.recent(KEEP_PRESSES * 2).length, KEEP_PRESSES);
  assert.equal(log.total, KEEP_PRESSES + 11);
  assert.ok(log.recent(3).every((each) => each.frameMs !== undefined));
});

test("a histogram counts into equal bins and keeps what falls outside at the ends", () => {
  assert.deepEqual(
    histogram([-5, 0, 0.9, 1, 2.5, 3.99, 9], 0, 4, 4),
    [3, 1, 1, 2],
  );
  assert.deepEqual(histogram([Number.NaN, Infinity], 0, 4, 2), [0, 0]);
  assert.deepEqual(histogram([1], 4, 0, 3), [0, 0, 0]);
  assert.deepEqual(meanOf([]), { mean: 0, sd: 0, n: 0 });
  assert.deepEqual(meanOf([2, 4, 4, 4, 5, 5, 7, 9]), { mean: 5, sd: 2, n: 8 });
});

test("what is hit later by eye than by ear is the picture arriving late", () => {
  const ear = Array.from(
      { length: EYE_MIN_HITS },
      (_, index) => -12 + (index % 3),
    ),
    eye = Array.from({ length: EYE_MIN_HITS }, (_, index) => 9 + (index % 3));
  assert.equal(visualFromEye(ear, eye), 21);
  assert.equal(visualFromEye(eye, ear), -21);
  assert.equal(visualFromEye(ear, eye.slice(1)), undefined, "too few by eye");
  assert.equal(visualFromEye([], eye), undefined);
  const bucket = createErrorBucket(3);
  for (const value of [1, Number.NaN, 2, 3, 4]) bucket.add(value);
  assert.deepEqual(bucket.values(), [2, 3, 4]);
  bucket.reset();
  assert.deepEqual(bucket.values(), []);
});

test("the log is JSON lines with the page's clock, rounded, bounded, and written once", async () => {
  let now = 1000.04;
  const log = createTimingLog("s1", () => now, 3);
  log.add("press", {
    stamp: 12.34567,
    nested: { off: -3.00049, list: [1.23456] },
    bad: Number.NaN,
  });
  now = 1016.7;
  log.add("frame");
  assert.deepEqual(
    log
      .text()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown),
    [
      {
        t: 1000,
        kind: "press",
        stamp: 12.346,
        nested: { off: -3, list: [1.235] },
        bad: null,
      },
      { t: 1016.7, kind: "frame" },
    ],
  );

  const sent: string[][] = [];
  let up = false;
  const writer = createLogWriter(
    log,
    async (lines) => {
      if (up) sent.push(lines);
      return up;
    },
    2,
  );
  assert.equal(writer.state, "idle");
  await writer.flush();
  assert.equal(writer.state, "idle", "one failure is not the end");
  up = true;
  await writer.flush();
  assert.equal(sent[0]?.length, 2, "what failed is sent again, in order");
  assert.equal(JSON.parse(sent[0]![0]!).kind, "press");
  assert.deepEqual([writer.state, writer.written], ["writing", 2]);
  await writer.flush();
  assert.equal(sent.length, 1, "nothing new, nothing sent");
  log.add("a");
  log.add("b");
  log.add("c");
  log.add("d");
  assert.equal(log.size, 3, "only the newest lines are kept");
  await writer.flush();
  assert.equal(sent[1]?.length, 3);

  // No server: after its tries it stops asking, and keeps the lines for a download.
  const lone = createTimingLog("s2", () => 0);
  let asked = 0;
  const off = createLogWriter(
    lone,
    async () => {
      asked++;
      throw new Error("no server");
    },
    2,
  );
  lone.add("x");
  await off.flush();
  await off.flush();
  await off.flush();
  assert.deepEqual([asked, off.state], [2, "off"]);
  assert.equal(lone.text(), `${JSON.stringify({ t: 0, kind: "x" })}\n`);
});

test("only this machine and a private network count as a local dev server", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "[::1]",
    "192.168.1.20",
    "10.0.0.5",
    "172.20.1.1",
    "anders-mbp.local",
  ])
    assert.equal(isLocalHost(host), true, host);
  for (const host of [
    "fusegames.ai",
    "andeplane.github.io",
    "172.32.0.1",
    "11.0.0.1",
    "localhost.evil.com",
    "1192.168.1.1",
  ])
    assert.equal(isLocalHost(host), false, host);
});

test("the frame lead is one refresh of the display, whatever its rate, and ignores a stall", () => {
  const lead = createFrameLead();
  assert.ok(
    Math.abs(lead.ms - 1000 / 60) < 1e-9,
    "60 Hz until it has seen frames",
  );
  let at = 0;
  for (let index = 0; index < 30; index++) lead.frame((at += 1000 / 120));
  assert.ok(Math.abs(lead.ms - 1000 / 120) < 1e-6);
  assert.ok(Math.abs(lead.hz - 120) < 1e-3);
  // A tab that slept, then a dropped frame now and then.
  lead.frame((at += 4000));
  for (let index = 0; index < 30; index++)
    lead.frame((at += index % 7 === 0 ? 1000 / 60 : 1000 / 120));
  assert.ok(Math.abs(lead.ms - 1000 / 120) < 1e-6);
  for (let index = 0; index < 60; index++) lead.frame((at += 1000 / 60));
  assert.ok(
    Math.abs(lead.ms - 1000 / 60) < 1e-6,
    "a display that changed is followed",
  );
});
