import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { ATTACK, INPUT_MASK, type HeroKind } from "../engine/index.js";
import {
  CONTINUE,
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
  /** What was logged last: the bits, and for which run, stage and camp (`matchId:round:camp`). */
  private sent = { phase: "", bits: 0 };
  /** The countdown (run, stage and its end tick) this device last voted in, so a held or mashed Attack votes once. */
  private voted = "";
  constructor(
    code: string,
    settings: Settings,
    callbacks: AxeCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(axeGame, code, settings, callbacks, options);
  }
  /**
   * Holds `bits` from now on; logs them if the room is in a run and this device plays a hero in it. A fresh press of
   * Attack while the continue countdown runs is also this device's vote to continue (`continueRun`).
   */
  input(bits: number): void {
    const attack = bits & ~this.bits & ATTACK;
    this.bits = bits & INPUT_MASK;
    if (attack) this.continueRun();
    this.flush();
  }
  /**
   * Votes to continue the run once every hero is out. Refused unless the fold would count it: the continue countdown
   * runs, and this device is present (not hidden, not logged absent) in the seat of a hero in the world. A vote is
   * logged once a countdown. `true` means it was logged, not that it landed: another hero's vote, or the countdown
   * running out first, settles it, and the screen shows what the room did.
   */
  continueRun(): boolean {
    const room = this.world?.state,
      seat = this.player();
    if (
      !room?.world ||
      room.stage !== "running" ||
      room.until === 0 ||
      !seat?.connected ||
      this.hiddenState ||
      !room.world.heroes.some((hero) => hero.seat === seat.slot)
    )
      return false;
    const countdown = `${room.matchId}:${room.round}:${room.until}`;
    if (this.voted === countdown) return false;
    this.voted = countdown;
    this.append(CONTINUE, room.matchId, room.round);
    this.sendPackets(this.deps.now());
    return true;
  }
  /**
   * Re-logs the held bits when the stage has moved on since they were last logged, in play or at camp (which the fold
   * starts with nothing held too). The runtime does not call it on its own: the page calls it from its `state`
   * callback, so a key held across the start of a run, a camp or a stage is logged for the new one without a fresh key
   * event.
   */
  flush(): void {
    const room = this.world?.state,
      seat = this.player();
    if (
      !room?.world ||
      (room.stage !== "running" && !room.world.camp) ||
      !seat?.connected ||
      !room.world.heroes.some((hero) => hero.seat === seat.slot)
    )
      return;
    const phase = `${room.matchId}:${room.round}:${room.world.camp}`;
    if (phase === this.sent.phase && this.bits === this.sent.bits) return;
    this.sent = { phase, bits: this.bits };
    this.append(PLAY, room.matchId, room.round, this.bits);
    this.sendPackets(this.deps.now());
  }
  /**
   * Picks this member's hero for the next run. Refused unless every condition the fold applies a pick under holds
   * here: a seat that is present (not a watcher, and not absent or away, whose entries the fold skips) in the lobby or
   * once the run is over, the only stages that apply one. `true` means the pick was logged, not that it landed: the
   * room can start a run before the entry's tick, and the fold then drops it, so the screen shows the hero a seat
   * plays from the view (`SeatView.hero`), never from this return.
   */
  pick(hero: HeroKind): boolean {
    if (
      !isHero(hero) ||
      !this.player()?.connected ||
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
  /**
   * The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down and a
   * vote to continue that was lost with the log can be cast again.
   */
  protected resetControls(): void {
    this.sent = { phase: "", bits: 0 };
    this.voted = "";
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
