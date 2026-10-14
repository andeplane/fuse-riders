import { DEFAULT_MAP } from "./maps.js";
import {
  RoomRuntime,
  type RoomTransport,
  type RuntimeDependencies,
  type TransportEvents,
} from "fuse-netcode";
import {
  createMatch,
  type Action,
  type World,
  type MapDefinition,
  type MatchSettings,
  RULES,
} from "../engine/index.js";
import type {
  NeuralSession,
  GameMode,
  OnlineSession,
  RoomRules,
  RoomSnapshot,
  SessionOptions,
} from "../app/contracts.js";
import {
  neuralGame,
  COMMANDS_PER_SEAT,
  settingsMap,
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
  private pendingActions: Action[] = [];
  private pendingMatch = "";
  private readonly pendingLimit = RULES.queueLimit * 2;

  dispatch(action: Action): void {
    if (!this.dispatchBatch([action]))
      this.status.notice("Game orders are busy. Try again.");
  }
  dispatchBatch(actions: readonly Action[]): boolean {
    const scope = this.frameTiming()?.newer;
    if (
      !scope ||
      scope.finished ||
      this.roomState()?.stage !== "running" ||
      !this.player()?.connected
    )
      return false;
    if (this.pendingMatch !== scope.matchId) this.clearPending();
    if (this.pendingActions.length + actions.length > this.pendingLimit)
      return false;
    this.pendingMatch = scope.matchId;
    this.pendingActions.push(...structuredClone(actions));
    this.flushPending();
    return true;
  }
  /** Pace ordinary entries at the fold's existing per-seat limit. */
  flushPending(): void {
    if (!this.pendingActions.length) return;
    const scope = this.frameTiming()?.newer;
    if (
      !scope ||
      scope.finished ||
      this.roomState()?.stage !== "running" ||
      !this.player()?.connected ||
      scope.matchId !== this.pendingMatch
    ) {
      this.clearPending();
      return;
    }
    // ownTick is monotonic, including clock corrections. The stream's latest
    // tick covers already-written future entries; management does not spend
    // the game's action budget. append may choose a later, unused tick.
    const tick = Math.max(
      Math.floor(this.clock.tick()) + 1,
      this.own().latestTick(),
    );
    const used = this.own()
      .entriesAt(tick)
      .filter((entry) => entry[2] === 1).length;
    for (
      let available = COMMANDS_PER_SEAT - used;
      available > 0 && this.pendingActions.length;
      available--
    )
      this.append(1, scope.matchId, this.pendingActions.shift()!);
  }
  private clearPending(): void {
    this.pendingActions = [];
    this.pendingMatch = "";
  }
  protected override resetControls(): void {
    this.clearPending();
  }
  protected override absentControls(): void {
    this.clearPending();
  }
  protected override releaseControls(): void {
    this.clearPending();
  }
  override stop(): void {
    this.clearPending();
    super.stop();
  }
  /** The newest folded room, for the lobby; the board renders from frames. */
  roomState(): NeuralRoom | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
}

/** Offline uses exactly the online log/rollback clock, without constructing a transport. */
export function createSession(
  map: MapDefinition,
  slot: number,
  mode: GameMode,
  settings: MatchSettings,
  dependencies?: RuntimeDependencies,
  options: SessionOptions = {},
): NeuralSession {
  const listeners = new Set<() => void>();
  let view = createMatch(map, settings, [{ id: "solo", slot }]);
  let runtime: NeuralRuntime;
  let disposed = false;
  const start = () => {
    runtime = new NeuralRuntime(
      neuralGame,
      "",
      {
        map,
        slot,
        mode,
        engine: settings,
        ...(mode === "watch"
          ? {
              watchStrategies:
                options.watchStrategies ?? (["pressure", "balanced"] as const),
            }
          : {}),
      },
      {
        state(frame) {
          view = frame;
          runtime.flushPending();
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
    localPlayerId: "solo",
    canControl: mode !== "watch",
    view: () => view,
    dispatch: (action) => {
      if (!disposed && mode !== "watch") runtime.dispatch(action);
    },
    dispatchBatch: (actions) =>
      !disposed && mode !== "watch" && runtime.dispatchBatch(actions),
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

export const DEFAULT_ROOM_RULES: RoomRules = {
  mapId: DEFAULT_MAP,
  aiStrategy: "random",
  powerups: true,
};

/**
 * A Versus room over the network: the same runtime and fold as local play,
 * with a transport. The lobby reads seats and rules from the folded room.
 */
export function createOnlineSession(
  code: string,
  transport: (events: TransportEvents) => RoomTransport,
  dependencies?: RuntimeDependencies,
): OnlineSession {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const settings = (rules: RoomRules): NeuralSettings => ({
    mapId: rules.mapId,
    slot: 0,
    mode: "versus",
    // Random leaves the opening unset: each bot draws its own from the match.
    engine:
      rules.aiStrategy === "random"
        ? { powerups: rules.powerups }
        : { aiStrategy: rules.aiStrategy, powerups: rules.powerups },
  });
  let view = createMatch(settingsMap(settings(DEFAULT_ROOM_RULES)), {}, [
    { id: "solo", slot: 0 },
  ]);
  let manager = false;
  let status = "Connecting to the room…";
  let closed: RoomSnapshot["closed"] = "";
  let disposed = false;
  const runtime = new NeuralRuntime(
    neuralGame,
    code,
    settings(DEFAULT_ROOM_RULES),
    {
      state(frame) {
        view = frame;
        runtime.flushPending();
        notify();
      },
      event() {},
      status(text) {
        status = text;
        notify();
      },
      ready(_id, host) {
        manager = host;
        notify();
      },
      kicked() {
        closed = "kicked";
        notify();
      },
      ended() {
        closed = "ended";
        notify();
      },
    },
    { transport, ...(dependencies ? { dependencies } : {}) },
  );
  const rules = (): RoomRules => {
    const current = runtime.roomState()?.settings;
    return {
      mapId: current?.mapId ?? DEFAULT_ROOM_RULES.mapId,
      aiStrategy: current
        ? (current.engine.aiStrategy ?? "random")
        : DEFAULT_ROOM_RULES.aiStrategy,
      powerups: current?.engine.powerups ?? DEFAULT_ROOM_RULES.powerups,
    };
  };
  const seated = () =>
    view.players.some((p) => p.id === runtime.self) &&
    runtime.roomState()?.stage === "running";
  runtime.start();
  return {
    code,
    get localPlayerId() {
      return runtime.self;
    },
    get canControl() {
      return seated();
    },
    view: () => view,
    dispatch: (action) => {
      if (!disposed && seated()) runtime.dispatch(action);
    },
    dispatchBatch: (actions) =>
      !disposed && seated() && runtime.dispatchBatch(actions),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // A room restarts through its lobby, not by rebuilding the session.
    reset: () => {
      runtime.command({ type: "action", action: "lobby" });
    },
    dispose: () => {
      if (!disposed) {
        disposed = true;
        runtime.stop();
        listeners.clear();
      }
    },
    room() {
      const room = runtime.roomState();
      return {
        code,
        stage: room ? room.stage : "connecting",
        seats: room
          ? [...room.seats.values()]
              .sort((a, b) => a.slot - b.slot)
              .map((seat) => ({
                id: seat.id,
                name: seat.name,
                slot: seat.slot,
                bot: seat.bot,
                connected: seat.connected,
                watcher: seat.watcher === true,
              }))
          : [],
        self: runtime.self,
        manager,
        status,
        closed,
        ...rules(),
      };
    },
    join: (name) => {
      runtime.command({ type: "join", name, avatarId: "brain" });
    },
    addBot: () => {
      runtime.command({ type: "bot", action: "add" });
    },
    removeBot: (id) => {
      runtime.command({ type: "bot", action: "remove", id });
    },
    configure: (change) => {
      runtime.command({
        type: "settings",
        settings: settings({ ...rules(), ...change }),
      });
    },
    start: () => {
      runtime.command({ type: "action", action: "start" });
    },
    rematch: () => {
      runtime.command({ type: "action", action: "rematch" });
    },
    lobby: () => {
      runtime.command({ type: "action", action: "lobby" });
    },
  };
}
