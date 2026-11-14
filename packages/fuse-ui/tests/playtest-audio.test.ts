import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  PCM_PROCESSOR,
  startPcmMicrophone,
  type CaptureContext,
  type CaptureNode,
  type WavSegment,
  PcmChunks,
} from "../src/playtest-audio.js";

interface Processor {
  port: { onmessage: (event: { data: unknown }) => void };
  process(inputs: Float32Array[][]): boolean;
}

/** Runs the actual worklet program with deterministic message queues on both sides. */
async function microphone(initialGame = "fuse-riders", moduleGame?: string) {
  const toPage: unknown[] = [],
    toProcessor: unknown[] = [];
  let ProcessorClass: (new () => Processor) | undefined;
  runInNewContext(PCM_PROCESSOR, {
    Float32Array,
    AudioWorkletProcessor: class {
      port = {
        onmessage: () => undefined,
        postMessage: (data: unknown) => toPage.push(data),
      };
    },
    registerProcessor(_name: string, constructor: new () => Processor) {
      ProcessorClass = constructor;
    },
  });
  assert.ok(ProcessorClass);
  const processor = new ProcessorClass();
  const chunks: WavSegment[] = [];
  let closed = false,
    disconnected = false;
  let currentGame = initialGame;
  const focusListeners = new Set<(game: string) => void>();
  const node: CaptureNode = {
    port: {
      onmessage: null,
      postMessage: (message) => toProcessor.push(message),
      close: () => {
        closed = true;
      },
    },
    onprocessorerror: null,
    disconnect() {
      disconnected = true;
    },
  };
  const context: CaptureContext = {
    sampleRate: 24000,
    state: "running",
    audioWorklet: {
      addModule: async () => {
        if (moduleGame) currentGame = moduleGame;
      },
    },
    addEventListener() {},
    resume: async () => undefined,
    close: async () => undefined,
  };
  const timeouts = new Set<() => void>();
  const capture = await startPcmMicrophone(
    {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
        getTracks: () => [],
      }),
      createContext: () => context,
      createNode: () => node,
      connect: () => ({ disconnect() {} }),
      createUrl: () => "blob:test",
      revokeUrl() {},
      schedule(run) {
        timeouts.add(run);
        return () => {
          timeouts.delete(run);
        };
      },
    },
    (chunk) => chunks.push(chunk),
    (reason) => assert.fail(reason),
    {
      current: () => currentGame,
      subscribe: (listener) => {
        focusListeners.add(listener);
        return () => {
          focusListeners.delete(listener);
        };
      },
    },
  );
  return {
    capture,
    chunks,
    focus(game: string) {
      currentGame = game;
      for (const listener of focusListeners) listener(game);
    },
    subscribed: () => focusListeners.size,
    samples(count: number, value: number) {
      processor.process([[new Float32Array(count).fill(value)]]);
    },
    processorMessages() {
      for (const data of toProcessor.splice(0))
        processor.port.onmessage({ data });
    },
    pageMessages() {
      for (const data of toPage.splice(0))
        node.port.onmessage?.(new MessageEvent("message", { data }));
    },
    expireTimeouts() {
      for (const run of timeouts) run();
      timeouts.clear();
    },
    closed: () => closed && disconnected,
  };
}

async function sampleValues(chunks: readonly WavSegment[]): Promise<number[]> {
  const values: number[] = [];
  for (const chunk of chunks) {
    const view = new DataView(await chunk.blob.arrayBuffer());
    for (let offset = 44; offset < view.byteLength; offset += 2)
      values.push(view.getInt16(offset, true));
  }
  return values;
}

test("switching games before ten seconds drains delayed worklet PCM under the old game", async () => {
  const mic = await microphone();
  mic.samples(6000, 0.25);
  mic.focus("fuse-birds");
  // Both full blocks and the partial worklet buffer are still in flight.
  mic.processorMessages();
  mic.samples(12000, -0.25);
  mic.pageMessages();
  assert.equal(mic.chunks.length, 1);
  assert.equal(mic.chunks[0]?.gameId, "fuse-riders");
  const stopping = mic.capture.stop();
  mic.processorMessages();
  mic.pageMessages();
  await stopping;
  assert.deepEqual(
    mic.chunks.map(({ gameId, startMs, endMs, sequence }) => ({
      gameId,
      startMs,
      endMs,
      sequence,
    })),
    [
      { gameId: "fuse-riders", startMs: 0, endMs: 250, sequence: 0 },
      { gameId: "fuse-birds", startMs: 250, endMs: 750, sequence: 1 },
    ],
  );
  assert.deepEqual(await sampleValues(mic.chunks), [
    ...new Array<number>(6000).fill(8192),
    ...new Array<number>(12000).fill(-8192),
  ]);
  assert.equal(mic.closed(), true);
  assert.equal(mic.subscribed(), 0);
});

test("focus changes while microphone setup awaits a worklet module use the game at capture start", async () => {
  const mic = await microphone("fuse-riders", "fuse-birds");
  mic.samples(128, 0.5);
  const stopping = mic.capture.stop();
  mic.processorMessages();
  mic.pageMessages();
  await stopping;
  assert.equal(mic.chunks[0]?.gameId, "fuse-birds");
});

test("rapid quantum-size focus boundaries keep integer-ms WAV acknowledgements contiguous at actual rates", async () => {
  for (const rate of [44100, 48000]) {
    const chunks: WavSegment[] = [];
    const pcm = new PcmChunks(
      rate,
      (chunk) => chunks.push(chunk),
      "fuse-riders",
    );
    for (let i = 0; i < 100; i++) {
      pcm.push(new Float32Array(128));
      pcm.setGame(i % 2 ? "fuse-riders" : "fuse-birds");
    }
    let through = 0;
    for (const chunk of chunks) {
      const view = new DataView(await chunk.blob.arrayBuffer());
      const duration = Math.round(
        ((view.getUint32(40, true) / 2) * 1000) / rate,
      );
      assert.equal(chunk.startMs, through);
      assert.equal(chunk.endMs, through + duration);
      through = chunk.endMs;
    }
    assert.equal((await sampleValues(chunks)).length, 12800);
  }
});

test("rapid game switches and closing the focused window keep sample order and bounded WAVs", async () => {
  const mic = await microphone();
  mic.samples(240000 + 17, 0.5);
  mic.capture.setGame("fuse-birds");
  mic.processorMessages();
  mic.samples(240, -0.5);
  mic.capture.setGame("fuse-riders");
  mic.capture.setGame("fuseos"); // The last game window has closed.
  mic.processorMessages();
  mic.samples(480, 0);
  const stopping = mic.capture.stop();
  mic.processorMessages();
  mic.pageMessages();
  await stopping;
  assert.deepEqual(
    mic.chunks.map((chunk) => chunk.gameId),
    ["fuse-riders", "fuse-riders", "fuse-birds", "fuseos"],
  );
  assert.deepEqual(
    mic.chunks.map((chunk) => chunk.sequence),
    [0, 1, 2, 3],
  );
  for (let i = 0; i < mic.chunks.length; i++) {
    const chunk = mic.chunks[i]!;
    assert.ok(chunk.blob.size <= 44 + 240000 * 2);
    assert.equal(chunk.startMs, i ? mic.chunks[i - 1]?.endMs : 0);
  }
  assert.equal(
    (await sampleValues(mic.chunks)).length,
    240000 + 17 + 240 + 480,
  );
});

test("stop timeout preserves already received game attribution when a worklet cannot drain", async () => {
  const mic = await microphone();
  mic.samples(4096, 0.5);
  mic.pageMessages();
  mic.capture.setGame("fuse-birds"); // Worklet is unavailable before acknowledging the boundary.
  const stopping = mic.capture.stop();
  mic.expireTimeouts();
  await stopping;
  assert.equal(mic.chunks[0]?.gameId, "fuse-riders");
  assert.equal((await sampleValues(mic.chunks)).length, 4096);
  assert.equal(mic.closed(), true);
});
