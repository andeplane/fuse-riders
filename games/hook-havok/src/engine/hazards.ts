import type { Arena, Keeper } from "./arena.js";
import { MAPS } from "./maps.js";
import { knockout } from "./knockout.js";
import { floorTop, laserBand, touchesBand } from "./zones.js";

/**
 * The electrified floor and the laser gates (12B). Runs after keepers move,
 * hooks hit and bombs blast: every keeper in play and not spawn-protected
 * whose body touches the floor or a live beam's band this tick is knocked out
 * in slot order, through the same path as a bomb. A hazard credits nobody,
 * unless a rival's hook tip hit the victim within PUSH_TICKS: then that rival
 * pushed them in.
 */
export function stepHazards(
  arena: Arena,
  canPlay: (k: Keeper) => boolean,
): void {
  const t = arena.tuning,
    top = floorTop(t, arena.contest);
  const bands =
    t.lasers === "on"
      ? MAPS[t.map].zones.lasers.flatMap((l) => {
          const band = laserBand(l, arena.tick);
          return band ? [band] : [];
        })
      : [];
  if (top === undefined && !bands.length) return;
  for (const k of arena.keepers) {
    const w = k.world;
    if (!canPlay(k) || w.respawn || k.shield) continue;
    if (
      (top !== undefined && w.feet > top) ||
      bands.some((b) => touchesBand(b, w.x, w.feet))
    )
      knockout(arena, k, k.pushed ? k.pushedBy : "", "hazard");
  }
}
