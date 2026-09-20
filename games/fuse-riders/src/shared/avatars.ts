/**
 * How an avatar is shown: the label a menu reads out, the cell it is cut from in the sprite sheet, and the head a
 * browser that has never chosen one starts on. The ids themselves belong to the engine (`engine/avatar-id.ts`),
 * because the input log, the checkpoint guard and the head-repair rule validate and order by them; nothing here is
 * simulation, and the order comes from `AVATAR_IDS` so a new id cannot address a cell the image does not have.
 * `games/fuse-riders/tests/avatar-atlas.test.ts` checks that against the scene's atlas.
 */
import {
  AVATAR_IDS,
  RIDER_AVATAR_IDS,
  type AvatarId,
} from "../engine/avatar-id.js";

const LABELS: Record<AvatarId, string> = {
  robot: "Robot",
  cat: "Cat",
  fox: "Fox",
  alien: "Alien",
  astronaut: "Astronaut",
  skull: "Skull",
  octopus: "Octopus",
  dragon: "Dragon",
  owl: "Owl",
  slime: "Slime",
  mushroom: "Mushroom",
};
/** Every head the game draws, including the AI's: the atlas is cut in this order. */
export const AVATARS: ReadonlyArray<{ id: AvatarId; label: string }> =
  AVATAR_IDS.map((id) => ({ id, label: LABELS[id] }));
/**
 * The heads a person picks from. The robot is not among them — it is the AI riders' and they share it, so a human in
 * one could not be told from an opponent — and the mushroom fills the place it used to hold, which keeps the grid at
 * ten. The engine refuses the robot too (`isRiderAvatarId`); this is the same rule where a player can see it.
 */
export const RIDER_AVATARS: ReadonlyArray<{ id: AvatarId; label: string }> =
  RIDER_AVATAR_IDS.map((id) => ({ id, label: LABELS[id] }));
/**
 * What a browser that has never chosen a head starts on. Deliberately not `robot`: that is the AI riders' head, and
 * since rules `fuse-p2p-48` no two riders share one, so a human defaulting to `robot` would be indistinguishable from
 * the AI in a solo room and would be moved off it the moment a host added one. This is the same head the room falls
 * back to for a join that names none (`seating.defaultAvatar` in `online/fuse-game.ts`). It stays here rather than in
 * the engine because only the picker reads it: what a join with no head is seated in is the room's rule, not this.
 */
export const HUMAN_DEFAULT_AVATAR: AvatarId = "fox";
export const AVATAR_ATLAS_URL = "/avatars/neon-heads.png";
/** The sheet's shape: `scripts/build-avatar-atlas.ts` draws it, and `render/avatar-atlas.ts` cuts the scene's from it. */
export const AVATAR_COLUMNS = 5,
  AVATAR_ROWS = 3;
/** The cell an id is drawn from; an unknown value falls back to the first cell. */
export function avatarCell(value: unknown): { column: number; row: number } {
  const index = AVATAR_IDS.findIndex((id) => id === value);
  const safeIndex = index < 0 ? 0 : index;
  return {
    column: safeIndex % AVATAR_COLUMNS,
    row: Math.floor(safeIndex / AVATAR_COLUMNS),
  };
}
/**
 * Where to put a CSS `background-position` for that cell, as percentages. A sheet is positioned by proportion rather
 * than by pixels, so the step is `100 / (count - 1)` and not `100 / count`: with three rows the second is at 50%, not
 * 33%. Worked out here so the two callers and the stylesheet cannot drift from the grid above.
 */
export function avatarCellPosition(value: unknown): string {
  const { column, row } = avatarCell(value);
  return `${(column * 100) / (AVATAR_COLUMNS - 1)}% ${(row * 100) / (AVATAR_ROWS - 1)}%`;
}
