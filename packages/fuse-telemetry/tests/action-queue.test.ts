import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomError } from "fuse-network-be";
import {
  MemoryActionDatabase,
  FileActionDatabase,
} from "../src/action-adapters.js";
import {
  createActionService,
  type ActionService,
} from "../src/action-service.js";
import { createActionHttp } from "../src/action-http.js";
import {
  createOpenAIActionExtractor,
  explicitActionIntent,
  validateActionCandidates,
  type ActionCandidate,
  type ActionExtractionInput,
  type ActionExtractor,
} from "../src/action-extractor.js";
import type {
  ActionClaimResponse,
  TranscriptActionInput,
  TranscriptActionSegment,
} from "../src/action-contracts.js";
import { validateActionState } from "../src/action-store.js";

const admin = { uid: "admin" };
const segment = (
  sequence: number,
  text: string,
  gameId = "fuse-riders",
): TranscriptActionInput => ({
  recordingId: "recording-one",
  gameId,
  sequence,
  startMs: sequence * 10000,
  endMs: (sequence + 1) * 10000,
  text,
  reportIds: ["report-one"],
});
const candidate = (
  quote: string,
  sequence = 0,
  changes: Partial<ActionCandidate> = {},
): ActionCandidate => ({
  kind: "propose",
  targetId: null,
  title: "Fix the stuck menu",
  detail: "Repair the menu that stays open.",
  evidence: [{ sequence, quote }],
  ...changes,
});
const input = (text: string): ActionExtractionInput => ({
  currentSequence: 0,
  segments: [segment(0, text)],
  existing: [],
});
function fixture(
  extract: ActionExtractor["extract"] = async (value) => [
    candidate(value.segments.at(-1)!.text, value.currentSequence),
  ],
) {
  const database = new MemoryActionDatabase();
  let time = 1000,
    calls = 0;
  const transcripts = new Map<number, TranscriptActionSegment>();
  const service = createActionService({
    database,
    extractor: {
      async extract(value) {
        calls++;
        return extract(value);
      },
    },
    now: () => time,
    readNeighbors: async (_recording, sequence) =>
      [...transcripts.values()].filter(
        (item) =>
          item.sequence >= sequence - 2 && item.sequence <= sequence + 1,
      ),
  });
  return {
    database,
    service,
    transcripts,
    time: (value: number) => {
      time = value;
    },
    calls: () => calls,
    async process(value: TranscriptActionInput) {
      transcripts.set(value.sequence, value);
      await service.process(value);
    },
  };
}
async function one(service: ActionService) {
  const page = await service.list({}, admin);
  assert.equal(page.actions.length, 1);
  return page.actions[0]!;
}
const claim = async (service: ActionService, id: string, uid = "admin") =>
  (await service.mutate(
    id,
    "claim",
    { agentName: "worker", leaseMs: 10000 },
    { uid },
  )) as ActionClaimResponse;

test("English and Norwegian affirmative instructions require exact grounded evidence", () => {
  for (const quote of [
    "Fix the stuck menu.",
    "Please implement this feature.",
    "Fiks denne feilen.",
    "Legg til en pauseknapp.",
    "Gjør denne funksjonen ferdig.",
  ])
    assert.equal(
      validateActionCandidates({ actions: [candidate(quote)] }, input(quote))
        .length,
      1,
      quote,
    );
  assert.throws(
    () =>
      validateActionCandidates(
        { actions: [candidate("Fix a different bug.")] },
        input("Fix the stuck menu."),
      ),
    /Ungrounded/,
  );
  assert.throws(
    () =>
      validateActionCandidates(
        { actions: [candidate("Fix the stuck menu.", 6)] },
        input("Fix the stuck menu."),
      ),
    /Ungrounded/,
  );
});

test("ideas, questions, hypotheticals, negations, quoted directives and jokes never authorize a todo", () => {
  const utterances = [
    "A pause button would be cool.",
    "Maybe add a pause button.",
    "Could you fix the menu?",
    "If we add a feature, it could be fun.",
    "Do not fix the stuck menu.",
    "Don't fix the stuck menu.",
    "Fiks ikke denne feilen.",
    "Ikke legg til en knapp.",
    "Kanskje legg til en knapp.",
    "Han sa fiks denne feilen.",
    "Someone said fix the stuck menu.",
    'He said "Fix the stuck menu".',
    "Fix the stuck menu, just kidding.",
    "Fiks feilen, jeg tuller.",
    "I wish the menu worked.",
    "The menu is broken.",
  ];
  for (const text of utterances)
    assert.equal(
      validateActionCandidates({ actions: [candidate(text)] }, input(text))
        .length,
      0,
      text,
    );
  for (const text of [
    "Do not fix the stuck menu.",
    "Someone said fix the stuck menu.",
    "Maybe fix the stuck menu.",
  ]) {
    const quote = text.includes("Fix")
      ? "Fix the stuck menu."
      : "fix the stuck menu.";
    assert.equal(
      validateActionCandidates({ actions: [candidate(quote)] }, input(text))
        .length,
      0,
      `cropped ${text}`,
    );
  }
  assert.equal(
    explicitActionIntent("Avbryt oppgaven om menyen.", "retract"),
    true,
  );
  assert.equal(explicitActionIntent("Don't fix the menu.", "retract"), true);
});

test("strict candidate validation rejects invented target ids and arbitrary fields", () => {
  assert.throws(
    () =>
      validateActionCandidates(
        { actions: [{ ...candidate("Fix it."), malicious: true }] },
        input("Fix it."),
      ),
    /Invalid action candidate/,
  );
  assert.throws(
    () =>
      validateActionCandidates(
        { actions: [candidate("Fix it.", 0, { targetId: "unknown" })] },
        input("Fix it."),
      ),
    /Unknown action target/,
  );
  assert.throws(
    () =>
      validateActionCandidates(
        { actions: [candidate("Cancel it.", 0, { kind: "retract" })] },
        input("Cancel it."),
      ),
    /Missing action target/,
  );
});

test("OpenAI adapter uses bounded strict Responses with medium reasoning and refuses incomplete responses", async () => {
  const quote = "Fix the stuck menu.";
  const requests: Record<string, unknown>[] = [];
  const fake: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ actions: [candidate(quote)] }),
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );
  };
  const extractor = createOpenAIActionExtractor({
    apiKey: "test-key",
    fetch: fake,
  });
  assert.equal((await extractor.extract(input(quote))).length, 1);
  assert.equal(requests[0]!.model, "gpt-6.1-sol");
  assert.deepEqual(requests[0]!.reasoning, { effort: "medium" });
  assert.equal(requests[0]!.store, false);
  assert.match(JSON.stringify(requests[0]!.text), /json_schema/);
  assert.match(String(requests[0]!.instructions), /untrusted evidence/);
  await assert.rejects(
    createOpenAIActionExtractor({
      apiKey: "x",
      fetch: async () =>
        new Response(JSON.stringify({ status: "incomplete", output: [] })),
    }).extract(input(quote)),
    /Incomplete/,
  );
  await assert.rejects(
    createOpenAIActionExtractor({
      apiKey: "x",
      fetch: async () => new Response("down", { status: 503 }),
    }).extract(input(quote)),
    /503/,
  );
});

test("saved transcript delivery retries extraction after failure, then retries are free and idempotent", async () => {
  let failed = false;
  const f = fixture(async (value) => {
    if (!failed) {
      failed = true;
      throw new Error("provider unavailable");
    }
    return [candidate(value.segments.at(-1)!.text)];
  });
  const value = segment(0, "Fix the stuck menu.");
  await assert.rejects(f.process(value), /provider unavailable/);
  await f.process(value);
  await f.process(value);
  assert.equal(f.calls(), 2);
  const action = await one(f.service);
  assert.equal(action.status, "proposed");
  assert.deepEqual(action.evidence[0], {
    sequence: 0,
    startMs: 0,
    endMs: 10000,
    quote: value.text,
    reportIds: ["report-one"],
  });
});

test("overlapping repeated instructions reconcile one task and never expose claim secrets", async () => {
  const f = fixture();
  await f.process(segment(0, "Fix the stuck menu."));
  await f.process(segment(1, "Fix the stuck menu."));
  const action = await one(f.service);
  assert.equal(action.evidence.length, 2);
  const lease = await claim(f.service, action.id);
  assert.ok(lease.token);
  const listed = await one(f.service);
  assert.ok(listed.lease);
  assert.equal(JSON.stringify(listed).includes(lease.token), false);
  await assert.rejects(
    f.service.mutate(
      action.id,
      "complete",
      { token: "wrong", note: "done" },
      admin,
    ),
    /owned by another/,
  );
});

test("out-of-order transcripts wait for a predecessor and recover cross-chunk Norwegian directive once", async () => {
  const f = fixture(async (value) =>
    value.segments.length === 2
      ? [
          candidate("Vær så snill", 0, {
            title: "Legg til pauseknapp",
            evidence: [
              { sequence: 0, quote: "Vær så snill" },
              { sequence: 1, quote: "legg til en pauseknapp." },
            ],
          }),
        ]
      : [],
  );
  await assert.rejects(
    f.process(segment(1, "legg til en pauseknapp.")),
    /Previous transcript/,
  );
  assert.equal(f.calls(), 0);
  await f.process(segment(0, "Vær så snill"));
  await f.process(segment(1, "legg til en pauseknapp."));
  const action = await one(f.service);
  assert.equal(action.evidence.length, 2);
  assert.equal(f.calls(), 2);
});

test("missing preceding negation cannot produce a prematurely actionable task", async () => {
  const f = fixture(async (value) =>
    value.currentSequence === 0
      ? []
      : [candidate("fix the menu.", value.currentSequence)],
  );
  await assert.rejects(
    f.process(segment(1, "fix the menu.")),
    /Previous transcript/,
  );
  await f.process(segment(0, "Do not"));
  await f.process(segment(1, "fix the menu."));
  assert.deepEqual((await f.service.list({}, admin)).actions, []);
});

for (const kind of ["retract", "correct"] as const) {
  test(`saved out-of-order transcripts apply a later ${kind} after the proposal commits`, async () => {
    const quote =
      kind === "retract"
        ? "Cancel the menu fix."
        : "Add a close button instead.";
    const f = fixture(async (value) => {
      if (value.currentSequence === 0)
        return [candidate("Fix the stuck menu.")];
      const target = value.existing[0];
      return target
        ? [
            candidate(quote, 1, {
              kind,
              targetId: target.id,
              title: "Add a close button",
            }),
          ]
        : [];
    });
    // Transcription may finish both chunks before either extraction delivery.
    f.transcripts.set(0, segment(0, "Fix the stuck menu."));
    f.transcripts.set(1, segment(1, quote));
    await assert.rejects(
      f.process(segment(1, quote)),
      /Previous action extraction.*retry/,
    );
    assert.equal(f.calls(), 0);
    await f.process(segment(0, "Fix the stuck menu."));
    await f.process(segment(1, quote));
    const action = await one(f.service);
    assert.equal(action.status, kind === "retract" ? "retracted" : "proposed");
    if (kind === "retract") assert.equal(action.retraction?.quote, quote);
    else {
      assert.equal(action.title, "Add a close button");
      assert.equal(action.correction?.evidence[0]?.quote, quote);
    }
    assert.equal(f.calls(), 2);
  });
}

test("empty saved predecessors complete the extraction dependency without a provider call", async () => {
  const f = fixture();
  f.transcripts.set(0, segment(0, ""));
  await assert.rejects(
    f.process(segment(1, "Fix the stuck menu.")),
    /Previous action extraction.*retry/,
  );
  assert.equal(f.calls(), 0);
  await f.process(segment(0, ""));
  assert.equal((await one(f.service)).status, "proposed");
  const stored = await f.database.read("recording-one");
  assert.ok(stored?.processed["0"]);
  assert.ok(stored?.processed["1"]);
  await f.process(segment(1, "Fix the stuck menu."));
  assert.equal(f.calls(), 1);
});

test("competing claims serialize, lease expires, and former owner cannot complete", async () => {
  const f = fixture();
  await f.process(segment(0, "Fix the stuck menu."));
  const action = await one(f.service);
  const results = await Promise.allSettled([
    claim(f.service, action.id, "worker-a"),
    claim(f.service, action.id, "worker-b"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const winner = results.find(
    (result): result is PromiseFulfilledResult<ActionClaimResponse> =>
      result.status === "fulfilled",
  )!.value;
  f.time(11001);
  assert.equal((await one(f.service)).status, "proposed");
  const next = await claim(f.service, action.id, "worker-c");
  await assert.rejects(
    f.service.mutate(
      action.id,
      "complete",
      { token: winner.token, note: "old execution" },
      { uid: winner.action.lease!.ownerId },
    ),
    /owned by another/,
  );
  await f.service.mutate(
    action.id,
    "renew",
    { token: next.token, leaseMs: 20000 },
    { uid: "worker-c" },
  );
  await f.service.mutate(
    action.id,
    "complete",
    { token: next.token, note: "PR 123" },
    { uid: "worker-c" },
  );
  assert.equal((await one(f.service)).status, "done");
});

test("later retraction remains visible for claimed execution, blocks completion, and releases safely", async () => {
  const f = fixture(async (value) =>
    value.currentSequence === 0
      ? [candidate("Fix the stuck menu.")]
      : [
          candidate("Cancel the menu task.", 1, {
            kind: "retract",
            targetId: value.existing[0]!.id,
          }),
        ],
  );
  await f.process(segment(0, "Fix the stuck menu."));
  const action = await one(f.service),
    lease = await claim(f.service, action.id);
  await f.process(segment(1, "Cancel the menu task."));
  assert.equal((await one(f.service)).status, "claimed");
  assert.equal((await one(f.service)).retraction?.sequence, 1);
  await assert.rejects(
    f.service.mutate(
      action.id,
      "complete",
      { token: lease.token, note: "done" },
      admin,
    ),
    /Spoken change/,
  );
  await f.service.mutate(action.id, "release", { token: lease.token }, admin);
  assert.equal((await one(f.service)).status, "retracted");
});

test("explicit correction requires current execution to release and reclaim the replacement", async () => {
  const f = fixture(async (value) =>
    value.currentSequence === 0
      ? [candidate("Fix the stuck menu.")]
      : [
          candidate("Add a close button instead.", 1, {
            kind: "correct",
            targetId: value.existing[0]!.id,
            title: "Add a close button",
            detail: "A replacement direction.",
          }),
        ],
  );
  await f.process(segment(0, "Fix the stuck menu."));
  const action = await one(f.service),
    lease = await claim(f.service, action.id);
  await f.process(segment(1, "Add a close button instead."));
  assert.equal((await one(f.service)).title, "Fix the stuck menu");
  await assert.rejects(
    f.service.mutate(action.id, "renew", { token: lease.token }, admin),
    /Spoken change/,
  );
  await f.service.mutate(action.id, "release", { token: lease.token }, admin);
  const replacement = await claim(f.service, action.id);
  assert.equal(replacement.action.title, "Add a close button");
  await f.service.mutate(
    action.id,
    "complete",
    { token: replacement.token, note: "replacement implemented" },
    admin,
  );
});

test("recording game switches keep task identities and game-scoped agent access separate", async () => {
  const f = fixture();
  await f.process(segment(0, "Fix the stuck menu.", "fuse-riders"));
  await f.process(segment(1, "Fix the stuck menu.", "fuseball"));
  const minted = await f.service.mintToken({ gameId: "fuseball" }, "admin");
  const agent = await f.service.verifyAgentToken(minted.token);
  assert.ok(agent);
  const page = await f.service.list({}, agent);
  assert.equal(page.actions.length, 1);
  assert.equal(page.actions[0]!.gameId, "fuseball");
  const other = (await f.service.list({ gameId: "fuse-riders" }, admin))
    .actions[0]!;
  await assert.rejects(
    f.service.mutate(other.id, "claim", { agentName: "wrong scope" }, agent),
    /scope denied/,
  );
  await assert.rejects(
    f.service.list({ gameId: "fuse-riders" }, agent),
    /scope denied/,
  );
});

test("agent tokens are scoped, hashed, revocable, expire, and cannot dismiss", async () => {
  const f = fixture();
  await f.process(segment(0, "Fix the stuck menu."));
  const minted = await f.service.mintToken(
    { recordingId: "recording-one", expiresInMs: 60000 },
    "admin",
  );
  const stored = await f.database.readToken(minted.id);
  assert.ok(stored);
  assert.notEqual(stored.hash, minted.token);
  assert.equal(JSON.stringify(stored).includes(minted.token), false);
  const agent = await f.service.verifyAgentToken(minted.token);
  assert.ok(agent);
  const action = await one(f.service);
  await assert.rejects(
    f.service.mutate(action.id, "dismiss", { note: "ignore" }, agent),
    /Developer sign-in/,
  );
  await assert.rejects(
    f.service.list({ recordingId: "other" }, agent),
    /scope denied/,
  );
  await f.service.revokeToken(minted.id, "admin");
  assert.equal(await f.service.verifyAgentToken(minted.token), undefined);
  const expiring = await f.service.mintToken(
    { gameId: "fuse-riders", expiresInMs: 60000 },
    "admin",
  );
  f.time(61000);
  assert.equal(await f.service.verifyAgentToken(expiring.token), undefined);
  await assert.rejects(f.service.mintToken({}, "admin"), /scope/);
});

test("file adapter survives reopen with completed extraction and hidden lease state intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fuse-actions-"));
  try {
    const path = join(dir, "actions.json"),
      db = await FileActionDatabase.open(path);
    const service = createActionService({
      database: db,
      extractor: { extract: async () => [candidate("Fix the stuck menu.")] },
      readNeighbors: async () => [],
    });
    await service.process(segment(0, "Fix the stuck menu."));
    const item = await one(service),
      lease = await claim(service, item.id);
    const reopened = await FileActionDatabase.open(path);
    assert.equal(
      (await reopened.read("recording-one"))?.leaseSecrets[item.id],
      lease.token,
    );
    let calls = 0;
    const restored = createActionService({
      database: reopened,
      extractor: {
        extract: async () => {
          calls++;
          return [];
        },
      },
      readNeighbors: async () => [],
    });
    await restored.process(segment(0, "Fix the stuck menu."));
    assert.equal(calls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP requires verified developer auth, limits request fields and gives agent tokens only action access", async () => {
  const f = fixture();
  await f.process(segment(0, "Fix the stuck menu."));
  const handler = createActionHttp(f.service, async (token) =>
    token === "valid"
      ? { uid: "admin", email: "allowed@example.com" }
      : undefined,
  );
  const server = createServer((req, res) => {
    void handler
      .handle(req, res, "127.0.0.1")
      .then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      })
      .catch((error: unknown) => {
        res.writeHead(error instanceof RoomError ? error.status : 500);
        res.end();
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/api/dev/actions`)).status, 401);
    assert.equal(
      (
        await fetch(`${base}/api/dev/actions`, {
          headers: { authorization: "Bearer invalid" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${base}/api/dev/actions?limit=NaN`, {
          headers: { authorization: "Bearer valid" },
        })
      ).status,
      400,
    );
    const minted = await f.service.mintToken(
      { recordingId: "recording-one" },
      "admin",
    );
    const headers = {
      authorization: `Bearer ${minted.token}`,
      "content-type": "application/json",
    };
    const list = await fetch(`${base}/api/dev/actions`, { headers });
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await fetch(`${base}/api/dev/agent-tokens`, {
          method: "POST",
          headers,
          body: JSON.stringify({ gameId: "fuseball" }),
        })
      ).status,
      403,
    );
    const action = await one(f.service);
    const claimed = await fetch(`${base}/api/dev/actions/${action.id}/claim`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentName: "CLI worker" }),
    });
    assert.equal(claimed.status, 200);
    assert.equal(
      (
        await fetch(`${base}/api/dev/actions/${action.id}/complete`, {
          method: "POST",
          headers,
          body: JSON.stringify({ token: "wrong", note: "done" }),
        })
      ).status,
      409,
    );
    assert.equal(
      (await fetch(`${base}/api/dev/actions?status=unknown`, { headers }))
        .status,
      400,
    );
    assert.equal(
      (await fetch(`${base}/api/dev/actions?limit=1&limit=2`, { headers }))
        .status,
      400,
    );
    assert.equal(
      (
        await fetch(`${base}/api/dev/actions/${action.id}/claim`, {
          method: "POST",
          headers,
          body: JSON.stringify({ agentName: "worker", extra: true }),
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("extraction has one fenced owner while duplicate deliveries retry without duplicate provider work", async () => {
  let enter: () => void = () => {
    throw new Error("not initialized");
  };
  let finish: () => void = () => {
    throw new Error("not initialized");
  };
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const f = fixture(async () => {
    enter();
    await held;
    return [candidate("Fix the stuck menu.")];
  });
  const value = segment(0, "Fix the stuck menu.");
  const first = f.process(value);
  await entered;
  await assert.rejects(f.process(value), /extraction busy/);
  finish();
  await first;
  await f.process(value);
  assert.equal(f.calls(), 1);
  assert.equal((await one(f.service)).status, "proposed");
});

test("retraction plus an expired lease stays retracted; older duplicate instructions never reopen it", async () => {
  const f = fixture(async (value) =>
    value.currentSequence === 0
      ? [candidate("Fix the stuck menu.")]
      : [
          candidate("Cancel the menu task.", 1, {
            kind: "retract",
            targetId: value.existing[0]!.id,
          }),
        ],
  );
  await f.process(segment(0, "Fix the stuck menu."));
  const action = await one(f.service);
  await claim(f.service, action.id);
  await f.process(segment(1, "Cancel the menu task."));
  f.time(11001);
  assert.equal((await one(f.service)).status, "retracted");
  await f.process(segment(0, "Fix the stuck menu."));
  assert.equal((await one(f.service)).status, "retracted");
  await assert.rejects(claim(f.service, action.id), /not claimable/);
});

test("bounded action pagination resumes without missing items and supports updated-since", async () => {
  const f = fixture(async (value) => [
    candidate(value.segments.at(-1)!.text, value.currentSequence, {
      title: `Task ${value.currentSequence}`,
    }),
  ]);
  await f.process(segment(0, "Fix the stuck menu."));
  f.time(2000);
  await f.process(segment(1, "Add a pause button."));
  f.time(3000);
  await f.process(segment(2, "Remove the duplicate button."));
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await f.service.list({ limit: 1, cursor }, admin);
    for (const item of page.actions) {
      assert.equal(ids.has(item.id), false);
      ids.add(item.id);
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.size, 3);
  const recent = await f.service.list({ since: 2001 }, admin);
  assert.equal(recent.actions.length, 1);
  assert.equal(recent.actions[0]!.title, "Task 2");
  await assert.rejects(
    f.service.list({ cursor: "bad" }, admin),
    /Invalid action cursor/,
  );
});

test("corrupt or oversized stored action state is rejected atomically and healthy state survives", async () => {
  const f = fixture();
  await f.process(segment(0, "Fix the stuck menu."));
  const before = await f.database.read("recording-one");
  assert.ok(before);
  assert.throws(
    () =>
      validateActionState({
        ...before,
        items: [{ ...before.items[0]!, status: "claimed" }],
      }),
    /Invalid action item/,
  );
  await assert.rejects(
    f.database.transact("recording-one", (state) => {
      assert.ok(state);
      state.items[0]!.title = "x".repeat(500001);
      return { state, result: undefined };
    }),
    /capacity exceeded/,
  );
  assert.deepEqual(await f.database.read("recording-one"), before);
});
