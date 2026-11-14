import type { IncomingMessage, ServerResponse } from "node:http";
import { OAuth2Client } from "google-auth-library";
import { RoomError } from "fuse-network-be";
import { debugAssert, DebugService, checksum } from "./debug-service.js";
import { recordingKey, segmentKey, type SegmentRecord } from "./debug-store.js";
import {
  TranscriptionFailure,
  type AudioTranscriber,
  type FinalizedAudio,
  type TranscriptHook,
} from "./transcription.js";

export interface TranscriptionWorkerOptions {
  service: DebugService;
  transcriber: AudioTranscriber;
  bucket: string;
  afterTranscript?: TranscriptHook;
  leaseMs?: number;
  maxAttempts?: number;
}
export class TranscriptionWorker {
  constructor(private options: TranscriptionWorkerOptions) {}
  async process(event: FinalizedAudio): Promise<void> {
    if (event.bucket !== this.options.bucket) return;
    const match = /^recordings\/([\da-f-]{36})\/(\d{1,3})\.wav$/i.exec(
      event.name,
    );
    if (!match || !/^\d+$/.test(event.generation)) return;
    const id = match[1]!,
      sequence = Number(match[2]),
      key = segmentKey(id, sequence),
      rkey = recordingKey(id),
      { service } = this.options,
      now = service.now();
    const acquired = await service.database.transact([key, rkey], (records) => {
      const segment = records.get(key),
        recording = records.get(rkey);
      // Unknown events and replaced generations have no authority to create metadata.
      if (
        segment?.kind !== "segment" ||
        recording?.kind !== "recording" ||
        segment.objectKey !== event.name ||
        segment.owner !== recording.owner ||
        segment.expiresAt <= now ||
        segment.mediaExpiresAt <= now ||
        recording.expiresAt <= now ||
        (segment.generation && segment.generation !== event.generation) ||
        segment.status === "failed" ||
        segment.actionsComplete
      )
        return { result: undefined };
      debugAssert(segment.leaseUntil <= now, 503, "Transcription lease busy");
      const next: SegmentRecord = {
        ...segment,
        generation: event.generation,
        lease: segment.lease + 1,
        leaseUntil: now + (this.options.leaseMs ?? 600_000),
        status: segment.transcript === undefined ? "processing" : "complete",
        attempts: segment.attempts + (segment.transcript === undefined ? 1 : 0),
      };
      return {
        writes: new Map([[key, next]]),
        result: { segment: next, gameId: next.gameId ?? recording.gameId },
      };
    });
    if (!acquired) return;
    const { segment, gameId } = acquired,
      lease = segment.lease;
    const update = async (
      operation: (current: SegmentRecord) => SegmentRecord,
    ) =>
      service.database.transact([key], (records) => {
        const current = records.get(key);
        debugAssert(
          current?.kind === "segment" && current.lease === lease,
          503,
          "Transcription lease replaced",
        );
        const next = operation(current);
        return { writes: new Map([[key, next]]), result: next };
      });
    let savedTranscript = segment.transcript !== undefined;
    try {
      let text = segment.transcript;
      if (text === undefined) {
        if (segment.attempts > (this.options.maxAttempts ?? 8))
          throw new TranscriptionFailure(
            "Transcription retry limit reached",
            true,
          );
        const object = await service.objects.get(event.name, event.generation);
        if (!object)
          throw new TranscriptionFailure("Audio object unavailable", false);
        if (
          checksum(object.bytes) !== segment.checksum ||
          object.mime !== "audio/wav"
        )
          throw new TranscriptionFailure("Audio checksum mismatch", true);
        text = await this.options.transcriber.transcribe(object.bytes);
        if (typeof text !== "string" || text.length > 32_000)
          throw new TranscriptionFailure(
            "Invalid transcription response",
            true,
          );
        await update((current) => ({
          ...current,
          transcript: text,
          status: "complete",
        }));
        savedTranscript = true;
      }
      if (this.options.afterTranscript)
        await this.options.afterTranscript({
          recordingId: id,
          gameId,
          sequence,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text,
        });
      await update((current) => {
        const { error: _error, ...rest } = current;
        return {
          ...rest,
          actionsComplete: true,
          leaseUntil: 0,
          status: "complete",
        };
      });
    } catch (error) {
      const permanent =
        error instanceof TranscriptionFailure && error.permanent;
      await update((current) => ({
        ...current,
        leaseUntil: 0,
        status:
          current.transcript !== undefined
            ? "complete"
            : permanent
              ? "failed"
              : "pending",
        error: permanent ? error.message : "Processing will retry",
      }));
      if (!permanent || savedTranscript)
        throw new RoomError(503, "Transcription delivery must retry");
    }
  }
}

/** Signed Pub/Sub OIDC token, restricted to the dedicated push service account and exact audience. */
export function createWorkerVerifier(
  audience: string,
  serviceAccountEmail: string,
  client = new OAuth2Client(),
): (req: IncomingMessage) => Promise<boolean> {
  if (!audience || !serviceAccountEmail)
    throw new Error("Worker identity must be configured");
  return async (req) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return false;
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience });
      const payload = ticket.getPayload();
      return (
        payload?.email === serviceAccountEmail &&
        payload.email_verified === true &&
        (payload.iss === "https://accounts.google.com" ||
          payload.iss === "accounts.google.com")
      );
    } catch {
      return false;
    }
  };
}
export async function readDebugBody(
  req: IncomingMessage,
  max: number,
): Promise<Buffer> {
  const declared = req.headers["content-length"];
  debugAssert(
    declared === undefined ||
      (/^\d+$/.test(declared) && Number(declared) <= max),
    413,
    "Request too large",
  );
  const chunks: Buffer[] = [];
  let size = 0;
  const deadline = setTimeout(
    () => req.destroy(new RoomError(408, "Upload deadline exceeded")),
    30_000,
  );
  deadline.unref();
  try {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      debugAssert(size <= max, 413, "Request too large");
      chunks.push(bytes);
    }
  } finally {
    clearTimeout(deadline);
  }
  return Buffer.concat(chunks);
}
export function transcriptionWorkerHttp(
  worker: TranscriptionWorker,
  verify: (req: IncomingMessage) => Promise<boolean>,
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    if (
      new URL(req.url ?? "/", "http://worker").pathname !==
      "/api/internal/transcription"
    )
      return false;
    debugAssert(req.method === "POST", 405);
    debugAssert(await verify(req), 401, "Worker identity required");
    let value: unknown;
    try {
      value = JSON.parse((await readDebugBody(req, 32_768)).toString());
    } catch (error) {
      if (error instanceof RoomError) throw error;
      throw new RoomError(400, "Invalid queue payload");
    }
    debugAssert(
      !!value &&
        typeof value === "object" &&
        "message" in value &&
        !!value.message &&
        typeof value.message === "object" &&
        "data" in value.message &&
        typeof value.message.data === "string",
    );
    let event: unknown;
    try {
      event = JSON.parse(Buffer.from(value.message.data, "base64").toString());
    } catch {
      throw new RoomError(400, "Invalid object event");
    }
    debugAssert(
      !!event &&
        typeof event === "object" &&
        "bucket" in event &&
        typeof event.bucket === "string" &&
        "name" in event &&
        typeof event.name === "string" &&
        "generation" in event &&
        typeof event.generation === "string",
    );
    await worker.process({
      bucket: event.bucket,
      name: event.name,
      generation: event.generation,
    });
    res.writeHead(204);
    res.end();
    return true;
  };
}
