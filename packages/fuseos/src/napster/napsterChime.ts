/**
 * The little "you're connected" chime: three soft sine notes rising, synthesised on the spot so no audio file
 * (and nobody's recording) ships. Plays through whatever AudioContext the page may create; silent where there is
 * none, or where the page was opened with `?mute`.
 */

/** The slice of the Web Audio API the chime uses, so a test can hand in a silent one. */
export interface ChimeParam {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}

export interface ChimeNode {
  connect(node: ChimeNode): ChimeNode;
}

export interface ChimeAudioContext {
  readonly currentTime: number;
  readonly destination: ChimeNode;
  createGain(): ChimeNode & { gain: ChimeParam };
  createOscillator(): ChimeNode & {
    type: OscillatorType;
    frequency: ChimeParam;
    start(when: number): void;
    stop(when: number): void;
  };
  close(): Promise<void>;
}

/** E5, G#5, B5: a major arpeggio, bright and a bit cheesy, like the era. */
export const CHIME_NOTES: readonly { frequency: number; at: number }[] = [
  { frequency: 659.25, at: 0 },
  { frequency: 830.61, at: 0.11 },
  { frequency: 987.77, at: 0.22 },
];

export const CHIME_SECONDS = 1.1;

export function playChimeOn(context: ChimeAudioContext): void {
  const start = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.18, start);
  master.connect(context.destination);
  for (const note of CHIME_NOTES) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, start + note.at);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.setValueAtTime(0.0001, start + note.at);
    envelope.gain.linearRampToValueAtTime(1, start + note.at + 0.02);
    envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      start + note.at + CHIME_SECONDS - 0.3,
    );
    oscillator.connect(envelope).connect(master);
    oscillator.start(start + note.at);
    oscillator.stop(start + CHIME_SECONDS);
  }
}

/**
 * Builds the chime player over an AudioContext factory. A factory that throws or returns nothing means silence;
 * the context is closed once the notes are over.
 */
export function createChime(
  createContext: () => ChimeAudioContext | undefined,
  later: (callback: () => void, ms: number) => void,
): () => void {
  return () => {
    let context: ChimeAudioContext | undefined;
    try {
      context = createContext();
      if (!context) return;
      playChimeOn(context);
    } catch {
      // A garnish: a browser that refuses audio still connects.
      return;
    }
    const opened = context;
    later(
      () => {
        void opened.close().catch(() => undefined);
      },
      CHIME_SECONDS * 1000 + 200,
    );
  };
}
