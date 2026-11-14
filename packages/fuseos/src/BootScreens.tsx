import { OS_NAME } from "./desktop/windowMeta";

/** The classic boot blue; the splash and progress bar of the real boot screen are Phase B's. */
export const BOOT_BLUE = "#000080";

/**
 * The boot screen: the OS name over Windows 95 blue, with the endlessly scrolling bar along
 * the bottom edge, for at least `BOOT_HOLD_MS` so a cached load still boots visibly.
 */
export function BootScreen() {
  return (
    <main
      className="win98 boot-screen relative flex h-full w-full flex-col items-center justify-center overflow-hidden text-white"
      style={{ backgroundColor: BOOT_BLUE }}
      aria-live="polite"
      aria-label={`Starting ${OS_NAME}`}
    >
      <h1
        className="m-0 text-5xl font-bold tracking-widest"
        style={{ textShadow: "3px 3px #000" }}
      >
        {OS_NAME}
      </h1>
      <p className="mt-3 text-base">Starting {OS_NAME}...</p>
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
