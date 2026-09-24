import { RoomRuntime, type RuntimeDependencies } from "fuse-netcode";
import {
  createMatch,
  type Action,
  type World,
  type MapDefinition,
  type MatchSettings,
} from "../engine/index.js";
import type { NeuralSession, GameMode } from "../app/contracts.js";
import {
  neuralGame,
  type NeuralRoom,
  type NeuralEntry,
  type NeuralSettings,
} from "./game.js";

class NeuralRuntime extends RoomRuntime<
  NeuralRoom,
  NeuralEntry,
  World,
  never,
  NeuralSettings
> {
  dispatch(action: Action): void {
    const scope = this.frameTiming()?.newer;
    if (scope) this.append(1, scope.matchId, action);
  }
}

/** Offline uses exactly the online log/rollback clock, without constructing a transport. */
export function createSession(
  map: MapDefinition,
  slot: number,
  mode: GameMode,
  settings: MatchSettings,
  dependencies?: RuntimeDependencies,
): NeuralSession {
  const listeners = new Set<() => void>();
  let view = createMatch(map, settings, [{ id: "solo", slot }]);
  let runtime: NeuralRuntime;
  let disposed = false;
  const start = () => {
    runtime = new NeuralRuntime(
      neuralGame,
      "",
      { map, slot, mode, engine: settings },
      {
        state(frame) {
          view = frame;
          for (const listener of listeners) listener();
        },
        event() {},
        status() {},
        ready() {},
      },
      { ...(dependencies ? { dependencies } : {}), humanName: "You" },
    );
    runtime.start();
  };
  start();
  return {
    view: () => view,
    dispatch: (action) => {
      if (!disposed) runtime.dispatch(action);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => {
      if (!disposed) {
        runtime.stop();
        start();
      }
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        runtime.stop();
        listeners.clear();
      }
    },
  };
}
