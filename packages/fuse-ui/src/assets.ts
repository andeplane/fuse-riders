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
export const MUSIC_TRACKS = [
  {
    id: "pixel-sax-parade",
    title: "Pixel Sax Parade",
    path: "/music/pixel-sax-parade.m4a",
  },
  {
    id: "coin-op-swing",
    title: "Coin Op Swing",
    path: "/music/coin-op-swing.m4a",
  },
  {
    id: "arcade-adventure",
    title: "Arcade Adventure",
    path: "/music/arcade-adventure.m4a",
  },
  { id: "forest-job", title: "Forest Job", path: "/music/forest-job.m4a" },
  {
    id: "neon-grid-chase",
    title: "Neon Grid Chase",
    path: "/music/neon-grid-chase.m4a",
  },
  { id: "final-chase", title: "Final Chase", path: "/music/final-chase.m4a" },
  {
    id: "reduced-noise-orchestra",
    title: "Reduced Noise Orchestra",
    path: "/music/reduced-noise-orchestra.m4a",
  },
  {
    id: "midnight-run",
    title: "Midnight Run",
    path: "/music/midnight-run.m4a",
  },
  {
    id: "fast-frontier-run",
    title: "Fast Frontier Run",
    path: "/music/fast-frontier-run.m4a",
  },
  { id: "snaky-blue", title: "Snaky Blue", path: "/music/snaky-blue.m4a" },
  {
    id: "arcade-blues",
    title: "Arcade Blues",
    path: "/music/arcade-blues.m4a",
  },
  { id: "snabby-jazz", title: "Snabby Jazz", path: "/music/snabby-jazz.m4a" },
  { id: "snaky-jazz", title: "Snaky Jazz", path: "/music/snaky-jazz.m4a" },
] as const;
