import { createHash } from "node:crypto";
import { RoomError } from "fuse-network-be";
import {
  DEBUG_LIMITS as L,
  type RecordingSubmission,
  type RecordingSummary,
  type ReportSubmission,
  type ReportView,
  type RecordingDetail,
} from "./debug-contracts.js";
import {
  recordingKey,
  reportKey,
  segmentKey,
  type DebugDatabase,
  type DebugRecord,
  type RecordingRecord,
  type ReportRecord,
  type SegmentRecord,
  type LimitRecord,
} from "./debug-store.js";
import type { PrivateObjectStorage } from "./storage.js";

export const debugUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0;
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function debugAssert(
  condition: unknown,
  status = 400,
  message = "Invalid playtest request",
): asserts condition {
  if (!condition) throw new RoomError(status, message);
}
export const checksum = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
function ofKind<K extends DebugRecord["kind"]>(
  value: DebugRecord | undefined,
  kind: K,
): Extract<DebugRecord, { kind: K }> | undefined {
  return value?.kind === kind
    ? (value as Extract<DebugRecord, { kind: K }>)
    : undefined;
}
function live<T extends DebugRecord>(
  value: T | undefined,
  now: number,
): T | undefined {
  return value && value.expiresAt > now ? value : undefined;
}
function quota(value: DebugRecord | undefined, now: number): LimitRecord {
  return (
    ofKind(live(value, now), "limit") ?? {
      kind: "limit",
      sessions: 0,
      durationMs: 0,
      reports: 0,
      expiresAt: now + 2 * 86400_000,
    }
  );
}
export function recordingSummary(r: RecordingRecord): RecordingSummary {
  const {
    id,
    gameId,
    startedAt,
    lastUploadAt,
    status,
    durationMs,
    bytes,
    expiresAt,
  } = r;
  return {
    id,
    gameId,
    startedAt,
    lastUploadAt,
    status,
    durationMs,
    bytes,
    expiresAt,
  };
}
export function reportView(r: ReportRecord, now: number): ReportView {
  const {
    id,
    gameId,
    category,
    text,
    createdAt,
    receivedAt,
    recordingId,
    offsetMs,
  } = r;
  return {
    id,
    gameId,
    category,
    text,
    createdAt,
    receivedAt,
    ...(recordingId ? { recordingId, offsetMs } : {}),
    ...(r.screenshotKey && r.ready && r.mediaExpiresAt > now
      ? { screenshotUrl: `/api/dev/reports/${id}/screenshot` }
      : {}),
  };
}

/** Strict canonical PCM16 mono WAV. No claimed MIME/duration can bypass sample counting. */
export function validateWav(bytes: Uint8Array): {
  durationMs: number;
  sampleRate: number;
} {
  debugAssert(
    bytes.byteLength >= 46 && bytes.byteLength <= L.segmentBytes,
    413,
    "Audio size outside bounds",
  );
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  debugAssert(
    b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WAVE" &&
      b.readUInt32LE(4) === b.length - 8,
  );
  let offset = 12,
    sampleRate = 0,
    dataBytes = 0,
    format = false,
    data = false;
  while (offset + 8 <= b.length) {
    const tag = b.toString("ascii", offset, offset + 4),
      length = b.readUInt32LE(offset + 4),
      start = offset + 8;
    debugAssert(start + length <= b.length);
    if (tag === "fmt ") {
      debugAssert(
        !format &&
          length === 16 &&
          b.readUInt16LE(start) === 1 &&
          b.readUInt16LE(start + 2) === 1 &&
          b.readUInt16LE(start + 14) === 16 &&
          b.readUInt16LE(start + 12) === 2,
      );
      sampleRate = b.readUInt32LE(start + 4);
      debugAssert(
        sampleRate >= 8000 &&
          sampleRate <= 96000 &&
          b.readUInt32LE(start + 8) === sampleRate * 2,
      );
      format = true;
    } else if (tag === "data") {
      debugAssert(!data && length > 0 && length % 2 === 0);
      dataBytes = length;
      data = true;
    } else debugAssert(false, 400, "Unsupported WAV chunk");
    offset = start + length + (length % 2);
  }
  debugAssert(
    format && data && offset === b.length && dataBytes / 2 <= sampleRate * 10,
  );
  return {
    sampleRate,
    durationMs: Math.round((dataBytes / 2 / sampleRate) * 1000),
  };
}

export interface DebugServiceOptions {
  database: DebugDatabase;
  objects: PrivateObjectStorage;
  gameIds: ReadonlySet<string>;
  now: () => number;
}
export class DebugService {
  readonly database: DebugDatabase;
  readonly objects: PrivateObjectStorage;
  constructor(private options: DebugServiceOptions) {
    this.database = options.database;
    this.objects = options.objects;
  }
  now(): number {
    return this.options.now();
  }
  private validGame(v: unknown): v is string {
    return typeof v === "string" && this.options.gameIds.has(v);
  }
  private validTime(v: unknown): v is number {
    return (
      integer(v) && v <= this.now() + 300_000 && v >= this.now() - 7 * 86400_000
    );
  }
  async createRecording(
    owner: string,
    input: unknown,
  ): Promise<RecordingSummary> {
    debugAssert(
      plain(input) &&
        debugUuid(input.id) &&
        this.validGame(input.gameId) &&
        this.validTime(input.startedAt),
    );
    const body: RecordingSubmission = {
      id: input.id,
      gameId: input.gameId,
      startedAt: input.startedAt,
    };
    const now = this.now(),
      key = recordingKey(body.id),
      day = `limit:record:${checksum(owner)}:${Math.floor(now / 86400_000)}`,
      fingerprint = checksum(JSON.stringify(body));
    return this.database.transact([key, day], (records) => {
      const current = ofKind(records.get(key), "recording");
      if (current) {
        debugAssert(
          current.owner === owner && current.fingerprint === fingerprint,
          409,
          "Recording id conflict",
        );
        debugAssert(current.expiresAt > now, 410, "Recording expired");
        return { result: recordingSummary(current) };
      }
      const q = quota(records.get(day), now);
      debugAssert(
        q.sessions < L.dailySessions,
        429,
        "Daily recording session limit reached",
      );
      const record: RecordingRecord = {
        kind: "recording",
        ...body,
        owner,
        fingerprint,
        lastUploadAt: now,
        status: "recording",
        durationMs: 0,
        bytes: 0,
        expiresAt: now + L.textRetentionMs,
        mediaExpiresAt: now + L.mediaRetentionMs,
      };
      return {
        writes: new Map<string, DebugRecord>([
          [key, record],
          [day, { ...q, sessions: q.sessions + 1 }],
        ]),
        result: recordingSummary(record),
      };
    });
  }
  async recording(id: string): Promise<RecordingRecord> {
    debugAssert(debugUuid(id));
    const record = ofKind(
      live(await this.database.read(recordingKey(id)), this.now()),
      "recording",
    );
    debugAssert(record, 404, "Recording not found");
    return record;
  }
  async upload(
    owner: string,
    id: string,
    sequence: number,
    startMs: number,
    bytes: Uint8Array,
    gameId?: string,
  ) {
    debugAssert(
      debugUuid(id) &&
        integer(sequence) &&
        sequence < L.recordingSegments &&
        integer(startMs),
    );
    const { durationMs } = validateWav(bytes),
      endMs = startMs + durationMs;
    debugAssert(gameId === undefined || this.validGame(gameId));
    debugAssert(
      durationMs > 0 &&
        endMs <= L.recordingMs &&
        (sequence !== 0 || startMs === 0),
    );
    const now = this.now(),
      rkey = recordingKey(id),
      skey = segmentKey(id, sequence),
      previous = segmentKey(id, sequence - 1),
      next = segmentKey(id, sequence + 1),
      day = `limit:audio:${checksum(owner)}:${Math.floor(now / 86400_000)}`,
      hash = checksum(bytes),
      objectKey = `recordings/${id}/${sequence}.wav`;
    const segment = await this.database.transact(
      [rkey, skey, previous, next, day],
      (records) => {
        const recording = ofKind(live(records.get(rkey), now), "recording");
        debugAssert(
          recording && recording.owner === owner,
          403,
          "Recording owner required",
        );
        debugAssert(
          recording.mediaExpiresAt > now,
          410,
          "Recording media expired",
        );
        const existing = ofKind(records.get(skey), "segment");
        if (existing) {
          debugAssert(
            existing.checksum === hash &&
              existing.startMs === startMs &&
              existing.endMs === endMs &&
              existing.gameId === (gameId ?? recording.gameId),
            409,
            "Immutable segment conflict",
          );
          return { result: existing };
        }
        // Finish records the user's intent; already queued chunks may arrive afterwards.
        const before = ofKind(records.get(previous), "segment"),
          after = ofKind(records.get(next), "segment");
        debugAssert(
          (!before || before.endMs === startMs) &&
            (!after || after.startMs === endMs),
          409,
          "Segment timeline conflict",
        );
        const q = quota(records.get(day), now);
        debugAssert(
          q.durationMs + durationMs <= L.dailyRecordingMs &&
            recording.bytes + bytes.length <= L.recordingBytes,
          429,
          "Recording quota reached",
        );
        const value: SegmentRecord = {
          kind: "segment",
          recordingId: id,
          owner,
          gameId: gameId ?? recording.gameId,
          sequence,
          startMs,
          endMs,
          status: "pending",
          checksum: hash,
          objectKey,
          bytes: bytes.length,
          attempts: 0,
          lease: 0,
          leaseUntil: 0,
          expiresAt: recording.expiresAt,
          mediaExpiresAt: recording.mediaExpiresAt,
        };
        return {
          writes: new Map<string, DebugRecord>([
            [skey, value],
            [
              rkey,
              {
                ...recording,
                lastUploadAt: now,
                durationMs: Math.max(recording.durationMs, endMs),
                bytes: recording.bytes + bytes.length,
              },
            ],
            [day, { ...q, durationMs: q.durationMs + durationMs }],
          ]),
          result: value,
        };
      },
    );
    const object = await this.objects.put(objectKey, bytes, "audio/wav");
    await this.database.transact([skey], (records) => {
      const current = ofKind(records.get(skey), "segment");
      debugAssert(current && current.checksum === segment.checksum, 409);
      debugAssert(
        !current.generation || current.generation === object.generation,
        409,
      );
      return {
        writes: new Map([
          [skey, { ...current, generation: object.generation }],
        ]),
        result: undefined,
      };
    });
    return { sequence, startMs, endMs, saved: true as const };
  }
  async finish(owner: string, id: string): Promise<RecordingSummary> {
    debugAssert(debugUuid(id));
    const key = recordingKey(id),
      now = this.now();
    return this.database.transact([key], (records) => {
      const record = ofKind(live(records.get(key), now), "recording");
      debugAssert(
        record && record.owner === owner,
        403,
        "Recording owner required",
      );
      const next: RecordingRecord = { ...record, status: "finished" };
      return { writes: new Map([[key, next]]), result: recordingSummary(next) };
    });
  }
  async submitReport(
    identity: string,
    owner: string | undefined,
    input: unknown,
  ) {
    debugAssert(
      plain(input) &&
        debugUuid(input.id) &&
        this.validGame(input.gameId) &&
        ["bug", "feature", "idea", "other"].includes(String(input.category)) &&
        typeof input.text === "string" &&
        input.text.length <= 8000 &&
        input.text.trim().length > 0 &&
        this.validTime(input.createdAt),
    );
    debugAssert(
      (input.recordingId === undefined && input.offsetMs === undefined) ||
        (debugUuid(input.recordingId) &&
          integer(input.offsetMs) &&
          input.offsetMs <= L.recordingMs),
    );
    let screenshot: Uint8Array | undefined,
      mime: "image/png" | "image/jpeg" | undefined;
    if (input.screenshot !== undefined) {
      debugAssert(
        plain(input.screenshot) &&
          ["image/png", "image/jpeg"].includes(String(input.screenshot.mime)) &&
          typeof input.screenshot.base64 === "string" &&
          input.screenshot.base64.length <=
            Math.ceil(L.screenshotBytes / 3) * 4 &&
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            input.screenshot.base64,
          ),
      );
      mime = input.screenshot.mime as typeof mime;
      screenshot = Buffer.from(input.screenshot.base64, "base64");
      debugAssert(
        screenshot.length > 8 &&
          screenshot.length <= L.screenshotBytes &&
          (mime === "image/png"
            ? Buffer.from(screenshot.subarray(0, 8)).equals(
                Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
              )
            : screenshot[0] === 255 &&
              screenshot[1] === 216 &&
              screenshot[screenshot.length - 2] === 255 &&
              screenshot[screenshot.length - 1] === 217),
      );
    }
    const body: Omit<ReportSubmission, "screenshot"> = {
      id: input.id,
      gameId: input.gameId,
      category: input.category as ReportSubmission["category"],
      text: input.text,
      createdAt: input.createdAt,
      ...(typeof input.recordingId === "string"
        ? { recordingId: input.recordingId, offsetMs: input.offsetMs as number }
        : {}),
    };
    const now = this.now(),
      key = reportKey(body.id),
      day = `limit:report:${checksum(identity)}:${Math.floor(now / 86400_000)}`,
      fingerprint = checksum(
        JSON.stringify([
          body,
          screenshot ? checksum(screenshot) : null,
          mime ?? null,
        ]),
      ),
      rkey = body.recordingId ? recordingKey(body.recordingId) : undefined;
    const record = await this.database.transact(
      [key, day, ...(rkey ? [rkey] : [])],
      (records) => {
        if (rkey) {
          const recording = ofKind(live(records.get(rkey), now), "recording");
          debugAssert(
            recording && owner && recording.owner === owner,
            403,
            "Recording owner required",
          );
        }
        const current = ofKind(records.get(key), "report");
        if (current) {
          debugAssert(
            current.fingerprint === fingerprint,
            409,
            "Report id conflict",
          );
          debugAssert(current.expiresAt > now, 410);
          return { result: current };
        }
        const q = quota(records.get(day), now);
        debugAssert(
          q.reports < L.dailyReports,
          429,
          "Daily report limit reached",
        );
        const value: ReportRecord = {
          kind: "report",
          ...body,
          fingerprint,
          receivedAt: now,
          expiresAt: now + L.textRetentionMs,
          mediaExpiresAt: now + L.mediaRetentionMs,
          ready: !screenshot,
          ...(screenshot ? { screenshotKey: `screenshots/${body.id}` } : {}),
        };
        return {
          writes: new Map<string, DebugRecord>([
            [key, value],
            [day, { ...q, reports: q.reports + 1 }],
          ]),
          result: value,
        };
      },
    );
    if (screenshot && mime && record.screenshotKey) {
      const object = await this.objects.put(
        record.screenshotKey,
        screenshot,
        mime,
      );
      await this.database.transact([key], (records) => {
        const current = ofKind(records.get(key), "report");
        debugAssert(current && current.fingerprint === fingerprint, 409);
        return {
          writes: new Map([
            [
              key,
              {
                ...current,
                ready: true,
                screenshotGeneration: object.generation,
              },
            ],
          ]),
          result: undefined,
        };
      });
    }
    return { id: record.id, receivedAt: record.receivedAt };
  }
  async listReports(limit = 25, cursor?: string, recordingId?: string) {
    debugAssert(
      integer(limit) &&
        limit > 0 &&
        limit <= 50 &&
        (!cursor || /^report:[\da-f-]{36}$/i.test(cursor)) &&
        (!recordingId || debugUuid(recordingId)),
    );
    const rows = await this.database.list(
        "report",
        "report:",
        cursor,
        limit + 1,
        recordingId,
      ),
      visible = rows.slice(0, limit);
    return {
      reports: visible.flatMap(({ value }) =>
        value.kind === "report" &&
        value.ready &&
        value.expiresAt > this.now() &&
        (!recordingId || value.recordingId === recordingId)
          ? [reportView(value, this.now())]
          : [],
      ),
      ...(rows.length > limit ? { nextCursor: visible.at(-1)!.key } : {}),
    };
  }
  async listRecordings(limit = 25, cursor?: string) {
    debugAssert(
      integer(limit) &&
        limit > 0 &&
        limit <= 50 &&
        (!cursor || /^recording:[\da-f-]{36}$/i.test(cursor)),
    );
    const rows = await this.database.list(
        "recording",
        "recording:",
        cursor,
        limit + 1,
      ),
      visible = rows.slice(0, limit);
    return {
      recordings: visible.flatMap(({ value }) =>
        value.kind === "recording" && value.expiresAt > this.now()
          ? [recordingSummary(value)]
          : [],
      ),
      ...(rows.length > limit ? { nextCursor: visible.at(-1)!.key } : {}),
    };
  }
  async detail(id: string): Promise<RecordingDetail> {
    const recording = await this.recording(id),
      now = this.now();
    const rows = await this.database.list(
      "segment",
      `segment:${id}:`,
      undefined,
      L.recordingSegments,
    );
    const segments = rows.flatMap(({ value: s }) =>
      s.kind === "segment" && s.expiresAt > now
        ? [
            {
              sequence: s.sequence,
              ...(s.gameId ? { gameId: s.gameId } : {}),
              startMs: s.startMs,
              endMs: s.endMs,
              status: s.status,
              ...(s.transcript !== undefined
                ? { transcript: s.transcript }
                : {}),
              ...(s.error ? { error: s.error } : {}),
              ...(s.generation && s.mediaExpiresAt > now
                ? {
                    audioUrl: `/api/dev/recordings/${id}/segments/${s.sequence}/audio`,
                  }
                : {}),
            },
          ]
        : [],
    );
    // Reports are paginated separately; detail exposes the first bounded page explicitly via the reports list API.
    const page = await this.listReports(50, undefined, id);
    return {
      recording: recordingSummary(recording),
      segments,
      reports: page.reports,
      ...(page.nextCursor ? { reportsNextCursor: page.nextCursor } : {}),
      transcript: segments
        .filter((s) => s.transcript)
        .map((s) => `[${(s.startMs / 1000).toFixed(1)}s] ${s.transcript}`)
        .join("\n"),
    };
  }
  async audio(id: string, sequence: number) {
    await this.recording(id);
    debugAssert(integer(sequence) && sequence < L.recordingSegments);
    const segment = ofKind(
      live(await this.database.read(segmentKey(id, sequence)), this.now()),
      "segment",
    );
    debugAssert(
      segment?.generation && segment.mediaExpiresAt > this.now(),
      404,
      "Audio not found or expired",
    );
    return this.objects.get(segment.objectKey, segment.generation);
  }
  async report(id: string): Promise<ReportView> {
    debugAssert(debugUuid(id));
    const record = ofKind(
      live(await this.database.read(reportKey(id)), this.now()),
      "report",
    );
    debugAssert(record?.ready, 404, "Report not found");
    return reportView(record, this.now());
  }
  async screenshot(id: string) {
    debugAssert(debugUuid(id));
    const report = ofKind(
      live(await this.database.read(reportKey(id)), this.now()),
      "report",
    );
    debugAssert(
      report?.ready &&
        report.screenshotKey &&
        report.mediaExpiresAt > this.now(),
      404,
      "Screenshot not found or expired",
    );
    return this.objects.get(report.screenshotKey, report.screenshotGeneration);
  }
}
