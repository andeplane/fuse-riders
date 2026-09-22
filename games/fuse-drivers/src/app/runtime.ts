import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  CONTROLS,
  fuseDriversGame,
  packControls,
  type FuseDriversEntry,
  type FuseDriversEvent,
  type FuseDriversRoom,
  type FuseDriversSettings,
  type FuseDriversView,
} from "../game/index.js";
import type { TruckInput } from "../game/sim/input.js";

export type FuseDriversCallbacks = Callbacks<
  FuseDriversView,
  FuseDriversEvent,
  FuseDriversSettings
>;

/**
 * The driving room: the netcode's runtime with a truck's controls.
 *
 * A driver holds the same keys for seconds at a time, so this logs only a change. Silence in the log means
 * "still as before", which is what the fold assumes, and a race costs a handful of entries per corner
 * rather than one per tick.
 */
export class FuseDriversRuntime extends RoomRuntime<
  FuseDriversRoom,
  FuseDriversEntry,
  FuseDriversView,
  FuseDriversEvent,
  FuseDriversSettings
> {
  /** The bitmask this device last logged; -1 before it has logged any, so the first press always sends. */
  private held = -1;

  constructor(
    code: string,
    settings: FuseDriversSettings,
    callbacks: FuseDriversCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuseDriversGame, code, settings, callbacks, options);
  }

  /** Logs the controls when they differ from the ones last logged. */
  drive(input: TruckInput): void {
    const bits = packControls(input);
    if (bits === this.held) return;
    this.held = bits;
    this.append(CONTROLS, bits);
    this.sendPackets(this.deps.now());
  }

  protected override resetControls(): void {
    this.held = -1;
  }

  /** A hidden page or a closing room must not leave a truck holding a turn for everyone else to watch. */
  protected override releaseControls(): void {
    if (this.held > 0) {
      this.held = 0;
      this.append(CONTROLS, 0);
    }
  }

  protected override absentControls(): void {
    if (this.held !== -1) this.resetControls();
  }

  /** The newest simulated room, for the receipts a device reports; the screen renders from the view. */
  roomState(): FuseDriversRoom | undefined {
    return this.world?.state;
  }

  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
}
