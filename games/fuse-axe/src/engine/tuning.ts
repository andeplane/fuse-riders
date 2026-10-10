/**
 * The constants every layer agrees on. Distances are integer sub-units (`px(n)` is n pixels), velocities sub-units
 * per step and accelerations sub-units per step per step, so a replay folds to the same bits on every device; the
 * simulation runs `STEPS_PER_SECOND` steps a second.
 */
export const SUB = 256;

/**
 * A constant in pixels as sub-units; for module constants, not for per-step state. Halves round away from zero, so
 * `px(-n)` mirrors `px(n)` (a knockback to the left matches one to the right), and a result of zero is never `-0`.
 */
export const px = (pixels: number): number =>
  Math.sign(pixels) * Math.round(Math.abs(pixels) * SUB) + 0;

export const STEPS_PER_SECOND = 60;
/** Log ticks are 50 ms, so each folds three steps. */
export const STEPS_PER_TICK = 3;
/** The native screen in pixels, scaled up by whole numbers on the page. */
export const VIEW_W = 320;
export const VIEW_H = 180;
/** Seats per room, as in every Fuse game. */
export const CAPACITY = 5;

// ---- the stage ----
/** The floor band: a hero's feet stand between these depths, which are also screen rows in the lower half. */
export const FLOOR_TOP = px(104);
export const FLOOR_BOTTOM = px(172);
/** Stage 1, Ashen Village: four screens of road. Later stages bring their own lengths. */
export const STAGE_LENGTH = px(4 * VIEW_W);
/** The camera's left edge stops here, with the stage's end at the screen's right edge. */
export const CAMERA_END = STAGE_LENGTH - px(VIEW_W);
/** The camera keeps the leading hero this far from its left edge, unless the leftmost hero holds it back. */
export const CAMERA_LEAD = px(160);
/** How close a hero's centre comes to the screen's edges: half a body, so nobody walks off screen. */
export const HERO_MARGIN = px(14);

// ---- the heroes ----
export const HERO_KINDS = ["brakka", "rhea", "gorm"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];
/** Walking speed along the road (`x`) and in depth (`y`); depth is slower, as in the original. */
export const WALK: Readonly<
  Record<HeroKind, { readonly x: number; readonly y: number }>
> = {
  brakka: { x: px(1), y: px(0.6) },
  rhea: { x: px(1.25), y: px(0.75) },
  gorm: { x: px(0.8), y: px(0.5) },
};
/** 181/256 ≈ 1/√2: a diagonal scales both components so it is no faster than walking straight. */
export const DIAGONAL = 181;
/** A jump's launch speed and the pull back down: about 38 px high and 40 steps (0.67 s) in the air. */
export const JUMP_VZ = px(3.7);
export const GRAVITY = px(0.19);
/** Steps a landed hero shows the landing pose; it acts again on the step after. */
export const LAND_STEPS = 8;
