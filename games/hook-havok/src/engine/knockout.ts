import type { Arena, Keeper } from "./arena.js";
import { MAPS } from "./maps.js";
import { BODY, S, cancel, readyHook } from "./world.js";
import { KO_RESPAWN } from "./bomb-rules.js";
import { gain } from "./zones.js";

const saturate = (n: number) => Math.min(0xffffffff, n + 1);
/**
 * One knockout path for bombs (11B) and hazards (12B): the event for the feed,
 * the body leaving below the arena, the tallies and the score. `by` is the
 * bomb's thrower, or for a hazard the rival credited with the push ("" when
 * nobody is). Only a bomb can be a self-knockout.
 */
export function knockout(
  arena: Arena,
  victim: Keeper,
  by: string,
  cause: "bomb" | "hazard",
): void {
  const w = victim.world,
    self = cause === "bomb" && victim.id === by;
  arena.knockouts.push({
    tick: arena.tick,
    by,
    target: victim.id,
    x: w.x,
    y: w.feet - BODY / 2,
    cause,
  });
  // Like a fall the body leaves below the arena, so every respawn invariant holds.
  Object.assign(w, {
    respawn: KO_RESPAWN,
    deaths: saturate(w.deaths),
    feet: MAPS[arena.tuning.map].height * S + BODY + S,
    vx: 0,
    vy: 0,
    buffer: 0,
    coyote: 0,
    grounded: false,
    airJump: false,
    charge: 0,
    hook: readyHook(),
  });
  victim.ward = 0;
  victim.pushed = 0;
  victim.pushedBy = "";
  const kit = victim.bomb,
    scorer = by ? arena.keepers.find((k) => k.id === by) : undefined;
  if (self) kit.selfKnockouts = saturate(kit.selfKnockouts);
  else if (cause === "bomb") kit.bombed = saturate(kit.bombed);
  else kit.zapped = saturate(kit.zapped);
  if (!self && scorer) scorer.bomb.knockouts = saturate(scorer.bomb.knockouts);
  kit.fate = self ? "self" : cause;
  kit.by = self ? "" : by;
  const c = arena.contest;
  if (arena.tuning.rules === "free" || c.phase !== "active") return;
  const entry = c.entries.find((e) => e.id === victim.id);
  if (!entry) return;
  if (arena.tuning.rules === "elimination") {
    entry.out = true;
    cancel(w);
    return;
  }
  // The victim's usual death penalty; the thrower or pusher +1 (three times
  // from the crown zone), or −1 for a keeper's own bomb.
  entry.score -= 2;
  const credited = by ? c.entries.find((e) => e.id === by) : undefined;
  if (credited)
    credited.score += self
      ? -1
      : scorer && !scorer.world.respawn
        ? gain(arena.tuning, scorer.world.x, scorer.world.feet)
        : 1;
}
