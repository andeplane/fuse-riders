import { BootScreen } from "./BootScreens";
import { Shell } from "./Shell";
import type { WindowContent } from "./state/appState";
import type { StateStore } from "./state/stateStore";
import { useBootHold } from "./state/useBootHold";

/** How long the boot screen stays up at least, so it is seen even when the bundle is cached. */
export const BOOT_HOLD_MS = 1500;

export type AppProps = {
  store: StateStore;
  initialOpen?: readonly WindowContent[];
  /** Minimum time the boot screen stays up. */
  bootHoldMs?: number;
};

/** The boot screen, then the desktop. Everything the desktop depends on is provided around this by `main.tsx` (or a test). */
export function App({ store, initialOpen, bootHoldMs = BOOT_HOLD_MS }: AppProps) {
  const holding = useBootHold(bootHoldMs);
  if (holding) return <BootScreen />;
  return <Shell store={store} initialOpen={initialOpen} />;
}

export default App;
