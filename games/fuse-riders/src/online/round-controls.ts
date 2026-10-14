import { createRoundControls } from "fuse-ui";
import type { WorldView } from "../engine/view.js";

export interface RiderRoundControlsState {
  state?: Pick<WorldView, "round" | "phase">;
  scope?: string;
  joined: boolean;
  displayOnly: boolean;
  spectator: boolean;
  touch: boolean;
  ended: boolean;
}

/** Guidance follows the shared countdown on desktop, TV and controller phones. */
export function createRiderRoundControls(document?: Document) {
  const controls = createRoundControls({
    document,
    controls: [
      { keys: "← / A", action: "Steer left" },
      { keys: "→ / D", action: "Steer right" },
      { keys: "Space", action: "Hold to charge, release to fire" },
    ],
    touchControls: [
      { keys: "◀ zone", action: "Hold to steer left" },
      { keys: "▶ zone", action: "Hold to steer right" },
      { keys: "Fire zone", action: "Hold to charge, release to fire" },
    ],
    goal: "Keep moving. Avoid trails and blasts to be the last rider alive.",
  });
  controls.element.classList.add("rider-round-controls");
  return {
    element: controls.element,
    update({
      state,
      scope,
      joined,
      displayOnly,
      spectator,
      touch,
      ended,
    }: RiderRoundControlsState) {
      controls.update({
        round: scope ?? state?.round ?? "",
        visible:
          !ended &&
          state?.phase === "countdown" &&
          (joined || displayOnly || spectator),
        touch,
        spectator,
        display: displayOnly,
      });
    },
  };
}
