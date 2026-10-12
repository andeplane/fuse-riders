import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { PRESENCE } from "fuse-netcode";
import type { FuseLaneRoom } from "../src/game/index.js";
import {
  dueReports,
  sendReport,
  type DueReport,
  type ReportTransport,
} from "../src/app/reports.js";
import { fold, nextWeek, started } from "./fixtures/lane.js";

/** A match Ada wins on Monday of week 2, after Bo dropped out. */
function over(): FuseLaneRoom {
  const room = started();
  Object.assign(room.players.a!, {
    goals: [10, 10, 10, 10],
    cash: 1000,
    happiness: 20,
    job: 0,
    wage: 4,
    dep: 30,
  });
  room.players.a!.courses[0] = 10;
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  nextWeek(room);
  assert.equal(room.stage, "over");
  return room;
}

test("only a finisher owes the match, once it is confirmed, and not before the end", () => {
  const room = over();
  const due = dueReports(room, "a", room.phaseEnd, new Set());
  assert.deepEqual(
    due.map((report) => [report.key, report.path]),
    [["m1:match", "results"]],
  );
  assert.deepEqual(due[0]!.result.finishers, ["a"]);
  assert.deepEqual(
    dueReports(room, "b", room.phaseEnd, new Set()),
    [],
    "Bo left before the end: the others report",
  );
  assert.deepEqual(dueReports(room, "", room.phaseEnd, new Set()), []);
  assert.deepEqual(dueReports(started(), "a", 1e9, new Set()), []);
});

const REPORT: DueReport = dueReports(over(), "a", Infinity, new Set())[0]!;

interface Post {
  url: string;
  init: RequestInit;
}
/** A room service that answers each post with the next of `answers`: a status and body, or a thrown error. */
function service(answers: ({ status: number; body?: unknown } | Error)[]) {
  const posts: Post[] = [],
    waits: number[] = [];
  const transport: ReportTransport = {
    roomToken: "token-1",
    fetch: (input, init) => {
      posts.push({ url: String(input), init: init! });
      const answer = answers.shift()!;
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(
        new Response(JSON.stringify(answer.body ?? {}), {
          status: answer.status,
        }),
      );
    },
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
  return { transport, posts, waits };
}

test("a report posts the result with the room token, and says whether the record is confirmed", async () => {
  const confirmed = service([{ status: 200, body: { status: "confirmed" } }]);
  assert.equal(
    await sendReport("https://api/results", REPORT, confirmed.transport),
    "confirmed",
  );
  const [post] = confirmed.posts;
  assert.equal(post!.url, "https://api/results");
  assert.equal(post!.init.method, "POST");
  assert.equal(post!.init.keepalive, true);
  assert.deepEqual(post!.init.headers, {
    "Content-Type": "application/json",
    Authorization: "Bearer token-1",
  });
  assert.deepEqual(JSON.parse(String(post!.init.body)), {
    result: REPORT.result,
  });
  const pending = service([{ status: 200, body: { status: "pending" } }]);
  assert.equal(await sendReport("u", REPORT, pending.transport), "pending");
  const bare = service([{ status: 200, body: {} }]);
  assert.equal(await sendReport("u", REPORT, bare.transport), "pending");
});

test("a lost race, a reconnecting socket and a dropped connection are retried with backoff; other refusals are final", async () => {
  const retried = service([
    { status: 503 },
    { status: 403 },
    new TypeError("offline"),
  ]);
  assert.equal(await sendReport("u", REPORT, retried.transport), "failed");
  assert.equal(retried.posts.length, 3);
  assert.deepEqual(retried.waits, [1000, 2000]);

  const recovered = service([
    new TypeError("offline"),
    { status: 200, body: { status: "confirmed" } },
  ]);
  assert.equal(await sendReport("u", REPORT, recovered.transport), "confirmed");
  assert.equal(recovered.posts.length, 2);

  const refused = service([{ status: 400 }]);
  assert.equal(await sendReport("u", REPORT, refused.transport), "failed");
  assert.equal(refused.posts.length, 1, "a bad request is not tried again");
  const once = service([{ status: 500 }]);
  assert.equal(await sendReport("u", REPORT, once.transport, 1), "failed");
  assert.deepEqual(once.waits, []);
});

test("without a wait of its own, a retry waits on the clock", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { transport, posts } = service([
      { status: 503 },
      { status: 200, body: { status: "confirmed" } },
    ]);
    delete transport.wait;
    const sent = sendReport("u", REPORT, transport);
    // Let the first post settle; the retry then waits for 1000 ms.
    for (let n = 0; n < 5; n++) await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(posts.length, 1);
    mock.timers.tick(999);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(posts.length, 1, "not yet");
    mock.timers.tick(1);
    assert.equal(await sent, "confirmed");
    assert.equal(posts.length, 2);
  } finally {
    mock.timers.reset();
  }
});
