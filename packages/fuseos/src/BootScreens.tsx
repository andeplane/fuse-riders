import bootSplash from "./assets/boot-splash.jpg";
import { OS_NAME } from "./desktop/windowMeta";

import "./BootScreens.css";

/** The sky blue behind the splash while the image decodes. */
export const BOOT_SKY = "#a9c6e8";

/**
 * The Windows 98 boot screen: the cloud splash with the flag and "FuseOS 98", and the
 * endlessly scrolling blue bar along the bottom edge, shown for at least `BOOT_HOLD_MS` so
 * a cached load still boots visibly.
 */
export function BootScreen() {
  return (
    <main
      className="win98 boot-screen relative h-full w-full overflow-hidden"
      style={{ backgroundColor: BOOT_SKY }}
      aria-live="polite"
      aria-label={`Starting ${OS_NAME}`}
    >
      <img
        src={bootSplash}
        alt={OS_NAME}
        className="boot-splash absolute inset-0 h-full w-full object-cover object-center"
      />
      <div
        className="boot-bar absolute bottom-0 left-0 w-full"
        role="progressbar"
        aria-label="Loading"
      >
        <div className="boot-bar-glow" />
      </div>
    </main>
  );
}
