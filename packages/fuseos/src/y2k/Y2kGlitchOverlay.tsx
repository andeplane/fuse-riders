import { useContext } from "react";

import { Y2kContext } from "./y2kContext";

/**
 * The desktop's share of the bug: a full-screen overlay that flickers and tears for the glitch
 * phase. Absent in real time and under reduced motion (the clock still tells the story then).
 */
export function Y2kGlitchOverlay() {
  const { phase, reducedMotion } = useContext(Y2kContext);
  if (phase !== "glitch" || reducedMotion) return null;
  return (
    <div
      className="y2k-glitch pointer-events-none absolute inset-0 z-50"
      data-testid="y2k-glitch"
      aria-hidden
    >
      <div className="y2k-glitch-bands" />
      <div className="y2k-glitch-invert" />
    </div>
  );
}
