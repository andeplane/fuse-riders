export const AVATARS = [
  { id: "robot", label: "Robot" },
  { id: "cat", label: "Cat" },
  { id: "fox", label: "Fox" },
  { id: "alien", label: "Alien" },
  { id: "astronaut", label: "Astronaut" },
  { id: "skull", label: "Skull" },
  { id: "octopus", label: "Octopus" },
  { id: "dragon", label: "Dragon" },
  { id: "owl", label: "Owl" },
  { id: "slime", label: "Slime" },
] as const;
export type AvatarId = (typeof AVATARS)[number]["id"];
/** The head an AI rider wears, and the one a rider seated with no head at all falls back to. */
export const DEFAULT_AVATAR: AvatarId = "robot";
/**
 * What a browser that has never chosen a head starts on. Deliberately not `robot`: that is the AI riders' head, and
 * since rules `fuse-p2p-48` no two riders share one, so a human defaulting to `robot` would be indistinguishable from
 * the AI in a solo room and would be moved off it the moment a host added one. This is the same head the room falls
 * back to for a join that names none (`seating.defaultAvatar` in `online/fuse-game.ts`).
 */
export const HUMAN_DEFAULT_AVATAR: AvatarId = "fox";
export const AVATAR_ATLAS_URL = "/avatars/neon-heads.png";
export function isAvatarId(value: unknown): value is AvatarId {
  return (
    typeof value === "string" && AVATARS.some((avatar) => avatar.id === value)
  );
}
export function avatarCell(value: unknown): { column: number; row: number } {
  const index = AVATARS.findIndex((avatar) => avatar.id === value);
  const safeIndex = index < 0 ? 0 : index;
  return { column: safeIndex % 5, row: Math.floor(safeIndex / 5) };
}
