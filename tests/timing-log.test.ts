import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createDevRoomService } from "../service/dev.js";
import {
  MAX_TIMING_BODY_BYTES,
  MAX_TIMING_FILE_BYTES,
  TIMING_LOG_PATH,
  createTimingLogHttp,
  timingLines,
  type TimingLogFiles,
} from "../service/timing-log.js";
import { TIMING_LOG_PATH as PAGE_PATH } from "../games/fusemania/src/app/timing-session.js";

test("the page and the local service agree on where a timing session goes", () => {
  assert.equal(PAGE_PATH, TIMING_LOG_PATH);
});

test("only lines that are JSON objects are a session", () => {
  assert.equal(
    timingLines('{"t":1,"kind":"press"}\n\n {"t":2}\n'),
    '{"t":1,"kind":"press"}\n{"t":2}\n',
  );
  assert.equal(timingLines(""), "");
  assert.equal(timingLines("\n\n"), "");
  for (const bad of [
    '{"t":1}\nnot json\n',
    "[1,2]\n",
    '"text"\n',
    "null\n",
    "7\n",
  ])
    assert.equal(timingLines(bad), undefined, bad);
});

test("the local dev service appends a debug session to a file, and takes nothing else", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fuse-timing-"));
  const service = createDevRoomService({ timingLogDirectory: directory });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port,
    origin = `http://127.0.0.1:${port}`;
  const post = (query: string, body: string, method = "POST") =>
    fetch(`${origin}${TIMING_LOG_PATH}${query}`, {
      method,
      headers: { origin, "content-type": "application/x-ndjson" },
      ...(method === "POST" ? { body } : {}),
    });
  try {
    const where = "?game=fusemania&session=2026-11-14t17-00-00-000z";
    const first = await post(
      where,
      '{"t":1,"kind":"session"}\n{"t":2,"kind":"press","stamp":12.5}\n',
    );
    assert.equal(first.status, 200);
    const file = ((await first.json()) as { file: string }).file;
    assert.equal(
      file,
      join(directory, "fusemania-2026-11-14t17-00-00-000z.jsonl"),
    );
    assert.equal((await post(where, '{"t":3,"kind":"judged"}\n')).status, 200);
    assert.deepEqual(
      (await readFile(file, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
      [
        { t: 1, kind: "session" },
        { t: 2, kind: "press", stamp: 12.5 },
        { t: 3, kind: "judged" },
      ],
    );
    // An empty batch writes nothing and is not an error.
    assert.equal(
      (await post("?game=fusemania&session=empty", "\n")).status,
      200,
    );

    // Names become a file name: nothing but the fixed alphabet gets through.
    for (const query of [
      "?game=fusemania&session=../../etc/passwd",
      "?game=fusemania&session=a%2Fb",
      "?game=..&session=x",
      "?game=fusemania",
      "?game=fusemania&session=UPPER",
      `?game=fusemania&session=${"a".repeat(81)}`,
    ])
      assert.equal((await post(query, '{"t":1}\n')).status, 400, query);
    assert.equal((await post(where, "not json\n")).status, 400);
    assert.equal((await post(where, "", "GET")).status, 405);
    assert.equal(
      (await post(where, `{"pad":"${"x".repeat(MAX_TIMING_BODY_BYTES)}"}\n`))
        .status,
      413,
    );
    // Another site open in the same browser is refused before the route sees it.
    const foreign = await fetch(
      `${origin}${TIMING_LOG_PATH}?game=fusemania&session=foreign`,
      {
        method: "POST",
        headers: { origin: "https://elsewhere.example" },
        body: '{"t":1}\n',
      },
    );
    assert.equal(foreign.status, 403);
    assert.deepEqual(await readdir(directory), [
      "fusemania-2026-11-14t17-00-00-000z.jsonl",
    ]);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("without a directory the service has no such route", async () => {
  const service = createDevRoomService();
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const port = (service.server.address() as AddressInfo).port,
    origin = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(
      `${origin}${TIMING_LOG_PATH}?game=fusemania&session=x`,
      { method: "POST", headers: { origin }, body: '{"t":1}\n' },
    );
    assert.equal(response.status, 404);
  } finally {
    await service.close();
  }
});

/** The route alone on a server of its own, with the file system a test gives it. */
async function routeAlone(files: TimingLogFiles) {
  const http = createTimingLogHttp("logs", files);
  const server = createServer((req, res) => {
    void http.handle(req, res, "local").then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    post: (session: string, body: string) =>
      fetch(
        `http://127.0.0.1:${port}${TIMING_LOG_PATH}?game=fusemania&session=${session}`,
        { method: "POST", body },
      ),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("a session's file stops growing at its limit, counted in bytes", async () => {
  const appended: string[] = [];
  let size = MAX_TIMING_FILE_BYTES - 5;
  const route = await routeAlone({
    ensure: async () => undefined,
    size: async () => size,
    append: async (_, text) => void appended.push(text),
  });
  try {
    // A file system that says the file is nearly full.
    assert.equal(
      (await route.post("full", '{"t":1,"kind":"press"}\n')).status,
      413,
    );
    // Twelve characters that are fifteen bytes: there is room for the one and not for the other.
    size = MAX_TIMING_FILE_BYTES - 13;
    assert.equal((await route.post("full", '{"s":"ééé"}\n')).status, 413);
    assert.deepEqual(appended, []);
    size = MAX_TIMING_FILE_BYTES - 15;
    assert.equal((await route.post("full", '{"s":"ééé"}\n')).status, 200);
    assert.deepEqual(appended, ['{"s":"ééé"}\n']);
  } finally {
    await route.close();
  }
});

test("two writes at once cannot both find room for one", async () => {
  const line = '{"t":1,"kind":"press"}\n';
  let size = MAX_TIMING_FILE_BYTES - line.length;
  const route = await routeAlone({
    ensure: async () => undefined,
    // Slow enough that both requests are waiting on it together.
    size: () => new Promise((resolve) => setImmediate(() => resolve(size))),
    append: async (_, text) => void (size += Buffer.byteLength(text)),
  });
  try {
    const answers = await Promise.all([
      route.post("race", line),
      route.post("race", line),
    ]);
    assert.deepEqual(answers.map((each) => each.status).sort(), [200, 413]);
    assert.equal(size, MAX_TIMING_FILE_BYTES);
  } finally {
    await route.close();
  }
});
