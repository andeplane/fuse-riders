import {
  defaultRoomSettings,
  type RoomSettings,
} from "../../src/engine/room-settings.js";

/**
 * The board most engine tests are written against, said out loud: the obstacle-free `classic` arena and an aim that
 * parks at full reach, with every other setting at its default.
 *
 * It is exactly what a game without settings used to fall back on before `GameState.settings` became required
 * (#253 A3), so a test that built such a game keeps its geometry and its random draws. A test about what a new room
 * plays starts from `defaultRoomSettings()` instead (`rotate` maps, a bouncing aim).
 */
export function classicSettings(
  overrides: Partial<RoomSettings> = {},
): RoomSettings {
  return {
    ...defaultRoomSettings(),
    map: "classic",
    aimBounce: false,
    ...overrides,
  };
}
