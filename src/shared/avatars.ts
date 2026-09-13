export const AVATARS = [
  { id: 'robot', label: 'Robot' }, { id: 'cat', label: 'Cat' },
  { id: 'fox', label: 'Fox' }, { id: 'alien', label: 'Alien' },
  { id: 'astronaut', label: 'Astronaut' }, { id: 'skull', label: 'Skull' },
  { id: 'octopus', label: 'Octopus' }, { id: 'dragon', label: 'Dragon' },
  { id: 'owl', label: 'Owl' }, { id: 'slime', label: 'Slime' },
] as const;
export type AvatarId = typeof AVATARS[number]['id'];
export const DEFAULT_AVATAR: AvatarId = 'robot';
export const AVATAR_ATLAS_URL = '/avatars/neon-heads.png';
export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && AVATARS.some(avatar => avatar.id === value);
}
export function avatarCell(value: unknown): { column: number; row: number } {
  const index = AVATARS.findIndex(avatar => avatar.id === value);
  const safeIndex = index < 0 ? 0 : index;
  return { column: safeIndex % 5, row: Math.floor(safeIndex / 5) };
}
