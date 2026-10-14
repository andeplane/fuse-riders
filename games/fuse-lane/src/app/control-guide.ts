import type { ControlHint } from "fuse-ui";

export const TOWN_GOAL =
  "Work, study, shop and invest: reach all four goals to win.";
export const TOWN_CONTROLS: readonly ControlHint[] = [
  { keys: "Click / tap a building", action: "Walk there and open its choices" },
  { keys: "Click / tap a choice", action: "Work, buy or study at that place" },
  { keys: "Drag the map", action: "Look around town" },
  {
    keys: "CALL IT A WEEK",
    action: "End your turn; unused hours become sleep",
  },
];
