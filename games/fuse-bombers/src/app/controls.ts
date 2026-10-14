import type { ControlHint } from "fuse-ui";
import type { Seat } from "./lobby.js";

export const GOAL =
  "Fly around the temple. Fire when your rotating launcher aims at another gunship. Last gunship standing wins; fallen pilots fly as ghosts and drop bombs.";
export const ONLINE_CONTROLS: readonly ControlHint[] = [
  { keys: "WASD / arrow keys", action: "Fly your gunship or ghost" },
  { keys: "Space", action: "Fire a rocket / drop a ghost bomb" },
  { keys: "Gamepad stick / D-pad + face button", action: "Fly + fire" },
];
export const TOUCH_CONTROLS: readonly ControlHint[] = [
  { keys: "D-pad", action: "Hold a direction to fly" },
  { keys: "FIRE / BOMB", action: "Tap to fire / drop a ghost bomb" },
];

/** The actual occupied local seats. Arrows are an alternate WASD cluster only while no arrows rider is seated. */
export function localControls(seats: readonly Seat[]): readonly ControlHint[] {
  const arrowsTaken = seats.some((seat) => seat.device === "key:ARROWS");
  return seats.flatMap((seat) => {
    const device = seat.device;
    if (!device) return [];
    const keys =
      device === "key:WASD"
        ? `${arrowsTaken ? "WASD" : "WASD / arrows"} + Space`
        : device === "key:IJKL"
          ? "IJKL + H"
          : device === "key:ARROWS"
            ? "Arrow keys + /"
            : device === "key:NUMPAD"
              ? "Numpad 8456 + 0 / Enter"
              : device.startsWith("touch:")
                ? `${seat.tag} D-pad + FIRE`
                : `${seat.tag} stick / D-pad + face button`;
    return [{ keys, action: `${seat.name}: fly + fire / ghost bomb` }];
  });
}
