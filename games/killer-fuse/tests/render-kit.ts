/** Shared setup for the renderer tests: real views from the engine and the real art manifest. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createRound,
  viewOf,
  type RoundView,
  type UnitView,
} from "../src/engine/index.js";
import { VIEW_RULES, type ViewRules } from "../src/engine/view.js";
import { parseManifest, type ArtManifest } from "../src/render/manifest.js";
import type { Sizes } from "../src/render/metrics.js";

/** The rule values every view carries, for calling the animation helpers directly. */
export const RULES: ViewRules = VIEW_RULES;

/** Art heights for tests that place effects: made-up but distinct, so a mixed-up kind shows. */
export const SIZES: Sizes = {
  worker: 16,
  warrior: 22,
  queen: 18,
  gate: 28,
  snail: 15,
  snailFront: 19,
};

export function rawManifest(): unknown {
  const path = fileURLToPath(
    new URL("../public/killer-fuse/art/manifest.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

export const manifest = (): ArtManifest => parseManifest(rawManifest());

/** The opening view of a round on map 1 with a bot in every seat. */
export function openingView(patch: Partial<RoundView> = {}): RoundView {
  return { ...viewOf(createRound({ seed: 1, mapId: 1 })), ...patch };
}

/** A living Worker of team 0 standing still, changed by `patch`. */
export function unitView(patch: Partial<UnitView> = {}): UnitView {
  return {
    slot: 1,
    team: 0,
    kind: "worker",
    speed: false,
    x: 100,
    y: 100,
    facing: 1,
    grounded: true,
    moving: false,
    flapped: false,
    diving: false,
    dashing: false,
    attacking: false,
    attackStep: 0,
    stunned: false,
    stun: 0,
    locked: false,
    depositing: false,
    carrying: false,
    invulnerable: false,
    dead: false,
    respawn: 0,
    riding: false,
    eaten: false,
    bot: true,
    ...patch,
  };
}

/** `view` with the unit in `slot` changed. */
export function withUnit(
  view: RoundView,
  slot: number,
  patch: Partial<UnitView>,
): RoundView {
  return {
    ...view,
    units: view.units.map((unit) =>
      unit.slot === slot ? { ...unit, ...patch } : unit,
    ),
  };
}
