import { WAVE_EVERY, WAVE_FIRST, type WorldView } from "../../engine/index.js";
import type { StampedEvent } from "../../render/cues.js";
import {
  CueGate,
  Limiter,
  LATE_STEPS,
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
  /** Plays `sound` at `gain` (0..1) and stereo `pan` (-1 left .. 1 right). */
  play(sound: Sound, gain: number, pan: number): void;
  /** Lowers the effects and music for `seconds` under a sting. */
  duck(seconds: number): void;
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

/** The interface's own sounds, and this seat's gold pop. */
export type UiCue = Extract<
  CueKind,
  "click" | "hover" | "buy" | "sell" | "confirm" | "invalid" | "gold"
>;

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
  private wave = { matchId: "", index: 0 };

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
    if (!this.gate.accept(matchId, stamped, world?.step)) return;
    for (const cue of cuesOf(stamped.event, world, seat)) {
      this.heard++;
      const { gain, pan } =
        cue.at && world && this.camera
          ? spatial(cue.at, this.camera, world)
          : { gain: 1, pan: 0 };
      if (gain >= MIN_GAIN) this.play(cue.kind, gain, pan);
    }
  }

  /** A frame of `world`: a lane map's wave sounds a low horn as it leaves, once a wave, on time or not at all. */
  frame(matchId: string, world: WorldView): void {
    if (!world.lanes.length || world.step < WAVE_FIRST) return;
    const index = Math.floor((world.step - WAVE_FIRST) / WAVE_EVERY) + 1;
    const fresh = (world.step - WAVE_FIRST) % WAVE_EVERY <= LATE_STEPS;
    const known = this.wave.matchId === matchId ? this.wave.index : 0;
    this.wave = { matchId, index: Math.max(known, index) };
    if (index > known && fresh) {
      this.heard++;
      this.play("wave", 1, 0);
    }
  }

  /** A sound of the interface, or of this seat's own gold. */
  ui(kind: UiCue): void {
    this.heard++;
    this.play(kind, 1, 0);
  }

  private play(kind: CueKind, gain: number, pan: number): void {
    if (!this.on.effects || !this.unlocked || this.hidden) return;
    if (!this.limiter.allow(kind, this.backend.now())) return;
    const sound = SOUNDS[kind];
    this.played++;
    this.safely((backend) => backend.play(sound, gain, pan));
    const { duck } = sound;
    if (duck) this.safely((backend) => backend.duck(duck));
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
