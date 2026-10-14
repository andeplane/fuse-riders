/** Redacted operational telemetry. No SDP, addresses, names, tokens or arbitrary error strings. */
export interface LinkReport {
  peerId: string;
  connectionId: string;
  offerer: boolean;
  healthy: boolean;
  ageMs: number;
  ice: string;
  connection: string;
  gathering: string;
  signaling: string;
  channel: string;
  local: Record<string, number>;
  remote: Record<string, number>;
  signalling: Record<string, number>;
  attempts: number;
}
export interface LinkReportFrame {
  type: "link-report";
  version: 1;
  hidden: boolean;
  links: LinkReport[];
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const count = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= 1_000_000_000;
const candidateTypes = ["host", "srflx", "prflx", "relay", "end", "unknown"];
const signalCounts = [
  "descriptions",
  "candidates",
  "applied",
  "buffered",
  "rejected",
  "dropped",
  "offersOut",
  "offersIn",
  "answersOut",
  "answersIn",
  "candidatesOut",
  "relayFailed",
];
function counts(
  value: unknown,
  keys: string[],
): Record<string, number> | undefined {
  const raw = object(value);
  if (!raw) return undefined;
  const result: Record<string, number> = {};
  for (const key of keys) {
    if (raw[key] === undefined) continue;
    if (!count(raw[key])) return undefined;
    result[key] = raw[key];
  }
  return result;
}
/** Reconstruct an allowlisted record: untrusted extra properties can never become log fields. */
export function readLinkReport(value: unknown): LinkReportFrame | undefined {
  const raw = object(value);
  if (
    !raw ||
    raw.type !== "link-report" ||
    raw.version !== 1 ||
    typeof raw.hidden !== "boolean" ||
    !Array.isArray(raw.links) ||
    raw.links.length > 10
  )
    return undefined;
  const links: LinkReport[] = [];
  for (const item of raw.links) {
    const link = object(item);
    if (
      !link ||
      typeof link.peerId !== "string" ||
      !/^[a-f0-9]{24}$/.test(link.peerId) ||
      typeof link.connectionId !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(link.connectionId) ||
      typeof link.offerer !== "boolean" ||
      typeof link.healthy !== "boolean" ||
      !count(link.ageMs) ||
      !count(link.attempts) ||
      link.attempts > 4
    )
      return undefined;
    const allowed: Record<string, string[]> = {
      ice: [
        "new",
        "checking",
        "connected",
        "completed",
        "disconnected",
        "failed",
        "closed",
      ],
      connection: [
        "new",
        "connecting",
        "connected",
        "disconnected",
        "failed",
        "closed",
      ],
      gathering: ["new", "gathering", "complete"],
      signaling: [
        "stable",
        "have-local-offer",
        "have-remote-offer",
        "have-local-pranswer",
        "have-remote-pranswer",
        "closed",
      ],
    };
    for (const [key, states] of Object.entries(allowed))
      if (typeof link[key] !== "string" || !states.includes(link[key]))
        return undefined;
    if (
      typeof link.channel !== "string" ||
      !/^(drained|(?:none|connecting|open|closing|closed)\/(?:none|connecting|open|closing|closed))$/.test(
        link.channel,
      )
    )
      return undefined;
    const local = counts(link.local, candidateTypes),
      remote = counts(link.remote, candidateTypes),
      signalling = counts(link.signalling, signalCounts);
    if (!local || !remote || !signalling) return undefined;
    links.push({
      peerId: link.peerId,
      connectionId: link.connectionId,
      offerer: link.offerer,
      healthy: link.healthy,
      ageMs: link.ageMs,
      attempts: link.attempts,
      ice: link.ice as string,
      connection: link.connection as string,
      gathering: link.gathering as string,
      signaling: link.signaling as string,
      channel: link.channel,
      local,
      remote,
      signalling,
    });
  }
  return { type: "link-report", version: 1, hidden: raw.hidden, links };
}
