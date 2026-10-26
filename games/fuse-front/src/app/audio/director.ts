import {
  NO_WINNER,
  SUB,
  TILE_PX,
  WAVE_EVERY,
  WAVE_FIRST,
  teamOf,
  type CombatEvent,
  type WorldView,
} from "../../engine/index.js";
import type { StampedEvent } from "../../render/cues.js";
import {
  CueGate,
  LATE_STEPS,
  Limiter,
  MIN_GAIN,
  cuesOf,
  spatial,
  type Camera,
} from "./cues.js";
import {
  MOODS,
  MoodTracker,
  OUTROS,
  Sequencer,
  type Mood,
  type Scene,
} from "./music.js";
import { SOUNDS, type CueKind, type Sound, type Voice } from "./sounds.js";

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
  /** Seconds on the audio clock while it runs; none before a gesture, while suspended or without Web Audio. */
  time(): number | undefined;
  /** Renders a music voice at `at` on the audio clock, on the music bus. */
  schedule(voice: Voice, at: number): void;
  /** Lowers the effects and music for `seconds` under a sting. */
  duck(seconds: number): void;
  /** The tab was hidden (silence everything) or shown again. */
  hide(hidden: boolean): void;
}

/** Calls `tick` every `ms`: `setInterval` in the browser, by hand in tests. */
export type Repeat = (tick: () => void, ms: number) => void;
/** The music's voices go to the audio clock this far ahead, every `PUMP_MS`. */
export const AHEAD = 0.2;
export const PUMP_MS = 50;
/** Sub-pixels from this seat's hero within which combat heats the music. */
const NEAR = 12 * SUB * TILE_PX;

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
 * user gesture (`unlock`) nor while the tab is hidden. Its pump plays the music for the page's `scene` (`music.ts`),
 * heated by combat near this seat's hero and made tense by this side's losses. The MUSIC and EFFECTS choices are this browser's, kept in
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
  private wave = { matchId: "", index: 0 };
  /** When a press last sounded, so its button's click does not sound over it. */
  private pressed = -Infinity;
  private readonly mood = new MoodTracker();
  private current: Scene = { kind: "menu" };
  private sequencer: Sequencer | undefined;
  private outro: Mood | undefined;
  /** The mood the music last played, and the milliseconds its pump has spent: what a smoke test reads. */
  moodNow: Mood | undefined;
  musicMs = 0;

  constructor(
    private readonly backend: AudioBackend,
    private readonly store: AudioStore,
    private readonly keys: AudioKeys,
    readonly muted: boolean,
    repeat: Repeat,
  ) {
    const stored = (channel: Channel) =>
      !muted && store.getItem(keys[channel]) !== "0";
    this.on = { music: stored("music"), effects: stored("effects") };
    if (!muted) repeat(() => this.pump(), PUMP_MS);
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
    if (!this.muted) this.heat(stamped.event, world, seat);
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
    // A lane map's wave sounds a low horn as it leaves, once a wave, on time or not at all; a decided match's clock
    // runs on but sends no waves.
    if (world.winner !== NO_WINNER) return;
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

  /** Where the page is, for the music: the menus, a match under way, or one this side won or lost. */
  scene(scene: Scene): void {
    this.current = scene;
  }

  /** A sound of the interface. A button's click is dropped when its press already sounded (a buy, a buzz). */
  ui(kind: UiCue): void {
    const now = this.backend.now();
    if (kind === "click" && now - this.pressed < 0.05) return;
    if (kind !== "click" && kind !== "hover") this.pressed = now;
    this.heard++;
    this.play(kind, 1, 0);
  }

  /** Combat near this seat's hero heats the music up; a ruin of this side's makes it tense. */
  private heat(event: CombatEvent, world: WorldView | undefined, seat: number) {
    const now = this.backend.now();
    if (event.type === "destroyed") {
      const team = world?.buildings.find((b) => b.id === event.building)?.team;
      if (seat >= 0 && team === teamOf(seat)) this.mood.lost(now);
    }
    if (event.type !== "shot" && event.type !== "death") return;
    const hero = world?.heroes.find((h) => h.seat === seat && h.hp > 0);
    if (!hero) return;
    const at = event.type === "shot" ? event.to : event;
    if (Math.hypot(at.x - hero.x, at.y - hero.y) <= NEAR) this.mood.combat(now);
  }

  /**
   * The music's pump, every `PUMP_MS`: the mood from the scene, the loop's next voices handed to the audio clock
   * `AHEAD` seconds early, or the mood's outro once. Nothing while silent; a loop that stopped starts afresh.
   */
  private pump(): void {
    const started = this.backend.now();
    const time =
      this.muted || !this.unlocked || this.hidden || !this.on.music
        ? undefined
        : this.safelyGet(() => this.backend.time());
    if (time === undefined) {
      this.sequencer = undefined;
      return;
    }
    const mood = this.mood.next(this.current, started);
    this.moodNow = mood;
    if (mood === "victory" || mood === "defeat") {
      this.sequencer = undefined;
      if (this.outro !== mood)
        for (const { at, voice } of OUTROS[mood])
          this.safely((backend) => backend.schedule(voice, time + 0.4 + at));
      this.outro = mood;
    } else {
      this.outro = undefined;
      this.sequencer ??= new Sequencer(time + 0.05, MOODS[mood]);
      this.sequencer.play(MOODS[mood]);
      for (const { at, voice } of this.sequencer.due(time, AHEAD))
        this.safely((backend) => backend.schedule(voice, at));
    }
    this.musicMs += (this.backend.now() - started) * 1000;
  }

  private safelyGet<T>(get: () => T): T | undefined {
    try {
      return get();
    } catch {
      return undefined;
    }
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
    const { duck } = sound;
    if (duck) this.safely((backend) => backend.duck(duck));
  }

  private ready(): boolean {
    return this.safelyGet(() => this.backend.ready()) ?? false;
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
