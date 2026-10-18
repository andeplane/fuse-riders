/**
 * Targeting, as pure functions of a `WorldView` for this device's seat: what a click means (right-click an enemy to
 * attack it, the ground to move; A then click to attack-move; a spell key to aim, a left click to cast), which bodies
 * an aimed unit spell may take, the overlay a battlefield draws while aiming, a spell's tooltip and the target panel.
 * The engine decides what actually happens; these only choose what to ask of it.
 */
import {
  AIM_SLACK,
  KITS,
  STEPS_PER_SECOND,
  SUB,
  TILE_PX,
  teamOf,
  type SpellInfo,
  type WorldView,
} from "../engine/index.js";
import type { Overlay } from "../render/renderer.js";
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
}

/** Every body in the view: units, living uncloaked heroes, and turrets and forts with an owner (ruins too). */
export function bodies(world: WorldView): Body[] {
  const out: Body[] = world.units.map((u) => ({ ...u, of: 0, id: u.id }));
  for (const h of world.heroes)
    if (h.hp > 0 && !h.cloaked) out.push({ ...h, of: 1, id: h.seat });
  for (const b of world.buildings)
    if ((b.kind === "turret" || b.kind === "fort") && b.team >= 0)
      out.push({
        ...b,
        of: 2,
        x: (b.x + 0.5) * TILE,
        y: (b.y + 0.5) * TILE,
      });
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

/** An enemy of `seat` that `attack` may name: alive and, for a building, still standing. */
export const isEnemy = (seat: number) => (body: Body) =>
  seat >= 0 && body.team !== teamOf(seat) && body.hp > 0;

/** What the next click means: nothing armed, an attack-move armed (A), or a spell slot aiming. */
export type Mode =
  { kind: "idle" } | { kind: "attackMove" } | { kind: "aim"; slot: number };
export const IDLE: Mode = { kind: "idle" };

export type Intent =
  | { kind: "move" | "attackMove"; x: number; y: number }
  | { kind: "attack"; of: number; id: number }
  | {
      kind: "cast";
      slot: number;
      x: number;
      y: number;
      target?: { of: number; id: number };
    }
  | { kind: "factory"; id: number }
  /** Leave the armed mode; `none` keeps it (a click out of reach). */
  | { kind: "cancel" }
  | { kind: "none" };

const heroOf = (world: WorldView, seat: number) =>
  world.heroes.find((h) => h.seat === seat && h.hp > 0);
const within = (a: { x: number; y: number }, b: typeof a, r: number) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r * r;

/**
 * The bodies an aimed `unit` spell in `slot` may take, within its reach of the hero: an enemy unit or hero for
 * SNIPE, an enemy light tank for HIJACK, a hurt friend (not a ruined fort) for REPAIR BEAM.
 */
export function spellTargets(
  world: WorldView,
  seat: number,
  slot: number,
): Body[] {
  const hero = heroOf(world, seat);
  const spell = hero && KITS[hero.kind][slot];
  if (!hero || spell?.targeting !== "unit") return [];
  const ours = teamOf(seat);
  const take = (body: Body): boolean => {
    if (spell.effect === "repair")
      return (
        body.team === ours &&
        body.hp < body.maxHp &&
        (body.hp > 0 || body.kind !== "fort")
      );
    if (body.team === ours || body.hp <= 0 || body.of === 2) return false;
    return spell.effect !== "hijack" || body.kind === "lightTank";
  };
  return bodies(world).filter(
    (body) => take(body) && within(body, hero, spell.range + AIM_SLACK),
  );
}

/** What a click with `button` (0 left, 2 right) on `tile` asks for in `mode`. */
export function clickIntent(
  world: WorldView,
  seat: number,
  mode: Mode,
  tile: { x: number; y: number },
  button: number,
  factory?: number,
): Intent {
  if (mode.kind !== "idle" && button !== 0) return { kind: "cancel" };
  const { x, y } = tile;
  if (mode.kind === "attackMove") return { kind: "attackMove", x, y };
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
        spellTargets(world, seat, slot),
      );
      return body
        ? { kind: "cast", slot, x, y, target: { of: body.of, id: body.id } }
        : { kind: "none" };
    }
    const aim = { x: (x + 0.5) * TILE, y: (y + 0.5) * TILE };
    return within(aim, hero, spell.range + AIM_SLACK)
      ? { kind: "cast", slot, x, y }
      : { kind: "none" };
  }
  if (button === 0 && factory !== undefined)
    return { kind: "factory", id: factory };
  const enemy = bodyAt(world, tile, isEnemy(seat));
  if (enemy) return { kind: "attack", of: enemy.of, id: enemy.id };
  return { kind: "move", x, y };
}

/**
 * A spell key or button pressed in `mode`: a `self` spell casts at once on the hero's tile, an aimed one arms (or,
 * pressed again, disarms) aiming. Nothing happens for a spell that is not ready.
 */
export function pressSpell(
  world: WorldView,
  seat: number,
  mode: Mode,
  slot: number,
  ready: boolean,
): { mode: Mode; cast?: { x: number; y: number } } {
  const hero = heroOf(world, seat);
  const spell = hero && KITS[hero.kind][slot];
  if (!hero || !spell || !ready) return { mode };
  if (spell.targeting === "self") {
    return { mode: IDLE, cast: heroTile(world, seat) };
  }
  const again = mode.kind === "aim" && mode.slot === slot;
  return { mode: again ? IDLE : { kind: "aim", slot } };
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
  const of = target.of === "unit" ? 0 : target.of === "hero" ? 1 : 2;
  const body = bodies(world).find((b) => b.of === of && b.id === target.id);
  if (!body) return null;
  return {
    name: label(body.kind),
    hp: body.maxHp > 0 ? Math.max(0, body.hp / body.maxHp) : 0,
    team: body.team,
    chosen: target.chosen,
    kind: body.kind,
  };
}
