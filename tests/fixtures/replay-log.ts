import { BotController } from "../../src/engine/bot-controller.js";
import {
  applyTick,
  createRoomState,
  hashRoomState,
  type StreamEntries,
  type RoomState,
} from "../../src/engine/apply-tick.ts";
import type { Entry } from "../../src/engine/input-log.ts";
import { defaultRoomSettings } from "../../src/engine/room-settings.js";
import type { GameEvent } from "../../src/shared/protocol.js";

/** A room's whole input: every member's log entries, and how many ticks to fold them over. Inputs only, no state. */
export interface Recording {
  matchId: string;
  creator: string;
  ticks: number;
  entries: Record<string, Entry[]>;
}

/** One member stream per tick, in the order given. A stream is written in tick order, so each is read once through. */
export function streamReader(
  entries: Record<string, readonly Entry[]>,
  order: (members: string[]) => string[] = (members) => members,
): (tick: number) => Map<string, StreamEntries> {
  const cursors = new Map(Object.keys(entries).map((member) => [member, 0]));
  return (tick) =>
    new Map(
      order(Object.keys(entries)).map((member) => {
        const list = entries[member]!;
        let cursor = cursors.get(member)!;
        const start = cursor;
        if (list[cursor] && list[cursor]![1] < tick)
          throw new Error(`${member}'s stream is not in tick order`);
        while (list[cursor]?.[1] === tick) cursor++;
        cursors.set(member, cursor);
        return [member, { generation: 1, entries: list.slice(start, cursor) }];
      }),
    );
}

/** One hash per tick. Any engine that disagrees with another on any tick has diverged. */
export function replayHashes(
  recording: Recording,
  observe?: (
    state: Readonly<RoomState>,
  ) => (events: readonly GameEvent[]) => void,
): string[] {
  const state = createRoomState(recording.matchId, defaultRoomSettings()),
    bots = new BotController(),
    streams = streamReader(recording.entries),
    hashes: string[] = [];
  for (let tick = 1; tick <= recording.ticks; tick++) {
    const after = observe?.(state);
    const events = applyTick(state, recording.creator, streams(tick), bots);
    after?.(events);
    hashes.push(hashRoomState(state));
  }
  return hashes;
}
