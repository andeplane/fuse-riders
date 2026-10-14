/**
 * The image files the round scene loads, by texture key, as paths under the site base. They are Fuse Riders' own
 * files in the site root's public/ (its prop pack's crate and its neon theme's fuse), shared rather than copied;
 * tests/assets.test.ts fails if one moves.
 */
export const SHARED_SPRITES = {
  crate: "props/desert-industrial-v1/crate-small-wood.png",
  flame: "themes/clean-neon/flame.svg",
  bomb: "themes/clean-neon/bomb.svg",
} as const;
