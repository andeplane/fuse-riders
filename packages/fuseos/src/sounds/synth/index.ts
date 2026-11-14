import type { SystemSoundEvent } from "../soundEvents";

/** Renders one sound as mono samples at the given rate; pure and deterministic. */
export type SynthRenderer = (sampleRate: number) => Float32Array;

/**
 * The synthesiser for each event, loaded only when that sound first plays so the desktop's
 * initial bundle carries none of the DSP (the modem alone is a few kilobytes of code and
 * a second of CPU to render).
 */
export async function loadSynth(
  event: SystemSoundEvent,
): Promise<SynthRenderer> {
  switch (event) {
    case "modem":
      return (await import("./modem")).renderModem;
    case "floppy":
      return (await import("./floppy")).renderFloppy;
    case "seek":
      return (await import("./floppy")).renderDriveSeek;
    case "startup":
      return (await import("./chimes")).renderStartup;
    case "shutdown":
      return (await import("./chimes")).renderShutdown;
    case "ding":
      return (await import("./chimes")).renderDing;
    case "error":
      return (await import("./chimes")).renderError;
    case "recycle":
      return (await import("./chimes")).renderRecycle;
  }
}
