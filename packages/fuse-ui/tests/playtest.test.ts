import assert from "node:assert/strict";
import { test } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { page } from "./dom-fixture.js";
import { PcmChunks, pcmWav, type WavSegment } from "../src/playtest-audio.js";
import {
  createRecordingUploader,
  type OutboxItem,
  type PlaytestOutbox,
  type StoredRecording,
  type StoredSegment,
  type UploadState,
  indexedDbPlaytestOutbox,
  MAX_OUTBOX_BYTES,
} from "../src/playtest-outbox.js";
import {
  isEditableReportTarget,
  playtestInputBlocked,
  registerPlaytestCapture,
  playtestCanvasImages,
  registerPlaytestInput,
  setPlaytestInputBlocked,
} from "../src/playtest-input.js";
import { recordingRequested, recordingTime } from "../src/playtest.js";

test("recording flags are explicit aliases and local navigation retains intent", () => {
  assert.equal(recordingRequested("?mute", null), false);
  assert.equal(recordingRequested("?record", null), true);
  assert.equal(recordingRequested("?report", null), true);
  assert.equal(recordingRequested("?room=ABCD", "1"), true);
  assert.equal(recordingRequested("?recording=1", null), false);
  assert.equal(recordingTime(125999), "2:05");
});

test("report entry releases all held inputs; leaving never restores a hold", () => {
  const { document } = page();
  let releases = 0;
  const dispose = registerPlaytestInput(document, {
    cancel: () => {
      releases++;
    },
  });
  setPlaytestInputBlocked(document, true);
  assert.equal(playtestInputBlocked(document), true);
  assert.equal(releases, 1);
  setPlaytestInputBlocked(document, true);
  assert.equal(releases, 1);
  setPlaytestInputBlocked(document, false);
  assert.equal(releases, 2);
  dispose();
  setPlaytestInputBlocked(document, true);
  assert.equal(releases, 2);
});

test("editable controls retain native cut, including descendants of contenteditable", () => {
  const { document } = page();
  const editor = document.createElement("div"),
    child = document.createElement("span");
  editor.setAttribute("contenteditable", "true");
  editor.append(child);
  assert.equal(isEditableReportTarget(child), true);
  assert.equal(
    isEditableReportTarget(document.createElement("textarea")),
    true,
  );
  assert.equal(isEditableReportTarget(document.createElement("canvas")), false);
  assert.equal(isEditableReportTarget(null), false);
});

test("renderer capture includes connected canvases and releases disposed adapters", async () => {
  const { document } = page();
  const canvas = document.createElement("canvas"),
    removed = document.createElement("canvas");
  document.body.append(canvas);
  const dispose = registerPlaytestCapture(
    document,
    async () =>
      new Map([
        [canvas, "data:image/png;base64,actual"],
        [removed, "stale"],
      ]),
  );
  assert.deepEqual(
    [...(await playtestCanvasImages(document))],
    [[canvas, "data:image/png;base64,actual"]],
  );
  dispose();
  assert.equal((await playtestCanvasImages(document)).size, 0);
});

test("PCM chunks are independently decodable WAVs with exact actual-rate offsets", async () => {
  const chunks: WavSegment[] = [];
  const encoder = new PcmChunks(44100, (chunk) => chunks.push(chunk));
  // Deliberately cross chunk boundaries at a non-quantum-aligned position.
  encoder.push(new Float32Array(44100 * 10 - 17).fill(0.5));
  assert.equal(chunks.length, 0);
  encoder.push(new Float32Array(44100 + 37).fill(-0.5));
  assert.equal(chunks.length, 1);
  assert.equal(encoder.offsetMs(), 11000);
  encoder.flush();
  assert.deepEqual(
    chunks.map(({ sequence, startMs, endMs }) => ({
      sequence,
      startMs,
      endMs,
    })),
    [
      { sequence: 0, startMs: 0, endMs: 10000 },
      { sequence: 1, startMs: 10000, endMs: 11000 },
    ],
  );
  for (const chunk of chunks) {
    const bytes = await chunk.blob.arrayBuffer(),
      header = new DataView(bytes);
    const text = (offset: number, length: number) =>
      new TextDecoder().decode(bytes.slice(offset, offset + length));
    assert.equal(text(0, 4), "RIFF");
    assert.equal(text(8, 4), "WAVE");
    assert.equal(text(36, 4), "data");
    assert.equal(header.getUint32(4, true), bytes.byteLength - 8);
    assert.equal(header.getUint32(24, true), 44100);
    assert.equal(header.getUint16(22, true), 1);
    assert.equal(header.getUint32(40, true), bytes.byteLength - 44);
    assert.equal(
      chunk.endMs,
      chunk.startMs +
        Math.round((((bytes.byteLength - 44) / 2) * 1000) / 44100),
    );
  }
  encoder.flush();
  assert.equal(chunks.length, 2);
});

test("PCM WAV clamps out-of-range samples and rejects unsupported rates", async () => {
  const view = new DataView(
    await pcmWav(new Float32Array([-2, 0, 2]), 24000).arrayBuffer(),
  );
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 0);
  assert.equal(view.getInt16(48, true), 32767);
  assert.throws(() => new PcmChunks(192000, () => {}), /sample rate/);
});

function memoryStore(initial: OutboxItem[]): PlaytestOutbox {
  const values = new Map(initial.map((item) => [item.key, item]));
  return {
    list: async () => [...values.values()],
    put: async (item) => {
      values.set(item.key, item);
    },
    remove: async (key) => {
      values.delete(key);
    },
    async updateRecording(key, change) {
      const current = values.get(key);
      if (current?.kind !== "recording") throw new Error("Missing recording");
      const next = change(current);
      values.set(key, next);
      return next;
    },
  };
}
const session: StoredRecording = {
  kind: "recording",
  key: "recording",
  id: "recording",
  ownerUid: "admin",
  gameId: "dice",
  startedAt: 10,
  savedMs: 0,
  finished: false,
};
function segment(sequence: number): StoredSegment {
  return {
    kind: "segment",
    key: `recording:${sequence}`,
    recordingId: "recording",
    sequence,
    startMs: sequence * 10000,
    endMs: (sequence + 1) * 10000,
    blob: pcmWav(new Float32Array(80000), 8000),
  };
}
test("an uncertain upload retains identical audio and retries serially before finishing", async () => {
  const first = { ...segment(0), gameId: "fuse-riders" },
    second = { ...segment(1), gameId: "fuse-birds" },
    store = memoryStore([{ ...session, finished: true }, second, first]);
  const sent: StoredSegment[] = [],
    changes: UploadState[] = [],
    retries: { run(): void; ms: number }[] = [];
  let fail = true,
    finished = 0;
  const uploader = createRecordingUploader({
    store,
    ownerUid: () => "admin",
    changed: (state) => changes.push(state),
    schedule: (run, ms) => {
      const item = { run, ms };
      retries.push(item);
      return () => {
        const index = retries.indexOf(item);
        if (index >= 0) retries.splice(index, 1);
      };
    },
    upload: {
      async segment(_session, chunk) {
        sent.push(chunk);
        if (fail) {
          fail = false;
          throw new Error("Connection dropped");
        }
      },
      async finish() {
        finished++;
      },
    },
  });
  await uploader.kick();
  assert.equal((await store.list()).length, 3);
  assert.equal(finished, 0);
  assert.equal(retries[0]?.ms, 1000);
  assert.equal(changes.at(-1)?.error, "Connection dropped");
  await uploader.kick();
  assert.deepEqual(
    sent.map((item) => item.sequence),
    [0, 0, 1],
  );
  assert.deepEqual(
    sent.map((item) => item.gameId),
    ["fuse-riders", "fuse-riders", "fuse-birds"],
  );
  assert.equal(
    sent[0]?.blob,
    sent[1]?.blob,
    "retry must preserve the exact immutable bytes",
  );
  assert.equal(finished, 1);
  assert.equal((await store.list()).length, 0);
  assert.equal(changes.at(-1)?.savedMs, 20000);
  uploader.dispose();
});

test("stopping while an upload is in flight preserves finished and acknowledged progress", async () => {
  const chunk = segment(0),
    store = memoryStore([{ ...session }, chunk]);
  let release = () => {},
    entered = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finished = 0;
  const uploader = createRecordingUploader({
    store,
    ownerUid: () => "admin",
    changed() {},
    schedule: () => () => {},
    upload: {
      async segment() {
        entered();
        await pending;
      },
      async finish() {
        finished++;
      },
    },
  });
  const work = uploader.kick();
  await started;
  await store.updateRecording(session.key, (current) => ({
    ...current,
    finished: true,
  }));
  release();
  await work;
  assert.equal(finished, 1);
  assert.equal((await store.list()).length, 0);
});

test("committed audio survives a new browser-storage client and is removed only on request", async () => {
  const factory = new IDBFactory();
  const original = indexedDbPlaytestOutbox(factory);
  const chunk = segment(0);
  await original.put(session);
  await original.put(chunk);
  const restored = indexedDbPlaytestOutbox(factory);
  const items = await restored.list();
  const audio = items.find(
    (item): item is StoredSegment => item.kind === "segment",
  );
  assert.ok(audio);
  assert.deepEqual(
    new Uint8Array(await audio.blob.arrayBuffer()),
    new Uint8Array(await chunk.blob.arrayBuffer()),
  );
  await restored.updateRecording(session.key, (value) => ({
    ...value,
    finished: true,
  }));
  assert.equal(
    (await original.list()).find((item) => item.kind === "recording")?.finished,
    true,
  );
  await restored.remove(chunk.key);
  assert.equal((await original.list()).length, 1);
});

test("browser storage enforces the byte cap atomically under concurrent writes", async () => {
  const store = indexedDbPlaytestOutbox(new IDBFactory());
  const blob = new Blob([new Uint8Array(MAX_OUTBOX_BYTES / 2)]);
  const results = await Promise.allSettled(
    [0, 1, 2].map((sequence) => store.put({ ...segment(sequence), blob })),
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    2,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1,
  );
  assert.equal((await store.list()).length, 2);
});
