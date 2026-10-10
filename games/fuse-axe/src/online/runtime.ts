import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { INPUT_MASK, type HeroKind } from "../engine/index.js";
import {
  PICK,
  PLAY,
  axeGame,
  picksApply,
  type Entry,
  type Room,
  type Settings,
  type View,
} from "./game.js";
import { isHero } from "./names.js";

export type AxeCallbacks = Callbacks<View, never, Settings>;

/**
 * The Fuse Axe room: the netcode's runtime plus this device's held controls and hero pick. A change of the held bits
 * is logged for the run and stage this device sees; a new stage (or run) logs them again, since the fold starts every
 * stage with nothing held.
 */
export class AxeRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", round: -1, bits: 0 };
  constructor(
    code: string,
    settings: Settings,
    callbacks: AxeCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(axeGame, code, settings, callbacks, options);
  }
  /** Holds `bits` from now on; logs them if the room is in a run and this device plays a hero in it. */
  input(bits: number): void {
    this.bits = bits & INPUT_MASK;
    this.flush();
  }
  /** Re-logs the held bits when the stage has moved on since they were last logged. */
  flush(): void {
    const room = this.world?.state,
      seat = this.player();
    if (
      !room?.world ||
      room.stage !== "running" ||
      !seat?.connected ||
      !room.world.heroes.some((hero) => hero.seat === seat.slot)
    )
      return;
    const { matchId, round, bits } = this.sent;
    if (matchId === room.matchId && round === room.round && bits === this.bits)
      return;
    this.sent = { matchId: room.matchId, round: room.round, bits: this.bits };
    this.append(PLAY, room.matchId, room.round, this.bits);
    this.sendPackets(this.deps.now());
  }
  /**
   * Picks this member's hero for the next run. Refused unless the room is in the lobby or the run is over, the only
   * stages whose fold applies a pick: one logged in a run or in camp between its stages would be dropped.
   */
  pick(hero: HeroKind): boolean {
    if (
      !isHero(hero) ||
      !this.player() ||
      this.hiddenState ||
      !picksApply(this.world!.state.stage)
    )
      return false;
    this.append(PICK, hero);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** The newest simulated room, for reports and tests; the screen renders from frames. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
  /** The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down. */
  protected resetControls(): void {
    this.sent = { matchId: "", round: -1, bits: 0 };
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
