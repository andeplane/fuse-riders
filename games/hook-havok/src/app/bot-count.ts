/**
 * The manager's Room & match → Bots choice. Adding seats bots at once; the
 * netcode removes a seat only between rounds, so a lower count sends the room
 * to the lobby and keeps a `target` the page applies there (`botsToRemove`).
 */
export interface BotChoice {
  /** Bots to seat now. */
  add: number;
  /**
   * Bots to keep once the room is back in the lobby; `undefined` when nothing
   * is to go. A count at or above the bots seated now clears a pending target:
   * picking 1 of 3 and then 4 before the lobby arrived must end at 4, not 1.
   */
  target: number | undefined;
  /** Send the room to the lobby, where the target applies. */
  lobby: boolean;
}
export function chooseBots(want: number, have: number): BotChoice {
  return want < have
    ? { add: 0, target: want, lobby: true }
    : { add: want - have, target: undefined, lobby: false };
}
/** The bot seats to remove in the lobby to reach `target`, the last seat first. */
export function botsToRemove(
  seats: readonly { id: string; slot: number; bot: boolean }[],
  target: number,
): string[] {
  const bots = seats.filter((s) => s.bot).sort((a, b) => b.slot - a.slot);
  return bots.slice(0, Math.max(0, bots.length - target)).map((s) => s.id);
}
/**
 * Whether removing bots now would cut short a competitive round: the lobby
 * trip restarts everyone, so the page asks first. Free play and a finished
 * round restart without asking.
 */
export function removalInterrupts(
  stage: "lobby" | "running",
  contest: { rules: string; phase: string },
): boolean {
  return (
    stage === "running" &&
    contest.rules !== "free" &&
    (contest.phase === "countdown" || contest.phase === "active")
  );
}
