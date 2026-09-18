import {
  COUNTDOWN_TICKS,
  MATCH_WINNER_TICKS,
  OVERTIME_START_TICK,
  ROUND_DRAW_TICK,
  TICK_HZ,
} from "../engine/game.js";
import { ARENA_MAP_RECIPES } from "../engine/arena-map.js";
import type { ArenaMapId, GameEvent } from "../shared/protocol.js";
import type { ViewSnapshot } from "./snapshot-stream.js";

/**
 * Pure text model for the in-arena announcements the online screen renders: countdown, round result with
 * placements, overtime, the final result, plus the elimination feed. The LAN TV keeps its own copy of this
 * logic in `main.ts`; this module exists so the online room, solo and the phone read the same moments.
 */
export type Announcement =
  | { kind: "hidden" }
  | { kind: "countdown"; round: number; count: string; hint: string }
  | { kind: "overtime"; text: string }
  | {
      kind: "round";
      round: number;
      /** The match ends with this round: its result still comes first, and the match winner is named after it. */
      last: boolean;
      title: string;
      placements: string[];
      next: string;
    }
  | { kind: "final"; title: string; subtitle: string };

const points = (units: number): string => {
  const value = units / 60;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

type Pause = Pick<ViewSnapshot, "phase" | "tick" | "phaseEndsAtTick">;
const ticksLeft = (snapshot: Pause): number =>
  snapshot.phaseEndsAtTick === undefined
    ? 0
    : Math.max(0, snapshot.phaseEndsAtTick - snapshot.tick);

/**
 * A round's own result is on show: every pause between rounds, and the opening of the final pause. Only that pause's
 * closing MATCH_WINNER_TICKS name the match winner; shown from the start, that name read as the winner of the round.
 */
export function showsRoundResult(snapshot: Pause): boolean {
  if (snapshot.phase === "roundOver") return true;
  return (
    snapshot.phase === "matchOver" && ticksLeft(snapshot) > MATCH_WINNER_TICKS
  );
}

/** The round winner's name. The placements keep it when the host removes that rider during the pause; the roster does not. */
export function roundWinnerName(snapshot: ViewSnapshot): string | undefined {
  const id = snapshot.roundWinnerId;
  if (id === undefined) return undefined;
  return (
    snapshot.players.find((player) => player.id === id)?.name ??
    snapshot.roundPlacements.find((entry) => entry.playerId === id)?.name
  );
}

/** The match winner's name, or undefined for a shared victory. Match stats outlive a rider the host removes. */
export function matchWinnerName(snapshot: ViewSnapshot): string | undefined {
  return snapshot.matchStats.find(
    (player) => player.playerId === snapshot.matchWinnerId,
  )?.name;
}

export function announcementFor(
  snapshot: ViewSnapshot,
  selfId: string,
  touch: boolean,
): Announcement {
  const left = ticksLeft(snapshot);
  if (snapshot.phase === "countdown") {
    const seconds = Math.ceil(left / TICK_HZ);
    return {
      kind: "countdown",
      round: snapshot.round,
      count: seconds > 0 ? String(seconds) : "GO!",
      hint: touch
        ? "HOLD LEFT / RIGHT TO STEER · HOLD THE MIDDLE TO CHARGE, RELEASE TO FIRE"
        : "← → OR A / D TO STEER · HOLD SPACE TO CHARGE, RELEASE TO FIRE",
    };
  }
  if (snapshot.phase === "playing") {
    const elapsed =
      snapshot.roundStartedTick === undefined
        ? 0
        : snapshot.tick - snapshot.roundStartedTick;
    if (elapsed >= OVERTIME_START_TICK)
      return {
        kind: "overtime",
        text: `OVERTIME // WALLS CLOSING · DRAW IN ${Math.max(0, Math.ceil((ROUND_DRAW_TICK - elapsed) / TICK_HZ))}s`,
      };
    // Open edges close when overtime starts, and a rider heading out through one on that tick meets a wall instead.
    if (snapshot.map === "wrap" && elapsed >= OVERTIME_START_TICK - 3 * TICK_HZ)
      return {
        kind: "overtime",
        text: `EDGES CLOSE IN ${Math.ceil((OVERTIME_START_TICK - elapsed) / TICK_HZ)}s`,
      };
    return { kind: "hidden" };
  }
  const last = snapshot.phase === "matchOver";
  if (showsRoundResult(snapshot)) {
    const winner = roundWinnerName(snapshot);
    const title =
      winner === undefined
        ? "DRAW"
        : snapshot.roundWinnerId === selfId
          ? "YOU WIN THE ROUND"
          : `${winner} WINS THE ROUND`;
    const placements = snapshot.roundPlacements.map(
      (entry) =>
        `#${entry.place} ${entry.playerId === selfId ? "YOU" : entry.name}  +${points(entry.scoreUnits)}`,
    );
    const seconds = Math.ceil(
      (last ? left - MATCH_WINNER_TICKS : left) / TICK_HZ,
    );
    return {
      kind: "round",
      round: snapshot.round,
      last,
      title,
      placements,
      next: last
        ? `MATCH RESULT IN ${seconds}`
        : left > 0
          ? `NEXT ROUND IN ${seconds}`
          : "NEXT ROUND",
    };
  }
  if (last) {
    const winner = matchWinnerName(snapshot);
    return {
      kind: "final",
      title:
        winner === undefined
          ? "SHARED VICTORY"
          : snapshot.matchWinnerId === selfId
            ? "YOU WIN THE MATCH"
            : `${winner} WINS THE MATCH`,
      subtitle:
        left > 0
          ? winner === undefined
            ? "MATCH RESULT"
            : "MATCH WINNER"
          : "MATCH COMPLETE",
    };
  }
  return { kind: "hidden" };
}

/** "ROUND 2/5 · 01:12" for the header chip; the clock counts down to the draw, mirroring the LAN TV timer. */
export function roundClock(snapshot: ViewSnapshot): string {
  if (snapshot.phase === "lobby") return "";
  const remaining =
    snapshot.phase === "playing" && snapshot.roundStartedTick !== undefined
      ? Math.max(
          0,
          ROUND_DRAW_TICK - (snapshot.tick - snapshot.roundStartedTick),
        )
      : snapshot.phase === "countdown"
        ? Math.min(
            COUNTDOWN_TICKS,
            Math.max(
              0,
              (snapshot.phaseEndsAtTick ?? snapshot.tick) - snapshot.tick,
            ),
          )
        : undefined;
  if (remaining === undefined)
    return `ROUND ${snapshot.round}/${snapshot.matchLength}`;
  const seconds = Math.ceil(remaining / TICK_HZ);
  return `ROUND ${snapshot.round}/${snapshot.matchLength} · ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const CAUSES = {
  wall: "hit the wall",
  trail: "clipped a trail",
  explosion: "caught a blast",
  rider: "rammed a rider",
} as const;

/**
 * One line for the elimination feed, or undefined for events that are not eliminations.
 *
 * Crashing into scenery is reported as `wall`, because it is the same kind of death, so on a board that has any the
 * line cannot promise which solid thing was hit.
 */
export function eliminationLine(
  event: GameEvent,
  players: ReadonlyArray<{ id: string; name: string }>,
  selfId: string,
  map: ArenaMapId = "classic",
): string | undefined {
  if (event.type !== "playerEliminated") return undefined;
  const name =
    event.playerId === selfId
      ? "YOU"
      : (players.find((player) => player.id === event.playerId)?.name ??
        "A rider");
  return `${name} ${event.cause === "wall" && ARENA_MAP_RECIPES[map].species.length > 0 ? "crashed" : CAUSES[event.cause]}`;
}
