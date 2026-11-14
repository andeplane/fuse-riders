import { STEPS_PER_TICK, type View } from "../online/index.js";

/** `Analytics.track` of `fuse-ui/analytics`: it adds the `fuse.` prefix and the game id. */
export type Track = (
  event: string,
  properties?: Record<string, unknown>,
) => void;

const TEAMS = ["cyan", "pink"];

/**
 * Killer Fuse's own product event beside the shared `Match Started` and `Match Ended` (`fuse-ui/play-metrics`): one
 * `Game Ended` per decided game of a set, with how it was won and how long it took. Like the shared ones it is a
 * per-device observation, sent once the game's record can no longer be rolled back, and never for games decided
 * before this page saw the set (a page that joins or reloads midway reports only what it watched end).
 */
export function createGameMetrics(
  track: Track,
): (view: View, me: string, confirmedTick: number, mode: string) => void {
  let match = "";
  const sent = new Set<number>();
  return (view, me, confirmedTick, mode) => {
    if (view.matchId !== match) {
      match = view.matchId;
      sent.clear();
      for (const record of view.results) sent.add(record.round);
    }
    for (const record of view.results) {
      if (sent.has(record.round)) continue;
      if (record.tick * STEPS_PER_TICK > confirmedTick) continue;
      sent.add(record.round);
      const humans = record.crew.filter((id) => id !== "").length,
        slot = record.crew.indexOf(me);
      track("Game Ended", {
        round: record.round,
        mapId: record.mapId,
        winKind: record.kind,
        winningTeam: TEAMS[record.team],
        durationSeconds: Math.round(record.steps / 60),
        humanCount: humans,
        botCount: record.crew.length - humans,
        played: me !== "" && slot >= 0,
        ...(me !== "" && slot >= 0 ? { won: slot % 2 === record.team } : {}),
        mode,
      });
    }
  };
}
