import { createContext } from "react";

import type { WinampRegistry } from "./winampRegistry";
import { createWinampRegistry } from "./winampRegistry";

/**
 * Playback is transient (not stored), so the running Winamp publishes its live controls here by
 * window id: the Office Assistant reads the queue for its status and presses the same transport
 * the mouse does. Mirrors `PaintRegistryContext`.
 */
export const WinampRegistryContext = createContext<WinampRegistry>(
  createWinampRegistry(),
);
