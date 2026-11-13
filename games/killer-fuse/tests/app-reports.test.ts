import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, STEPS_PER_TICK } from "../src/online/index.js";
import { dueReports, sendReport } from "../src/app/reports.js";
import { finish, fold, join, lobby, run, started } from "./fixtures/room.js";
import { ACTION } from "fuse-netcode";

const clock = (tick: number): number => tick * STEPS_PER_TICK;

test("a device reports a game once it is confirmed, the set once its last game is, and each once", () => {
  const room = started();
  finish(room, 0);
  const decided = room.results[0]!.tick;
  assert.deepEqual(dueReports(room, "a", clock(decided) - 1, new Set()), []);
  const [game] = dueReports(room, "a", clock(decided), new Set());
  assert.equal(game?.path, "round-results");
  assert.equal(game?.result.round, 1);
  assert.equal(game?.key, "m1:1");
  assert.deepEqual(
    dueReports(room, "a", clock(decided), new Set([game!.key])),
    [],
  );
  assert.deepEqual(dueReports(room, "tv", clock(decided), new Set()), []);
  assert.deepEqual(dueReports(room, "", clock(decided), new Set()), []);
  run(room, room.resumeAt - room.tick);
  finish(room, 0);
  assert.equal(room.stage, "over");
  const sent = new Set([game!.key]);
  assert.deepEqual(
    dueReports(room, "b", clock(room.results[1]!.tick) - 1, sent),
    [],
    "the deciding game is not confirmed yet",
  );
  const later = dueReports(room, "b", clock(room.tick), sent);
  assert.deepEqual(
    later.map((report) => [report.path, report.key]),
    [
      ["round-results", "m1:2"],
      ["results", "m1:match"],
    ],
  );
  assert.equal(later[1]!.result.winnerId, "a");
  assert.deepEqual(
    dueReports(
      room,
      "b",
      clock(room.tick),
      new Set(["m1:1", "m1:2", "m1:match"]),
    ),
    [],
  );
  assert.deepEqual(
    dueReports(room, "tv", clock(room.tick), new Set()),
    [],
    "only a finisher reports the set",
  );
});

test("six people: no game receipts (the platform rates five), and the set from its first five", () => {
  const room = lobby({ ...DEFAULT_SETTINGS, wins: 1 });
  fold(room, {
    a: [
      join("c", "Cy", 2),
      join("d", "Di", 3),
      join("e", "Ed", 4),
      join("f", "Flo", 5),
    ],
  });
  fold(room, { a: [[ACTION, "start", "m1"]] });
  finish(room, 1);
  const due = dueReports(room, "a", clock(room.tick), new Set());
  assert.deepEqual(
    due.map((report) => report.path),
    ["results"],
  );
  assert.deepEqual(dueReports(room, "f", clock(room.tick), new Set()), []);
});

test("a report goes with the room token, retries a lost race and stops at a refusal", async () => {
  const room = started();
  finish(room, 0);
  const [report] = dueReports(room, "a", clock(room.tick), new Set());
  assert.ok(report);
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const replies = [
    () => new Response("{}", { status: 503 }),
    (): Response => {
      throw new TypeError("offline");
    },
    () => Response.json({ status: "confirmed" }),
  ];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return replies.shift()!();
  };
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  assert.equal(
    await sendReport("https://rooms/x", report, {
      fetch: fetcher,
      roomToken: "t0k",
      wait,
    }),
    "confirmed",
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.url, "https://rooms/x");
  assert.deepEqual(waits, [1000, 2000]);
  const headers = new Headers(calls[0]!.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer t0k");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    result: report.result,
  });

  const once =
    (response: () => Response): typeof fetch =>
    async () =>
      response();
  assert.equal(
    await sendReport("u", report, {
      fetch: once(() => Response.json({ status: "pending" })),
      roomToken: "t",
      wait,
    }),
    "pending",
  );
  assert.equal(
    await sendReport("u", report, {
      fetch: once(() => new Response("{}", { status: 400 })),
      roomToken: "t",
      wait,
    }),
    "failed",
    "a refusal is final",
  );
  let forbidden = 0;
  assert.equal(
    await sendReport(
      "u",
      report,
      {
        fetch: once(() => {
          forbidden++;
          return new Response("{}", { status: 403 });
        }),
        roomToken: "t",
        wait,
      },
      2,
    ),
    "failed",
  );
  assert.equal(forbidden, 2, "a 403 is a reconnecting socket: retried");
  // Without an injected wait the real timer is used: one attempt never waits.
  assert.equal(
    await sendReport(
      "u",
      report,
      {
        fetch: once(() => new Response("{}", { status: 500 })),
        roomToken: "t",
      },
      1,
    ),
    "failed",
  );
});
