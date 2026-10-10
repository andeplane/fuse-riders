/**
 * The constants every layer agrees on. Distances are integer sub-units (`px(n)` is n pixels), so a replay folds to
 * the same bits on every device; the simulation runs `STEPS_PER_SECOND` steps a second.
 */
export const SUB = 256;

/** A constant in pixels as sub-units; for module constants, not for per-step state. */
export const px = (pixels: number): number => Math.round(pixels * SUB);

export const STEPS_PER_SECOND = 60;
/** Log ticks are 50 ms, so each folds three steps. */
export const STEPS_PER_TICK = 3;
/** The native screen in pixels, scaled up by whole numbers on the page. */
export const VIEW_W = 320;
export const VIEW_H = 180;
/** Seats per room, as in every Fuse game. */
export const CAPACITY = 5;
