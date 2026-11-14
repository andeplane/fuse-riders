import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  EARLY_MS,
  LATE_MS,
  MAX_SONG_MS,
  MIN_SONG_MS,
  RELEASE,
  TICK_MS,
  USE,
  forecast,
  toView,
  type Pending,
  type WorldView,
} from "../engine/index.js";
import {
  PICK,
  PLAY,
  type Entry,
  type FusemaniaGame,
  type Room,
  type Settings,
  type View,
} from "./game.js";

export type FusemaniaCallbacks = Callbacks<View, never, Settings>;

/** An input this device logged and the room may not have folded yet. */
interface Logged {
  tick: number;
  epoch: number;
  code: number;
  ms: number;
}

/**
 * The Fusemania room: the netcode's runtime plus this device's keys. A key is logged the moment it moves, stamped
 * with the song time the device heard, and judged at that time whenever the room folds it; until then `picture`
 * plays this device's unfolded keys forward on a copy, so the screen shows a press at once and the fold changes
 * nothing it showed.
 */
export class FusemaniaRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private logged: Logged[] = [];
  /** Per column: whether this device has the key down in the room's log. */
  private down = [false, false, false, false];
  /** The match `down` is about: a new match starts with every key up. */
  private epoch = -1;
  /** How much room the newest logged input had inside its tick's bounds, ms; negative when the fold will move it. */
  private slack: number | undefined;
  constructor(
    code: string,
    settings: Settings,
    callbacks: FusemaniaCallbacks,
    private readonly fusemania: FusemaniaGame,
    options: RuntimeOptions = {},
  ) {
    super(fusemania, code, settings, callbacks, options);
  }
  /** The match this device plays in right now, if it does. */
  private playing(): { room: Room; slot: number } | undefined {
    const room = this.world?.state;
    if (!room || room.stage !== "running" || !this.player()?.connected) return;
    const slot = room.roster.findIndex((entrant) => entrant.id === this.id);
    return slot < 0 ? undefined : { room, slot };
  }
  private log(room: Room, code: number, ms: number): void {
    const tick = this.recorder.next();
    this.logged = this.logged.filter((entry) => entry.tick > room.tick);
    this.logged.push({ tick, epoch: room.epoch, code, ms });
    this.slack = undefined;
    if (room.world) {
      // The fold takes a timestamp no further than `LATE_MS` behind its tick and `EARLY_MS` ahead (`applyInput`).
      const at = room.world.ms + (tick - room.tick) * TICK_MS;
      this.slack = Math.min(ms - (at - TICK_MS - LATE_MS), at + EARLY_MS - ms);
    }
    this.recorder.at(tick, [
      PLAY,
      room.epoch,
      code,
      Math.max(MIN_SONG_MS, Math.min(MAX_SONG_MS, Math.round(ms))),
    ]);
    this.sendPackets(this.deps.now());
  }
  /** The key of `column` went down (or came up) at song time `ms`. Returns whether it was logged. */
  key(column: number, down: boolean, ms: number): boolean {
    const playing = this.playing();
    if (!playing || column < 0 || column >= RELEASE || !Number.isFinite(ms))
      return false;
    if (playing.room.epoch !== this.epoch) {
      this.epoch = playing.room.epoch;
      this.down = [false, false, false, false];
    }
    if (this.down[column] === down) return false;
    this.down[column] = down;
    this.log(playing.room, down ? column : column + RELEASE, ms);
    return true;
  }
  /** Throws (or uses) the power-up in hand. */
  useItem(ms: number): boolean {
    const playing = this.playing();
    if (!playing || !Number.isFinite(ms)) return false;
    this.log(playing.room, USE, ms);
    return true;
  }
  /** Plays chart `chart` from the next match on. */
  pick(chart: number): void {
    if (!this.world?.state || !this.player()) return;
    this.append(PICK, chart);
    this.sendPackets(this.deps.now());
  }
  /**
   * Where the room's shared clock says the song is right now, in ms (negative during the lead-in), or undefined when
   * no match is running. The audio follows this; a rider's own picture follows the audio.
   */
  songMs(): number | undefined {
    const room = this.world?.state;
    if (!room?.world || room.stage !== "running") return;
    return room.world.ms + (this.clock.tick() - room.tick) * TICK_MS;
  }
  /**
   * The match to draw: the newest folded world, with this device's unfolded keys applied and its own run settled up
   * to `now` (the song time it judges at). A watcher gets the folded world as it is.
   */
  picture(now: number): WorldView | undefined {
    const room = this.world?.state;
    if (!room?.world) return;
    const library = this.fusemania.library;
    const slot = room.roster.findIndex((entrant) => entrant.id === this.id);
    if (slot < 0 || room.stage !== "running")
      return toView(library, room.world);
    const pending: Pending[] = [];
    for (const entry of this.logged)
      if (entry.tick > room.tick && entry.epoch === room.epoch)
        pending.push({
          code: entry.code,
          ms: entry.ms,
          at: room.world.ms + (entry.tick - room.tick) * TICK_MS,
        });
    return toView(library, forecast(library, room.world, slot, pending, now));
  }
  /**
   * How far inside its tick's bounds the newest input this device logged was, in ms of song time; undefined before
   * the first. Diagnostics: an input is judged at its own song time as long as this is not negative, and a negative
   * one is where the room's clock (and so the network) would reach a judgment.
   */
  get lastSlackMs(): number | undefined {
    return this.slack;
  }
  /** The newest simulated room, for reports and tests. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
  /** Lets go of every key this device holds in the log, at song time `ms`. */
  letGo(ms: number): void {
    for (let column = 0; column < RELEASE; column++)
      if (this.down[column]) this.key(column, false, ms);
  }
  /** The log was reset (a resync): what was logged is gone, and so is what it held. */
  protected resetControls(): void {
    this.logged = [];
    this.down = [false, false, false, false];
  }
  protected releaseControls(): void {
    const ms = this.songMs();
    if (ms !== undefined) this.letGo(ms);
    this.down = [false, false, false, false];
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
