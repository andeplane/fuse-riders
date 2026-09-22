import {
  RULES,
  WIDTH,
  HEIGHT,
  advance,
  createMatch,
  decodeState,
  encodeState,
  hashState,
  isAction,
  type Action,
  type Fact,
  type Match,
} from "fuse-birds-game";
import { nextReplayActions } from "./fuse-birds-replay.js";

export interface LogEntry {
  tick: number;
  actions: Action[];
}
export interface ActionLog {
  rules: typeof RULES;
  entries: LogEntry[];
}
export type Driver = "idle" | "pass" | "aimed";
const object = (raw: unknown): raw is Record<string, unknown> =>
  !!raw && typeof raw === "object" && !Array.isArray(raw);
const terrainBytes = (WIDTH * HEIGHT) / 8;

/** JSON is a CLI storage envelope, never part of the engine's dependency graph. */
export function checkpointJSON(state: Match): string {
  const copy = encodeState(state);
  return JSON.stringify({
    format: "fuse-birds-checkpoint-1",
    hash: hashState(copy),
    state: {
      ...copy,
      terrain: {
        ...copy.terrain,
        bits: Buffer.from(copy.terrain.bits).toString("base64"),
      },
    },
  });
}
export function readCheckpoint(raw: unknown): Match {
  if (
    !object(raw) ||
    raw.format !== "fuse-birds-checkpoint-1" ||
    !object(raw.state) ||
    !object(raw.state.terrain)
  )
    throw new Error("Invalid checkpoint envelope");
  const bits = raw.state.terrain.bits;
  if (
    typeof bits !== "string" ||
    bits.length !== (terrainBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]+$/.test(bits)
  )
    throw new Error("Invalid checkpoint terrain encoding");
  const state = decodeState({
    ...raw.state,
    terrain: {
      ...raw.state.terrain,
      bits: new Uint8Array(Buffer.from(bits, "base64")),
    },
  });
  if (!state || hashState(state) !== raw.hash)
    throw new Error("Invalid checkpoint state or hash");
  return state;
}
export function readLog(raw: unknown): ActionLog {
  if (
    !object(raw) ||
    raw.rules !== RULES ||
    !Array.isArray(raw.entries) ||
    raw.entries.length > 100_000
  )
    throw new Error("Invalid action log envelope");
  let previous = 0;
  const entries = raw.entries.map((entry) => {
    if (
      !object(entry) ||
      !Number.isSafeInteger(entry.tick) ||
      Number(entry.tick) <= previous ||
      Number(entry.tick) > 100_000 ||
      !Array.isArray(entry.actions) ||
      entry.actions.length > 32 ||
      !entry.actions.every(isAction)
    )
      throw new Error("Invalid, unordered or unbounded action log entry");
    previous = Number(entry.tick);
    return {
      tick: previous,
      actions: structuredClone(entry.actions) as Action[],
    };
  });
  return { rules: RULES, entries };
}
export function initialMatch(seed: number, count: number): Match {
  if (!Number.isInteger(count) || count < 2 || count > 5)
    throw new Error("Player count must be 2–5");
  return createMatch(
    "headless",
    seed,
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: `Bird ${i + 1}`,
    })),
  );
}
export function runHeadless(
  state: Match,
  options: {
    ticks: number;
    driver: Driver;
    log?: ActionLog;
    trace?: (entry: LogEntry & { hash: string; facts: Fact[] }) => void;
  },
) {
  if (
    !Number.isSafeInteger(options.ticks) ||
    options.ticks < 0 ||
    options.ticks > 100_000
  )
    throw new Error("Tick limit must be 0–100000");
  const byTick = new Map(
    options.log?.entries.map((entry) => [entry.tick, entry.actions]),
  );
  const record: ActionLog = { rules: RULES, entries: [] };
  for (
    let i = 0;
    i < options.ticks && state.phase !== "over" && state.phase !== "fault";
    i++
  ) {
    let actions = byTick.get(state.tick + 1) ?? [];
    // A supplied log is authoritative: missing ticks are empty, never filled by a driver.
    if (!options.log && options.driver === "aimed")
      actions = nextReplayActions(state);
    if (!options.log && options.driver === "pass" && state.phase === "aiming") {
      const player = state.players[state.active]!;
      actions = [
        {
          actor: player.id,
          round: state.round,
          turn: state.turn,
          ordinal: player.ordinal + 1,
          type: "pass",
        },
      ];
    }
    const facts = advance(state, actions);
    if (actions.length)
      record.entries.push({
        tick: state.tick,
        actions: structuredClone(actions),
      });
    options.trace?.({
      tick: state.tick,
      actions,
      facts,
      hash: hashState(state),
    });
  }
  return {
    record,
    summary: {
      rules: RULES,
      seed: state.seed,
      tick: state.tick,
      phase: state.phase,
      winner: state.winner,
      fault: state.fault,
      hash: hashState(state),
      terrainVersion: state.terrain.version,
      generation: {
        attempt: state.preparation.attempt,
        work: state.preparation.work,
        witnesses: state.preparation.witnesses.length,
      },
    },
  };
}
