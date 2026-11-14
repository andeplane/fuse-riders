import { createContext } from "react";

/** What the tray and the window need besides the presence service: time, and the "uh-oh" alert. */
export type FriendsDeps = {
  now: () => number;
  /** Run `callback` after `delayMs`; returns a cancel. Tests hand in a manual scheduler. */
  schedule: (callback: () => void, delayMs: number) => () => void;
  /** The short two-tone alert a toast plays; a no-op when the OS is muted. */
  playAlert: () => void;
  /** Put text on the clipboard (the player's own id); resolves even where the clipboard is unavailable. */
  copyText: (text: string) => Promise<void>;
};

export const defaultFriendsDeps: FriendsDeps = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const handle = window.setTimeout(callback, delayMs);
    return () => window.clearTimeout(handle);
  },
  playAlert: () => undefined,
  copyText: async (text) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // A page without clipboard access: the id is still on screen to be selected.
    }
  },
};

export const FriendsDepsContext =
  createContext<FriendsDeps>(defaultFriendsDeps);
