import test from "node:test";
import assert from "node:assert/strict";
import { PRESENCE } from "fuse-netcode";
import { FINISHED } from "../src/engine/index.js";
import { dueReports, sendReport, type DueReport } from "../src/app/reports.js";
import { matchResult, roundResult } from "../src/online/result.js";
import type { Room } from "../src/online/game.js";
import { fold, started } from "./fixtures/room.js";

/** A one-level match between `a` and `b`, over, `a` home first. */
function finished(): Room {
  const room = started({ display: false, level: 0 });
  const world = room.world!;
  while (world.phase === "countdown") fold(room);
  world.step = 960;
  world.riders.forEach((rider, slot) => {
    rider.status = FINISHED;
    rider.finish = rider.run = slot === 0 ? 800 : 960;
  });
  fold(room);
  assert.equal(room.stage, "over");
  return room;
}

test("a finished match is owed twice by each rider who finished it, once its deciding tick is confirmed", () => {
  const room = finished();
  const clock = room.decided!.clock;
  assert.deepEqual(
    dueReports(room, "a", clock - 1, new Set()),
    [],
    "not yet confirmed",
  );
  const due = dueReports(room, "a", clock, new Set());
  assert.deepEqual(
    due.map((report) => [report.key, report.path]),
    [
      [`${room.matchId}:1`, "round-results"],
      [`${room.matchId}:match`, "results"],
    ],
  );
  assert.deepEqual(due[0]!.result, roundResult(room));
  assert.deepEqual(due[1]!.result, matchResult(room));
  assert.equal(due[1]!.result.winnerId, "a");
  // Both riders report the same bytes.
  assert.deepEqual(
    dueReports(room, "b", clock, new Set()).map((report) => report.result),
    due.map((report) => report.result),
  );
  // Sent once each.
  assert.deepEqual(
    dueReports(room, "a", clock, new Set([due[0]!.key])).map((r) => r.path),
    ["results"],
  );
  assert.deepEqual(
    dueReports(room, "a", clock, new Set(due.map((r) => r.key))),
    [],
  );
});

test("a device that did not finish the match owes nothing", () => {
  const room = finished();
  const clock = room.decided!.clock;
  for (const id of ["", "tv", "bot:1", "z"])
    assert.deepEqual(dueReports(room, id, clock + 99, new Set()), [], id);
  // A race still running, or a lobby, owes nothing.
  const running = started({ display: false, level: 0 });
  assert.deepEqual(dueReports(running, "a", 1e9, new Set()), []);
  // A rider who left before the end is not among the finishers.
  const left = started({ display: false, level: 0 });
  const world = left.world!;
  while (world.phase === "countdown") fold(left);
  fold(left, { a: [[PRESENCE, "b", false, 1]] });
  world.riders[0]!.status = FINISHED;
  world.riders[0]!.finish = world.riders[0]!.run = world.step;
  fold(left);
  assert.equal(left.stage, "over");
  assert.deepEqual(left.decided!.finishers, ["a"]);
  assert.deepEqual(dueReports(left, "b", 1e9, new Set()), []);
  assert.equal(dueReports(left, "a", 1e9, new Set()).length, 2);
});

const report = (): DueReport => {
  const room = finished();
  return dueReports(room, "a", room.decided!.clock, new Set())[1]!;
};
/** A `fetch` that answers from a script, one entry per call, and records what it was asked. */
function scripted(answers: readonly (Response | Error)[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    const answer = answers[calls.length - 1] ?? new Error("no more answers");
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  };
  return { calls, fetcher };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

test("a report carries the room token and the result, and says what the service made of it", async () => {
  const due = report();
  const { calls, fetcher } = scripted([json(200, { status: "confirmed" })]);
  assert.equal(
    await sendReport("https://x/results", due, {
      fetch: fetcher,
      roomToken: "tok",
    }),
    "confirmed",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://x/results");
  assert.equal(calls[0]!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    result: due.result,
  });
  assert.equal(
    new Headers(calls[0]!.init?.headers).get("Authorization"),
    "Bearer tok",
  );
  const pending = scripted([json(200, { status: "pending" })]);
  assert.equal(
    await sendReport("u", due, { fetch: pending.fetcher, roomToken: "t" }),
    "pending",
  );
});

test("a lost race, a reconnecting socket and a dropped connection are retried; any other refusal is final", async () => {
  const due = report();
  const waits: number[] = [];
  const wait = (ms: number) => {
    waits.push(ms);
    return Promise.resolve();
  };
  const retried = scripted([
    json(503, {}),
    new Error("offline"),
    json(200, { status: "confirmed" }),
  ]);
  assert.equal(
    await sendReport("u", due, {
      fetch: retried.fetcher,
      roomToken: "t",
      wait,
    }),
    "confirmed",
  );
  assert.equal(retried.calls.length, 3);
  assert.deepEqual(waits, [1000, 2000], "backing off, never sleeping for real");

  const forbidden = scripted([json(403, {}), json(403, {}), json(403, {})]);
  assert.equal(
    await sendReport("u", due, {
      fetch: forbidden.fetcher,
      roomToken: "t",
      wait,
    }),
    "failed",
  );
  assert.equal(forbidden.calls.length, 3, "bounded");

  const refused = scripted([json(400, {}), json(200, { status: "confirmed" })]);
  assert.equal(
    await sendReport("u", due, {
      fetch: refused.fetcher,
      roomToken: "t",
      wait,
    }),
    "failed",
  );
  assert.equal(refused.calls.length, 1, "a refusal is not retried");
});
