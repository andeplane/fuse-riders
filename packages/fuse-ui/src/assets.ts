/** Presentation assets shared by the arcade games; no simulation rules live here. */
export const AVATAR_ATLAS = {
  url: "/avatars/neon-heads.png",
  columns: 5,
  rows: 3,
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
    "mushroom",
  ],
} as const;
export { ALL_SONGS as MUSIC_TRACKS } from "fuse-music";
