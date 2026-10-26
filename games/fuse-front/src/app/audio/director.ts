import type { WorldView } from "../../engine/index.js";
import type { StampedEvent } from "../../render/cues.js";
import {
  CueGate,
  Limiter,
  MIN_GAIN,
  cuesOf,
  spatial,
  type Camera,
} from "./cues.js";
import { SOUNDS, type CueKind, type Sound } from "./sounds.js";

/** What the director drives: Web Audio in the browser (`web-backend.ts`), a recorder in tests. */
export interface AudioBackend {
  /** Seconds on a clock that runs while the page does: the limiter's. */
  now(): number;
  /** A user gesture: make or resume the audio context, which browsers hold silent until one. */
  unlock(): void;
  /** Whether a sound played now would be heard: the context exists and runs. */
  ready(): boolean;
  /** Plays `sound` at `gain` (0..1) and stereo `pan` (-1 left .. 1 right). */
  play(sound: Sound, gain: number, pan: number): void;
  /** The tab was hidden (silence everything) or shown again. */
  hide(hidden: boolean): void;
}

export type Channel = "music" | "effects";
/** Where this browser's two choices are kept: "0" is off, anything else (or nothing) on. */
export type AudioKeys = Readonly<Record<Channel, string>>;

export interface AudioStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The cues that come by the dozen in a fight, and the level below which they make no voice. */
// prettier-ignore
const BUSY = new Set<CueKind>(["rifle", "flamer", "sentry", "heroShot", "robotDeath"]);
const BUSY_GAIN = 0.2;

/** The interface's own sounds, and this seat's gold pop. */
// prettier-ignore
export type UiCue = Extract<CueKind, "click" | "hover" | "buy" | "sell" | "confirm" | "invalid" | "gold">;

/**
 * Fuse Front's sound: it hears every engine event the runtime delivers (`event`), each once however often rollback
 * re-runs its step, and plays its cue placed against the camera (`camera`, set every frame). Nothing sounds before a
 * user gesture (`unlock`) nor while the tab is hidden. The MUSIC and EFFECTS choices are this browser's, kept in
 * `store`; a page opened with `?mute` (`muted`) never sounds, never touches the backend, and neither reads nor writes
 * them.
 */
export class FrontAudio {
  /** Cues heard and cues played: what a smoke test reads (a muted page hears them all and plays none). */
  heard = 0;
  played = 0;
  /** The camera's box the cues are placed against; none (before the first frame) plays everything centred. */
  camera: Camera | undefined;
  private readonly gate = new CueGate();
  private readonly limiter = new Limiter();
  private readonly on: Record<Channel, boolean>;
  private unlocked = false;
  private hidden = false;
  private shown = { matchId: "", step: 0 };

  constructor(
    private readonly backend: AudioBackend,
    private readonly store: AudioStore,
    private readonly keys: AudioKeys,
    readonly muted: boolean,
  ) {
    const stored = (channel: Channel) =>
      !muted && store.getItem(keys[channel]) !== "0";
    this.on = { music: stored("music"), effects: stored("effects") };
  }

  /** "muted" by `?mute`, "waiting" for a gesture, "hidden", or "on". */
  get state(): "muted" | "waiting" | "hidden" | "on" {
    if (this.muted) return "muted";
    if (!this.unlocked) return "waiting";
    return this.hidden ? "hidden" : "on";
  }

  /** Whether this browser chose to hear `channel`. */
  enabled(channel: Channel): boolean {
    return this.on[channel];
  }
  set(channel: Channel, on: boolean): void {
    if (this.muted || on === this.on[channel]) return;
    this.on[channel] = on;
    this.store.setItem(this.keys[channel], on ? "1" : "0");
  }

  unlock(): void {
    if (this.muted || this.hidden) return;
    this.unlocked = true;
    this.safely((backend) => backend.unlock());
  }

  hide(hidden: boolean): void {
    if (this.muted || hidden === this.hidden) return;
    this.hidden = hidden;
    this.limiter.reset();
    if (this.unlocked) this.safely((backend) => backend.hide(hidden));
  }

  /** An engine event, stamped with its step, for this device's `seat` (-1 watches) over the `world` shown. */
  event(
    matchId: string,
    stamped: StampedEvent,
    world: WorldView | undefined,
    seat: number,
  ): void {
    // The shown world's step counts only for its own match: a new match's first events are never "late".
    const shown = this.shown.matchId === matchId ? this.shown.step : 0;
    if (!this.gate.accept(matchId, stamped, shown)) return;
    // Silent pages skip the work, but a `?mute` page still counts its cues for smoke tests.
    if (!this.muted && !this.live()) return;
    for (const cue of cuesOf(stamped.event, world, seat)) {
      this.heard++;
      const { gain, pan } =
        cue.at && world && this.camera
          ? spatial(cue.at, this.camera, world)
          : { gain: 1, pan: 0 };
      // A quiet, off-screen gunshot must not take the slot of one on screen.
      if (gain >= (BUSY.has(cue.kind) ? BUSY_GAIN : MIN_GAIN))
        this.play(cue.kind, gain, pan);
    }
  }

  /** A frame of `world` is shown: its step is the newest the late-event window counts for its match. */
  frame(matchId: string, world: WorldView): void {
    this.shown = { matchId, step: world.step };
  }

  /** A sound of the interface: a buy, a sell, a confirmed target, a refused order. */
  ui(kind: UiCue): void {
    this.heard++;
    this.play(kind, 1, 0);
  }

  /** This seat's last hit paid gold on `step`: its ka-ching, unless that step is too old to sound. */
  gold(step: number): void {
    if (this.gate.fresh(step)) this.ui("gold");
  }

  private live(): boolean {
    return this.on.effects && this.unlocked && !this.hidden;
  }

  private play(kind: CueKind, gain: number, pan: number): void {
    if (!this.live() || !this.ready()) return;
    if (!this.limiter.allow(kind, this.backend.now())) return;
    const sound = SOUNDS[kind];
    this.played++;
    this.safely((backend) => backend.play(sound, gain, pan));
  }

  private ready(): boolean {
    try {
      return this.backend.ready();
    } catch {
      return false;
    }
  }

  /** A backend that fails costs the page that sound, never the frame it came with. */
  private safely(act: (backend: AudioBackend) => void): void {
    try {
      act(this.backend);
    } catch {
      // Silent: audio never gets in the way of the game.
    }
  }
}
