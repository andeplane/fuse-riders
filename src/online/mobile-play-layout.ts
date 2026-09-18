import "./mobile-play-layout.css";
import type { MobileScreen } from "./room-screen.js";
/** The phone layout's own behaviour: the ☰ MENU tools overlay, the control hints, and what a change of screen does to
 *  held input. Whether the phone is the controller, upright or on its lobby screen is decided by `roomScreen`, and its
 *  classes are set with the rest of the screen's; this module keeps its own record of them and reads none back. */
export function installMobilePlayLayout(
  app: HTMLElement,
  clearControls: () => void,
) {
  let phase = "lobby",
    recapReady = false,
    active = false,
    portrait = false,
    toolsOpen = false;
  const compact = document.createElement("button");
  compact.className = "mobile-tools-toggle";
  compact.textContent = "☰ MENU";
  compact.setAttribute("aria-expanded", "false");
  // Labels render from attributes via CSS generated content: no text node exists for iOS long-press selection or Copy/Look Up callouts.
  const hints = document.createElement("div");
  hints.className = "mobile-control-hints";
  for (const text of [
    "HOLD LEFT",
    "HOLD TO FIRE · RELEASE TO LAUNCH",
    "HOLD RIGHT",
  ]) {
    const hint = document.createElement("span");
    hint.dataset.hint = text;
    hints.append(hint);
  }
  app.append(hints, compact);
  for (const type of ["selectstart", "contextmenu"])
    app.addEventListener(type, (event) => {
      const target = event.target as Node;
      const element = target instanceof Element ? target : target.parentElement;
      if (active && !element?.closest("dialog,input,textarea,select"))
        event.preventDefault();
    });
  const setTools = (open: boolean) => {
    toolsOpen = open;
    app.classList.toggle("mobile-tools-open", open);
    compact.setAttribute("aria-expanded", String(open));
  };
  const closeTools = () => setTools(false);
  const openTools = () => {
    clearControls();
    setTools(true);
  };
  compact.onclick = () => {
    clearControls();
    setTools(!toolsOpen);
  };
  // Closing a dialog returns to the live thirds mid-round; in lobby/results the roster and actions stay open.
  app.querySelector("dialog")?.addEventListener("close", () => {
    if (["countdown", "playing"].includes(phase)) closeTools();
  });
  // Phase transitions: entering countdown/play closes the tools overlay and restarts the hint fade (re-appending restarts the CSS animation);
  // the recap opening ends the match for this screen, and opens the overlay so the roster and (for the host) REMATCH are in view. The pause before
  // it keeps the overlay shut: it hides the announcer, which is showing the final round's result and then the match winner. The lobby is its own phone screen (#134), never the controller.
  const enter = () => {
    if (["countdown", "playing"].includes(phase)) {
      closeTools();
      hints.remove();
      app.append(hints);
    } else if (phase === "matchOver" && recapReady) openTools();
  };
  return {
    /** A new screen: a frame, the room ending, or (`resized`) the viewport changing. A resize cancels held input and may
     *  close the tools, but is not a phase transition: the hints do not restart and the results do not open the tools. */
    update(
      next: MobileScreen,
      nextPhase: string,
      nextRecapReady: boolean,
      resized = false,
    ) {
      const entered =
        nextPhase !== phase || nextRecapReady !== recapReady || !active;
      phase = nextPhase;
      recapReady = nextRecapReady;
      // Rotating cancels held input, but only closes the tools overlay while a round is live: a host reviewing results keeps it open (#134).
      if (active !== next.active || portrait !== next.portrait) {
        clearControls();
        if (active !== next.active || ["countdown", "playing"].includes(phase))
          closeTools();
      }
      active = next.active;
      portrait = next.portrait;
      if (entered && active && !resized) enter();
    },
    /** The ☰ MENU tools overlay is open over the controller: keys do not steer. */
    blocked: () => toolsOpen,
  };
}
