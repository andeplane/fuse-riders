import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type {
  MetricsResponse,
  MetricsRow,
  RecordingDetail,
} from "fuse-telemetry/contracts";
import {
  comparisonRows,
  defaultDateRange,
  chartPoints,
  timestamp,
} from "../dev/model.js";
import { createWorkspaceApi, WorkspaceError } from "../dev/api.js";
import { mountWorkspace, type WorkspaceAccount } from "../dev/workspace.js";
import { createDom } from "../dev/dom.js";
import { tokenTools, type MintedToken } from "../dev/actions.js";
import { recordingDetail, type PrivateMedia } from "../dev/sessions.js";

function row(gameId: string | null, start: string, users: number): MetricsRow {
  return {
    gameId,
    periodStart: start,
    periodEnd: "2026-11-15",
    events: 10,
    users,
    sessions: 3,
    roundStarts: users,
    roundEnds: 1,
    eventCounts: {},
  };
}
const metrics: MetricsResponse = {
  period: "day",
  timezone: "UTC",
  from: "2026-11-14",
  toExclusive: "2026-11-15",
  series: [row(null, "2026-11-14", 3)],
  games: [row("fuse-riders", "2026-11-14", 3)],
  partial: false,
  limits: { maxPeriods: 100, maxDocuments: 1000 },
};
function fixture() {
  const window = new Window();
  const document = window.document as unknown as Document;
  const root = document.createElement("div");
  document.body.append(root);
  let listener: Parameters<WorkspaceAccount["watch"]>[0] = () => undefined;
  const account: WorkspaceAccount = {
    ready: async () => undefined,
    watch(callback) {
      listener = callback;
      callback(undefined);
      return () => undefined;
    },
    signIn: async () => {
      listener({ name: "Developer" });
    },
    signOut: async () => {
      listener(undefined);
    },
    failure: () => "Sign-in failed.",
  };
  return {
    root,
    document,
    account,
    login() {
      listener({ name: "Developer" });
    },
    logout() {
      listener(undefined);
    },
  };
}
async function settled(predicate: () => boolean) {
  for (let iteration = 0; iteration < 100; iteration++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.ok(predicate(), "Expected the controlled request to settle");
}
function click(root: HTMLElement, text: string) {
  const control = [...root.querySelectorAll("button")].find(
    (button) => button.textContent === text,
  );
  assert.ok(control, `Missing control: ${text}`);
  control.click();
}

test("comparison sorts exact period counts instead of summing users across days", () => {
  const rows = [
    row("a", "2026-11-13", 100),
    row("a", "2026-11-14", 2),
    row("b", "2026-11-14", 5),
  ];
  assert.deepEqual(
    comparisonRows(rows, "2026-11-14", "users", true).map((item) => [
      item.gameId,
      item.users,
    ]),
    [
      ["b", 5],
      ["a", 2],
    ],
  );
  assert.equal(rows[0]?.users, 100);
  assert.deepEqual(defaultDateRange(new Date("2026-11-14T23:59:59Z")), {
    from: "2026-10-16",
    to: "2026-11-14",
  });
  assert.equal(timestamp(61000), "1:01");
  assert.ok(
    !chartPoints([row(null, "2026-11-14", 0)], "users").includes("NaN"),
  );
});

test("private API sends bearer only in header, omits browser credentials and rejects off-origin media", async () => {
  let calls = 0;
  const api = createWorkspaceApi({
    origin: "https://service.example",
    token: async () => "private-token",
    request: async (input, init) => {
      calls++;
      assert.ok(!String(input).includes("private-token"));
      assert.deepEqual(init?.headers, {
        Authorization: "Bearer private-token",
      });
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.credentials, "omit");
      return Response.json({ ok: true });
    },
  });
  await api.json("/api/dev/me", new AbortController().signal);
  await assert.rejects(
    api.blob(
      "https://attacker.example/api/dev/audio",
      new AbortController().signal,
    ),
    WorkspaceError,
  );
  assert.equal(calls, 1);
});

test("denied developer access never fetches private metrics or exposes backend errors", async () => {
  const f = fixture();
  const paths: string[] = [];
  const unmount = mountWorkspace(f.root, {
    ...f,
    now: () => new Date("2026-11-14T12:00:00Z"),
    gamesUrl: "/",
    transport: {
      origin: "https://service.example",
      token: async () => "private-token",
      request: async (input) => {
        paths.push(new URL(String(input)).pathname);
        return Response.json(
          { error: "secret internal exception" },
          { status: 403 },
        );
      },
    },
  });
  f.login();
  await settled(
    () =>
      f.root.textContent?.includes("does not have developer access") ?? false,
  );
  assert.deepEqual(paths, ["/api/dev/me"]);
  assert.ok(!f.root.textContent?.includes("secret internal exception"));
  assert.ok(f.root.querySelector(".error button"));
  unmount();
});

test("workspace authenticates, provides five chart equivalents, and discards stale views on sign-out", async () => {
  const f = fixture();
  const paths: string[] = [];
  let finishReports: ((response: Response) => void) | undefined;
  let reportSignal: AbortSignal | null | undefined;
  const unmount = mountWorkspace(f.root, {
    ...f,
    now: () => new Date("2026-11-14T12:00:00Z"),
    gamesUrl: "/",
    transport: {
      origin: "https://service.example",
      token: async () => "private-token",
      request: async (input, init) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        if (path === "/api/dev/me")
          return Response.json({ uid: "dev", email: "allowed@example.com" });
        if (path === "/api/dev/metrics") return Response.json(metrics);
        reportSignal = init?.signal;
        return new Promise<Response>((resolve) => {
          finishReports = resolve;
        });
      },
    },
  });
  await settled(
    () =>
      !f.root.querySelector<HTMLButtonElement>(".auth-panel button")?.disabled,
  );
  assert.deepEqual(paths, []);
  f.login();
  await settled(() => f.root.querySelectorAll("figure").length === 5);
  assert.deepEqual(paths.slice(0, 2), ["/api/dev/me", "/api/dev/metrics"]);
  assert.equal(f.root.querySelectorAll("details table tbody tr").length, 1);
  assert.ok(f.root.textContent?.includes("browser installations"));
  click(f.root, "Reports");
  await settled(() => !!finishReports);
  f.logout();
  assert.ok(reportSignal?.aborted);
  finishReports!(
    Response.json({
      reports: [
        {
          id: "private",
          gameId: "fuse-riders",
          text: "PRIVATE REPORT",
          category: "bug",
          createdAt: 1,
          receivedAt: 1,
        },
      ],
    }),
  );
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.ok(f.root.textContent?.includes("Sign in to continue"));
  assert.ok(!f.root.textContent?.includes("PRIVATE REPORT"));
  unmount();
});

test("timeline orders chunks and reports while treating private transcript as plain text", () => {
  const f = fixture();
  const media: PrivateMedia = {
    blob: async () => "blob:private",
    active: () => true,
    error: () => undefined,
    release: () => undefined,
    onDispose: () => undefined,
  };
  const detail: RecordingDetail = {
    recording: {
      id: "session",
      gameId: "fuse-riders",
      startedAt: 1,
      lastUploadAt: 1,
      status: "finished",
      durationMs: 20000,
      bytes: 100,
      expiresAt: 999,
    },
    segments: [
      {
        sequence: 1,
        startMs: 10000,
        endMs: 20000,
        status: "complete",
        transcript: "<img src=x onerror=alert(1)>",
      },
      { sequence: 0, startMs: 0, endMs: 10000, status: "pending" },
    ],
    reports: [
      {
        id: "report",
        gameId: "fuse-riders",
        category: "bug",
        text: "Report at five",
        createdAt: 1,
        receivedAt: 1,
        recordingId: "session",
        offsetMs: 5000,
      },
    ],
    transcript: "",
  };
  const rendered = recordingDetail(
    createDom(f.document),
    detail,
    media,
    () => undefined,
  );
  const entries = rendered.querySelectorAll(".timeline-entry");
  assert.equal(entries.length, 3);
  assert.ok(entries[0]?.textContent?.includes("0:00–0:10"));
  assert.ok(entries[1]?.textContent?.includes("Report at five"));
  assert.ok(entries[2]?.textContent?.includes("<img src=x onerror=alert(1)>"));
  assert.equal(rendered.querySelectorAll("img").length, 0);
});

test("scoped agent credentials reveal once, retain only revocation metadata, and revoke privately", async () => {
  const f = fixture();
  const tokens: MintedToken[] = [];
  const requests: { path: string; method?: string; body?: BodyInit | null }[] =
    [];
  const api = createWorkspaceApi({
    origin: "https://service.example",
    token: async () => "admin-token",
    request: async (input, init) => {
      requests.push({
        path: new URL(String(input)).pathname,
        method: init?.method,
        body: init?.body,
      });
      return Response.json(
        init?.method === "DELETE"
          ? { revoked: true }
          : {
              id: "credential-id",
              token: "once-only-secret",
              expiresAt: 1800000000000,
              gameId: "fuse-riders",
            },
      );
    },
  });
  f.root.append(
    tokenTools(
      createDom(f.document),
      api,
      new AbortController().signal,
      tokens,
      () => assert.fail("Credential request should succeed"),
    ),
  );
  const scope = f.root.querySelector("select")!;
  scope.value = "gameId";
  f.root.querySelector("input")!.value = "fuse-riders";
  f.root.querySelector("form")!.requestSubmit();
  await settled(() => !!f.root.querySelector("textarea"));
  assert.equal(f.root.querySelector("textarea")!.value, "once-only-secret");
  assert.ok(!JSON.stringify(tokens).includes("once-only-secret"));
  assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
    gameId: "fuse-riders",
    expiresInMs: 3600000,
  });
  click(f.root, "Hide credential");
  assert.equal(f.root.querySelector("textarea"), null);
  click(f.root, "Revoke credential");
  await settled(() => tokens.length === 0);
  assert.deepEqual(requests[1], {
    path: "/api/dev/agent-tokens/credential-id",
    method: "DELETE",
    body: undefined,
  });
  assert.ok(f.root.textContent?.includes("Credential revoked"));
});
