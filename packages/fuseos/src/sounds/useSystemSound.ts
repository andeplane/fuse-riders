import { useCallback, useContext, useSyncExternalStore } from "react";

import { SoundServiceContext } from "./soundContext";
import type { SystemSoundEvent } from "./soundEvents";
import type { SoundPrefs } from "./soundPrefsStore";
import type {
  SoundHandle,
  SoundPlayOptions,
  SoundService,
} from "./soundService";

export function useSoundService(): SoundService {
  return useContext(SoundServiceContext);
}

/**
 * `playSystemSound(event)` for any component: Explorer plays "floppy" when it opens a folder,
 * the Recycle Bin "recycle" when it empties, and so on. Returns the handle so a caller can cut
 * a long sound short.
 */
export function usePlaySystemSound(): (
  event: SystemSoundEvent,
  options?: SoundPlayOptions,
) => SoundHandle {
  const sounds = useSoundService();
  return useCallback(
    (event: SystemSoundEvent, options?: SoundPlayOptions) =>
      sounds.play(event, options),
    [sounds],
  );
}

/** The current preferences, re-rendering on every change (the Sounds applet). */
export function useSoundPrefs(): SoundPrefs {
  const sounds = useSoundService();
  return useSyncExternalStore(
    useCallback((listener) => sounds.subscribe(listener), [sounds]),
    () => sounds.prefs(),
    () => sounds.prefs(),
  );
}
