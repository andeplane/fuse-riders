import type { SystemSoundEvent } from "./soundEvents";
import floppyOpenUrl from "./recordings/floppy-open.mp3?url";
import floppySeekUrl from "./recordings/floppy-seek.mp3?url";

/**
 * Real recordings that replace the synthesiser for some events: a 3½" drive taped by Verum384 on freesound.org
 * (sound 536950, CC0 1.0), cut into "motor on + two seeks" for opening A: and one head seek for every other
 * folder. Source, licence and the exact ffmpeg cuts: docs/fuseos/licenses/floppy-sounds.md. Each clip is
 * fetched the first time its sound plays, never at boot.
 */
export const RECORDING_URLS: Readonly<
  Partial<Record<SystemSoundEvent, string>>
> = {
  floppy: floppyOpenUrl,
  seek: floppySeekUrl,
};

/** `loadRecording` for `WebAudioSoundService`: fetches the event's clip, or undefined when it has none or the fetch fails. */
export function createRecordingLoader(
  fetchBytes: (url: string) => Promise<Response>,
  urls: Readonly<Partial<Record<SystemSoundEvent, string>>> = RECORDING_URLS,
): (event: SystemSoundEvent) => Promise<ArrayBuffer | undefined> {
  return async (event) => {
    const url = urls[event];
    if (url === undefined) return undefined;
    const response = await fetchBytes(url);
    return response.ok ? response.arrayBuffer() : undefined;
  };
}
