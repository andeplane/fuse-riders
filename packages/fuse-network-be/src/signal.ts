/** Signalling payload boundary enforced by RoomGateway, in Cloud Run and in the local room service; only SDP and ICE shapes pass. */
export function validSignal(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const signal = raw as Record<string, unknown>;
  if (Object.keys(signal).length !== 1) return false;
  if (signal.description && typeof signal.description === "object") {
    const d = signal.description as Record<string, unknown>;
    return (
      typeof d.type === "string" &&
      ["offer", "answer"].includes(d.type) &&
      typeof d.sdp === "string" &&
      d.sdp.length <= 30_000 &&
      Object.keys(d).every((k) => ["type", "sdp"].includes(k))
    );
  }
  if (signal.candidate && typeof signal.candidate === "object") {
    // Chrome and Safari toJSON(): candidate (empty string marks end-of-candidates for a section), sdpMid, sdpMLineIndex, usernameFragment; null fields allowed.
    const c = signal.candidate as Record<string, unknown>;
    return (
      typeof c.candidate === "string" &&
      c.candidate.length <= 2048 &&
      Object.keys(c).every((k) =>
        ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"].includes(
          k,
        ),
      ) &&
      (c.sdpMid == null || typeof c.sdpMid === "string") &&
      (c.sdpMLineIndex == null ||
        (Number.isSafeInteger(c.sdpMLineIndex) &&
          Number(c.sdpMLineIndex) >= 0)) &&
      (c.usernameFragment == null || typeof c.usernameFragment === "string")
    );
  }
  return false;
}
