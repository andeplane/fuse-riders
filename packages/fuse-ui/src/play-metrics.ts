import { createBrowserAnalytics, type Analytics } from "./analytics.js";

export interface PlayFrame {
  /** Scope only; never sent to Mixpanel. */
  matchId: string;
  active: boolean;
  ended: boolean;
  /** Omit only for games with a single continuous match. */
  round?: number;
  playerCount: number;
  botCount: number;
  seated: boolean;
  mode: string;
}

/** Per-device observations, just like Riders' funnel; never a second simulation or a per-tick event stream. */
export function createPlayMetrics(
  track: Analytics["track"],
  now: () => number,
): (frame: PlayFrame) => void {
  let match = "",
    started = false,
    ended = false,
    seated = false;
  let startedAt: number | undefined;
  return (frame) => {
    if (!frame.matchId) return;
    if (frame.matchId !== match) {
      match = frame.matchId;
      started = ended = false;
      startedAt = undefined;
    }
    const properties = {
      playerCount: frame.playerCount,
      botCount: frame.botCount,
      humanCount: frame.playerCount - frame.botCount,
      played: frame.seated,
      mode: frame.mode,
    };
    if (frame.seated && !seated) {
      seated = true;
      track("Seat Taken", properties);
    }
    // Joining midway through a multi-round match is not a new match start.
    if (
      frame.active &&
      !frame.ended &&
      (frame.round ?? 1) === 1 &&
      !started &&
      !ended
    ) {
      started = true;
      startedAt = now();
      track("Match Started", properties);
    }
    if (frame.ended && !ended) {
      ended = true;
      track("Match Ended", {
        ...properties,
        ...(startedAt === undefined
          ? {}
          : {
              durationSeconds: Math.max(
                0,
                Math.round((now() - startedAt) / 1000),
              ),
            }),
      });
    }
  };
}

/** One instance at the page's composition root. Analytics is disabled on dev addresses unless explicitly enabled. */
export function startGameAnalytics(gameId: string): Analytics {
  const analytics = createBrowserAnalytics(gameId);
  const query = new URLSearchParams(location.search);
  analytics.start({
    role: query.has("solo")
      ? "solo"
      : query.has("room")
        ? query.get("display") === "1"
          ? "display"
          : "joiner"
        : "landing",
  });
  analytics.track("App Opened");
  return analytics;
}
