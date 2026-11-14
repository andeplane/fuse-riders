import { useContext, useEffect, useRef } from "react";

import { DesktopUiContext } from "../desktop/desktopUiContext";

import { useSoundService } from "./useSystemSound";

/**
 * Plays the start-up chime when the desktop appears (held until the first click if the browser
 * has not unlocked audio yet), the shut-down chime when Start > Shut Down shows the black
 * screen, and the start-up chime again when that screen is clicked to "turn the computer on".
 * Mounted once by `Shell`; renders nothing.
 */
export function SystemSoundTriggers() {
  const sounds = useSoundService();
  const { shutdownScreen } = useContext(DesktopUiContext);
  const wasShutDown = useRef(false);

  useEffect(() => {
    sounds.play("startup");
  }, [sounds]);

  useEffect(() => {
    if (shutdownScreen === wasShutDown.current) return;
    wasShutDown.current = shutdownScreen;
    sounds.play(shutdownScreen ? "shutdown" : "startup");
  }, [shutdownScreen, sounds]);

  return null;
}
