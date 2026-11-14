import { createContext } from "react";

import type { WindowContent } from "../../state/appState";

/**
 * Whether this page session has "dialled in" yet. The first time Network Neighborhood or
 * Friends opens, the Dial-Up Networking dialog runs the modem handshake first; after that
 * (or after Cancel) the desktop is online until the page is reloaded.
 */
export interface DialUpSession {
  readonly connected: boolean;
  markConnected(): void;
}

export class MemoryDialUpSession implements DialUpSession {
  connected = false;
  markConnected(): void {
    this.connected = true;
  }
}

/** One per page load: a reload starts a new session, so the handshake plays again. */
export const DialUpSessionContext = createContext<DialUpSession>(
  new MemoryDialUpSession(),
);

/**
 * The window to open for `content` behind the dial-up gate: the dialog that opens `content`
 * on connect while the session is offline, `content` itself afterwards. The integrator wraps
 * Network Neighborhood and Friends with this:
 *
 *     commands.open(withDialUp({ kind: "network" }, session));
 */
export function withDialUp(
  content: WindowContent,
  session: DialUpSession,
): WindowContent {
  return session.connected ? content : { kind: "dialup", then: content };
}
