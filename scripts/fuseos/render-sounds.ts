/**
 * Renders every FuseOS system sound to a WAV file with the same synthesis code the desktop
 * runs, so they can be listened to outside a browser:
 *
 *   pnpm exec tsx scripts/fuseos/render-sounds.ts <out-dir> [event ...]
 *
 * Writes <out-dir>/<event>.wav (16-bit mono, 44.1 kHz) for each event, all of them by default.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  isSystemSoundEvent,
  SYSTEM_SOUND_EVENTS,
} from "../../packages/fuseos/src/sounds/soundEvents";
import { loadSynth } from "../../packages/fuseos/src/sounds/synth";
import { encodeWav } from "../../packages/fuseos/src/sounds/synth/wav";

const SAMPLE_RATE = 44100;

async function main(args: string[]): Promise<void> {
  const [outDir, ...wanted] = args;
  if (!outDir) {
    console.error("usage: render-sounds.ts <out-dir> [event ...]");
    process.exitCode = 2;
    return;
  }
  const events = wanted.length > 0 ? wanted : [...SYSTEM_SOUND_EVENTS];
  mkdirSync(outDir, { recursive: true });
  for (const event of events) {
    if (!isSystemSoundEvent(event)) {
      console.error(
        `unknown sound: ${event} (one of ${SYSTEM_SOUND_EVENTS.join(", ")})`,
      );
      process.exitCode = 2;
      return;
    }
    const render = await loadSynth(event);
    const samples = render(SAMPLE_RATE);
    const path = join(outDir, `${event}.wav`);
    writeFileSync(path, encodeWav(samples, SAMPLE_RATE));
    console.log(`${path}  ${(samples.length / SAMPLE_RATE).toFixed(2)} s`);
  }
}

await main(process.argv.slice(2));
