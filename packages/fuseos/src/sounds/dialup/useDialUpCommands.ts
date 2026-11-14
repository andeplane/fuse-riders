import { useContext, useMemo } from "react";

import type { WindowContent, WindowKind } from "../../state/appState";
import { sameInstance } from "../../state/appState";
import { useAppState } from "../../state/useAppState";
import type { WindowCommands } from "../../windows/useWindowCommands";
import { useWindowCommands } from "../../windows/useWindowCommands";

import { DialUpSessionContext, withDialUp } from "./dialUpSession";

/** The programs that need the network: the first of them to open in a page session dials in first. */
const ONLINE_KINDS: ReadonlySet<WindowKind> = new Set(["network", "friends"]);

export function needsDialUp(content: WindowContent): boolean {
  return ONLINE_KINDS.has(content.kind);
}

/**
 * The window commands for anything a person opens by hand (the Start menu, a desktop icon, the tray, Fusteam,
 * Run): `open` puts Dial-Up Networking in front of Network Neighborhood and Fuse Messenger until the session
 * has connected, then opens them straight away. A window of the program that is already open is only
 * focused, and deep links and restored windows never come through here, so a reload does not dial.
 */
export function useDialUpCommands(): WindowCommands {
  const commands = useWindowCommands();
  const session = useContext(DialUpSessionContext);
  const { state } = useAppState();
  const windows = state.windows;
  return useMemo(
    () => ({
      ...commands,
      open: (content, options) => {
        const alreadyOpen = windows.some((window) =>
          sameInstance(content, window),
        );
        if (needsDialUp(content) && !alreadyOpen && !session.connected)
          commands.open(withDialUp(content, session));
        else commands.open(content, options);
      },
    }),
    [commands, session, windows],
  );
}
