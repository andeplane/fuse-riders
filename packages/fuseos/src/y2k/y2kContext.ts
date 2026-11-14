import { createContext } from "react";

import type { Y2kPhase } from "./y2kSequence";

/** What the desktop sees of the running sequence; `phase` is null in real time. */
export type Y2kView = {
  phase: Y2kPhase | null;
  /** The user prefers reduced motion: no flicker, no scramble, a still garbled clock. */
  reducedMotion: boolean;
  /** Starts the sequence right now (the hidden trigger, a demo); does not count as the day's run. */
  trigger: () => void;
};

export const Y2kContext = createContext<Y2kView>({
  phase: null,
  reducedMotion: false,
  trigger: () => undefined,
});
