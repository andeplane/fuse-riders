import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PcmChunks,
  type WavSegment,
} from "../../fuse-ui/src/playtest-audio.js";
import { DebugService, validateWav } from "../src/debug-service.js";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "../src/debug-memory.js";
import { segmentKey } from "../src/debug-store.js";

test("actual PCM focus chunks upload gaplessly at 44.1/48kHz, including sub-ms tails and frozen retries", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    now = 1_800_000_000_000;
  for (const rate of [44100, 48000]) {
    const database = new MemoryDebugDatabase();
    const service = new DebugService({
      database,
      objects: new MemoryPrivateObjectStorage(),
      gameIds: new Set(["fuse-riders", "fuse-birds", "fuseos"]),
      now: () => now,
    });
    await service.createRecording("owner", {
      id,
      gameId: "fuseos",
      startedAt: now,
    });
    const chunks: WavSegment[] = [];
    const pcm = new PcmChunks(
      rate,
      (chunk) => chunks.push(chunk),
      "fuse-riders",
    );
    pcm.push(new Float32Array(rate * 10 + 8));
    pcm.setGame("fuse-birds");
    for (let i = 0; i < 30; i++) {
      pcm.push(new Float32Array(128));
      pcm.setGame(i % 2 ? "fuse-birds" : "fuse-riders");
    }
    pcm.setGame("fuseos"); // Closing the game does not relabel its pending samples.
    pcm.flush();
    assert.equal(chunks[1]?.blob.size, 44 + 8 * 2);
    assert.equal(chunks[1]?.endMs, 10001);
    let through = 0,
      samples = 0;
    for (const chunk of chunks) {
      const bytes = new Uint8Array(await chunk.blob.arrayBuffer());
      const validated = validateWav(bytes);
      assert.ok(validated.durationMs > 0);
      assert.equal(chunk.startMs, through);
      const expected = {
        sequence: chunk.sequence,
        startMs: through,
        endMs: through + validated.durationMs,
        saved: true,
      };
      assert.deepEqual(
        await service.upload(
          "owner",
          id,
          chunk.sequence,
          chunk.startMs,
          bytes,
          chunk.gameId,
        ),
        expected,
      );
      assert.deepEqual(
        await service.upload(
          "owner",
          id,
          chunk.sequence,
          chunk.startMs,
          bytes,
          chunk.gameId,
        ),
        expected,
      );
      await assert.rejects(
        () =>
          service.upload(
            "owner",
            id,
            chunk.sequence,
            chunk.startMs,
            bytes,
            "fuseos",
          ),
        /conflict/,
      );
      const stored = await database.read(segmentKey(id, chunk.sequence));
      assert.equal(
        stored?.kind === "segment" ? stored.gameId : undefined,
        chunk.gameId,
      );
      assert.equal(chunk.endMs, expected.endMs);
      through = chunk.endMs;
      samples += (bytes.length - 44) / 2;
      assert.equal((await service.recording(id)).durationMs, through);
    }
    assert.equal(samples, rate * 10 + 8 + 30 * 128);
  }
});
