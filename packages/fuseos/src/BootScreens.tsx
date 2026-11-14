import { FuseOsSplash } from "./assets/FuseOsSplash";
import { OS_NAME } from "./desktop/windowMeta";

import "./BootScreens.css";

/**
 * The boot screen: the FuseOS splash (`assets/FuseOsSplash`) over black with a status line and,
 * along the bottom edge, the endlessly scrolling band of the Windows 95 boot screen in Fuse
 * neon. `App` keeps it up for at least `BOOT_HOLD_MS`, so a cached load still boots visibly.
 */
export function BootScreen() {
  return (
    <main
      className="win98 fuseos-boot relative flex h-full w-full flex-col items-center justify-center overflow-hidden"
      aria-live="polite"
      aria-label={`Starting ${OS_NAME}`}
    >
      <div className="fuseos-boot-splash">
        <FuseOsSplash />
      </div>
      <p className="fuseos-boot-status">Starting {OS_NAME}...</p>
      <div
        className="fuseos-boot-bar"
        role="progressbar"
        aria-label="Loading"
        aria-valuetext="Starting"
      >
        <div className="fuseos-boot-band" />
      </div>
    </main>
  );
}
