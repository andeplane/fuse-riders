/** Private playtest wire contracts; timestamps and offsets are milliseconds. */
export type ReportCategory = "bug" | "feature" | "idea" | "other";
export interface ReportSubmission {
  id: string;
  gameId: string;
  category: ReportCategory;
  text: string;
  createdAt: number;
  screenshot?: { mime: "image/png" | "image/jpeg"; base64: string };
  recordingId?: string;
  offsetMs?: number;
}
export interface ReportAcknowledgement {
  id: string;
  receivedAt: number;
}
export interface RecordingSubmission {
  id: string;
  gameId: string;
  startedAt: number;
}
export interface RecordingSummary {
  id: string;
  gameId: string;
  startedAt: number;
  lastUploadAt: number;
  status: "recording" | "finished";
  durationMs: number;
  bytes: number;
  expiresAt: number;
}
export interface SegmentAcknowledgement {
  sequence: number;
  startMs: number;
  endMs: number;
  saved: true;
}
export interface SegmentView {
  gameId?: string;
  sequence: number;
  startMs: number;
  endMs: number;
  status: "pending" | "processing" | "complete" | "failed";
  transcript?: string;
  error?: string;
  audioUrl?: string;
}
export interface ReportView extends Omit<ReportSubmission, "screenshot"> {
  receivedAt: number;
  screenshotUrl?: string;
}
export interface ReportsPage {
  reports: ReportView[];
  nextCursor?: string;
}
export interface RecordingsPage {
  recordings: RecordingSummary[];
  nextCursor?: string;
}
export interface RecordingDetail {
  recording: RecordingSummary;
  segments: SegmentView[];
  reports: ReportView[];
  transcript: string;
  reportsNextCursor?: string;
}
export const DEBUG_LIMITS = {
  segmentBytes: 2 * 1024 * 1024,
  screenshotBytes: 2 * 1024 * 1024,
  segmentMs: 10_000,
  recordingMs: 2 * 60 * 60 * 1000,
  recordingSegments: 720,
  recordingBytes: 400 * 1024 * 1024,
  dailyRecordingMs: 2 * 60 * 60 * 1000,
  dailySessions: 20,
  dailyReports: 50,
  mediaRetentionMs: 30 * 86400_000,
  textRetentionMs: 365 * 86400_000,
} as const;
