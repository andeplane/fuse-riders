import { clamp, div } from "./math.js";
import {
  ATTACK,
  DOWN,
  INPUT_MASK,
  JUMP,
  LEFT,
  MAGIC,
  RIGHT,
  UP,
  pressed,
  released,
} from "./input.js";
import {
  advanceSpells,
  charge,
  conjure,
  conjures,
  spellbound,
} from "./magic.js";
import * as T from "./tuning.js";
import { planOf, waveSpawns, type Placed, type Side } from "./stages.js";
import { act, rest, thinks } from "./ai.js";
import { brace, breaks, enrage, isOgre, ogreAct } from "./ogre.js";
import { isLancer, lancerAct, soar, takeOff } from "./lancer.js";
import {
  advanceImps,
  advanceItems,
  gone,
  isImp,
  kick,
  kickable,
  scurry,
} from "./imps.js";
import {
  SPAWNS,
  inView,
  launch,
  newEnemy,
  present,
  setState,
  spark,
  type Enemy,
  type EnemyState,
  type Hero,
  type HeroState,
  type World,
} from "./world.js";

/**
 * One 1/60 s step, as a pure function: the input world is left untouched. The order is part of the rules: effects
 * past their life are dropped; every hero in id order reads its seat's held bits, swings, walks, runs, dashes, jumps
 * or falls (or reels, lies, gets up, drops back in, charges or casts magic), is held to the floor band and the
 * screen, and lands its blade on the enemies in id order; then the spells play in the order they were cast
 * (`magic.ts`), landing the blows due; then, unless a spell holds them frozen, every enemy in id order walks in,
 * reels, flies, lies or gets up, or thinks (`ai.ts`, an ogre `ogre.ts`) and lands its blows on the heroes in id order;
 * an ogre whose twin has fallen enrages (`enrage`); a defeated enemy
 * that has blinked long enough is gone, as
 * is a sack imp that has left the screen (`imps.ts`); then the items on the floor fall, vanish or are picked up; then
 * the camera follows, no further than the next wave's trigger; then the waves begin, spawn and clear
 * (`advanceWaves`), and the imps the camera has reached are sent. `held` holds each seat's bits by seat index; a
 * missing seat holds nothing.
 */
export function step(world: World, held: readonly number[]): World {
  const now = world.step + 1;
  const next: World = {
    ...world,
    step: now,
    heroes: world.heroes.map((hero) => ({ ...hero })),
    enemies: world.enemies.map((enemy) => ({ ...enemy })),
    fx: world.fx.filter((fx) => now - fx.born < T.FX_LIFE),
    items: world.items.map((item) => ({ ...item })),
    spells: [...world.spells],
  };
  for (const hero of next.heroes)
    moveHero(next, hero, (held[hero.seat] ?? 0) & INPUT_MASK);
  advanceSpells(next);
  if (!spellbound(next))
    for (const enemy of next.enemies) moveEnemy(next, enemy);
  enrage(next);
  next.enemies = next.enemies.filter(
    (enemy) =>
      (enemy.state !== "dead" || enemy.timer < T.DEAD_STEPS) &&
      !gone(next, enemy),
  );
  advanceItems(next);
  advanceCamera(next);
  advanceWaves(next);
  advanceImps(next);
  return next;
}

/**
 * One 50 ms log tick of `STEPS_PER_TICK` steps, as Choppers folds them: the first step takes `first` (by seat, the
 * last bits logged this tick together with every tap logged during it, so a tap shorter than a tick still
 * presses) and the others take `held` (the last bits logged).
 */
export function stepTick(
  world: World,
  held: readonly number[],
  first: readonly number[] = held,
): World {
  let next = world;
  for (let index = 0; index < T.STEPS_PER_TICK; index++)
    next = step(next, index === 0 ? first : held);
  return next;
}

/** The walk the held directions ask for; opposite directions cancel and a diagonal is no faster than straight. */
function walk(hero: Hero, bits: number): void {
  const dx = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0),
    dy = (bits & DOWN ? 1 : 0) - (bits & UP ? 1 : 0),
    speed = T.WALK[hero.kind],
    scale = dx !== 0 && dy !== 0 ? T.DIAGONAL : 256;
  hero.vx = dx * div(speed.x * scale, 256);
  hero.vy = dy * div(speed.y * scale, 256);
  if (dx !== 0) hero.facing = dx > 0 ? 1 : -1;
}

export const SWINGS: readonly HeroState[] = ["attack1", "attack2", "attack3"];

/** A swing starts from a standstill and with a clean slate of enemies struck. */
function startSwing(hero: Hero, index: number): void {
  hero.state = SWINGS[index]!;
  hero.timer = hero.vx = hero.vy = hero.attackBuf = 0;
  hero.struck = [];
}

/**
 * A swing's step. Presses in the wind-up are dropped; once the blade's window has passed, a press waiting from the
 * window or the recovery chains the next swing (the finisher ends the combo, and a press then waits for idle); at
 * the recovery's end the hero is idle again. Returns the swing while its blade is out.
 */
function swing(hero: Hero, index: number): T.Swing | undefined {
  const frames = T.COMBO[hero.kind][index]!,
    hits = frames.startup + frames.active;
  if (hero.timer < frames.startup) hero.attackBuf = 0;
  else if (hero.timer < hits) return frames;
  else if (hero.attackBuf > 0 && index < SWINGS.length - 1)
    startSwing(hero, index + 1);
  else if (hero.timer >= hits + frames.recovery) setState(hero, "idle");
  return undefined;
}

const SIDES = LEFT | RIGHT;

/**
 * Follows Left and Right for the run's double tap, from presses and releases alone, so a rollback replays it. A press
 * of one direction starts a tap of it, and any other press of either cancels whatever was waiting; letting go of it
 * by `RUN_TAP` steps makes it a tap, and a second press of it within `RUN_GAP` steps of that waits `BUFFER_STEPS`
 * as the run's. Letting go of a direction held too long, or of the second press, leaves nothing.
 */
function doubleTap(world: World, hero: Hero, down: number, up: number): void {
  if (up & hero.tap)
    if (world.step <= hero.tapUntil) hero.tapUntil = world.step + T.RUN_GAP;
    else hero.tap = hero.tapUntil = hero.runBuf = 0;
  if (!down) return;
  if (down === hero.tap && world.step <= hero.tapUntil) {
    hero.runBuf = T.BUFFER_STEPS;
    hero.tapUntil = 0;
  } else {
    hero.tap = down === SIDES ? 0 : down;
    hero.tapUntil = hero.tap ? world.step + T.RUN_TAP : 0;
    hero.runBuf = 0;
  }
}

/** A run's step: its speed along the road the way the hero faces, steered in depth at the walk's pace. */
function stride(hero: Hero, bits: number): void {
  hero.vx = hero.facing * T.RUN[hero.kind];
  hero.vy = ((bits & DOWN ? 1 : 0) - (bits & UP ? 1 : 0)) * T.WALK[hero.kind].y;
}

/** A jump leaves the floor with the hero's velocity this step, which it keeps until it lands. */
function leap(hero: Hero): void {
  setState(hero, "jump");
  hero.vz = T.JUMP_VZ;
  hero.jumpBuf = 0;
}

/**
 * A run's step. It ends, leaving the hero free to walk on this step, once its direction is let go or the other one
 * held; Magic from it stops to charge or cast (`magic.ts`), Attack dashes and Jump leaps, carrying the run's speed.
 */
function run(world: World, hero: Hero, bits: number): void {
  if ((bits & SIDES) !== (hero.facing > 0 ? RIGHT : LEFT))
    setState(hero, "idle");
  else if (conjures(hero)) conjure(world, hero, bits);
  else if (hero.attackBuf > 0) {
    setState(hero, "dash");
    hero.vx = hero.facing * T.DASH[hero.kind].speed;
    hero.vy = hero.attackBuf = 0;
    hero.struck = [];
  } else {
    stride(hero, bits);
    if (hero.jumpBuf > 0) leap(hero);
  }
}

/**
 * A dash's step: it slides on with its blow out for its active steps (the first is the step it began), then stands
 * through the recovery and is idle again. Returns the blow while it is out.
 */
function dash(hero: Hero): T.Dash | undefined {
  const frames = T.DASH[hero.kind];
  if (hero.timer < frames.active) return frames;
  hero.vx = 0;
  if (hero.timer >= frames.active + frames.recovery) setState(hero, "idle");
  return undefined;
}

/** How long each timed hero state lasts, and what follows it. */
const HERO_AFTER: Partial<Record<HeroState, readonly [number, HeroState]>> = {
  land: [T.LAND_STEPS, "idle"],
  hurt: [T.HERO_HURT_STEPS, "idle"],
  down: [T.HERO_DOWN_STEPS, "getup"],
  getup: [T.GETUP_STEPS, "idle"],
  dead: [T.RESPAWN_DELAY, "respawn"],
  throw: [T.THROW_STEPS, "idle"],
};
/** The states a hero flies, falls or drops in under gravity, and what each lands in. */
const AIRBORNE: readonly HeroState[] = [
  "jump",
  "jumpattack",
  "knockdown",
  "respawn",
];
/** The states a hero lies fallen in, where it fell. */
const FALLEN: readonly HeroState[] = ["dead", "out"];

/**
 * A fallen hero with a life left drops back in from the top of the screen at its seat's place, at full health, its
 * magic pots kept. The
 * screen row of a figure is its depth less its height, so a height equal to the depth is a drop from row 0.
 */
function respawn(world: World, hero: Hero): void {
  const [x, y] = SPAWNS[hero.seat]!;
  hero.x = world.camX + T.px(x);
  hero.y = hero.z = T.px(y);
  hero.facing = 1;
  hero.hp = T.HERO_HP[hero.kind];
  setState(hero, "respawn");
}

/**
 * The party continues: every hero drops back in at its seat's place on the screen with full health and every life
 * (`LIVES`), as after a lost life, with nothing buffered and its magic pots kept. The stage goes on where it stood: the
 * camera, the waves, the enemies and the items on the floor are left as they are. Pure, like `step`: the world passed
 * in is left untouched. The room calls it once per stage, on the first CONTINUE folded after every hero is out
 * (`defeated`).
 */
export function revive(world: World): World {
  const next: World = {
    ...world,
    heroes: world.heroes.map((hero) => ({ ...hero })),
  };
  for (const hero of next.heroes) {
    hero.lives = T.LIVES;
    hero.vx = hero.vy = hero.vz = 0;
    hero.attackBuf = hero.jumpBuf = hero.runBuf = hero.magicBuf = 0;
    hero.stagger = 0;
    hero.tap = hero.tapUntil = 0;
    hero.struck = [];
    respawn(next, hero);
  }
  return next;
}

/**
 * A hero's timed state runs out: landing, reeling and getting up end in idle, lying in getting up (invulnerable,
 * and for `GETUP_GRACE` after), and a fallen hero drops back in, or with no life left is out.
 */
function recover(world: World, hero: Hero): void {
  const after = HERO_AFTER[hero.state];
  if (!after || hero.timer < after[0]) return;
  if (after[1] === "getup")
    hero.invulnUntil = world.step + T.GETUP_STEPS + T.GETUP_GRACE;
  if (after[1] !== "respawn") setState(hero, after[1]);
  else if (hero.lives > 0) respawn(world, hero);
  else setState(hero, "out");
}

/**
 * Where a figure in the air comes down: a jump (with or without its stab) lands, a knockdown lies down or falls for
 * good, a drop-in stands.
 */
function land(world: World, hero: Hero): void {
  if (hero.state === "jump" || hero.state === "jumpattack")
    setState(hero, "land");
  else if (hero.state === "respawn") {
    setState(hero, "idle");
    hero.invulnUntil = world.step + T.RESPAWN_INVULN;
  } else if (hero.hp > 0) setState(hero, "down");
  else {
    setState(hero, "dead");
    hero.lives--;
  }
}

/** A nudge slowing toward a stop by `HURT_FRICTION` a step. */
const slow = (v: number): number =>
  Math.sign(v) * Math.max(0, Math.abs(v) - T.HURT_FRICTION) + 0;

function moveHero(world: World, hero: Hero, bits: number): void {
  const presses = pressed(bits, hero.held),
    releases = released(bits, hero.held);
  hero.held = bits;
  if (hero.state === "out") return;
  if (presses & ATTACK) hero.attackBuf = T.BUFFER_STEPS;
  if (presses & JUMP) hero.jumpBuf = T.BUFFER_STEPS;
  if (presses & MAGIC) hero.magicBuf = T.BUFFER_STEPS;
  doubleTap(world, hero, presses & SIDES, releases & SIDES);
  // Hit-stop holds the hero, and the presses it buffers, in place.
  if (world.step <= hero.stopUntil) return;
  hero.timer++;
  recover(world, hero);
  if (hero.state === "run") run(world, hero, bits);
  else if (hero.state === "charge") charge(world, hero, bits);
  advanceMove(world, hero, presses);
  const index = SWINGS.indexOf(hero.state);
  const blade =
    index >= 0
      ? swing(hero, index)
      : hero.state === "dash"
        ? dash(hero)
        : undefined;
  if (hero.state === "idle" || hero.state === "walk") {
    walk(hero, bits);
    // Magic comes first, as from a run: it spends a pot on purpose, so no Attack or Jump pressed with it takes it over.
    if (conjures(hero)) conjure(world, hero, bits);
    else if (paired(hero)) backAttack(hero);
    else if (hero.attackBuf > 0) attack(world, hero, bits);
    else if (hero.jumpBuf > 0) leap(hero);
    else if (hero.runBuf > 0 && (bits & SIDES) === hero.tap) {
      setState(hero, "run");
      hero.facing = hero.tap === RIGHT ? 1 : -1;
      hero.runBuf = 0;
      stride(hero, bits);
    } else setState(hero, hero.vx !== 0 || hero.vy !== 0 ? "walk" : "idle");
  }
  // A jump keeps the momentum it launched with: no steering in the air, as in the original.
  hero.x += hero.vx;
  hero.y += hero.vy;
  if (AIRBORNE.includes(hero.state)) {
    hero.z += hero.vz;
    hero.vz -= T.GRAVITY;
    if (hero.z <= 0) {
      hero.z = hero.vx = hero.vy = hero.vz = 0;
      land(world, hero);
    }
  } else if (hero.state === "hurt") hero.vx = slow(hero.vx);
  // A fallen hero lies where it fell, and the camera leaves it behind rather than drag it along the screen's edge: one
  // that has just gone out too, or it would be pulled onto the screen on the step it does.
  if (!FALLEN.includes(hero.state))
    hero.x = clamp(
      hero.x,
      world.camX + T.HERO_MARGIN,
      world.camX + T.VIEW_W * T.SUB - T.HERO_MARGIN,
    );
  hero.y = clamp(hero.y, T.FLOOR_TOP, T.FLOOR_BOTTOM);
  if (blade) strike(world, hero, blade);
  moveStrike(world, hero);
  if (hero.attackBuf > 0) hero.attackBuf--;
  if (hero.jumpBuf > 0) hero.jumpBuf--;
  if (hero.runBuf > 0) hero.runBuf--;
  if (hero.magicBuf > 0) hero.magicBuf--;
}

/**
 * An enemy a blade can land on: on its feet (thinking or reeling), or walking or leaping in once its whole body is on
 * screen; a sack imp as `kickable` says.
 */
export const hittable = (world: World, enemy: Enemy): boolean =>
  isImp(enemy)
    ? kickable(world, enemy)
    : thinks(enemy) ||
      enemy.state === "hurt" ||
      ((enemy.state === "enter" || enemy.state === "leap") &&
        inView(world, enemy));

/** The blows that knock down whatever they land on: the finisher, the dash, the back attack and the jump attack. */
const KNOCKS: readonly HeroState[] = [
  "attack3",
  "dash",
  "backattack",
  "jumpattack",
];
/** Which way along the road a hero's blade lands: behind it in the back attack, in front otherwise. */
const aim = (hero: Hero): 1 | -1 =>
  hero.state === "backattack" ? (hero.facing > 0 ? -1 : 1) : hero.facing;

/**
 * The blade's window: it reaches `reach` from the hero's centre the way it aims (`aim`), sweeps `SWING_HEIGHT` up
 * from its feet (the jump attack's stab `STAB_BELOW` under them too) and lands only in the depth lane. Every hittable
 * enemy whose body overlaps it takes the hit, each at most once a swing, a dash or a jump; heroes are never in its way.
 */
function strike(world: World, hero: Hero, blade: T.Blow): void {
  const below = hero.state === "jumpattack" ? T.STAB_BELOW : 0;
  for (const enemy of world.enemies) {
    const ahead = (enemy.x - hero.x) * aim(hero),
      { half, height } = T.ENEMY_BODY[enemy.kind];
    if (
      hittable(world, enemy) &&
      !hero.struck.includes(enemy.id) &&
      ahead + half >= 0 &&
      ahead - half <= blade.reach &&
      Math.abs(enemy.y - hero.y) <= T.LANE &&
      enemy.z < hero.z + T.SWING_HEIGHT &&
      hero.z - below < enemy.z + height
    )
      hit(world, hero, enemy, blade.damage);
  }
}

/**
 * A hit: the damage, then hitstun and a nudge away from the hero, which breaks off the enemy's swing, or, from a blow
 * that knocks down (`KNOCKS`), at no hp left or in the air (a lancer's leap), a knockdown that launches the enemy up
 * and away and frees its place by the hero it was going for. Attacker and target both hold still for the hit-stop. A
 * sack imp is kicked (`kick`) instead, and the hero's tallies are left alone. An ogre's super armour takes the blow
 * (`brace`) unless it breaks (`breaks`).
 */
function hit(world: World, hero: Hero, enemy: Enemy, damage: number): void {
  const taken = Math.min(damage, enemy.hp),
    heavy = KNOCKS.includes(hero.state),
    knocked = isOgre(enemy)
      ? breaks(world, enemy, taken, heavy)
      : heavy || ((enemy.hp === taken || enemy.z > 0) && !isImp(enemy)),
    dir = aim(hero),
    until = world.step + (knocked ? T.HEAVY_HITSTOP : T.HITSTOP);
  // In id order, the one way the checkpoint spells it: an enemy that gets up or is nudged into reach later in the
  // window can have a lower id than one already hit.
  hero.struck = [...hero.struck, enemy.id].sort((a, b) => a - b);
  hero.stopUntil = Math.max(hero.stopUntil, until);
  if (isImp(enemy)) return kick(world, enemy, dir, heavy);
  enemy.hp -= taken;
  hero.damage += taken;
  if (knocked) {
    launch(world, enemy, dir);
    hero.knockdowns++;
  } else if (isOgre(enemy)) brace(world, enemy, taken, heavy, dir);
  else {
    enemy.stopUntil = until;
    enemy.facing = dir > 0 ? -1 : 1;
    // Not `setState`, which ignores a change to the state the enemy is already in: a hit on a reeling enemy restarts
    // its hitstun.
    enemy.state = "hurt";
    enemy.timer = enemy.vz = 0;
    enemy.vx = dir * T.HURT_PUSH;
  }
  spark(
    world,
    enemy.hp === 0 ? "ko" : heavy ? "heavy" : "hit",
    enemy.x - dir * T.ENEMY_BODY[enemy.kind].half,
    enemy.y,
    enemy.z + T.SPARK_HEIGHT,
  );
}

/** How long each timed enemy state lasts, and what follows it. */
const AFTER: Partial<Record<EnemyState, readonly [number, EnemyState]>> = {
  hurt: [T.HURT_STEPS, "idle"],
  down: [T.DOWN_STEPS, "getup"],
  getup: [T.GETUP_STEPS, "idle"],
};

/** Sends an enemy walking in to `inset` inside the screen's edge on `side`, facing its way, going for nobody. */
function walkIn(world: World, enemy: Enemy, side: Side, inset: number): void {
  const left = side === "left";
  enemy.goal = left
    ? world.camX + inset
    : world.camX + T.VIEW_W * T.SUB - inset;
  enemy.facing = left ? 1 : -1;
  enemy.vx = enemy.target = 0;
  setState(enemy, "enter");
}

/**
 * An enemy's step, unless it is in hit-stop. One walking in steps toward its goal and stands idle there; a nudge
 * slows to a stop; a knockdown flies under gravity and lands `down`, or `dead` at no hp left, and a thrown body
 * (`fly`) too; reeling, lying and getting up each last their time, and a held one waits in its holder's hands until
 * the throw; a lancer's leap flies (`soar`). An idle enemy outside a locked screen walks back in at the nearer edge;
 * one on its feet otherwise thinks (`ai.ts`, an ogre `ogre.ts`, a lancer `lancer.ts`). Every enemy but one walking or
 * leaping in stays on the road (a wave at the stage's end enters from beyond it) and in the floor band. A sack imp
 * goes its own way (`scurry`) once it has moved and flown.
 */
function moveEnemy(world: World, enemy: Enemy): void {
  if (world.step <= enemy.stopUntil) return;
  enemy.timer++;
  enemy.x += enemy.vx;
  if (enemy.state === "enter") {
    enemy.x += clamp(enemy.goal - enemy.x, -T.ENTER_WALK, T.ENTER_WALK);
    if (enemy.x === enemy.goal) rest(world, enemy);
  } else if (enemy.state === "leap") soar(world, enemy);
  else if (enemy.state === "knockdown") {
    enemy.z += enemy.vz;
    enemy.vz -= T.GRAVITY;
    if (enemy.z <= 0) {
      enemy.z = enemy.vx = enemy.vz = 0;
      setState(enemy, enemy.hp > 0 ? "down" : "dead");
    }
  } else if (enemy.state === "thrown") fly(world, enemy);
  else enemy.vx = slow(enemy.vx);
  if (isImp(enemy)) return scurry(enemy);
  const after = AFTER[enemy.state];
  if (after && enemy.timer >= after[0])
    if (after[1] === "idle") rest(world, enemy);
    else setState(enemy, after[1]);
  if (enemy.state === "idle" && world.locked && !inView(world, enemy))
    walkIn(
      world,
      enemy,
      2 * (enemy.x - world.camX) < T.VIEW_W * T.SUB ? "left" : "right",
      T.RETURN_INSET,
    );
  if (thinks(enemy))
    (isOgre(enemy) ? ogreAct : isLancer(enemy) ? lancerAct : act)(world, enemy);
  if (enemy.state !== "enter" && enemy.state !== "leap")
    enemy.x = clamp(enemy.x, 0, planOf(world).length);
  enemy.y = clamp(enemy.y, T.FLOOR_TOP, T.FLOOR_BOTTOM);
}

/**
 * The camera only moves forward: it keeps the leading hero `CAMERA_LEAD` from its left edge, but never past the
 * leftmost hero (who therefore holds it), the next wave's trigger (or, while a wave is fought, its own) or the
 * stage's end, and no faster than `CAMERA_SPEED`. A hero off the field (fallen, dropping back in or out) counts
 * for nothing, or a fallen one would hold the camera where it lies; with no hero on the field it stays put.
 */
function advanceCamera(world: World): void {
  let leader = -Infinity,
    leftmost = Infinity;
  for (const hero of world.heroes) {
    if (!present(hero)) continue;
    if (hero.x > leader) leader = hero.x;
    if (hero.x < leftmost) leftmost = hero.x;
  }
  const { waves, cameraEnd } = planOf(world);
  const hold = waves[world.locked ? world.wave - 1 : world.wave];
  const target = Math.min(
    leader - T.CAMERA_LEAD,
    leftmost - T.HERO_MARGIN,
    hold?.at ?? cameraEnd,
    world.camX + T.CAMERA_SPEED,
  );
  if (target > world.camX) world.camX = target;
}

/** A wave's spawn appears just outside the screen's edge on its side and walks in, or a lancer leaps in (`takeOff`). */
function enter(world: World, spawn: Placed): void {
  const x =
    spawn.side === "left"
      ? world.camX - T.ENTER_OUT
      : world.camX + T.VIEW_W * T.SUB + T.ENTER_OUT;
  const enemy = newEnemy(world, spawn.kind, spawn.tier, x, spawn.y, 1);
  walkIn(world, enemy, spawn.side, spawn.inset);
  if (isLancer(enemy)) takeOff(enemy);
  world.enemies.push(enemy);
}

/**
 * The camera at the next trigger begins its wave and locks the screen. The locked wave's spawns enter in order as
 * their delays come due (one waits while the world holds `ENEMY_MAX`), and once all are in and no enemy is left but
 * sack imps, which leave on their own, the screen unlocks: GO shows, or after the last wave the stage is cleared.
 */
function advanceWaves(world: World): void {
  const { waves } = planOf(world);
  if (!world.locked) {
    if (world.wave >= waves.length || world.camX < waves[world.wave]!.at)
      return;
    world.wave++;
    world.locked = true;
    world.waveStep = world.step;
    world.spawned = 0;
  }
  const spawns = waveSpawns(waves[world.wave - 1]!, world.heroes.length);
  for (
    let due = spawns[world.spawned];
    due &&
    world.waveStep + due.delay <= world.step &&
    world.enemies.length < T.ENEMY_MAX;
    due = spawns[++world.spawned]
  )
    enter(world, due);
  if (
    world.spawned < spawns.length ||
    world.enemies.some((enemy) => !isImp(enemy))
  )
    return;
  world.locked = false;
  if (world.wave < waves.length) world.goUntil = world.step + T.GO_STEPS;
}

// ---- the back attack, the jump attack and the throw ----

/**
 * Attack and Jump pressed on the floor within `BACK_WINDOW` steps of each other are the back attack, and neither press
 * waits for the other: the first acts at once, and the second, within the window of it, turns the slash still
 * winding up or the jump still leaving the floor into the back attack (`advanceMove`). Both waiting as the hero comes
 * free make it when they were pressed within the window of each other (their buffers count down together); further
 * apart, Attack goes first as before and the Jump waits out its buffer. A run never makes it (`runningJump`).
 */
const paired = (hero: Hero): boolean =>
  hero.attackBuf > 0 &&
  hero.jumpBuf > 0 &&
  Math.abs(hero.attackBuf - hero.jumpBuf) <= T.BACK_WINDOW;

/** The back attack starts on the floor, from a standstill, keeping the hero's facing, with no enemy yet struck. */
function backAttack(hero: Hero): void {
  hero.state = "backattack";
  hero.timer = hero.z = hero.vx = hero.vy = hero.vz = 0;
  hero.attackBuf = hero.jumpBuf = 0;
  hero.struck = [];
}

/**
 * A jump from a run carries the run's speed along the road, faster than any walk. The back attack never comes from a
 * run: Attack in one dashes, and Attack in its jump is the jump attack however soon it follows the take-off.
 */
const runningJump = (hero: Hero): boolean =>
  Math.abs(hero.vx) > T.WALK[hero.kind].x;

/**
 * The moves beyond the combo, on the steps they run (before the swings and the free hero's choice): a Jump pressed
 * within `BACK_WINDOW` steps of a slash beginning, or an Attack within it of a standing or walking jump leaving the
 * floor, is the back attack; any other Attack in the air is the jump attack, once a jump; the back attack ends in
 * idle once its recovery is over, and the grab in the throw once `GRAB_STEPS` have passed.
 */
function advanceMove(world: World, hero: Hero, presses: number): void {
  const pairs = hero.timer <= T.BACK_WINDOW;
  if (hero.state === "attack1" && pairs && (presses & JUMP) !== 0)
    backAttack(hero);
  else if (hero.state === "jump" && hero.attackBuf > 0) {
    if (pairs && !runningJump(hero)) backAttack(hero);
    else {
      setState(hero, "jumpattack");
      hero.attackBuf = 0;
      hero.struck = [];
    }
  } else if (hero.state === "backattack") {
    const { startup, active, recovery } = T.BACK_ATTACK[hero.kind];
    if (hero.timer >= startup + active + recovery) setState(hero, "idle");
  } else if (hero.state === "grab" && hero.timer >= T.GRAB_STEPS)
    throwHeld(world, hero);
}

/**
 * A free hero's Attack: holding toward a dazed (`hurt`) enemy of a throwable kind within `GRAB_REACH` in front, in
 * its lane, it grabs the first such in id order, which waits `held` in its hands; otherwise it begins the combo.
 */
function attack(world: World, hero: Hero, bits: number): void {
  const toward = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0);
  const enemy = world.enemies.find((each) => {
    const ahead = (each.x - hero.x) * toward;
    return (
      toward === hero.facing &&
      each.state === "hurt" &&
      T.THROWABLE[each.kind] &&
      ahead >= 0 &&
      ahead <= T.GRAB_REACH &&
      Math.abs(each.y - hero.y) <= T.LANE
    );
  });
  if (!enemy) return startSwing(hero, 0);
  setState(hero, "grab");
  hero.vx = hero.vy = hero.attackBuf = 0;
  setState(enemy, "held");
  enemy.holder = hero.id;
  enemy.vx = enemy.target = 0;
  enemy.facing = hero.facing > 0 ? -1 : 1;
  enemy.x = hero.x + hero.facing * T.GRAB_HOLD;
  enemy.y = hero.y;
}

/**
 * The grab runs out and the hero throws: the body it holds leaves from over its shoulder and flies behind it
 * (`fly`), its thrower kept as its holder. The throw counts in the hero's tallies as a throw and a knockdown.
 */
function throwHeld(world: World, hero: Hero): void {
  setState(hero, "throw");
  hero.throws++;
  hero.knockdowns++;
  const body = world.enemies.find(
    (each) => each.state === "held" && each.holder === hero.id,
  )!;
  setState(body, "thrown");
  body.x = hero.x;
  body.y = hero.y;
  body.z = T.THROW_LIFT;
  body.vx = -hero.facing * T.THROW_VX;
  body.vz = T.THROW_VZ;
  body.facing = hero.facing;
  body.stopUntil = 0;
}

/**
 * A thrown body's step, after it has moved along the road: it rises and falls under gravity and knocks down every
 * hittable enemy it meets in its lane (`BODY_DAMAGE`, each once, as one knocked down is no longer hittable), then
 * lands with `THROW_DAMAGE`, down or, at no hp left, dead. Its thrower is credited with what it does; a sack imp it
 * meets is kicked as by a heavy blow.
 */
function fly(world: World, body: Enemy): void {
  const thrower = world.heroes.find((each) => each.id === body.holder)!,
    dir = body.vx > 0 ? 1 : -1;
  body.z += body.vz;
  body.vz -= T.GRAVITY;
  for (const enemy of world.enemies)
    if (
      enemy !== body &&
      !T.BOSS[enemy.kind] &&
      hittable(world, enemy) &&
      Math.abs(enemy.x - body.x) <= 2 * T.ENEMY_HALF_W &&
      Math.abs(enemy.y - body.y) <= T.LANE &&
      body.z < enemy.z + T.ENEMY_HEIGHT
    ) {
      if (isImp(enemy)) {
        kick(world, enemy, dir, true);
        continue;
      }
      const taken = Math.min(T.BODY_DAMAGE, enemy.hp);
      enemy.hp -= taken;
      thrower.damage += taken;
      thrower.knockdowns++;
      launch(world, enemy, dir);
      spark(
        world,
        enemy.hp === 0 ? "ko" : "heavy",
        enemy.x - dir * T.ENEMY_HALF_W,
        enemy.y,
        enemy.z + T.SPARK_HEIGHT,
      );
    }
  if (body.z > 0) return;
  const taken = Math.min(T.THROW_DAMAGE, body.hp);
  body.hp -= taken;
  thrower.damage += taken;
  body.z = body.vx = body.vz = body.holder = 0;
  setState(body, body.hp > 0 ? "down" : "dead");
  spark(world, body.hp > 0 ? "heavy" : "ko", body.x, body.y, 0);
}

/**
 * The moves' blades, once the hero has moved: the back attack's behind it while it is out, and the jump attack's stab
 * from its wind-up until the hero lands.
 */
function moveStrike(world: World, hero: Hero): void {
  if (hero.state === "backattack") {
    const back = T.BACK_ATTACK[hero.kind];
    if (hero.timer >= back.startup && hero.timer < back.startup + back.active)
      strike(world, hero, back);
  } else if (hero.state === "jumpattack") {
    const stab = T.JUMP_ATTACK[hero.kind];
    if (hero.timer >= stab.startup) strike(world, hero, stab);
  }
}
