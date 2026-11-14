import { createContext } from "react";

/** What the taskbar clock shows instead of the real time, while something (the Y2K sequence) overrides it. */
export type ClockDisplay = {
  text: string;
  /** Extra class on the <time>, e.g. for a jitter animation. */
  className?: string;
};

/** Null means the clock shows the real time. */
export const ClockDisplayContext = createContext<ClockDisplay | null>(null);
