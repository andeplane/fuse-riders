import type { Frame } from "fuse-netcode";
import type { BirdsSettings, BirdsView } from "../online/game.js";

export interface MetricsContext {
  memberId: string;
  displayOnly: boolean;
  practice: boolean;
  /** Internal deduplication scope only; never an analytics property. */
  roomScope: string;
}

/** Map actual room observations to the shared funnel, without player names or invite properties. */
export function birdsPlayFrame(
  frame: Frame<BirdsView>,
  settings: BirdsSettings,
  context: MetricsContext,
) {
  const world = frame.world;
  const players = frame.seats.filter((seat) => !seat.watcher);
  return {
    // Practice maps share an id; NEW MAP advances the round and starts a new observation scope.
    matchId: world
      ? `${world.id}:${world.round}`
      : frame.matchId || context.roomScope,
    active: !!world && !["preparing", "over", "fault"].includes(world.phase),
    ended: world?.phase === "over",
    playerCount: players.length,
    botCount: players.filter((seat) => seat.bot).length,
    seated:
      !context.displayOnly &&
      players.some((seat) => seat.id === context.memberId),
    mode: context.practice
      ? "practice"
      : settings.display
        ? "shared"
        : "online",
  };
}
