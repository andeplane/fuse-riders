import { useContext, useEffect } from "react";

import { isRunChord, matchShortcut } from "../lib/shortcuts";
import { useWindowCommands } from "../windows/useWindowCommands";

import { DesktopDepsContext } from "./desktopDepsContext";
import { DesktopUiContext } from "./desktopUiContext";

/**
 * The desktop-wide keys (Desktop scope in `lib/shortcuts.ts`): Ctrl+Esc opens or closes the
 * Start menu, the one Windows key a browser lets a page see; Escape closes it from anywhere
 * (the menu's own handler covers the keys pressed inside it); Win+R opens the Run dialog where
 * the chord reaches the page at all. Listens on `document`, so a focused game iframe still keeps
 * its own keys: nothing inside a frame reaches here.
 */
export function useDesktopKeyboard(): void {
  const { startMenuOpen, setStartMenuOpen } = useContext(DesktopUiContext);
  const { isApplePlatform } = useContext(DesktopDepsContext);
  const commands = useWindowCommands();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchShortcut(event, "desktop.startMenu")) {
        event.preventDefault();
        setStartMenuOpen(!startMenuOpen);
      } else if (startMenuOpen && matchShortcut(event, "desktop.closeMenu")) {
        setStartMenuOpen(false);
      } else if (isRunChord(event, isApplePlatform())) {
        event.preventDefault();
        setStartMenuOpen(false);
        commands.open({ kind: "run" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [startMenuOpen, setStartMenuOpen, isApplePlatform, commands]);
}
