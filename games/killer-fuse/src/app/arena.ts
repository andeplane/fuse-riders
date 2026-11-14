import type { Frame, FrameTiming } from "fuse-netcode";
import type { GameEvent } from "../engine/index.js";
import type { View } from "../online/index.js";
import type {
  ArenaOptions,
  ArenaView,
  SoundCue,
  TickEvents,
} from "../render/api.js";

/**
 * Between the room and the renderer (`src/render/api.ts`). The room hands over a frame per log tick and, before
 * it, every event the fold produced (`event`); the renderer wants each tick's events fed once (`advance`, which
 * starts effects and sounds) and a picture per display frame between the two newest (`render`). The arena exists
 * while there is a game to show and this device shows it.
 */
export interface ArenaSetup<Host = HTMLElement> {
  /** The renderer's `createArenaView`, handed in so a test can stand in for it. */
  create: (host: Host, options: ArenaOptions) => ArenaView;
  host: Host;
  artUrl: string;
  /** The runtime's `frameTiming`. */
  timing: () => FrameTiming<View> | undefined;
  /** The runtime's `confirmedTick`: the game clock no rollback can reach back past. */
  confirmed: () => number;
  /** Called when the arena plays something loud, so the page's music steps back under it. */
  duck?: () => void;
}

/** The queue may hold this many ticks' events; a frame always drains it, so more means frames stopped coming. */
export const QUEUE_LIMIT = 64;

/**
 * Events the runtime delivered and no frame has carried to the renderer yet. The runtime folds several ticks at
 * once and publishes one frame, and a rollback re-runs ticks and publishes the newest, so the frame's own events
 * (`View.world.events`, the newest tick's) are not all of them: the event callback is, once per tick and index.
 */
export class EventQueue {
  private game = "";
  private readonly ticks = new Map<number, GameEvent[]>();

  add(event: GameEvent, matchId: string, round: number, tick: number): void {
    const game = `${matchId}:${round}`;
    // Events of another game than the last fed are the next one's; those of a finished one are of no use.
    if (game !== this.game) {
      this.ticks.clear();
      this.game = game;
    }
    const list = this.ticks.get(tick);
    if (list) list.push(event);
    else this.ticks.set(tick, [event]);
    if (this.ticks.size > QUEUE_LIMIT) {
      const oldest = Math.min(...this.ticks.keys());
      this.ticks.delete(oldest);
    }
  }

  /**
   * The ticks of `frame`'s game up to its own, oldest first, with the frame's own events as its tick's (the frame
   * is the truth for that tick after a rollback; what was queued for it is the same events or overturned ones).
   * Ticks taken are forgotten; ticks of another game are dropped.
   */
  take(frame: Frame<View>, newest: readonly GameEvent[]): TickEvents[] {
    const game = `${frame.matchId}:${frame.round}`;
    if (game !== this.game) {
      this.ticks.clear();
      this.game = game;
    }
    const found: TickEvents[] = [];
    for (const tick of [...this.ticks.keys()].sort((a, b) => a - b)) {
      if (tick >= frame.tick) {
        if (tick === frame.tick) this.ticks.delete(tick);
        continue;
      }
      found.push({ tick, events: this.ticks.get(tick)! });
      this.ticks.delete(tick);
    }
    found.push({ tick: frame.tick, events: newest });
    return found;
  }

  clear(): void {
    this.ticks.clear();
    this.game = "";
  }

  get size(): number {
    return this.ticks.size;
  }
}
export interface ArenaLook {
  names: readonly string[];
  localSlot: number;
  muted: boolean;
  /** Outline this device's unit (a few seconds after it spawns, respawns or transforms). */
  highlight: boolean;
  /** Let the synthesised music bed run: off while a music file plays, and off with the music switched off. */
  bed: boolean;
}

const sameGame = (a: Frame<View>, b: Frame<View>): boolean =>
  a.matchId === b.matchId && a.round === b.round;

export class ArenaDriver<Host = HTMLElement> {
  private arena: ArenaView | undefined;
  private look: ArenaLook = {
    names: [],
    localSlot: -1,
    muted: false,
    highlight: false,
    bed: true,
  };
  private shown = "";
  private fed: Frame<View> | undefined;
  private readonly queue = new EventQueue();
  constructor(private readonly setup: ArenaSetup<Host>) {}
  /**
   * One event from the runtime's `event` callback: kept for the frame that carries its tick to the renderer. With
   * no arena on the page (the lobby, a phone that is only a controller) there is nothing to play it, and an arena
   * opened later must not start on seconds of old events, so it is dropped.
   */
  event(event: GameEvent, matchId: string, round: number, tick: number): void {
    if (this.arena) this.queue.add(event, matchId, round, tick);
  }
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
      highlight: look.highlight,
      bed: look.bed,
    });
  }

  /**
   * One sound the page asks for, the countdown's: dropped when there is no arena to play it, since this device is
   * then in the lobby or only a controller.
   */
  cue(cue: SoundCue): void {
    this.arena?.cue(cue);
  }
  /**
   * The room's newest frame, from the runtime's `state` callback: once per new log tick, and again when a rollback
   * replaced it (the renderer does not double an effect it already played). It carries the events queued since the
   * last frame, and the runtime's confirmed tick, past which the renderer may play what cannot be taken back.
   * `show` is false where this device does not draw the arena: the lobby, or a phone that is only a controller.
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
        highlight: this.look.highlight,
        bed: this.look.bed,
        ...(this.setup.duck ? { duck: this.setup.duck } : {}),
      });
      // A failed load leaves an empty arena; the page's own screens still work.
      this.arena.ready.catch(() => undefined);
    }
    if (frame === this.fed) return;
    this.fed = frame;
    this.arena.advance(frame.world, {
      ticks: this.queue.take(frame, frame.world.events),
      confirmed: this.setup.confirmed(),
    });
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
    this.queue.clear();
  }
}
