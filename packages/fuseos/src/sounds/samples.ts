import floppyOpenUrl from "../assets/sounds/floppy-open.mp3";
import floppySeekUrl from "../assets/sounds/floppy-seek.mp3";

import type { SystemSoundEvent } from "./soundEvents";

/**
 * The sounds that are recordings rather than synthesis: a real 3½" drive (motor switching on, head seeks and
 * the step buzz) cut from one CC0 recording; source, author and licence are in
 * docs/fuseos/licenses/FLOPPY-SOUND.md. Only the addresses are bundled: a clip is fetched the first time its
 * sound plays, and the synthesiser stands in when it cannot be fetched or decoded.
 */
const SAMPLE_URLS: Partial<Record<SystemSoundEvent, string>> = {
  floppy: floppyOpenUrl,
  seek: floppySeekUrl,
};

/** The recording behind a sound, when it has one. */
export function sampleUrl(event: SystemSoundEvent): string | undefined {
  return SAMPLE_URLS[event];
}

/** The encoded clip for a sound, or undefined when the sound is synthesised. Rejects when the fetch fails. */
export type SampleLoader = (
  event: SystemSoundEvent,
) => Promise<ArrayBuffer | undefined>;

/** The slice of `fetch` a sample needs. */
export type SampleFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function createSampleLoader(
  fetchSample: SampleFetch,
  urlFor: (event: SystemSoundEvent) => string | undefined = sampleUrl,
): SampleLoader {
  return async (event) => {
    const url = urlFor(event);
    if (url === undefined) return undefined;
    const response = await fetchSample(url);
    if (!response.ok)
      throw new Error(`Sound sample ${url} answered ${response.status}`);
    return response.arrayBuffer();
  };
}
