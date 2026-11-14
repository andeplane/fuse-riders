import { createBrowserAnalytics, type Analytics } from "./analytics.js";
import { isEmbeddedPage } from "./embedded.js";

export interface PlayFrame {
  /** Scope only; never transmitted. */
  matchId: string;
  active: boolean;
  ended: boolean;
  /** Omit only for games with a single continuous match. */
  round?: number;
  /** Actual active gameplay, excluding countdowns. Omitted means no round integration. */
  roundActive?: boolean;
  /** Decided completion of the current semantic round. */
  roundEnded?: boolean;
  /** Separate from `round`, which some existing match-start adapters use synthetically. */
  roundKey?: number;
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
  const observeRound = createRoundMetrics(track);
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
    observeRound(frame);
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

/** Round participation is independent of per-device match observation and first-round start detection. */
export function createRoundMetrics(
  track: Analytics["track"],
): (frame: PlayFrame) => void {
  const starts = new Set<string>(),
    ends = new Set<string>();
  return (frame) => {
    if (!frame.matchId || !frame.seated) return;
    const key = JSON.stringify([
      frame.matchId,
      frame.roundKey ?? frame.round ?? 1,
    ]);
    const properties = {
      playerCount: frame.playerCount,
      botCount: frame.botCount,
      humanCount: frame.playerCount - frame.botCount,
      played: true,
      mode: frame.mode,
    };
    if (frame.roundActive && !starts.has(key)) {
      track("Round Started", properties, { key });
      starts.add(key);
      if (starts.size > 512) starts.delete(starts.values().next().value!);
    }
    if (frame.roundEnded && !ends.has(key)) {
      track("Round Ended", properties, { key, requires: "Round Started" });
      ends.add(key);
      if (ends.size > 512) ends.delete(ends.values().next().value!);
    }
  };
}

/** What a page is for, from its address: the `role` super property on every event. */
export type PageRole = "solo" | "display" | "joiner" | "landing";

export function pageRole(search: string): PageRole {
  const query = new URLSearchParams(search);
  if (query.has("solo")) return "solo";
  if (!query.has("room")) return "landing";
  return query.get("display") === "1" ? "display" : "joiner";
}

/** The facts about the page `startGameAnalytics` reports; read from the browser by default, given by a test. */
export interface AnalyticsPage {
  /** The page's `location.search`. */
  search: string;
  /** The page runs in a FuseOS desktop window rather than as the browser tab itself (`isEmbeddedPage`). */
  embedded: boolean;
}

export function browserAnalyticsPage(): AnalyticsPage {
  return { search: location.search, embedded: isEmbeddedPage(window) };
}

/**
 * One instance at the page's composition root. Analytics is disabled on dev addresses unless explicitly enabled.
 * `App Opened` says whether the page opened inside the FuseOS desktop (`embedded`), so a game played from a
 * desktop window and one played in its own tab can be told apart; the desktop reports its own opening as `fuseos`.
 */
export function startGameAnalytics(
  gameId: string,
  page: AnalyticsPage = browserAnalyticsPage(),
  create: (gameId: string) => Analytics = createBrowserAnalytics,
): Analytics {
  const analytics = create(gameId);
  analytics.start({ role: pageRole(page.search) });
  analytics.track("App Opened", { embedded: page.embedded });
  return analytics;
}
