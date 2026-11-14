import type { WinampControls } from "./winampControls";

/**
 * Where the running Winamp publishes its transport, by window id, for whatever else on the desktop
 * wants to press its buttons: the Office Assistant's `[music:<action>]` tool. `onRegister` lets a
 * caller that opened Winamp act once it is up (Clippy's "play music" presses Play the moment the
 * player has loaded).
 */
export interface WinampRegistry {
  set(windowId: string, controls: WinampControls): void;
  delete(windowId: string): void;
  /** The first registered transport, or undefined while no Winamp has loaded. */
  first(): WinampControls | undefined;
  size(): number;
  /** Runs `listener` for every registration from now on; returns the unsubscribe. */
  onRegister(listener: (controls: WinampControls) => void): () => void;
}

export function createWinampRegistry(): WinampRegistry {
  const entries = new Map<string, WinampControls>();
  const listeners = new Set<(controls: WinampControls) => void>();
  return {
    set(windowId, controls) {
      entries.set(windowId, controls);
      // A listener that unsubscribes itself must not disturb the walk.
      [...listeners].forEach((listener) => listener(controls));
    },
    delete(windowId) {
      entries.delete(windowId);
    },
    first: () => entries.values().next().value,
    size: () => entries.size,
    onRegister(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
