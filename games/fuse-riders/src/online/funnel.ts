/**
 * When the room's funnel events fire: `Match Started`, `Kill` / `Miss`, `Seat Taken` and `Match Ended`.
 *
 * The room UI calls `onFrame` with every snapshot it renders — twenty times a second — so everything here is
 * bookkeeping over a handful of fields: no DOM, no clock of its own, no network. Each event fires once per scope,
 * and the scopes differ, which is the reason this is a module with tests rather than five `let`s in a render
 * callback:
 *
 * | Event           | Fires once per                                                                              |
 * | --------------- | ------------------------------------------------------------------------------------------- |
 * | `Match Started` | match id, on the snapshot that shows its round 1 in `countdown` (`matchStartKey`)           |
 * | `Kill` / `Miss` | decided round and rider, remembered in storage so a reload does not repeat it               |
 * | `Seat Taken`    | funnel — that is, per entry into a room: the first snapshot showing this device's rider     |
 * | `Match Ended`   | recap: a `matchOver` whose closing pause has run out, keyed on the tick it ran out at, and |
 * |                 | forgotten when the room is back in the lobby                                                |
 *
 * `matchNumber` counts `Match Started` within this funnel, so a rematch is the same signal a `Rematch` event
 * would carry. `durationSeconds` is reported only for a match this funnel saw begin: a device that watched match
 * 1 start and missed match 2's start would otherwise report match 1's clock as match 2's length.
 */
import { BOT_ID_PREFIX } from "../engine/bot-controller.js";
import type { MatchPlayerStats } from "../engine/match-stats.js";
import type { DecidedRound } from "../engine/shot-log.js";
import type { RoomSettings } from "../engine/room-settings.js";
import type { SafeStorage } from "../client/safe-storage.js";
import {
  decidedRoundReport,
  matchEndedProps,
  matchStartKey,
} from "./analytics.js";

/** The last decided round (and rider) whose Kill and Miss events this browser sent, so a reload or a reopened tab does not send them twice. */
export const SHOTS_REPORTED_KEY = "fuse-shots-reported";

/** The fields of a rendered snapshot the funnel reads. A `Frame` satisfies it. */
export interface FunnelView {
  matchId: string;
  phase: string;
  round: number;
  tick: number;
  phaseEndsAtTick?: number;
  players: ReadonlyArray<{ id: string; avatarId: string }>;
  matchStats: readonly MatchPlayerStats[];
  decidedRound?: DecidedRound;
}

/** What only the device knows about the frame: who it is, and how far every rider's input is confirmed. */
export interface FunnelDevice {
  /** This device's rider, or `""` for a display, a spectator or a device not seated yet. */
  playerId: string;
  host: boolean;
  confirmedTick: number;
  rules: Pick<RoomSettings, "mode" | "match" | "length"> & {
    weights?: RoomSettings["weights"];
  };
}

export interface FunnelOptions {
  /** Wall-clock milliseconds, for `durationSeconds`. */
  now: () => number;
  storage: Pick<SafeStorage, "getItem" | "setItem">;
  /** Where the first failure is reported, once. Defaults to `console.warn`. */
  warn?: (message: string, error: unknown) => void;
}

export type Track = (
  event: string,
  properties?: Record<string, unknown>,
) => void;

export interface Funnel {
  onFrame(view: FunnelView, device: FunnelDevice): void;
}

export function createFunnel(
  track: Track,
  {
    now,
    storage,
    warn = (message, error) => console.warn(message, error),
  }: FunnelOptions,
): Funnel {
  // The in-memory copies are the real guard: storage can refuse, and a round-over snapshot arrives twenty times a second.
  let seatTracked = false,
    matchStartedAt = 0,
    matchNumber = 0,
    startedMatch = "",
    endedRecap = "",
    reportedShots = storage.getItem(SHOTS_REPORTED_KEY) ?? "",
    warned = false;

  const frame = (view: FunnelView, device: FunnelDevice) => {
    const botCount = view.players.filter((player) =>
      player.id.startsWith(BOT_ID_PREFIX),
    ).length;

    const startKey = matchStartKey(view.matchId, view.phase, view.round);
    // Every once-only flag below is set after its event has been handed to `track`, never before: a throw while
    // the properties are being built must cost a frame, not the event.
    if (startKey && startedMatch !== startKey) {
      const startedAt = now();
      track("Match Started", {
        matchNumber: matchNumber + 1,
        playerCount: view.players.length,
        botCount,
        mode: device.rules.mode,
        match: device.rules.match,
        matchLength: device.rules.length,
        powerupTypes: Object.values(device.rules.weights ?? {}).filter(
          (weight) => weight > 0,
        ).length,
        host: device.host,
      });
      startedMatch = startKey;
      matchStartedAt = startedAt;
      matchNumber += 1;
    }

    const shotReport = decidedRoundReport(
      view.decidedRound,
      device.playerId,
      device.confirmedTick,
      reportedShots,
      { riders: view.players.length, bots: botCount },
    );
    if (shotReport) {
      // The one place the mark comes first, and deliberately: every event of the round was already built by
      // `decidedRoundReport` above, so nothing is left to fail but `track` itself — and a `track` that threw on
      // the third event would otherwise re-send the first two on every frame, twenty times a second.
      reportedShots = shotReport.key;
      storage.setItem(SHOTS_REPORTED_KEY, shotReport.key);
      for (const shot of shotReport.events) track(shot.event, shot.properties);
    }

    const player = view.players.find(
      (candidate) => candidate.id === device.playerId,
    );
    if (player && !seatTracked) {
      track("Seat Taken", {
        avatarId: player.avatarId,
        playerCount: view.players.length,
      });
      seatTracked = true;
    }

    // The final-round pause keeps the arena up until `phaseEndsAtTick`; the recap, and this event, come after it.
    if (view.phase === "lobby") endedRecap = "";
    const recapReady =
      view.phase === "matchOver" && view.tick >= (view.phaseEndsAtTick ?? 0);
    if (recapReady && endedRecap !== String(view.phaseEndsAtTick)) {
      const sawStart =
        startedMatch === matchStartKey(view.matchId, "countdown", 1);
      track("Match Ended", {
        ...matchEndedProps(view.matchStats, device.playerId),
        ...(sawStart && matchStartedAt
          ? {
              durationSeconds: Math.round((now() - matchStartedAt) / 1000),
            }
          : {}),
      });
      endedRecap = String(view.phaseEndsAtTick);
    }
  };

  return {
    onFrame(view, device) {
      // This runs inside the callback that renders the room — and, on the host, publishes it. Analytics never
      // breaks the game: a malformed snapshot costs this frame's events, not the frame. It is not silent, though:
      // the first failure is reported, once — a throw that persists would otherwise lose the whole funnel with no
      // signal at all. Console only: the event list in docs/ANALYTICS.md has no diagnostic event, and a funnel
      // that cannot build an event is in no position to vouch for another.
      try {
        frame(view, device);
      } catch (error) {
        if (!warned) {
          warned = true;
          try {
            warn(
              "analytics funnel failed; further failures are not reported",
              error,
            );
          } catch {
            /* a reporter that throws is still not the game's problem */
          }
        }
      }
    },
  };
}
