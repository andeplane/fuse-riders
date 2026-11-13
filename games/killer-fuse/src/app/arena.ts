import type { Frame, FrameTiming } from "fuse-netcode";
import type { View } from "../online/index.js";
import type { ArenaOptions, ArenaView } from "../render/api.js";

/**
 * Between the room and the renderer (`src/render/api.ts`). The room hands over a frame per log tick; the renderer
 * wants each new step fed once (`advance`, which starts effects and sounds) and a picture per display frame between
 * the two newest (`render`). The arena exists while there is a game to show and this device shows it.
 */
export interface ArenaSetup<Host = HTMLElement> {
  /** The renderer's `createArenaView`, handed in so a test can stand in for it. */
  create: (host: Host, options: ArenaOptions) => ArenaView;
  host: Host;
  artUrl: string;
  /** The runtime's `frameTiming`. */
  timing: () => FrameTiming<View> | undefined;
}
export interface ArenaLook {
  names: readonly string[];
  localSlot: number;
  muted: boolean;
}

const sameGame = (a: Frame<View>, b: Frame<View>): boolean =>
  a.matchId === b.matchId && a.round === b.round;

export class ArenaDriver<Host = HTMLElement> {
  private arena: ArenaView | undefined;
  private look: ArenaLook = { names: [], localSlot: -1, muted: false };
  private shown = "";
  private fed: Frame<View> | undefined;
  constructor(private readonly setup: ArenaSetup<Host>) {}
  /** Whether the arena is on the page. */
  get open(): boolean {
    return this.arena !== undefined;
  }
  /** Who plays what and whether sound is on; the renderer hears only of changes. */
  update(look: ArenaLook): void {
    const key = JSON.stringify(look);
    this.look = look;
    if (key === this.shown) return;
    this.shown = key;
    this.arena?.update({
      names: [...look.names],
      localSlot: look.localSlot,
      muted: look.muted,
    });
  }
  /**
   * The room's newest frame, from the runtime's `state` callback: once per new log tick, and again when a rollback
   * replaced it (the renderer does not double an effect it already played). `show` is false where this device does
   * not draw the arena: the lobby, or a phone that is only a controller.
   */
  feed(frame: Frame<View>, show: boolean): void {
    if (!frame.world || !show) {
      this.close();
      return;
    }
    if (!this.arena) {
      this.arena = this.setup.create(this.setup.host, {
        artUrl: this.setup.artUrl,
        names: [...this.look.names],
        localSlot: this.look.localSlot,
        muted: this.look.muted,
      });
      // A failed load leaves an empty arena; the page's own screens still work.
      this.arena.ready.catch(() => undefined);
    }
    if (frame === this.fed) return;
    this.fed = frame;
    this.arena.advance(frame.world);
  }
  /** One display frame: the newest two frames of the same game blended at the presentation tick. */
  draw(): void {
    const timing = this.arena && this.setup.timing(),
      newer = timing?.newer,
      current = newer?.world;
    if (!this.arena || !timing || !newer || !current) return;
    const older = timing.older,
      previous = older && sameGame(older, newer) ? older.world : null;
    if (!older || !previous || !(newer.tick > older.tick)) {
      this.arena.render(current, current, 1);
      return;
    }
    const alpha = (timing.tick - older.tick) / (newer.tick - older.tick);
    this.arena.render(previous, current, Math.max(0, Math.min(1, alpha)));
  }
  resize(): void {
    this.arena?.resize();
  }
  close(): void {
    this.arena?.destroy();
    this.arena = undefined;
    this.fed = undefined;
  }
}
