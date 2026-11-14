import { createContext } from "react";

import type { SoundService } from "./soundService";
import { SilentSoundService } from "./soundService";

/**
 * The sound service in force. `main.tsx` provides the Web Audio one; the default keeps the
 * applet working but silent, which is also what every test sees unless it passes its own.
 */
export const SoundServiceContext = createContext<SoundService>(
  new SilentSoundService(),
);
