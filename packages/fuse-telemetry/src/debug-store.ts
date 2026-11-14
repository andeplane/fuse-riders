import type {
  RecordingSummary,
  ReportView,
  SegmentView,
} from "./debug-contracts.js";

export interface RecordingRecord extends RecordingSummary {
  kind: "recording";
  owner: string;
  fingerprint: string;
  mediaExpiresAt: number;
}
export interface ReportRecord extends ReportView {
  kind: "report";
  fingerprint: string;
  screenshotKey?: string;
  screenshotGeneration?: string;
  mediaExpiresAt: number;
  expiresAt: number;
  ready: boolean;
}
export interface SegmentRecord extends SegmentView {
  kind: "segment";
  recordingId: string;
  owner: string;
  checksum: string;
  objectKey: string;
  generation?: string;
  bytes: number;
  attempts: number;
  lease: number;
  leaseUntil: number;
  expiresAt: number;
  mediaExpiresAt: number;
  actionsComplete?: boolean;
}
export interface LimitRecord {
  kind: "limit";
  sessions: number;
  durationMs: number;
  reports: number;
  expiresAt: number;
}
export type DebugRecord =
  RecordingRecord | ReportRecord | SegmentRecord | LimitRecord;
export interface DebugMutation<T> {
  writes?: ReadonlyMap<string, DebugRecord>;
  result: T;
}
export interface DebugDatabase {
  /** Atomically read all keys before writes. Callbacks may be retried and must have no side effects. */
  transact<T>(
    keys: readonly string[],
    operation: (records: ReadonlyMap<string, DebugRecord>) => DebugMutation<T>,
  ): Promise<T>;
  read(key: string): Promise<DebugRecord | undefined>;
  /** Bounded keyset pagination. Implementations must order by document id. */
  list(
    kind: "recording" | "report" | "segment",
    prefix: string,
    after: string | undefined,
    limit: number,
    recordingId?: string,
  ): Promise<{ key: string; value: DebugRecord }[]>;
}
export const recordingKey = (id: string): string => `recording:${id}`;
export const reportKey = (id: string): string => `report:${id}`;
export const segmentKey = (id: string, sequence: number): string =>
  `segment:${id}:${String(sequence).padStart(4, "0")}`;

/** Fail closed on corrupt local files or incompatible database documents. */
export function storedDebugRecord(value: unknown): DebugRecord | undefined {
  if (value === undefined || value === null) return;
  if (
    typeof value !== "object" ||
    !("kind" in value) ||
    !("expiresAt" in value) ||
    !Number.isSafeInteger(value.expiresAt)
  )
    throw new Error("Invalid debug metadata");
  const record = value as DebugRecord;
  const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
    Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
  const text = (v: unknown, max: number): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= max;
  const uuid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      v,
    );
  const hash = (v: unknown): v is string =>
    typeof v === "string" && /^[\da-f]{64}$/.test(v);
  if (!["recording", "report", "segment", "limit"].includes(record.kind))
    throw new Error("Invalid debug metadata kind");
  if (
    record.kind === "recording" &&
    (!uuid(record.id) ||
      !text(record.owner, 128) ||
      !text(record.gameId, 80) ||
      !hash(record.fingerprint) ||
      !integer(record.startedAt) ||
      !integer(record.lastUploadAt) ||
      !integer(record.durationMs, 7_200_000) ||
      !integer(record.bytes, 400 * 1024 * 1024) ||
      !integer(record.mediaExpiresAt) ||
      !["recording", "finished"].includes(record.status))
  )
    throw new Error("Invalid recording metadata");
  if (
    record.kind === "segment" &&
    (!uuid(record.recordingId) ||
      !text(record.owner, 128) ||
      !hash(record.checksum) ||
      !integer(record.sequence, 719) ||
      record.objectKey !==
        `recordings/${record.recordingId}/${record.sequence}.wav` ||
      !integer(record.startMs, 7_200_000) ||
      !integer(record.endMs, 7_200_000) ||
      record.endMs <= record.startMs ||
      record.endMs - record.startMs > 10_000 ||
      !integer(record.bytes, 2 * 1024 * 1024) ||
      !integer(record.attempts) ||
      !integer(record.lease) ||
      !integer(record.leaseUntil) ||
      !integer(record.mediaExpiresAt) ||
      !["pending", "processing", "complete", "failed"].includes(
        record.status,
      ) ||
      (record.transcript !== undefined &&
        (typeof record.transcript !== "string" ||
          record.transcript.length > 32_000)) ||
      (record.error !== undefined && !text(record.error, 256)) ||
      (record.generation !== undefined && !text(record.generation, 128)) ||
      (record.gameId !== undefined && !text(record.gameId, 80)) ||
      (record.actionsComplete !== undefined &&
        typeof record.actionsComplete !== "boolean"))
  )
    throw new Error("Invalid segment metadata");
  if (
    record.kind === "report" &&
    (!uuid(record.id) ||
      !text(record.gameId, 80) ||
      !text(record.text, 8000) ||
      !hash(record.fingerprint) ||
      !integer(record.createdAt) ||
      !integer(record.receivedAt) ||
      !integer(record.mediaExpiresAt) ||
      typeof record.ready !== "boolean" ||
      !["bug", "feature", "idea", "other"].includes(record.category) ||
      (record.recordingId !== undefined &&
        (!uuid(record.recordingId) || !integer(record.offsetMs, 7_200_000))) ||
      (record.screenshotKey !== undefined &&
        record.screenshotKey !== `screenshots/${record.id}`) ||
      (record.screenshotGeneration !== undefined &&
        !text(record.screenshotGeneration, 128)))
  )
    throw new Error("Invalid report metadata");
  if (
    record.kind === "limit" &&
    (!integer(record.sessions) ||
      !integer(record.durationMs) ||
      !integer(record.reports))
  )
    throw new Error("Invalid debug quota metadata");
  return record;
}
