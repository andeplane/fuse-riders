import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { once } from "node:events";
import { DebugService, validateWav } from "../src/debug-service.js";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "../src/debug-memory.js";
import {
  FileDebugDatabase,
  FilePrivateObjectStorage,
} from "../src/debug-file.js";
import { TranscriptionWorker, readDebugBody } from "../src/worker.js";
import { GcsPrivateObjectStorage } from "../src/gcp-storage.js";
import { TranscriptionFailure } from "../src/transcription.js";
import { OpenAITranscriber } from "../src/openai.js";
import { createDebugHttpExtension } from "../src/debug-http.js";
import { RoomError } from "fuse-network-be";
import {
  reportKey,
  segmentKey,
  storedDebugRecord,
} from "../src/debug-store.js";
const id = "11111111-1111-4111-8111-111111111111",
  reportId = "22222222-2222-4222-8222-222222222222",
  now = 1_800_000_000_000;
function wav(samples = 8000, rate = 8000): Buffer {
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(samples * 2, 40);
  return b;
}
function setup() {
  let at = now;
  const database = new MemoryDebugDatabase(),
    objects = new MemoryPrivateObjectStorage(),
    service = new DebugService({
      database,
      objects,
      gameIds: new Set(["dice"]),
      now: () => at,
    });
  return {
    database,
    objects,
    service,
    advance: (ms: number) => {
      at += ms;
    },
  };
}
const recording = { id, gameId: "dice", startedAt: now };
const report = {
  id: reportId,
  gameId: "dice",
  category: "bug",
  text: "The control sticks",
  createdAt: now,
};
async function eventFor(objects: MemoryPrivateObjectStorage, sequence = 0) {
  const name = `recordings/${id}/${sequence}.wav`,
    object = await objects.get(name);
  assert.ok(object);
  return { bucket: "test", name, generation: object.generation };
}
test("WAV validation derives duration from PCM data and rejects malformed/long/stereo audio", () => {
  assert.deepEqual(validateWav(wav()), { sampleRate: 8000, durationMs: 1000 });
  assert.throws(() => validateWav(wav(80001)));
  const stereo = wav();
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => validateWav(stereo));
  const malformed = wav();
  malformed.writeUInt32LE(100, 40);
  assert.throws(() => validateWav(malformed));
  const huge = Buffer.alloc(2 * 1024 * 1024 + 1);
  assert.throws(() => validateWav(huge));
});
test("body size rejects a large Content-Length before consuming a slow upload", async () => {
  const req = new IncomingMessage(new Socket());
  req.headers["content-length"] = "20000000";
  await assert.rejects(
    () => readDebugBody(req, 100),
    (error) => error instanceof RoomError && error.status === 413,
  );
  req.destroy();
});
test("private GCS writes use create-only generations and verify identical retries", async () => {
  let object: Uint8Array | undefined;
  const request: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(
      (init?.headers as Headers).get("Authorization"),
      "Bearer test-only",
    );
    if (init?.method === "POST") {
      assert.equal(parsed.searchParams.get("ifGenerationMatch"), "0");
      if (object) return new Response(null, { status: 412 });
      assert.ok(init.body instanceof Uint8Array);
      object = init.body;
      return Response.json({ generation: "123" });
    }
    if (parsed.searchParams.get("alt") === "media")
      return new Response(new Uint8Array(object!));
    return Response.json({
      generation: "123",
      contentType: "audio/wav",
      size: String(object!.length),
    });
  };
  const storage = new GcsPrivateObjectStorage(
    "test-private-bucket",
    { headers: async () => new Headers({ Authorization: "Bearer test-only" }) },
    request,
  );
  assert.deepEqual(
    await storage.put("recordings/test/0.wav", wav(), "audio/wav"),
    { generation: "123" },
  );
  await storage.put("recordings/test/0.wav", wav(), "audio/wav");
  const changed = wav();
  changed[44] = 1;
  await assert.rejects(
    () => storage.put("recordings/test/0.wav", changed, "audio/wav"),
    /conflict/,
  );
});
test("sessions and immutable uploads bind owners, handle concurrent retries and exact duration", async () => {
  const { service } = setup();
  await service.createRecording("owner", recording);
  await assert.rejects(() => service.upload("other", id, 0, 0, wav()), /owner/);
  await Promise.all([
    service.upload("owner", id, 0, 0, wav()),
    service.upload("owner", id, 0, 0, wav()),
  ]);
  const saved = await service.recording(id);
  assert.equal(saved.bytes, wav().length);
  assert.equal(saved.durationMs, 1000);
  const changed = wav();
  changed[44] = 1;
  await assert.rejects(
    () => service.upload("owner", id, 0, 0, changed),
    /conflict/,
  );
  await assert.rejects(
    () => service.createRecording("other", recording),
    /conflict/,
  );
  await service.finish("owner", id);
  await service.upload("owner", id, 0, 0, wav());
  await service.upload("owner", id, 1, 1000, wav());
  assert.equal((await service.recording(id)).status, "finished");
});
test("out-of-order uploads reject contradictory neighbors and produce ordered audio", async () => {
  const { service } = setup();
  await service.createRecording("owner", recording);
  await service.upload("owner", id, 1, 1000, wav());
  await assert.rejects(
    () => service.upload("owner", id, 0, 0, wav(4000)),
    /timeline/,
  );
  await service.upload("owner", id, 0, 0, wav());
  assert.deepEqual(
    (await service.detail(id)).segments.map((s) => s.sequence),
    [0, 1],
  );
});
test("standalone reports are retry-safe, owned recording references and screenshot bytes validated", async () => {
  const { service } = setup();
  const first = await service.submitReport("opaque-ip", undefined, report);
  assert.deepEqual(
    await service.submitReport("opaque-ip", undefined, report),
    first,
  );
  await assert.rejects(
    () =>
      service.submitReport("opaque-ip", undefined, {
        ...report,
        text: "changed",
      }),
    /conflict/,
  );
  await service.createRecording("owner", recording);
  await assert.rejects(
    () =>
      service.submitReport("opaque-ip", undefined, {
        ...report,
        recordingId: id,
        offsetMs: 0,
      }),
    /owner/,
  );
  await assert.rejects(() =>
    service.submitReport("opaque-ip", undefined, {
      ...report,
      screenshot: {
        mime: "image/png",
        base64: Buffer.from("not a screenshot").toString("base64"),
      },
    }),
  );
  assert.equal((await service.listReports()).reports.length, 1);
});
test("report enum fields reject coercible arrays and objects before any write", async () => {
  const { service, database, objects } = setup();
  const jpeg = Buffer.from([255, 216, 0, 0, 0, 0, 0, 255, 217]).toString(
    "base64",
  );
  for (const category of [
    ["bug"],
    { toString: () => "bug" },
    { value: "bug" },
  ]) {
    await assert.rejects(
      service.submitReport("opaque-ip", undefined, { ...report, category }),
      (error: unknown) => error instanceof RoomError && error.status === 400,
    );
    assert.equal(await database.read(reportKey(reportId)), undefined);
  }
  for (const mime of [
    ["image/jpeg"],
    { toString: () => "image/jpeg" },
    { value: "image/jpeg" },
  ]) {
    await assert.rejects(
      service.submitReport("opaque-ip", undefined, {
        ...report,
        screenshot: { mime, base64: jpeg },
      }),
      (error: unknown) => error instanceof RoomError && error.status === 400,
    );
    assert.equal(await database.read(reportKey(reportId)), undefined);
    assert.equal(await objects.get(`screenshots/${reportId}`), undefined);
  }
  assert.equal((await service.listReports()).reports.length, 0);
  await service.submitReport("opaque-ip", undefined, {
    ...report,
    screenshot: { mime: "image/jpeg", base64: jpeg },
  });
  const stored = storedDebugRecord(await database.read(reportKey(reportId)));
  assert.ok(stored);
  assert.equal(stored.kind, "report");
  assert.equal((await service.listReports()).reports[0]?.category, "bug");
  assert.equal(
    (await objects.get(`screenshots/${reportId}`))?.mime,
    "image/jpeg",
  );
});
test("daily quotas are shared across concurrent session creation", async () => {
  const { service } = setup();
  const results = await Promise.allSettled(
    Array.from({ length: 21 }, (_, i) =>
      service.createRecording("owner", {
        ...recording,
        id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 20);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
test("durable delivery retries extraction without paying to transcribe twice", async () => {
  const { service, objects } = setup();
  await service.createRecording("owner", recording);
  await service.upload("owner", id, 0, 0, wav());
  let calls = 0,
    hooks = 0;
  const worker = new TranscriptionWorker({
      service,
      bucket: "test",
      transcriber: {
        transcribe: async () => {
          calls++;
          return "Fiks denne feilen, please.";
        },
      },
      afterTranscript: async (input) => {
        assert.equal(input.startMs, 0);
        hooks++;
        if (hooks === 1) throw new Error("Temporary extraction error");
      },
    }),
    event = await eventFor(objects);
  await assert.rejects(() => worker.process(event), /retry/);
  assert.equal(
    (await service.detail(id)).segments[0]!.transcript,
    "Fiks denne feilen, please.",
  );
  await worker.process(event);
  await worker.process(event);
  assert.equal(calls, 1);
  assert.equal(hooks, 2);
});
test("concurrent durable redelivery is fenced, transient retries and permanent failure visible", async () => {
  const { service, objects } = setup();
  await service.createRecording("owner", recording);
  await service.upload("owner", id, 0, 0, wav());
  let release: (value: string) => void = () => {
    throw new Error("not ready");
  };
  let entered: () => void = () => {};
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const worker = new TranscriptionWorker({
      service,
      bucket: "test",
      transcriber: {
        transcribe: async () => {
          entered();
          return new Promise<string>((r) => {
            release = r;
          });
        },
      },
    }),
    event = await eventFor(objects),
    processing = worker.process(event);
  await started;
  await assert.rejects(() => worker.process(event), /busy/);
  release("hello");
  await processing;
  await service.upload("owner", id, 1, 1000, wav());
  const failed = new TranscriptionWorker({
    service,
    bucket: "test",
    transcriber: {
      transcribe: async () => {
        throw new TranscriptionFailure("Unsupported audio", true);
      },
    },
  });
  await failed.process(await eventFor(objects, 1));
  assert.equal((await service.detail(id)).segments[1]!.status, "failed");
});
test("stale worker cannot overwrite a replacement lease", async () => {
  const { service, objects, database, advance } = setup();
  await service.createRecording("owner", recording);
  await service.upload("owner", id, 0, 0, wav());
  let release: (v: string) => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const old = new TranscriptionWorker({
      service,
      bucket: "test",
      leaseMs: 10,
      transcriber: {
        transcribe: async () => {
          entered();
          return new Promise<string>((r) => {
            release = r;
          });
        },
      },
    }),
    event = await eventFor(objects),
    running = old.process(event);
  await started;
  advance(11);
  await new TranscriptionWorker({
    service,
    bucket: "test",
    transcriber: { transcribe: async () => "new result" },
  }).process(event);
  release("old result");
  await assert.rejects(() => running, /replaced/);
  const segment = await database.read(segmentKey(id, 0));
  assert.equal(
    segment?.kind === "segment" ? segment.transcript : undefined,
    "new result",
  );
});
test("text survives media retention; expired private content is unavailable", async () => {
  const { service, advance } = setup();
  await service.createRecording("owner", recording);
  await service.upload("owner", id, 0, 0, wav());
  advance(31 * 86400_000);
  await assert.rejects(() => service.audio(id, 0), /expired/);
  assert.equal((await service.detail(id)).segments[0]!.audioUrl, undefined);
  advance(365 * 86400_000);
  await assert.rejects(() => service.detail(id), /not found/);
});
test("filesystem adapters survive reopen with independently playable WAV", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fuse-debug-test-"));
  try {
    const database = await FileDebugDatabase.open(join(directory, "metadata")),
      objects = new FilePrivateObjectStorage(join(directory, "objects")),
      service = new DebugService({
        database,
        objects,
        gameIds: new Set(["dice"]),
        now: () => now,
      });
    await service.createRecording("owner", recording);
    await service.upload("owner", id, 0, 0, wav());
    const reopened = new DebugService({
      database: await FileDebugDatabase.open(join(directory, "metadata")),
      objects: new FilePrivateObjectStorage(join(directory, "objects")),
      gameIds: new Set(["dice"]),
      now: () => now,
    });
    assert.equal((await reopened.recording(id)).bytes, wav().length);
    assert.deepEqual((await reopened.audio(id, 0))!.bytes, wav());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("OpenAI adapter uses multilingual gpt-transcribe and safely classifies provider failures", async () => {
  const request: typeof fetch = async (_url, init) => {
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("model"), "gpt-transcribe");
    assert.deepEqual(init.body.getAll("languages[]"), ["no", "en"]);
    assert.equal(init.body.get("response_format"), "json");
    return Response.json({ text: "Norsk og English" });
  };
  assert.equal(
    await new OpenAITranscriber({
      apiKey: "test-only",
      fetch: request,
    }).transcribe(wav()),
    "Norsk og English",
  );
  await assert.rejects(
    () =>
      new OpenAITranscriber({ apiKey: "", fetch: request }).transcribe(wav()),
    /not configured/,
  );
  await assert.rejects(
    () =>
      new OpenAITranscriber({
        apiKey: "test-only",
        fetch: async () =>
          new Response("private provider details", { status: 429 }),
      }).transcribe(wav()),
    (error) =>
      error instanceof TranscriptionFailure &&
      !error.permanent &&
      !error.message.includes("private"),
  );
});
test("HTTP rejects guests on recording and private reads while guest reports stay available", async () => {
  const { service } = setup(),
    extension = createDebugHttpExtension({
      service,
      verifier: async (token) =>
        token === "admin"
          ? { uid: "owner", email: "verified@example.test" }
          : undefined,
      reportIdentity: () => "opaque",
    });
  const server = createServer((req, res) => {
    void extension
      .handle(req, res, "ip")
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
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/api/dev/reports")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/telemetry/recordings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(recording),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(base + "/api/telemetry/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/dev/reports", {
          headers: { Authorization: "Bearer admin" },
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
