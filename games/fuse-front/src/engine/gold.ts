/**
 * Gold (v3 M3): each player's own, kept on its hero and checkpointed with it, earned by the rules in `GOLD`
 * (`tuning.ts`) and spent at the shop. Every amount is a whole number and every payout visits heroes by seat, so gold
 * is as deterministic as the rest of the step.
 *
 * - **Last hits:** a hero whose shot or spell lands on an enemy unit on the step it dies earns the unit's bounty
 *   (`lastHit`); the first such hero in shooter order (heroes by seat) takes it, whoever is credited with the kill's XP.
 * - **Hero kills:** the killer's seat earns a bounty that grows with the victim's streak, and its teammates that hit
 *   the victim lately and stand near share a part (`heroBounty`).
 * - **Structures, flags and the trickle:** a razed lane tower or gate pays its razer's whole team; a flag pays its
 *   taker; everyone earns a little every second.
 * - **The fountain:** a living hero in its own fort's courtyard heals fast (`fountain`).
 */
import type { GameMap } from "./map.js";
import { div } from "./math.js";
import { centreOf } from "./move.js";
import {
  ASSIST_RADIUS,
  FOUNTAIN,
  GOLD,
  teamOf,
  type UnitKind,
} from "./tuning.js";
import { NEUTRAL, NO_HURT, fortSite, type Hero, type World } from "./world.js";

/** Adds gold to a hero's purse, up to `GOLD.max`. */
export function earn(hero: Hero, amount: number): void {
  const total = hero.gold + amount;
  hero.gold = total < GOLD.max ? total : GOLD.max;
}

const heroOf = (world: World, seat: number): Hero | undefined =>
  world.heroes.find((hero) => hero.seat === seat);

/** The killing blow on a unit of `kind` and `owner` (a camp guard's is `NEUTRAL`) pays `seat`'s hero. */
export function lastHit(
  world: World,
  seat: number,
  kind: UnitKind,
  owner: number,
): void {
  const hero = heroOf(world, seat);
  if (hero === undefined) return;
  earn(hero, owner === NEUTRAL ? GOLD.guard : GOLD.lastHit[kind]);
}

/** Records that `seat`'s hero hit `victim`, for an assist on its death. */
export function hurtBy(victim: Hero, seat: number): void {
  if (victim.hurt[seat] === GOLD.assistWindow) return;
  victim.hurt = victim.hurt.map((left, each) =>
    each === seat ? GOLD.assistWindow : left,
  );
}

/** A hero kill's gold, by the victim's streak. */
export const bountyOf = (streak: number): number =>
  GOLD.hero +
  GOLD.perStreak * (streak < GOLD.streakMax ? streak : GOLD.streakMax);

/**
 * `victim` fell to `killer`'s seat (-1 pays nobody): the killer earns the bounty and a kill on its streak, and
 * `GOLD.assistPercent` of the bounty is split evenly among the killer's living teammates within `ASSIST_RADIUS` that
 * hit the victim in the last `GOLD.assistWindow` steps. The victim's streak and hits are cleared. Call it before the
 * victim's record changes (it reads where it fell).
 */
export function heroBounty(world: World, victim: Hero, killer: number): void {
  const bounty = bountyOf(victim.streak);
  victim.streak = 0;
  const hurt = victim.hurt;
  victim.hurt = NO_HURT;
  if (killer < 0 || teamOf(killer) === teamOf(victim.seat)) return;
  const slayer = heroOf(world, killer);
  if (slayer === undefined) return;
  earn(slayer, bounty);
  if (slayer.streak < GOLD.streakMax) slayer.streak++;
  const helpers = world.heroes.filter((hero) => {
    if (hero.seat === killer || hero.hp <= 0) return false;
    if (teamOf(hero.seat) !== teamOf(killer) || hurt[hero.seat]! <= 0)
      return false;
    const dx = hero.x - victim.x,
      dy = hero.y - victim.y;
    return dx * dx + dy * dy <= ASSIST_RADIUS * ASSIST_RADIUS;
  });
  if (helpers.length === 0) return;
  const share = div(div(bounty * GOLD.assistPercent, 100), helpers.length);
  for (const hero of helpers) earn(hero, share);
}

/** A lane tower or gate of `tier` fell to `seat`: every hero of its team earns `GOLD.tower[tier]`. */
export function towerGold(world: World, seat: number, tier: number): void {
  if (seat < 0) return;
  for (const hero of world.heroes)
    if (teamOf(hero.seat) === teamOf(seat)) earn(hero, GOLD.tower[tier]!);
}

/** Whether a hero stands in its own fort's courtyard (`FOUNTAIN.radius`), where it heals and shops. */
export function atFountain(map: GameMap, hero: Hero): boolean {
  const fort = fortSite(map, hero.seat);
  const dx = hero.x - centreOf(fort.x),
    dy = hero.y - centreOf(fort.y);
  return dx * dx + dy * dy <= FOUNTAIN.radius * FOUNTAIN.radius;
}

/**
 * Early in a step (`tendHeroes`): the trickle pays every hero, and the hits it took count down. Returns the hit
 * points and energy the fountain gives a living hero standing in it (0 and 0 elsewhere), for the caller to cap.
 */
export function tendGold(
  map: GameMap,
  world: World,
  hero: Hero,
  most: number,
): [number, number] {
  if (world.step % GOLD.trickleEvery === 0) earn(hero, GOLD.trickle);
  if (hero.hurt.some((left) => left > 0))
    hero.hurt = hero.hurt.map((left) => (left > 0 ? left - 1 : 0));
  if (hero.hp <= 0 || !atFountain(map, hero)) return [0, 0];
  const heal = div(most * FOUNTAIN.hpPermille, 1000);
  return [heal > 0 ? heal : 1, FOUNTAIN.energy];
}
