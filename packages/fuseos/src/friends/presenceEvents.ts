import type {
  Buddy,
  PlayerCard,
  PresenceSnapshot,
  RoomInvite,
} from "./presenceService";

/**
 * What the tray announces: the difference between two snapshots. Derived here rather than reported by the
 * service so every implementation (live, demo) gets the same toasts, and so a test can assert them from plain data.
 */
export type PresenceEvent =
  | { type: "signed-in"; buddy: Buddy }
  | { type: "playing"; buddy: Buddy }
  | { type: "invite"; invite: RoomInvite }
  | { type: "request"; from: PlayerCard };

const present = (buddy: Buddy) =>
  buddy.status === "online" ||
  buddy.status === "away" ||
  buddy.status === "playing";

/** The events `next` brings compared with `previous`. A first load announces nothing: it is history, not news. */
export function presenceEvents(
  previous: PresenceSnapshot,
  next: PresenceSnapshot,
): PresenceEvent[] {
  if (
    !previous.loaded ||
    !next.loaded ||
    previous.mode !== next.mode ||
    previous.account.kind !== "signed-in" ||
    next.account.kind !== "signed-in"
  )
    return [];
  const before = new Map(previous.buddies.map((b) => [b.publicId, b]));
  const events: PresenceEvent[] = [];
  for (const buddy of next.buddies) {
    const was = before.get(buddy.publicId);
    if (!was) continue;
    if (!present(was) && present(buddy))
      events.push({ type: "signed-in", buddy });
    const sameRoom =
      was.room?.code === buddy.room?.code &&
      was.room?.gameId === buddy.room?.gameId;
    if (buddy.status === "playing" && (was.status !== "playing" || !sameRoom))
      events.push({ type: "playing", buddy });
  }
  const invitesBefore = new Map(previous.invites.map((i) => [i.id, i.at]));
  for (const invite of next.invites)
    if (invitesBefore.get(invite.id) !== invite.at)
      events.push({ type: "invite", invite });
  const requestsBefore = new Set(previous.incoming.map((c) => c.publicId));
  for (const from of next.incoming)
    if (!requestsBefore.has(from.publicId))
      events.push({ type: "request", from });
  return events;
}
