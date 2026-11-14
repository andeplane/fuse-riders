import type {
  LogEntry,
  RollbackGame,
  RoomClock,
  StreamEntries,
} from "./game.js";
import { ACTION, BOT } from "./management.js";
const MATCH = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000002";

/** A bounded, seeded local bot match. No transport, account, storage, audio or product metrics. */
export function createAttractGame<
  Room extends RoomClock,
  Entry extends LogEntry,
  View extends { tick: number },
  Event,
  Settings,
>(
  game: RollbackGame<Room, Entry, View, Event, Settings>,
  settings: Settings,
  options: { bots?: number; warmup?: number; loopTicks?: number } = {},
) {
  let room: Room, ticker: ReturnType<typeof game.createTicker>;
  let streams: ReadonlyMap<string, StreamEntries<Entry>>;
  let generation = 0;
  const reset = () => {
    generation++;
    room = game.createRoom(MATCH, game.seating.soloSettings(settings));
    ticker = game.createTicker();
    const entries: Entry[] = [],
      pending = new Set<string>();
    const append = (tick: number, ...body: unknown[]) => {
      const entry = [entries.length + 1, tick, ...body];
      if (!game.isEntry(entry))
        throw new Error(`${game.id}: invalid attract entry`);
      entries.push(entry);
    };
    const count = Math.min(
      options.bots ?? game.seating.capacity,
      game.seating.capacity,
    );
    for (let slot = 0; slot < count; slot++) {
      const id = game.seating.botId(room, pending);
      pending.add(id);
      append(1, BOT, "add", id, game.seating.botName(slot), slot);
    }
    append(2, ACTION, "start", MATCH);
    streams = new Map([[OWNER, { generation: 1, entries }]]);
    for (let tick = 0; tick < (options.warmup ?? 100); tick++)
      ticker(room, OWNER, streams);
    if ((options.warmup ?? 100) >= 2 && game.stage(room) === "lobby")
      throw new Error(`${game.id}: attract match did not start`);
  };
  reset();
  return {
    advance() {
      if (
        room.tick >= (options.loopTicks ?? 1200) ||
        game.stage(room) === "over"
      )
        reset();
      else ticker(room, OWNER, streams);
    },
    view: () => game.view(room),
    tick: () => room.tick,
    scope: () => `menu-demo-${generation}`,
  };
}
