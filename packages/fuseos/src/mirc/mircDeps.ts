import { createContext } from "react";

import type { Scheduler } from "./irc/client";
import type { RegularsBrain } from "./sim/brain";
import type { IrcTransport } from "./irc/transport";
import { browserWebSocketTransport } from "./irc/transport";
import type { MircPrefs, MircPrefsStore } from "./mircPrefs";
import { defaultPrefs, LocalStorageMircPrefsStore } from "./mircPrefs";

/**
 * mIRC's outside world: the socket, timers, the clock, randomness (Guest nicks, backoff jitter) and where
 * settings are kept. The production values talk to the browser; tests inject a fake transport, a manual
 * scheduler and an in-memory store. There are no analytics here: nicks and messages are never reported.
 */
export type MircDeps = {
  /** The real WebSocket transport, used only through a configured `bridgeUrl`; otherwise networks are simulated. */
  transport: IrcTransport;
  /** The simulated regulars' brain; absent means the shared language model (or canned lines), chosen in the view. */
  brain?: RegularsBrain;
  scheduler: Scheduler;
  now: () => number;
  random: () => number;
  prefs: MircPrefsStore;
  /** A WebSocket↔IRC bridge (docs/fuseos/mirc.md). None is deployed; set VITE_IRC_BRIDGE_URL to use one. */
  bridgeUrl?: string;
};

function browserScheduler(): Scheduler {
  return {
    setTimeout: (callback, ms) => ({ id: window.setTimeout(callback, ms) }),
    clearTimeout: (handle) => window.clearTimeout(handle.id),
  };
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function browserMircDeps(): MircDeps {
  const bridge: unknown = import.meta.env.VITE_IRC_BRIDGE_URL;
  const fallback = (): MircPrefs => defaultPrefs(Math.random, Date.now());
  return {
    transport: browserWebSocketTransport(),
    scheduler: browserScheduler(),
    now: () => Date.now(),
    random: () => Math.random(),
    prefs: new LocalStorageMircPrefsStore(safeLocalStorage(), fallback),
    ...(typeof bridge === "string" && bridge.length > 0
      ? { bridgeUrl: bridge }
      : {}),
  };
}

/** Undefined until the entry point provides one, so a test that forgets to inject deps never opens a socket. */
export const MircDepsContext = createContext<MircDeps | undefined>(undefined);
