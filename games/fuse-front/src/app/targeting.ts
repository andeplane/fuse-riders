/**
 * Targeting, as pure functions of a `WorldView` for this device's seat: what a click means (right-click an enemy to
 * attack it, the ground to move; A then click to attack-move; a spell key to aim, a left click to cast; with Shift held
 * or the HUD's QUEUE on, each of these queues behind the hero's current order instead; an item key to use its
 * active, a BLINK aiming like a spell), which bodies
 * an aimed unit spell may take, the overlay a battlefield draws while aiming, a spell's tooltip and the target panel.
 * The engine decides what actually happens; these only choose what to ask of it.
 */
import {
  AIM_SLACK,
  ITEMS,
  KITS,
  STEPS_PER_SECOND,
  SUB,
  TILE_PX,
  teamOf,
  type SpellInfo,
  type WorldView,
} from "../engine/index.js";
import type { Overlay, ZoomAnchor } from "../render/renderer.js";
import { heroTile } from "./hud-state.js";

const TILE = SUB * TILE_PX;
/** How far from the clicked tile's centre a body may stand and still be the one clicked (sub-pixels). */
const PICK_REACH = TILE;

/** A body on the field, as `attack` and an aimed spell name it: a `MARKS` index (unit, hero, building) and id. */
export interface Body {
  of: 0 | 1 | 2;
  id: number;
  x: number;
  y: number;
  team: number;
  kind: string;
  hp: number;
  maxHp: number;
  /** A CLOAKed hero: no enemy may pick it, though a friend's REPAIR BEAM may. */
  cloaked: boolean;
}

/** `bodies` per view: a view never changes, so each is listed once however often the cursor asks. */
const listed = new WeakMap<WorldView, readonly Body[]>();

/** Every body in the view: units, living heroes, and buildings with an owner (ruins too). */
export function bodies(world: WorldView): readonly Body[] {
  const known = listed.get(world);
  if (known) return known;
  const out: Body[] = world.units.map((u) => ({ ...u, of: 0, cloaked: false }));
  for (const h of world.heroes)
    if (h.hp > 0) out.push({ ...h, of: 1, id: h.seat, cloaked: h.cloaked });
  for (const b of world.buildings)
    if (b.team >= 0)
      out.push({
        ...b,
        of: 2,
        x: (b.x + 0.5) * TILE,
        y: (b.y + 0.5) * TILE,
        cloaked: false,
      });
  listed.set(world, out);
  return out;
}

/** The body nearest the centre of `tile` within `PICK_REACH` that `accept` takes, or undefined. */
export function bodyAt(
  world: WorldView,
  tile: { x: number; y: number },
  accept: (body: Body) => boolean,
  among: readonly Body[] = bodies(world),
): Body | undefined {
  const [cx, cy] = [(tile.x + 0.5) * TILE, (tile.y + 0.5) * TILE];
  let best: Body | undefined,
    bestD = PICK_REACH * PICK_REACH;
  for (const body of among) {
    const d = (body.x - cx) ** 2 + (body.y - cy) ** 2;
    if (d <= bestD && accept(body)) [best, bestD] = [body, d];
  }
  return best;
}

/** An enemy of `seat` that `attack` may name: alive, uncloaked, and for a building a standing turret or fort. */
export const isEnemy = (seat: number) => (body: Body) =>
  seat >= 0 &&
  body.team !== teamOf(seat) &&
  body.hp > 0 &&
  !body.cloaked &&
  (body.of !== 2 || body.kind === "turret" || body.kind === "fort");

/**
 * The anchor a wheel or pinch zoom at `x`, `y` CSS pixels holds still. Zooming toward a point means leaving the hero,
 * so it stops following, like a pan; but while following, a zoom with the pointer on this seat's own hero (the
 * picked `tile`) stays on it and zooms about the centre, where the followed hero already is.
 */
// prettier-ignore
export function zoomAnchor(world: WorldView, seat: number, follow: boolean, tile: { x: number; y: number } | undefined, x: number, y: number): ZoomAnchor | undefined {
  const onHero = follow && tile && bodyAt(world, tile, (b) => b.of === 1 && b.id === seat);
  return onHero ? undefined : { x, y, world };
}

/** A two-finger pinch from points `a0`, `b0` to `a1`, `b1`: the zoom factor and the midpoint it zooms about. */
// prettier-ignore
export function pinchZoom(a0: Point, b0: Point, a1: Point, b1: Point): { factor: number; x: number; y: number } | undefined {
  const before = Math.hypot(a0.x - b0.x, a0.y - b0.y),
    after = Math.hypot(a1.x - b1.x, a1.y - b1.y);
  if (!(before > 0) || !(after > 0)) return undefined;
  return { factor: after / before, x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
}
type Point = { x: number; y: number };

/**
 * The mode a new view leaves armed: aiming and attack-moves end when the seat has no living hero (dead, watching, or
 * between matches), so a stale crosshair never outlives the hero that armed it.
 */
export const modeFor = (
  world: WorldView | undefined,
  seat: number,
  mode: Mode,
): Mode => {
  const hero = world && heroOf(world, seat);
  if (mode.kind !== "idle" && !hero) return IDLE;
  // A BLINK aimed from a slot that no longer holds one (sold) disarms too.
  if (mode.kind === "item" && !ITEMS[hero!.items[mode.slot] ?? -1]?.range)
    return IDLE;
  return mode;
};

/** What the next click means: nothing armed, an attack-move armed (A), or a spell slot aiming. */
export type Mode =
  | { kind: "idle" }
  | { kind: "attackMove" }
  /** `queued` when Shift (or QUEUE) armed it: the cast queues even if Shift is let go before the click. */
  | { kind: "aim"; slot: number; queued?: true }
  /** An item slot's BLINK aiming (`shop.ts`): the next left click jumps there. */
  | { kind: "item"; slot: number };
export const IDLE: Mode = { kind: "idle" };

export type Intent =
  | { kind: "move" | "attackMove"; x: number; y: number; queued?: true }
  | { kind: "attack"; of: number; id: number; queued?: true }
  | {
      kind: "cast";
      slot: number;
      x: number;
      y: number;
      target?: { of: number; id: number };
      /** Set when the order goes behind the hero's route. */
      queued?: true;
    }
  | { kind: "factory"; id: number }
  | { kind: "useItem"; slot: number; x: number; y: number }
  /** Leave the armed mode; `none` keeps it (a click out of reach). */
  | { kind: "cancel" }
  | { kind: "none" };

const heroOf = (world: WorldView, seat: number) =>
  world.heroes.find((h) => h.seat === seat && h.hp > 0);
const within = (a: { x: number; y: number }, b: typeof a, r: number) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r * r;

/**
 * Where an order measures its reach from: the hero, or for a queued one where its route leaves it standing, the last
 * move or attack-move waypoint (`HeroView.route`); a cast or an attack on the way does not move it there.
 */
export function origin(
  world: WorldView,
  seat: number,
  queued: boolean,
): { x: number; y: number } | undefined {
  const hero = heroOf(world, seat);
  const walks = queued
    ? hero?.route.filter((s) => s.kind === "move" || s.kind === "attackMove")
    : undefined;
  return walks?.at(-1) ?? hero;
}

/**
 * The bodies an aimed `unit` spell in `slot` may take, within its reach of the hero: an enemy unit or hero for
 * SNIPE, an enemy light tank for HIJACK, a hurt friend (not a ruined fort) for REPAIR BEAM.
 */
export function spellTargets(
  world: WorldView,
  seat: number,
  slot: number,
  queued = false,
): Body[] {
  const hero = heroOf(world, seat);
  const from = origin(world, seat, queued);
  const spell = hero && KITS[hero.kind][slot];
  if (!hero || spell?.targeting !== "unit") return [];
  const ours = teamOf(seat);
  const take = (body: Body): boolean => {
    // As the engine's REPAIR BEAM (`mends`): any hurt friend, a ruined turret too, never a ruined fort.
    if (spell.effect === "repair")
      return (
        body.team === ours &&
        body.hp < body.maxHp &&
        (body.hp > 0 || body.kind !== "fort")
      );
    if (body.team === ours || body.hp <= 0 || body.of === 2 || body.cloaked)
      return false;
    return spell.effect !== "hijack" || body.kind === "lightTank";
  };
  return bodies(world).filter(
    (body) => take(body) && within(body, from!, spell.range + AIM_SLACK),
  );
}

/**
 * What a click with `button` (0 left, 2 right) on `tile` asks for in `mode`; `queued` (Shift, or the HUD's QUEUE)
 * puts a move, attack-move, attack or cast behind the hero's current order, its reach measured from the route's end.
 */
export function clickIntent(
  world: WorldView,
  seat: number,
  mode: Mode,
  tile: { x: number; y: number },
  button: number,
  factory?: number,
  queued = false,
): Intent {
  if (mode.kind !== "idle" && button !== 0) return { kind: "cancel" };
  const { x, y } = tile;
  if (mode.kind === "aim" && mode.queued) queued = true;
  const q = queued ? { queued: true as const } : {};
  if (mode.kind === "attackMove") return { kind: "attackMove", x, y, ...q };
  if (mode.kind === "item") {
    const hero = heroOf(world, seat);
    const reach = hero && ITEMS[hero.items[mode.slot] ?? -1]?.range;
    if (!hero || !reach) return { kind: "cancel" };
    const aim = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
    return within(aim, hero, reach + AIM_SLACK)
      ? { kind: "useItem", slot: mode.slot, x, y }
      : { kind: "none" };
  }
  if (mode.kind === "aim") {
    const hero = heroOf(world, seat);
    const spell = hero && KITS[hero.kind][mode.slot];
    if (!hero || !spell) return { kind: "cancel" };
    const slot = mode.slot;
    if (spell.targeting === "unit") {
      const body = bodyAt(
        world,
        tile,
        () => true,
        spellTargets(world, seat, slot, queued),
      );
      const target = body && { of: body.of, id: body.id };
      return target
        ? { kind: "cast", slot, x, y, target, ...q }
        : { kind: "none" };
    }
    const aim = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
    return within(aim, origin(world, seat, queued)!, spell.range + AIM_SLACK)
      ? { kind: "cast", slot, x, y, ...q }
      : { kind: "none" };
  }
  if (button === 0 && factory !== undefined)
    return { kind: "factory", id: factory };
  const enemy = bodyAt(world, tile, isEnemy(seat));
  if (enemy) return { kind: "attack", of: enemy.of, id: enemy.id, ...q };
  return { kind: "move", x, y, ...q };
}

/** The mode a click leaves: a queued attack-move stays armed for the next waypoint, anything else disarms. */
export const modeAfter = (mode: Mode, intent: Intent): Mode =>
  intent.kind === "attackMove" && intent.queued ? mode : IDLE;

/**
 * A spell key or button pressed in `mode`: a `self` spell casts at once on the hero's tile, an aimed one arms (or,
 * pressed again, disarms) aiming. Nothing happens for a spell that is not ready, unless `queued`: a queued spell
 * waits its turn behind the route, so it need not be ready now.
 */
export function pressSpell(
  world: WorldView,
  seat: number,
  mode: Mode,
  slot: number,
  ready: boolean,
  queued = false,
): { mode: Mode; cast?: { x: number; y: number } } {
  const hero = heroOf(world, seat);
  const spell = hero && KITS[hero.kind][slot];
  if (!hero || !spell || spell.passive || !(ready || queued)) return { mode };
  if (spell.targeting === "self") {
    return { mode: IDLE, cast: heroTile(world, seat) };
  }
  const again = mode.kind === "aim" && mode.slot === slot;
  if (again) return { mode: IDLE };
  return {
    mode: queued ? { kind: "aim", slot, queued } : { kind: "aim", slot },
  };
}

/**
 * An item key or button pressed in `mode`: a SHIELD is used at once, a BLINK arms (or, pressed again, disarms)
 * aiming; nothing happens for an empty slot, a passive item or an active still cooling.
 */
export function pressItem(
  world: WorldView,
  seat: number,
  mode: Mode,
  slot: number,
): { mode: Mode; use?: { x: number; y: number } } {
  const hero = heroOf(world, seat);
  const item = hero && ITEMS[hero.items[slot] ?? -1];
  if (!hero || !item?.active || hero.itemCooldowns[slot]! > 0) return { mode };
  if (item.active === "shield")
    return { mode: IDLE, use: heroTile(world, seat) };
  const again = mode.kind === "item" && mode.slot === slot;
  return { mode: again ? IDLE : { kind: "item", slot } };
}

/** What the battlefield draws for `mode` with the cursor over `tile` (sub-pixels). */
export function overlayOf(
  world: WorldView,
  seat: number,
  mode: Mode,
  tile: { x: number; y: number } | undefined,
): Overlay {
  const cursor = tile && { x: (tile.x + 0.5) * TILE, y: (tile.y + 0.5) * TILE };
  const hero = heroOf(world, seat);
  const spell = mode.kind === "aim" && hero && KITS[hero.kind][mode.slot];
  if (spell) {
    const marks = spellTargets(world, seat, (mode as { slot: number }).slot);
    // A point spell with no area still marks the spot it lands on.
    const area =
      spell.targeting === "point" ? Math.max(spell.radius, TILE / 2) : 0;
    return { range: spell.range, area, cursor: cursor ?? null, marks };
  }
  // A BLINK's reach, and where it lands.
  const reach =
    mode.kind === "item" && hero && ITEMS[hero.items[mode.slot] ?? -1]?.range;
  if (reach)
    return { range: reach, area: TILE / 2, cursor: cursor ?? null, marks: [] };
  const hover = tile && bodyAt(world, tile, isEnemy(seat));
  const area = mode.kind === "attackMove" ? TILE / 2 : 0;
  return {
    range: 0,
    area,
    cursor: cursor ?? null,
    marks: hover ? [hover] : [],
  };
}

/** "lightTank" reads "LIGHT TANK". */
export const label = (id: string) =>
  id.replace(/([A-Z])/g, " $1").toUpperCase();

/** A spell's tooltip: its name, what it does, and its cost, cooldown, reach, area and unlock level. */
export function spellTooltip(spell: SpellInfo): {
  name: string;
  desc: string;
  stats: string;
  /** How it is aimed, for the tooltip's corner: passive, instant, unit target or ground target. */
  aim: string;
} {
  const tiles = (sub: number) => `${+(sub / TILE).toFixed(1)} tiles`;
  const stats = spell.passive
    ? ["Passive", spell.radius > 0 && `radius ${tiles(spell.radius)}`]
    : [
        `${spell.energy} energy`,
        `${spell.cooldown / STEPS_PER_SECOND}s cooldown`,
        spell.targeting === "self" ? "instant" : `range ${tiles(spell.range)}`,
        spell.radius > 0 && `radius ${tiles(spell.radius)}`,
      ];
  if (spell.unlock > 1) stats.push(`unlocks at level ${spell.unlock}`);
  return {
    name: spell.name.toUpperCase(),
    desc: spell.desc,
    stats: stats.filter(Boolean).join(" · "),
    aim: spell.passive
      ? "passive"
      : { self: "instant", unit: "unit target", point: "ground target" }[
          spell.targeting
        ],
  };
}

/** The HUD's target panel: what this seat's hero shoots (or chases), its name, hit points and team; null for none. */
export function targetPanel(
  world: WorldView,
  seat: number,
): {
  name: string;
  hp: number;
  team: number;
  chosen: boolean;
  kind: string;
} | null {
  const target = heroOf(world, seat)?.target;
  if (!target) return null;
  const body =
    target.of === "unit"
      ? world.units.find((u) => u.id === target.id)
      : target.of === "hero"
        ? world.heroes.find((h) => h.seat === target.id)
        : world.buildings.find((b) => b.id === target.id);
  if (!body) return null;
  return {
    name: label(body.kind),
    hp: body.maxHp > 0 ? Math.max(0, body.hp / body.maxHp) : 0,
    team: body.team,
    chosen: target.chosen,
    kind: body.kind,
  };
}
