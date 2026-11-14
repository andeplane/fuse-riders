/**
 * The engine data the renderer may read beside the view: the deck's fixed geometry in pixels and the timings it
 * draws to. What is drawn where the rules collide comes from here, so what you see is what plays.
 */
import * as T from "./tuning.js";
import { footholdX } from "./world.js";

export const DECK_W = T.DECK_W / T.U,
  START_X = T.START_X / T.U,
  LAST_X = T.LAST_X / T.U,
  GATE_X = T.GATE_X / T.U,
  SPAWN_X = T.SPAWN_X / T.U,
  EXIT_X = T.EXIT_X / T.U,
  FALL_DEPTH = T.FALL_DEPTH / T.U;
export const REACH = T.REACH / T.U,
  STAND_H = T.STAND_H / T.U,
  DUCK_H = T.DUCK_H / T.U,
  LOW_TOP = T.LOW_TOP / T.U,
  HIGH_BOTTOM = T.HIGH_BOTTOM / T.U;
export const GRAVITY = T.GRAVITY / T.U,
  DIVE_GRAVITY = T.DIVE_GRAVITY / T.U;
export const CAPACITY = T.CAPACITY,
  STEPS_PER_SECOND = T.STEPS_PER_SECOND,
  STEPS_PER_TICK = T.STEPS_PER_TICK,
  READY_STEPS = T.READY_STEPS,
  BREAK_STEPS = T.BREAK_STEPS;
export const LOW = 0,
  HIGH = 1;
/** Every foothold of a match that takes `maxHits` hits, px, from the start line back. */
export const footholds = (maxHits: number): number[] =>
  Array.from({ length: maxHits }, (_, hits) => footholdX(hits, maxHits) / T.U);
export { secondsLeft } from "./view.js";
