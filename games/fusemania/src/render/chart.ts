import type { Effect, StepNote, Steps } from "../engine/view-kit.js";
import { quantOf } from "./palette.js";

/**
 * Reading a chart without scanning it: which of a column's notes can be on screen, and each note's colour, worked
 * out once per chart.
 */

/**
 * The first index in `ids` (a column's notes or mines, in time order) whose note ends at or after `ms`. A column's
 * notes never overlap, so their ends are in order too and a binary search finds it.
 */
export function firstEndingAt(
  notes: readonly StepNote[],
  ids: readonly number[],
  ms: number,
): number {
  let low = 0,
    high = ids.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (notes[ids[middle]!]!.endMs < ms) low = middle + 1;
    else high = middle;
  }
  return low;
}

const quantCache = new WeakMap<Steps, Uint8Array>();
/** Each note's colour (an index into `QUANT_COLORS`), by note id. */
export function quantsOf(steps: Steps): Uint8Array {
  let quants = quantCache.get(steps);
  if (!quants) {
    quants = new Uint8Array(steps.notes.length);
    for (let id = 0; id < quants.length; id++)
      quants[id] = quantOf(steps.notes[id]!.beat);
    quantCache.set(steps, quants);
  }
  return quants;
}

/** Whether an effect of `kind` covers a note at `ms`: the engine's `under`, without the closure. */
export function covered(
  effects: readonly Effect[],
  kind: number,
  ms: number,
): boolean {
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]!;
    if (effect[0] === kind && effect[1] <= ms && ms < effect[2]) return true;
  }
  return false;
}

/** Whether the rider has any effect of `kind` at all, past or to come. */
export function has(effects: readonly Effect[], kind: number): boolean {
  for (let i = 0; i < effects.length; i++)
    if (effects[i]![0] === kind) return true;
  return false;
}
