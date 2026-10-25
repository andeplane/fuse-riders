/**
 * MOBA bots on a lane map (v3 M5), as ordinary commands: what a lane bot's living hero does on a think, at most one
 * cast and one walk or attack. Pure, like `bot.ts`, which calls it: it reads what a player sees, never the RNG or
 * anything it remembers, so its hysteresis lives in the hero's own state (a walk home is a `move` to its fort's tile,
 * kept until it arrives; a fight or a chase is its focus). The first that applies:
 *
 * 1. **Rest** at the fountain to `Profile.rested`; **shop** there (`bot-shop.ts`), walking home when hurt or in a lull
 *    with the gold for its next item, or with 1.5 times it. Hurt below `Profile.retreat` (or out of energy and hurt)
 *    it falls back behind its outermost tower and rests there: a calm hero heals fast (`HERO.regen`).
 * 2. **Fight** the weakest enemy hero within 8 tiles when its side's strength (hit points times damage on heroes, with
 *    `Profile.sense` the towers that reach the fight and the longer gun's free shots) wins by `Profile.nerve`; a fight
 *    it is in holds until it sways `SWAY` below, and lets go of a hero walking away out of reach. Otherwise it steps
 *    out of an enemy hero's reach.
 * 3. **Towers:** out of an enemy structure's reach unless its wave tanks it (`TANKS`), two heroes stand there with
 *    no enemy hero near, or it outlasts the structure alone (a dive that wins); out at once when one aims at it.
 * 4. **Last hit** the weakest enemy unit its next shot kills, by `Profile.lastHit` percent of the shot's exact damage.
 * 5. **Siege** a structure it may stand by (3). 6. **Group** on the enemy structure nearest the team while it has
 *    more heroes standing (a lone hero only on one it outlasts).
 * 7. **Jungle:** a jungle flag within `Profile.jungle` tiles of walk, from level 3 and healthy, while no enemy stands
 *    near and its lane is pushed past half way (a roamer goes twice as far, whatever its lane).
 * 8. **Lane:** stand at its wave's front, while an enemy hero contests the lane no closer to the enemy wave than its
 *    gun's reach (so it farms that wave rather than pushes it), 2 tiles ahead when none does or its team leads in
 *    razed structures; in a lull it holds its ground rather than walk back to meet its next wave.
 *
 * Lanes (`botLane`): 1v1 mid, 3v3 a lane each, 2v2 top and bottom, or with `Profile.roam` mid and a roamer. Spells
 * per kit (`laneCast`) never fire into nothing: no ORBITAL DROP or BLITZ outside a fight or siege, and no OVERCLOCK or
 * FLARE, since lane factories build nothing and waves ignore flares.
 */
import { UNREACHABLE, flowField, openTile } from "./flow.js";
import { atFountain } from "./gold.js";
import { alive, heroGun, heroMaxEnergy, heroMaxHp, levelOf } from "./hero.js";
import { ITEMS } from "./items.js";
import type { GameMap, Lane } from "./map.js";
import { div, isqrt } from "./math.js";
import { centreOf, tileOf } from "./move.js";
import { nextBuy } from "./bot-shop.js";
import { enemyAt } from "./focus.js";
import { upgrades } from "./jungle.js";
import { hideOf, kitOf, type Chosen } from "./spells.js";
import type { Command } from "./step.js";
import { razedBy, seatLane, waypoints } from "./waves.js";
import { FORT_GUN, GRUNT_ARMOUR, HERO, HEROES } from "./tuning.js";
import { STRAIGHT, TILE, TOWER, UNITS, teamOf } from "./tuning.js";
import { NEUTRAL, fortSite, unitCap, type Hero, type World } from "./world.js";
import type { Profile } from "./bot.js";

const NEAR = 8 * TILE;
const SCOUT = 16 * TILE;
/** Lane stands snap to this spacing, so a hero's walks reuse the flow fields they build. */
const STAND = 2 * TILE;
const SWAY = 25;
const TANKS = 1;
/** A tower's ramped shot over a long siege, in percent of its first (`TOWER.ramp`, `TOWER.rampMax`). */
const RAMPED = 225;

type Spot = { x: number; y: number };
const d2 = (ax: number, ay: number, bx: number, by: number): number =>
  (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const near = (a: Spot, x: number, y: number, r: number) =>
  d2(a.x, a.y, x, y) <= r * r;
const tileOfSpot = (a: Spot): [number, number] => [tileOf(a.x), tileOf(a.y)];
const lowest = (heroes: Hero[]) =>
  heroes.reduce<Hero | undefined>(
    (a, b) => (a && a.hp <= b.hp ? a : b),
    undefined,
  );

/** A lane's waypoint centres in one team's order, with the length walked to each (sub-pixels). */
type Track = { xs: number[]; ys: number[]; at: number[] };
const tracks = new WeakMap<Lane, Track[]>();
function trackOf(lane: Lane, team: number): Track {
  let pair = tracks.get(lane);
  if (pair === undefined)
    tracks.set(
      lane,
      (pair = [0, 1].map((side) => {
        const path = waypoints(lane, side);
        const [xs, ys] = [
          path.map((p) => centreOf(p.x)),
          path.map((p) => centreOf(p.y)),
        ];
        const at = [0];
        for (let i = 1; i < xs.length; i++)
          at.push(
            at[i - 1]! + isqrt(d2(xs[i]!, ys[i]!, xs[i - 1]!, ys[i - 1]!)),
          );
        return { xs, ys, at };
      })),
    );
  return pair[team]!;
}

/** The point `t` along leg `i` (ending at waypoint i) of `track`. */
const onLeg = (track: Track, i: number, t: number): [number, number] => {
  const length = track.at[i]! - track.at[i - 1]!;
  const [ax, ay] = [track.xs[i - 1]!, track.ys[i - 1]!];
  if (length === 0) return [ax, ay];
  return [
    ax + div((track.xs[i]! - ax) * t, length),
    ay + div((track.ys[i]! - ay) * t, length),
  ];
};

/** How far along `track` the point of it nearest (x, y) lies. */
function progress(track: Track, x: number, y: number): number {
  let best = 0,
    bestD = -1;
  for (let i = 1; i < track.xs.length; i++) {
    const length = track.at[i]! - track.at[i - 1]!;
    const [ax, ay] = [track.xs[i - 1]!, track.ys[i - 1]!];
    const dot = (x - ax) * (track.xs[i]! - ax) + (y - ay) * (track.ys[i]! - ay);
    const along = length === 0 ? 0 : div(dot, length);
    const t = along < 0 ? 0 : along > length ? length : along;
    const d = d2(x, y, ...onLeg(track, i, t));
    if (bestD < 0 || d < bestD) [best, bestD] = [track.at[i - 1]! + t, d];
  }
  return best;
}

/** The tile `distance` along `track`, clamped to its ends: on a straight leg, so walkable. */
function tileAt(track: Track, distance: number): [number, number] {
  const end = track.at.at(-1)!;
  const d = distance < 0 ? 0 : distance > end ? end : distance;
  let i = 1;
  while (i < track.at.length - 1 && track.at[i]! < d) i++;
  const [x, y] = onLeg(track, i, d - track.at[i - 1]!);
  return [tileOf(x), tileOf(y)];
}

/** The lane a bot plays, or -1 for a roamer (`Profile.roam` on a two-seat team). */
export function botLane(
  map: GameMap,
  world: World,
  seat: number,
  profile: Profile,
) {
  const team = world.players.filter((p) => p.team === teamOf(seat));
  const mid = map.lanes.findIndex((lane) => lane.name === "mid");
  if (mid >= 0 && team.length === 1) return mid;
  if (mid >= 0 && team.length === 2 && profile.roam)
    return team[0]!.seat === seat ? mid : -1;
  return seatLane(map, world, seat);
}

/** A hero's damage a step on heroes, times 1000, and a tower's on the same scale (its shot ramped half way). */
const dps = (hero: Hero) => {
  const gun = heroGun(hero);
  return div(gun.damage * HERO.duel * 10, gun.cooldown);
};
const TOWER_DPS = div(TOWER.damage * 150 * 10, TOWER.cooldown);

/** The indices of the standing enemy lane structures and forts (of `team`'s enemy) whose guns reach (x, y). */
function guns(
  map: GameMap,
  world: World,
  team: number,
  x: number,
  y: number,
  slack = 0,
) {
  const out: number[] = [];
  for (const [index, building] of world.buildings.entries()) {
    const site = map.sites[building.id]!;
    const fort = site.kind === "fort";
    if (building.hp <= 0 || (site.lane < 0 && !fort)) continue;
    if ((fort ? teamOf(site.seat) : site.team) === team) continue;
    const reach = (fort ? FORT_GUN.range : TOWER.range) + slack;
    if (near({ x, y }, centreOf(site.x), centreOf(site.y), reach))
      out.push(index);
  }
  return out;
}

/**
 * A lane bot's commands for this think. A hero focus no rule kept this think is dropped with a stop (a `move` to
 * its own tile), so a fight it let go of doesn't run on as a chase.
 */
export function laneCommands(
  map: GameMap,
  world: World,
  hero: Hero,
  profile: Profile,
): Command[] {
  const kept = { hero: false };
  const out = decide(map, world, hero, profile, kept);
  const [x, y] = tileOfSpot(hero);
  const moves = out.some((c) => c.type !== "cast");
  if (hero.focusOf === 1 && !kept.hero && !moves && openTile(map, x, y))
    out.push({ seat: hero.seat, type: "move", x, y });
  return out;
}

function decide(
  map: GameMap,
  world: World,
  hero: Hero,
  profile: Profile,
  kept: { hero: boolean },
): Command[] {
  const { seat } = hero;
  const team = teamOf(seat);
  const fort = fortSite(map, seat);
  const max = heroMaxHp(hero);
  const range = HEROES[hero.kind].range;
  const gun = heroGun(hero);
  const out: Command[] = [];
  // A walk within a tile of the one it is on keeps it, so a goal that drifts doesn't rebuild a flow field each think.
  const [gx, gy] = [hero.goal % map.width, div(hero.goal, map.width)];
  const walk = (x: number, y: number, sweep = false): Command[] => {
    const goal = y * map.width + x;
    if (
      goal === tileOf(hero.y) * map.width + tileOf(hero.x) ||
      !openTile(map, x, y)
    )
      return out;
    const same =
      hero.goal >= 0 &&
      x - gx <= 1 &&
      gx - x <= 1 &&
      y - gy <= 1 &&
      gy - y <= 1;
    if (same && hero.sweep > 0 === sweep && hero.focusOf < 0) return out;
    out.push({ seat, type: sweep ? "attackMove" : "move", x, y });
    return out;
  };
  const attack = (of: number, id: number): Command[] => {
    kept.hero ||= of === 1;
    if (hero.focusOf !== of || hero.focus !== id)
      out.push({ seat, type: "attack", of, id });
    return out;
  };
  const foes = world.heroes.filter((h) => alive(h) && teamOf(h.seat) !== team);
  const allies = world.heroes.filter(
    (h) => alive(h) && teamOf(h.seat) === team,
  );
  const close = foes.filter((h) => h.cloak === 0 && near(hero, h.x, h.y, NEAR));
  const spell = (mode: Mode) =>
    laneCast(map, world, hero, profile, out, close, mode);
  const lane = botLane(map, world, seat, profile);
  const laneOf = lane >= 0 ? lane : seatLane(map, world, seat);
  const track = trackOf(map.lanes[laneOf]!, team);
  const mine = progress(track, hero.x, hero.y);
  const back = () => walk(...tileAt(track, mine - 6 * TILE - (mine % STAND)));
  // How far along its lane its outermost standing structure stands: behind it is safe.
  let own = 0;
  for (const building of world.buildings) {
    const site = map.sites[building.id]!;
    if (site.lane !== laneOf || site.team !== team || building.hp <= 0)
      continue;
    const at = progress(track, centreOf(site.x), centreOf(site.y));
    own = at > own ? at : own;
  }

  // 1. Rest, shop and fall back.
  const id = nextBuy(hero);
  const hurt = hero.hp * 10 < max * 7;
  const lull = !world.units.some(
    (u) =>
      u.owner !== NEUTRAL &&
      teamOf(u.owner) !== team &&
      near(hero, u.x, u.y, SCOUT),
  );
  const shopping =
    id >= 0 &&
    hero.items.includes(-1) &&
    hero.gold * 2 >= ITEMS[id]!.cost * (hurt || lull ? 2 : 3);
  const energy = heroMaxEnergy(hero);
  if (atFountain(map, hero)) {
    const rested =
      hero.hp * 100 >= max * profile.rested && hero.energy * 100 >= energy * 60;
    // A walk out is cancelled with a stop on the fort's tile, where `walk` sends nothing.
    if (!rested && close.length === 0) {
      if (hero.goal >= 0 && hero.goal !== fort.y * map.width + fort.x)
        out.push({ seat, type: "move", x: fort.x, y: fort.y });
      return out;
    }
  } else {
    if (
      hero.goal === fort.y * map.width + fort.x ||
      (shopping && close.length === 0)
    ) {
      spell("flee");
      return walk(fort.x, fort.y);
    }
    const tired = hero.energy * 100 < energy * 20 && hero.hp * 2 < max;
    const low = hero.hp * 100 < max * profile.retreat || tired;
    // Behind its tower with an enemy hero come after it, it fights there (its tower on its side) rather than rest.
    const behind = mine <= own - TILE;
    if (low && !behind) {
      spell("flee");
      return walk(...tileAt(track, own - 3 * TILE));
    }
    if (
      behind &&
      close.length === 0 &&
      (low || hero.hp * 100 < max * profile.rested)
    ) {
      // It rests where it stands: a walk under way stops.
      const [x, y] = tileOfSpot(hero);
      if (hero.goal >= 0 && openTile(map, x, y))
        out.push({ seat, type: "move", x, y });
      return out;
    }
  }

  // 2. A fight with the enemy heroes near.
  const prey = lowest(close);
  if (prey !== undefined) {
    const friends = allies.filter((h) => near(hero, h.x, h.y, NEAR));
    // The longer gun of the pair shoots free while the other closes in: that much off the shorter's hit points.
    const free = (a: Hero, b: Hero) => {
      const reach = HEROES[b.kind].range - HEROES[a.kind].range;
      if (profile.sense < 2 || reach <= 0) return 0;
      return div(div(dps(b) * reach, HEROES[a.kind].speed), 1000);
    };
    const towers = (side: number) =>
      profile.sense > 0
        ? guns(map, world, side, prey.x, prey.y).length * TOWER_DPS
        : 0;
    const strength = (side: Hero[], guns: number, gap: number) =>
      (side.reduce((sum, h) => sum + h.hp, 0) - gap) *
      (side.reduce((sum, h) => sum + dps(h), 0) + guns);
    const ours = strength(friends, towers(1 - team), free(hero, prey));
    const theirs = strength(close, towers(team), free(prey, hero));
    const engaged =
      hero.focusOf === 1 && close.some((h) => h.seat === hero.focus);
    const winning =
      ours * 100 >= theirs * (profile.nerve - (engaged ? SWAY : 0));
    spell(
      winning
        ? "fight"
        : ours * 100 < theirs * (profile.nerve - SWAY)
          ? "flee"
          : "calm",
    );
    // A hero walking away (its walk leads away from this one: visible motion) out of its gun's reach is let go: at
    // the same speed a chase would never close.
    const target = engaged
      ? world.heroes.find((h) => h.seat === hero.focus)!
      : prey;
    const goal = {
      x: centreOf(target.goal % map.width),
      y: centreOf(div(target.goal, map.width)),
    };
    const fleeing =
      target.goal >= 0 &&
      d2(goal.x, goal.y, hero.x, hero.y) >
        d2(target.x, target.y, hero.x, hero.y);
    if (winning && (!fleeing || near(hero, target.x, target.y, range)))
      return attack(1, target.seat);
    if (close.some((h) => near(hero, h.x, h.y, HEROES[h.kind].range + TILE)))
      return back();
  }

  // 3. Towers.
  const outlasts = (index: number) => {
    const building = world.buildings[index]!;
    if (close.length > 0 || !enemyAt(map, world, team, 2, building.id))
      return false;
    const shooter = map.sites[building.id]!.kind === "fort" ? FORT_GUN : TOWER;
    const steps = div(building.hp * gun.cooldown, gun.damage);
    return (
      div(steps * shooter.damage * RAMPED, 10 * shooter.cooldown) < hero.hp * 7
    );
  };
  const covered =
    close.length === 0 &&
    allies.filter((h) => near(hero, h.x, h.y, NEAR)).length > 1;
  const holds = (index: number) => {
    const site = map.sites[world.buildings[index]!.id]!;
    const [sx, sy] = [centreOf(site.x), centreOf(site.y)];
    const tanks = world.units.filter(
      (u) =>
        u.lane >= 0 && teamOf(u.owner) === team && near(u, sx, sy, TOWER.range),
    ).length;
    return tanks >= TANKS || covered || outlasts(index);
  };
  const threats = guns(map, world, team, hero.x, hero.y, TILE);
  const aimed = (index: number) => {
    const building = world.buildings[index]!;
    return building.aimOf === 1 && building.aim === seat && !outlasts(index);
  };
  if (threats.some((index) => aimed(index) || !holds(index))) {
    spell("flee");
    return back();
  }

  // 4. A last hit, as `combat.ts` counts it; a unit it already chases stays its target a little further out, so a
  // quick thinker doesn't drop the chase.
  const armoured = upgrades(map, world, 1 - team).armour;
  let finish = -1,
    finishHp = 0;
  for (const unit of world.units) {
    const reach =
      range + (hero.focusOf === 0 && hero.focus === unit.id ? 3 : 1) * TILE;
    if (unit.owner === NEUTRAL || teamOf(unit.owner) === team) continue;
    if (!near(hero, unit.x, unit.y, reach)) continue;
    let shot = div(gun.damage * hideOf(world, unit, 1 - team), 100);
    if (armoured && unit.kind === "grunt" && unit.lane >= 0)
      shot = div(shot * (100 - GRUNT_ARMOUR), 100);
    if (
      unit.hp * 100 <= shot * profile.lastHit &&
      (finish < 0 || unit.hp < finishHp)
    )
      [finish, finishHp] = [unit.id, unit.hp];
  }
  if (finish >= 0) return attack(0, finish);

  // 5. A siege.
  for (const [index, building] of world.buildings.entries()) {
    if (!enemyAt(map, world, team, 2, building.id)) continue;
    const site = map.sites[building.id]!;
    if (
      near(hero, centreOf(site.x), centreOf(site.y), range + TILE) &&
      holds(index)
    ) {
      spell("siege");
      return attack(2, building.id);
    }
  }
  spell("calm");

  // 6. More heroes standing than the enemy: the structure nearest the team, from a lane 4 tiles short of it once two
  // stand together (or a lone hero outlasts it), else just outside a tower's reach to gather.
  if (allies.length > foes.filter((h) => h.cloak === 0).length) {
    const mean = (of: (h: Hero) => number) =>
      div(
        allies.reduce((sum, h) => sum + of(h), 0),
        allies.length,
      );
    const [cx, cy] = [mean((h) => h.x), mean((h) => h.y)];
    // The same for every hero of the team, so they all pick the same spot.
    // Within half of `NEAR` of the mean, so any two of them stand within `NEAR` of each other (rule 3's cover).
    const gathered =
      allies.filter((h) => near(h, cx, cy, div(NEAR, 2))).length > 1;
    const short =
      gathered || allies.length === 1 ? 4 * TILE : TOWER.range + 2 * TILE;
    let goal: [number, number] | undefined,
      bestD = -1;
    for (const [index, building] of world.buildings.entries()) {
      const aim = enemyAt(map, world, team, 2, building.id);
      if (!aim || (allies.length === 1 && !outlasts(index))) continue;
      const d = d2(aim.x, aim.y, cx, cy);
      if (bestD >= 0 && d >= bestD) continue;
      let spotD = -1;
      for (const each of map.lanes) {
        const along = trackOf(each, team);
        const spot = tileAt(along, progress(along, aim.x, aim.y) - short);
        const e = d2(centreOf(spot[0]), centreOf(spot[1]), aim.x, aim.y);
        if (spotD < 0 || e < spotD) [goal, spotD, bestD] = [spot, e, d];
      }
    }
    if (goal) return walk(...goal, true);
  }

  // Its wave's front and the enemy wave's on its lane, as lengths along it from its own end.
  let front = -1,
    enemyFront = -1;
  for (const unit of world.units) {
    if (unit.lane !== laneOf) continue;
    const at = progress(track, unit.x, unit.y);
    if (teamOf(unit.owner) === team) front = at > front ? at : front;
    else if (enemyFront < 0 || at < enemyFront) enemyFront = at;
  }

  // 7. The jungle.
  const half = div(track.at.at(-1)!, 2);
  const pushed = front > half && (enemyFront < 0 || enemyFront > half);
  if (lane < 0 || pushed) {
    const flag = jungleFlag(
      map,
      world,
      hero,
      profile.jungle * (lane < 0 ? 2 : 1),
      lane < 0,
    );
    if (flag >= 0) return walk(flag % map.width, div(flag, map.width), true);
  }

  // 8. The lane.
  const razed = razedBy(map, world.buildings);
  const watch = tileAt(track, front < 0 ? mine : front);
  const contested =
    razed[team]! <= razed[1 - team]! &&
    foes.some(
      (h) =>
        h.cloak === 0 && near(h, centreOf(watch[0]), centreOf(watch[1]), SCOUT),
    );
  let stand = front < 0 ? own - 2 * TILE : front + (contested ? 0 : 2 * TILE);
  const edge = enemyFront - range + TILE;
  if (contested && enemyFront >= 0 && stand > edge) stand = edge;
  if (lull && stand < mine) stand = mine;
  // Never into a structure's reach it may not stand in.
  const [sx, sy] = tileAt(track, stand);
  for (const index of guns(map, world, team, centreOf(sx), centreOf(sy), TILE))
    if (!holds(index)) {
      const site = map.sites[world.buildings[index]!.id]!;
      if (site.lane >= 0 && site.lane !== laneOf) continue;
      const at =
        progress(track, centreOf(site.x), centreOf(site.y)) -
        TOWER.range -
        2 * TILE;
      stand = at < stand ? at : stand;
    }
  const [x, y] = tileAt(track, stand < 0 ? 0 : stand - (stand % STAND));
  if (near(hero, centreOf(x), centreOf(y), 2 * TILE)) return out;
  return walk(x, y, !contested);
}

/**
 * The tile of the jungle flag its team doesn't hold (nor FORTIFY) cheapest to walk to within `reach` tiles, from level
 * 3 with 80 percent hit points, while no enemy unit (camp guards aside) stands within `SCOUT` and no enemy hero within
 * twice that (a laner, so no enemy hero pushes its lane while it is gone) or `SCOUT` (a roamer); -1 otherwise.
 */
function jungleFlag(
  map: GameMap,
  world: World,
  hero: Hero,
  reach: number,
  roamer: boolean,
) {
  const team = teamOf(hero.seat);
  if (reach <= 0 || levelOf(hero.xp) < 3 || hero.hp * 10 < heroMaxHp(hero) * 8)
    return -1;
  const enemy = (owner: number, at: Spot, r: number) =>
    owner !== NEUTRAL && teamOf(owner) !== team && near(hero, at.x, at.y, r);
  if (world.units.some((u) => enemy(u.owner, u, SCOUT))) return -1;
  if (
    world.heroes.some(
      (h) =>
        alive(h) &&
        h.cloak === 0 &&
        enemy(h.seat, h, roamer ? SCOUT : 2 * SCOUT),
    )
  )
    return -1;
  const at = tileOf(hero.y) * map.width + tileOf(hero.x);
  let best = -1,
    bestCost = reach * STRAIGHT + 1;
  for (const [sector, flag] of map.flags.entries()) {
    const owner = world.sectors[sector]!;
    if (map.sectorKinds[sector] !== "jungle" || world.fortified[sector]! > 0)
      continue;
    if (owner !== NEUTRAL && teamOf(owner) === team) continue;
    const tile = flag.y * map.width + flag.x;
    const cost = flowField(map, tile).cost(at);
    if (cost !== UNREACHABLE && cost < bestCost)
      [best, bestCost] = [tile, cost];
  }
  return best;
}

/** What a think is doing: taking a fight, fleeing one, bringing down a structure, or none of these. */
type Mode = "fight" | "flee" | "siege" | "calm";

/** At most one spell a think, pushed onto `out`, when `mode` and the kit call for it; easy casts only its first slot. */
function laneCast(
  map: GameMap,
  world: World,
  hero: Hero,
  profile: Profile,
  out: Command[],
  close: Hero[],
  mode: Mode,
): void {
  if (out.some((command) => command.type === "cast")) return;
  const { seat } = hero;
  const team = teamOf(seat);
  const kit = kitOf(hero);
  const level = levelOf(hero.xp);
  const ready = (slot: number) => {
    const spell = kit[slot]!;
    return (
      !spell.passive &&
      level >= spell.unlock &&
      hero.spells[slot] === 0 &&
      hero.energy >= spell.energy &&
      // A profile without Rally Cry (easy) casts only its first slot.
      (slot === 0 || profile.rally > 0)
    );
  };
  let crowd = 0,
    robots = 0,
    owned = 0,
    tank: (Spot & { id: number }) | undefined;
  for (const unit of world.units) {
    if (unit.owner === NEUTRAL) continue;
    if (unit.owner === seat && unit.lane < 0) owned++;
    const ally = teamOf(unit.owner) === team;
    const robot = UNITS[unit.kind].robot;
    if (!ally && robot && near(hero, unit.x, unit.y, kit[0]!.radius)) crowd++;
    if (ally && robot && near(hero, unit.x, unit.y, NEAR)) robots++;
    if (!ally && unit.kind === "lightTank" && near(hero, unit.x, unit.y, NEAR))
      tank ??= unit;
  }
  const room = owned < unitCap(world, seat);
  const busy = mode === "fight" || mode === "siege";
  const flee = mode === "flee" && close.length > 0;
  const own = tileOfSpot(hero);
  const inReach = (slot: number, at: Spot) =>
    near(hero, at.x, at.y, kit[slot]!.range);
  /** The tile DASH's reach toward `at`, or `at`'s when nearer. */
  const toward = (at: Spot): [number, number] => {
    const [dx, dy] = [at.x - hero.x, at.y - hero.y];
    const [length, reach] = [
      isqrt(dx * dx + dy * dy),
      kit[0]!.range - div(TILE, 2),
    ];
    if (length <= reach) return tileOfSpot(at);
    return tileOfSpot({
      x: hero.x + div(dx * reach, length),
      y: hero.y + div(dy * reach, length),
    });
  };
  const ratio = (h: Hero) => div(h.hp * 1000, heroMaxHp(h));
  const hurt = world.heroes
    .filter(
      (h) =>
        alive(h) && teamOf(h.seat) === team && ratio(h) < 700 && inReach(0, h),
    )
    .sort((a, b) => ratio(a) - ratio(b) || a.seat - b.seat)[0];
  const snipe = lowest(
    world.heroes.filter(
      (h) =>
        alive(h) && teamOf(h.seat) !== team && h.cloak === 0 && inReach(0, h),
    ),
  );
  const prey = lowest(close);
  const fort = fortSite(map, seat);
  const home = { x: centreOf(fort.x), y: centreOf(fort.y) };
  const pick = (at: Spot | undefined, of: number, id: number) =>
    at ? ([tileOfSpot(at), { of, id }] as const) : ([null] as const);
  /** By kit: [slot, whether it is called for, the aim tile, and the target it names]. */
  type Plan = readonly [number, boolean, [number, number] | null, Chosen?];
  const plans: Plan[] =
    hero.kind === "vix"
      ? [
          [
            3,
            room && tank !== undefined && inReach(3, tank),
            ...pick(tank, 0, tank?.id ?? 0),
          ],
          [
            0,
            snipe !== undefined && mode !== "flee",
            ...pick(snipe, 1, snipe?.seat ?? 0),
          ],
          [1, flee, own],
          [2, tank !== undefined, own],
        ]
      : hero.kind === "rivet"
        ? [
            [0, hurt !== undefined, ...pick(hurt, 1, hurt?.seat ?? 0)],
            [1, busy && room, own],
          ]
        : hero.kind === "tally"
          ? [
              [3, busy && robots >= profile.rally, own],
              [0, flee, toward(home)],
              [
                0,
                mode === "fight" &&
                  !!prey &&
                  !near(hero, prey.x, prey.y, HEROES.tally.range),
                prey ? toward(prey) : null,
              ],
            ]
          : [
              [0, profile.shockwave > 0 && crowd >= profile.shockwave, own],
              [1, profile.rally > 0 && robots >= profile.rally && busy, own],
              [3, profile.drop && room && busy, own],
            ];
  const plan = plans.find(
    ([slot, wanted, aim]) => wanted && aim !== null && ready(slot),
  );
  if (plan === undefined || plan[2] === null) return;
  const [slot, , [x, y], chosen] = plan;
  out.push({ seat, type: "cast", slot, x, y, ...chosen });
}
