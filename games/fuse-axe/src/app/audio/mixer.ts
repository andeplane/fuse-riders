import { Sequencer, type Song } from "./music.js";
import { fits, type Sound, type Voice } from "./sounds.js";

/** The loop's voices are handed to the audio clock this many seconds ahead, every `PUMP_MS`. */
export const AHEAD = 0.15,
  PUMP_MS = 40;

/** The graph a voice goes into: the effects and jingles, or the loop, which ducks under them. */
export type Bus = "effects" | "loop";

/** The audio graph as the mixer sees it: a Web Audio context in the browser (`web-backend.ts`), a recorder in tests. */
export interface Synth {
  /** Seconds on the audio clock, which stands still while the context is suspended. */
  readonly time: number;
  /** Whether that clock runs: not until a gesture resumes it, nor while the tab is hidden. */
  readonly running: boolean;
  /** Renders `voice` from `at` into `bus`, and calls `ended` once it has stopped and its nodes are off the graph. */
  voice(voice: Voice, at: number, bus: Bus, ended: () => void): void;
}

/** Calls `tick` every `ms` until the function it returns is called: `setInterval` in the browser, by hand in tests. */
export type Repeat = (tick: () => void, ms: number) => () => void;

/**
 * Decides which voices reach the graph and when: a cue's at once if the voices still sounding leave it room (`fits`),
 * the loop's a little ahead of time on every pump. Every voice counts until it ends, the loop's too, so a loud loop
 * leaves fewer for the effects, but the cap never holds the loop back. A clock that is not running is handed nothing:
 * whatever is scheduled on a suspended context sounds all at once when it resumes.
 */
export class Mixer {
  private live = 0;
  private stopPump?: () => void;

  constructor(
    private readonly synth: Synth,
    private readonly repeat: Repeat,
  ) {}

  /** Voices scheduled and not yet ended. */
  get sounding(): number {
    return this.live;
  }

  play(sound: Sound): void {
    const { synth } = this;
    if (!synth.running || !fits(sound, this.live)) return;
    for (const voice of sound.voices)
      this.start(voice, synth.time + (voice.at ?? 0), "effects");
  }

  /** Loops `song` from a moment from now, or stops the loop on null; the loop's voices already scheduled play out. */
  music(song: Song | null): void {
    this.stopPump?.();
    this.stopPump = undefined;
    if (!song) return;
    const sequencer = new Sequencer(song, this.synth.time + 0.05);
    this.stopPump = this.repeat(() => this.pump(sequencer), PUMP_MS);
  }

  private pump(sequencer: Sequencer): void {
    const { synth } = this;
    if (!synth.running) return;
    for (const { at, voice } of sequencer.due(synth.time, AHEAD))
      this.start(voice, at, "loop");
  }

  private start(voice: Voice, at: number, bus: Bus): void {
    let ended = false;
    this.synth.voice(voice, at, bus, () => {
      if (ended) return;
      ended = true;
      this.live--;
    });
    // Counted once the graph has it: a voice that failed to render never holds a place.
    this.live++;
  }
}
