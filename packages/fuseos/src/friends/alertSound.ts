/**
 * The "uh-oh": two short descending tones, synthesised so no audio file ships. The context is made on the first
 * alert (a browser only lets a page make sound after a gesture; the toasts follow clicks on the desktop, and a
 * blocked context simply stays silent).
 */
export type AudioContextFactory = () => AudioContext | undefined;

export const defaultAudioContextFactory: AudioContextFactory = () =>
  typeof AudioContext === "function" ? new AudioContext() : undefined;

export function createUhOhSound(
  factory: AudioContextFactory = defaultAudioContextFactory,
): () => void {
  let context: AudioContext | undefined;
  return () => {
    try {
      context ??= factory();
      if (!context) return;
      if (context.state === "suspended") void context.resume();
      const at = context.currentTime;
      for (const [frequency, start, length] of [
        [660, 0, 0.12],
        [440, 0.16, 0.2],
      ] as const) {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at + start);
        gain.gain.exponentialRampToValueAtTime(0.08, at + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + start + length);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at + start);
        oscillator.stop(at + start + length + 0.02);
      }
    } catch {
      // No audio here (an old browser, a blocked context): the toast is the alert.
    }
  };
}
