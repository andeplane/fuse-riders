import {
  RoomRuntime as NetRuntime,
  rulesAge as rulesAgeOf,
  type Callbacks as NetCallbacks,
  type FrameTiming,
  type RoomCommand as NetRoomCommand,
  type RuntimeOptions,
} from "fuse-netcode";
import { RULES, readyPhase, type RoomState } from "../engine/apply-tick.js";
import { RIDER_COLORS } from "../engine/tuning.js";
import {
  AVATAR,
  COLOR,
  READY,
  CANCEL,
  PRESS,
  RELEASE,
  STEER,
  type Entry,
} from "../engine/input-log.js";
import type { RoomSettings } from "../engine/room-settings.js";
import type { GameEvent } from "../engine/view.js";
import type { AvatarId } from "../engine/state.js";
import { fuseGame, type Frame, type FuseView } from "./fuse-game.js";

export type {
  RoomTransport,
  RuntimeDependencies,
  RuntimeMetrics,
  RuntimeOptions,
  TransportEvents,
} from "fuse-netcode";
export { RULES_MISMATCH } from "./fuse-game.js";

export type RoomCommand =
  | NetRoomCommand<RoomSettings>
  | {
      type: "input";
      seq: number;
      left: boolean;
      right: boolean;
      bomb: boolean;
      bombAction?: "press" | "release" | "cancel";
    }
  | { type: "avatar"; avatarId: AvatarId }
  | { type: "color"; colorIndex: number }
  | { type: "ready"; ready: boolean };
export type Callbacks = NetCallbacks<FuseView, GameEvent, RoomSettings>;
/** What `presentation()` hands the screen: frames and times, not a finished picture. */
export interface PresentationFrames {
  /** The tick before `newer`, when there is one to interpolate from. */
  older?: Frame;
  newer: Frame;
  /** The fractional tick to show, between the two frames. */
  tick: number;
  /** Present while this device steers a rider: lead it `lead` ticks (0 to 1) past `tick` with the held controls. */
  local?: {
    id: string;
    controls: { left: boolean; right: boolean };
    lead: number;
  };
}

/** Whether a peer announcing `theirs` is ahead of this build, behind it, or not comparable. */
export const rulesAge = (theirs: unknown): "newer" | "older" | "unknown" =>
  rulesAgeOf(RULES, theirs);

/**
 * Fuse Riders' room: the netcode's runtime with the rider's controls. Steering and the bomb button are edge-filtered
 * into the log (each press is a new gesture), released when the page is hidden, and led past the shown tick in
 * `presentation()`.
 */
export class RoomRuntime extends NetRuntime<
  RoomState,
  Entry,
  FuseView,
  GameEvent,
  RoomSettings
> {
  private held = {
    flags: -1,
    active: 0,
    latest: 0,
  };
  private readonly localHeld = new Map<
    string,
    { flags: number; active: number; latest: number }
  >();
  constructor(
    code: string,
    settings: RoomSettings,
    callbacks: Callbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuseGame, code, settings, callbacks, options);
  }
  /** Neutral controls, but gesture ids never restart: the own stream refuses a reused id and so would every peer. */
  protected override resetControls(): void {
    this.localHeld.clear();
    this.held = {
      flags: -1,
      active: 0,
      latest: Math.max(
        this.held.latest,
        this.world?.streams.get(this.id)?.latestOrdinal() ?? 0,
      ),
    };
  }
  protected override releaseControls(): void {
    for (const [id, held] of this.localHeld) {
      this.appendLocal(id, STEER, 0);
      if (held.active) this.appendLocal(id, CANCEL, held.active);
      held.flags = 0;
      held.active = 0;
    }
    if (this.held.flags > 0) {
      this.append(STEER, 0);
      this.held.flags = 0;
    }
    if (this.held.active) {
      this.append(CANCEL, this.held.active);
      this.held.active = 0;
    }
  }
  protected override absentControls(): void {
    if (this.held.flags !== -1) this.resetControls();
  }
  /** The steer the fold currently holds for a rider: what the benchmark reports as applied motion. */
  heldControls(id: string): { left: boolean; right: boolean } | undefined {
    const fold = this.world?.state.folds.get(id);
    if (!fold) return undefined;
    return { left: (fold.flags & 1) === 1, right: (fold.flags & 2) === 2 };
  }
  override command(command: RoomCommand): boolean {
    if (command?.type === "ready") {
      if (
        typeof command.ready !== "boolean" ||
        !this.world ||
        !this.player() ||
        this.hiddenState ||
        !readyPhase(this.world.state.game)
      )
        return false;
      const game = this.world.state.game;
      this.append(READY, command.ready, game.matchId, game.phase);
      this.sendPackets(this.deps.now());
      return true;
    }
    if (
      command &&
      typeof command === "object" &&
      (command.type === "input" ||
        command.type === "avatar" ||
        command.type === "color")
    ) {
      if (!this.world) {
        this.status.notice(this.text.loading);
        return false;
      }
      if (command.type === "input") return this.input(command);
      // A head and a colour are the rider's own entries on its own stream. Whether the choice sticks is the fold's
      // answer, not this device's: an entry for one another rider already wears is a no-op on every replica alike.
      if (command.type === "color") {
        if (
          !Number.isInteger(command.colorIndex) ||
          command.colorIndex < 0 ||
          command.colorIndex >= RIDER_COLORS.length ||
          !this.player() ||
          this.hiddenState
        )
          return false;
        this.append(COLOR, command.colorIndex);
        this.sendPackets(this.deps.now());
        return true;
      }
      if (
        !this.game.seating.isAvatar(command.avatarId) ||
        !this.player() ||
        this.hiddenState
      )
        return false;
      this.append(AVATAR, command.avatarId);
      this.sendPackets(this.deps.now());
      return true;
    }
    return super.command(command);
  }
  /** Fixed local seats only. Online callers cannot write another member's input stream. */
  localInput(
    id: string,
    command: Extract<RoomCommand, { type: "input" }>,
  ): boolean {
    if (!this.solo || !this.localPlayerIds.includes(id)) return false;
    return this.input(command, id);
  }
  /** Edge-filtered: an unchanged frame produces no entry; each press is a new gesture in its rider's log. */
  private input(
    command: Extract<RoomCommand, { type: "input" }>,
    id = this.id,
  ): boolean {
    const player = this.world && this.game.seat(this.world.state, id);
    if (!player || player.watcher || this.hiddenState) return false;
    let held = this.held;
    if (id !== this.id) {
      if (!this.localHeld.has(id))
        this.localHeld.set(id, { flags: -1, active: 0, latest: 0 });
      held = this.localHeld.get(id)!;
    }
    const append = (...body: unknown[]) =>
      id === this.id ? this.append(...body) : this.appendLocal(id, ...body);
    if (held.active === 0)
      held.latest = Math.max(
        held.latest,
        this.world!.streams.get(id)!.latestOrdinal(),
      );
    const flags = (command.left ? 1 : 0) | (command.right ? 2 : 0);
    if (flags !== held.flags) {
      append(STEER, flags);
      held.flags = flags;
    }
    if (command.bombAction === "press") {
      held.active = ++held.latest;
      append(PRESS, held.active);
    }
    if (command.bombAction === "release" && held.active) {
      append(RELEASE, held.active);
      held.active = 0;
    }
    if (command.bombAction === "cancel" && held.active) {
      append(CANCEL, held.active);
      held.active = 0;
    }
    if (this.lastPacketTick === -1) this.sendPackets(this.deps.now());
    return true;
  }
  /**
   * What to draw now, for presentation to place in time (`presentWorld` in `games/fuse-riders/src/render/time/`): the netcode's frames
   * and fractional tick, and how far to lead the local rider with the controls it holds.
   */
  presentation(): PresentationFrames | undefined {
    const frames: FrameTiming<FuseView> | undefined = this.frameTiming();
    if (!frames) return undefined;
    const { lead, ...shown } = frames,
      player = this.player(),
      controls = {
        left: (this.held.flags & 1) === 1,
        right: (this.held.flags & 2) === 2,
      };
    return {
      ...shown,
      ...(player && this.held.flags >= 0 && this.localPlayerIds.length < 2
        ? { local: { id: this.id, controls, lead } }
        : {}),
    };
  }
}
