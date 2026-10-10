import type { Store } from "../session.js";
import { CueTracker, type Heard } from "./cues.js";
import { SOUNDS, type Sound } from "./sounds.js";

/** What the director drives: WebAudio in the browser (`web-backend.ts`), a recorder in tests. */
export interface AudioBackend {
  /** A user gesture: make or resume the audio context, which browsers hold silent until one. */
  unlock(): void;
  play(sound: Sound): void;
  /** The tab was hidden (silence everything) or shown again. */
  hide(hidden: boolean): void;
}

/** Where the two choices are kept: "0" is off, anything else (or nothing) on. */
export interface AudioKeys {
  music: string;
  effects: string;
}

/**
 * The page's sound: it hears every frame (`frame`) and plays the cues that frame brings, the jingles on the music
 * channel and the rest on the effects channel. Nothing sounds before a user gesture (`unlock`), since browsers refuse
 * audio until one, nor while the tab is hidden. The MUSIC and EFFECTS choices are this browser's, kept in `store`; a
 * page opened with `?mute` (`muted`) never sounds, never touches the backend and neither reads nor writes them.
 */
export class AxeAudio {
  /** Cues heard so far, played or not: what a muted page shows a smoke test. */
  heard = 0;
  private readonly tracker = new CueTracker();
  private musicOn: boolean;
  private effectsOn: boolean;
  private unlocked = false;
  private hidden = false;

  constructor(
    private readonly backend: AudioBackend,
    private readonly store: Pick<Store, "getItem" | "setItem">,
    private readonly keys: AudioKeys,
    readonly muted: boolean,
  ) {
    this.musicOn = !muted && store.getItem(keys.music) !== "0";
    this.effectsOn = !muted && store.getItem(keys.effects) !== "0";
  }

  get music(): boolean {
    return this.musicOn;
  }
  get effects(): boolean {
    return this.effectsOn;
  }
  /** What the page is doing for sound: "muted" by `?mute`, "waiting" for a gesture, "hidden" or "on". */
  get state(): "muted" | "waiting" | "hidden" | "on" {
    if (this.muted) return "muted";
    if (!this.unlocked) return "waiting";
    return this.hidden ? "hidden" : "on";
  }

  setMusic(on: boolean): void {
    if (this.muted || on === this.musicOn) return;
    this.musicOn = on;
    this.store.setItem(this.keys.music, on ? "1" : "0");
  }
  setEffects(on: boolean): void {
    if (this.muted || on === this.effectsOn) return;
    this.effectsOn = on;
    this.store.setItem(this.keys.effects, on ? "1" : "0");
  }

  /** A user gesture. Every one reaches the backend, which resumes a context the browser suspended again. */
  unlock(): void {
    if (this.muted || this.hidden) return;
    this.unlocked = true;
    this.backend.unlock();
  }

  hide(hidden: boolean): void {
    if (this.muted || hidden === this.hidden) return;
    this.hidden = hidden;
    if (this.unlocked) this.backend.hide(hidden);
  }

  /** A new frame: its cues play, each on its channel if that is on. */
  frame(frame: Heard): void {
    const cues = this.tracker.next(frame);
    this.heard += cues.length;
    if (this.muted || !this.unlocked || this.hidden) return;
    for (const cue of cues) {
      const sound = SOUNDS[cue];
      if (sound.channel === "music" ? this.musicOn : this.effectsOn)
        this.backend.play(sound);
    }
  }
}
