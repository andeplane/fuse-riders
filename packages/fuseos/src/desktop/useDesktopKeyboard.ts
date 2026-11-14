import { useContext, useEffect } from "react";

import { matchShortcut } from "../lib/shortcuts";

import { DesktopUiContext } from "./desktopUiContext";

/**
 * The desktop-wide keys (Desktop scope in `lib/shortcuts.ts`): Ctrl+Esc opens or closes the
 * Start menu, the one Windows key a browser lets a page see; Escape closes it from anywhere
 * (the menu's own handler covers the keys pressed inside it). Listens on `document`, so a
 * focused game iframe still keeps its own keys: nothing inside a frame reaches here.
 */
export function useDesktopKeyboard(): void {
  const { startMenuOpen, setStartMenuOpen } = useContext(DesktopUiContext);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchShortcut(event, "desktop.startMenu")) {
        event.preventDefault();
        setStartMenuOpen(!startMenuOpen);
      } else if (startMenuOpen && matchShortcut(event, "desktop.closeMenu")) {
        setStartMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [startMenuOpen, setStartMenuOpen]);
}
