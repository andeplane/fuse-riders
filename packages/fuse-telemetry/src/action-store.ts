import type { ActionItem } from "./action-contracts.js";
import { ACTION_LIMITS } from "./action-contracts.js";
export interface ActionState {
  recordingId: string;
  gameId: string;
  items: ActionItem[];
  processed: Record<string, string>;
  leaseSecrets: Record<string, string>;
  extractionLease: { token: string; expiresAt: number } | null;
  expiresAt: number;
}
export interface ActionAgentToken {
  id: string;
  hash: string;
  ownerId: string;
  recordingId: string | null;
  gameId: string | null;
  expiresAt: number;
  revoked: boolean;
}
export interface ActionDatabase {
  /** Must serialize competing transactions across processes/instances. Callback has no side effects. */
  transact<T>(
    recordingId: string,
    update: (current: ActionState | undefined) => {
      state?: ActionState;
      result: T;
    },
  ): Promise<T>;
  read(recordingId: string): Promise<ActionState | undefined>;
  list(after: string | undefined, limit: number): Promise<ActionState[]>;
  putToken(token: ActionAgentToken): Promise<void>;
  readToken(id: string): Promise<ActionAgentToken | undefined>;
  revokeToken(id: string, ownerId: string): Promise<boolean>;
}
export const actionIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{1,100}$/.test(value) &&
  !/^__.*__$/.test(value);
const actionItemIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{1,100}_[a-f0-9]{16}$/.test(value);
const ownerIdentifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const integer = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0;
/** Reject corrupt persisted documents rather than expose them or restore partial state. */
export function validateActionState(value: unknown): ActionState | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== "object")
    throw new Error("Invalid action state");
  const state = value as ActionState;
  if (
    Buffer.byteLength(JSON.stringify(state)) > 500_000 ||
    !actionIdentifier(state.recordingId) ||
    !actionIdentifier(state.gameId) ||
    !integer(state.expiresAt) ||
    !Array.isArray(state.items) ||
    state.items.length > ACTION_LIMITS.perRecording ||
    !state.leaseSecrets ||
    typeof state.leaseSecrets !== "object" ||
    Object.keys(state.leaseSecrets).length > ACTION_LIMITS.perRecording ||
    !state.processed ||
    typeof state.processed !== "object" ||
    Object.keys(state.processed).length > ACTION_LIMITS.segments ||
    !Object.entries(state.processed).every(
      ([key, hash]) =>
        /^\d{1,3}$/.test(key) &&
        Number(key) < ACTION_LIMITS.segments &&
        /^[a-f0-9]{64}$/.test(hash),
    ) ||
    !(
      state.extractionLease === null ||
      (actionIdentifier(state.extractionLease?.token) &&
        integer(state.extractionLease.expiresAt))
    )
  )
    throw new Error("Invalid action state or metadata capacity exceeded");
  const ids = new Set<string>();
  for (const item of state.items) {
    if (
      !actionItemIdentifier(item.id) ||
      !item.id.startsWith(`${state.recordingId}_`) ||
      ids.has(item.id) ||
      item.recordingId !== state.recordingId ||
      !actionIdentifier(item.gameId) ||
      typeof item.title !== "string" ||
      !item.title ||
      item.title.length > ACTION_LIMITS.titleChars ||
      typeof item.detail !== "string" ||
      !item.detail ||
      item.detail.length > ACTION_LIMITS.detailChars ||
      !["proposed", "claimed", "done", "dismissed", "retracted"].includes(
        item.status,
      ) ||
      !integer(item.createdAt) ||
      !integer(item.updatedAt) ||
      !integer(item.revision) ||
      !Array.isArray(item.evidence) ||
      item.evidence.length < 1 ||
      item.evidence.length > ACTION_LIMITS.evidence ||
      (item.status === "claimed") !== (item.lease !== null)
    )
      throw new Error("Invalid action item");
    ids.add(item.id);
    if (
      item.correction !== null &&
      (!item.correction ||
        typeof item.correction.title !== "string" ||
        item.correction.title.length > ACTION_LIMITS.titleChars ||
        typeof item.correction.detail !== "string" ||
        item.correction.detail.length > ACTION_LIMITS.detailChars ||
        !integer(item.correction.revision) ||
        !Array.isArray(item.correction.evidence) ||
        item.correction.evidence.length > ACTION_LIMITS.evidence)
    )
      throw new Error("Invalid action correction");
    for (const proof of [
      ...item.evidence,
      ...(item.retraction ? [item.retraction] : []),
      ...(item.correction?.evidence ?? []),
    ])
      if (
        !integer(proof.sequence) ||
        proof.sequence >= ACTION_LIMITS.segments ||
        !integer(proof.startMs) ||
        !integer(proof.endMs) ||
        proof.endMs <= proof.startMs ||
        typeof proof.quote !== "string" ||
        !proof.quote ||
        proof.quote.length > ACTION_LIMITS.quoteChars ||
        !Array.isArray(proof.reportIds) ||
        proof.reportIds.length > 20 ||
        !proof.reportIds.every(actionIdentifier)
      )
        throw new Error("Invalid action evidence");
    if (
      item.lease !== null &&
      (!ownerIdentifier(item.lease.ownerId) ||
        !actionIdentifier(state.leaseSecrets[item.id]) ||
        !integer(item.lease.expiresAt) ||
        !integer(item.lease.revision) ||
        typeof item.lease.agentName !== "string" ||
        item.lease.agentName.length > 80)
    )
      throw new Error("Invalid action lease");
    if (
      item.resolution !== null &&
      (!integer(item.resolution.at) ||
        !ownerIdentifier(item.resolution.ownerId) ||
        typeof item.resolution.note !== "string" ||
        item.resolution.note.length > 1000)
    )
      throw new Error("Invalid action resolution");
  }
  return structuredClone(state);
}
export function validateActionToken(
  value: unknown,
): ActionAgentToken | undefined {
  if (value === undefined) return;
  const token = value as ActionAgentToken;
  if (
    !token ||
    !actionIdentifier(token.id) ||
    !ownerIdentifier(token.ownerId) ||
    !/^[a-f0-9]{64}$/.test(token.hash) ||
    !integer(token.expiresAt) ||
    typeof token.revoked !== "boolean" ||
    !(token.recordingId === null || actionIdentifier(token.recordingId)) ||
    !(token.gameId === null || actionIdentifier(token.gameId)) ||
    (!token.recordingId && !token.gameId)
  )
    throw new Error("Invalid agent token");
  return structuredClone(token);
}
