/**
 * How an avatar is shown: the label a menu reads out, the cell it is cut from in the sprite sheet, and the head a
 * browser that has never chosen one starts on. The ids themselves belong to the engine (`engine/avatar-id.ts`),
 * because the input log, the checkpoint guard and the head-repair rule validate and order by them; nothing here is
 * simulation, and the order comes from `AVATAR_IDS` so a new id cannot address a cell the image does not have.
 * `games/fuse-riders/tests/avatar-atlas.test.ts` checks that against the scene's atlas.
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
/**
 * What a browser that has never chosen a head starts on. Deliberately not `robot`: that is the AI riders' head, and
 * since rules `fuse-p2p-48` no two riders share one, so a human defaulting to `robot` would be indistinguishable from
 * the AI in a solo room and would be moved off it the moment a host added one. This is the same head the room falls
 * back to for a join that names none (`seating.defaultAvatar` in `online/fuse-game.ts`). It stays here rather than in
 * the engine because only the picker reads it: what a join with no head is seated in is the room's rule, not this.
 */
export const HUMAN_DEFAULT_AVATAR: AvatarId = "fox";
export const AVATAR_ATLAS_URL = "/avatars/neon-heads.png";
/** The cell an id is drawn from, five to a row; an unknown value falls back to the first cell. */
export function avatarCell(value: unknown): { column: number; row: number } {
  const index = AVATAR_IDS.findIndex((id) => id === value);
  const safeIndex = index < 0 ? 0 : index;
  return { column: safeIndex % 5, row: Math.floor(safeIndex / 5) };
}
