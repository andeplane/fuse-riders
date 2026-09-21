import { createPhoneLayout } from "fuse-ui";
import type { MobileScreen } from "./room-screen.js";
/** Fuse Riders' phone layout on fuse-ui's: the ☰ MENU tools overlay over the three control zones, their hints, and
 *  what a change of screen does to held input. Whether the phone is the controller, upright or on its lobby screen is
 *  decided by `roomScreen`, and its classes are set with the rest of the screen's. */
export function installMobilePlayLayout(
  app: HTMLElement,
  clearControls: () => void,
  dialogs: readonly HTMLDialogElement[],
) {
  const layout = createPhoneLayout({
    root: app,
    clearControls,
    hints: ["HOLD LEFT", "HOLD TO FIRE · RELEASE TO LAUNCH", "HOLD RIGHT"],
    dialogs,
    classes: {
      toggle: "mobile-tools-toggle",
      hints: "mobile-control-hints",
      open: "mobile-tools-open",
    },
  });
  return {
    update(
      next: MobileScreen,
      phase: string,
      recapReady: boolean,
      resized = false,
      controllerOnly = false,
    ) {
      // Hints follow the round phase, not a timer restarted on entry to play.
      if (layout.hints.dataset.phase !== phase)
        layout.hints.dataset.phase = phase;
      layout.update(
        next,
        {
          phase,
          live: phase === "countdown" || phase === "playing",
          results: phase === "matchOver" && recapReady,
        },
        resized,
        controllerOnly,
      );
    },
    blocked: layout.blocked,
  };
}
