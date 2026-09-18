/**
 * The avatar sheet the scene cuts rider portraits from: `columns` by `rows` equal cells, read left to right, top to
 * bottom. `frames` names each cell with the `avatarId` a view carries, so the order here is a property of the image,
 * not of the rules. `tests/avatar-atlas.test.ts` keeps it in step with the ids the game accepts.
 */
export const AVATAR_ATLAS = {
  url: "/avatars/neon-heads.png",
  columns: 5,
  rows: 2,
  frames: [
    "robot",
    "cat",
    "fox",
    "alien",
    "astronaut",
    "skull",
    "octopus",
    "dragon",
    "owl",
    "slime",
  ],
} as const;
