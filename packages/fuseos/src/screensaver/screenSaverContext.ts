import { createContext } from "react";

import type {
  ScreenSaverPrefs,
  ScreenSaverPrefsPatch,
} from "./screenSaverStore";
import { DEFAULT_SCREEN_SAVER_PREFS } from "./screenSaverStore";

export type ScreenSaverSnapshot = {
  prefs: ScreenSaverPrefs;
  /** The saver is on screen (idle timeout or Preview). */
  active: boolean;
};

export type ScreenSaverControls = {
  getSnapshot: () => ScreenSaverSnapshot;
  /** Saves a partial change; `pipes` is merged field by field. */
  configure: (patch: ScreenSaverPrefsPatch) => void;
  /** Starts the saver now, whatever the wait; throws when the desktop is shut down or the tab hidden. */
  preview: () => void;
  stop: () => void;
};

const initial: ScreenSaverSnapshot = {
  prefs: DEFAULT_SCREEN_SAVER_PREFS,
  active: false,
};

export const ScreenSaverContext = createContext<{
  snapshot: ScreenSaverSnapshot;
  controls: ScreenSaverControls;
}>({
  snapshot: initial,
  controls: {
    getSnapshot: () => initial,
    configure: () => undefined,
    preview: () => undefined,
    stop: () => undefined,
  },
});
