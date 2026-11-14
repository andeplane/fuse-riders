/** Private explicit-action proposals. Extraction never starts work automatically. */
export type ActionStatus =
  "proposed" | "claimed" | "done" | "dismissed" | "retracted";
export interface ActionEvidence {
  sequence: number;
  startMs: number;
  endMs: number;
  /** Exact spoken text, never a model paraphrase. Chunk precision only. */
  quote: string;
  reportIds: string[];
}
export interface ActionItem {
  id: string;
  recordingId: string;
  gameId: string;
  title: string;
  detail: string;
  evidence: ActionEvidence[];
  status: ActionStatus;
  createdAt: number;
  updatedAt: number;
  revision: number;
  lease: {
    ownerId: string;
    agentName: string;
    expiresAt: number;
    revision: number;
  } | null;
  resolution: { note: string; at: number; ownerId: string } | null;
  /** Retractions remain visible even when execution was already claimed or completed. */
  retraction: ActionEvidence | null;
  correction: {
    title: string;
    detail: string;
    evidence: ActionEvidence[];
    revision: number;
  } | null;
}
export interface ActionsQuery {
  recordingId?: string;
  gameId?: string;
  since?: number;
  status?: ActionStatus;
  cursor?: string;
  limit?: number;
}
export interface ActionsPage {
  actions: ActionItem[];
  nextCursor?: string;
  /** Bounded scans may return an empty page with a continuation. */
  scannedRecordings: number;
}
export interface ActionClaimRequest {
  agentName: string;
  leaseMs?: number;
}
export interface ActionLeaseRequest {
  token: string;
  leaseMs?: number;
}
export interface ActionCompleteRequest {
  token: string;
  note: string;
}
export interface ActionClaimResponse {
  action: ActionItem;
  token: string;
}
export interface TranscriptActionSegment {
  gameId?: string;
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
  reportIds?: string[];
}
export interface TranscriptActionInput extends TranscriptActionSegment {
  recordingId: string;
  gameId: string;
}
export interface TranscriptActionHook {
  process(input: TranscriptActionInput): Promise<void>;
}
export const ACTION_LIMITS = {
  perRecording: 128,
  segments: 720,
  transcriptChars: 12_000,
  contextChars: 6_000,
  candidates: 8,
  quoteChars: 500,
  titleChars: 140,
  detailChars: 600,
  evidence: 4,
  leaseMs: 5 * 60_000,
  maxLeaseMs: 30 * 60_000,
  retentionMs: 365 * 86400_000,
} as const;
