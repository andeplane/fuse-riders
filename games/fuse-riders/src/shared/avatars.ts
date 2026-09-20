/**
 * How an avatar is shown: the label a menu reads out and the cell it is cut from in the sprite sheet. The ids
 * themselves belong to the engine (`engine/avatar-id.ts`), because the input log and the checkpoint guard validate
 * against them; nothing here is simulation, and the order comes from `AVATAR_IDS` so a new id cannot address a cell
 * the image does not have. `games/fuse-riders/tests/avatar-atlas.test.ts` checks that against the scene's atlas.
 */
import { AVATAR_IDS, type AvatarId } from "../engine/avatar-id.js";

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
};
export const AVATARS: ReadonlyArray<{ id: AvatarId; label: string }> =
  AVATAR_IDS.map((id) => ({ id, label: LABELS[id] }));
export const AVATAR_ATLAS_URL = "/avatars/neon-heads.png";
/** The cell an id is drawn from, five to a row; an unknown value falls back to the first cell. */
export function avatarCell(value: unknown): { column: number; row: number } {
  const index = AVATAR_IDS.findIndex((id) => id === value);
  const safeIndex = index < 0 ? 0 : index;
  return { column: safeIndex % 5, row: Math.floor(safeIndex / 5) };
}
