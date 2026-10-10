import { CAPACITY, VIEW_W } from "../engine/view-kit.js";
import type { HeroView, WorldView } from "../engine/view.js";
import { HEROES } from "./art/index.js";
import {
  ADVANCE,
  GLYPH_H,
  createLettering,
  fontText,
  textWidth,
} from "./font.js";
import { blit, fill, type Pen } from "./pen.js";
import type { Palette } from "./pixel/palette.js";
import type { Sprite } from "./pixel/sprite.js";
import type { SpriteBaker } from "./pixel/surface.js";
import { SEAT_COLORS } from "./seat-colors.js";
import type { MakeSurface } from "./surface.js";

/**
 * The HUD: a strip along the top of the frame with a panel a seat, P1 to P5 left to right. A hero's panel holds its
 * portrait in the hero's own look (the palette it wears on the field) framed in its seat's colour, its player's name,
 * its lives as ×N, a segmented health bar whose lost part shows white for a moment and then drains, and its row of
 * magic pots. A hero out of lives is greyed; one lying fallen, dropping back in or invulnerable blinks, in step with
 * its sprite. An empty seat shows its tag and blinks JOIN (not in a solo game, where nobody can), or names the player
 * who joins with the next run. A hero that has lost its last life is out as it lands: the counter has already
 * dropped to ×0, so its panel greys then, not when it has finished lying there.
 *
 * Portraits and labels are baked once; a frame is a few flat rectangles and blits.
 */
export interface HudSeats {
  /** Each seat's player name by slot, null for nobody. The HUD writes what its font can of it. */
  readonly names: readonly (string | null)[];
  /** The seat this device plays, underlined in its colour; none on a shared screen. */
  readonly you?: number | null;
  /** An empty seat blinks JOIN. False where nobody can join (a solo game): it shows its tag and no more. Default true. */
  readonly open?: boolean;
}

/** What the HUD needs of a hero's look on the field: the palette its portrait wears too. */
export type Looks = ReadonlyMap<number, { readonly swap: Palette | undefined }>;

export interface Hud<Image> {
  draw(
    pen: Pen<Image>,
    view: WorldView,
    frame: number,
    looks: Looks,
    seats?: HudSeats,
  ): void;
}

/** An invulnerable hero blinks, on the field and in the HUD alike: shown and hidden every `BLINK_FRAMES` frames. */
export const BLINK_FRAMES = 4;
export const blinksOn = (frame: number): boolean =>
  Math.floor(frame / BLINK_FRAMES) % 2 === 0;
/** JOIN on an empty seat shows and hides every `JOIN_FRAMES` frames. */
export const JOIN_FRAMES = 30;

/** The strip's height, its rule along the bottom included, and each seat's panel's width. */
export const HUD_H = 22;
export const PANEL_W = Math.floor(VIEW_W / CAPACITY);
/** Within a panel: the portrait's frame, the name's top-left, the health bar and the pots. */
export const FRAME = { x: 1, y: 1, size: 18 } as const;
export const NAME = { x: 21, y: 2 } as const;
export const BAR = { x: 21, y: 9, w: 39, h: 3 } as const;
/** The bar's segments: a dark notch every `SEGMENT` pixels. */
export const SEGMENT = 5;
export const POTS = { x: 20, y: 13, step: 6 } as const;
/** A hit's white trail holds `TRAIL_HOLD` frames, then drains `TRAIL_DRAIN` pixels a frame. */
export const TRAIL_HOLD = 12;
export const TRAIL_DRAIN = 0.5;

export const HUD_COLORS = {
  strip: "#0b0614",
  rule: "#6544c2",
  ink: "#150c1f",
  plate: "#1a0e2e",
  empty: "#3b2a52",
  dim: "#7a5aa8",
  text: "#f1e8f7",
  outFrame: "#4a3c5a",
  outText: "#6d5d7d",
  track: "#3a1a2e",
  trail: "#ffffff",
  potEmpty: "#2a1c3a",
  pot: "#262e8c",
  potLit: "#3c5ce0",
  potGlint: "#78b4ff",
} as const;
/** The bar's colour and its highlight, by the share of health left: over a half, over a quarter, and less. */
export const HEALTH = {
  high: { color: "#b6ff4d", light: "#e4ffb8" },
  low: { color: "#ffe46b", light: "#fff4c0" },
  critical: { color: "#ff4f5e", light: "#ffa0a8" },
} as const;
export const healthTone = (share: number) =>
  share > 0.5 ? HEALTH.high : share > 0.25 ? HEALTH.low : HEALTH.critical;

/** A hero's magic pots: how many it holds and the most it can hold. */
export interface Pots {
  readonly held: number;
  readonly max: number;
}
/** Magic is still to come: until the view carries each hero's pots, every hero holds none of none. */
export const NO_POTS: Pots = { held: 0, max: 0 };

/** A row of `max` pots with its top-left at (`x`, `y`), the first `held` of them full. */
export function drawPots<Image>(
  pen: Pen<Image>,
  x: number,
  y: number,
  { held, max }: Pots,
): void {
  const c = HUD_COLORS;
  for (let i = 0; i < max; i++) {
    const left = x + i * POTS.step;
    pen.fillStyle = i < held ? c.pot : c.potEmpty;
    fill(pen, left + 1, y, 3, 1);
    fill(pen, left, y + 1, 5, 4);
    if (i >= held) continue;
    pen.fillStyle = c.potLit;
    fill(pen, left + 1, y + 1, 3, 3);
    pen.fillStyle = c.potGlint;
    fill(pen, left + 1, y + 1, 1, 1);
  }
}

/** The health bar's lit pixels for `hp` of `maxHp`: never none while any is left. */
export function barWidth(hp: number, maxHp: number): number {
  if (!(maxHp > 0) || !(hp > 0)) return 0;
  return Math.max(1, Math.round((BAR.w * Math.min(hp, maxHp)) / maxHp));
}

/** The glyphs a name gets beside lives of one digit; longer lives leave it fewer. */
export const NAME_GLYPHS = 8;
const TAGS = Array.from({ length: CAPACITY }, (_, i) => `P${i + 1}`);

const grey = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const v = Math.round(22 + 0.45 * (0.3 * r! + 0.59 * g! + 0.11 * b!));
  const h = (n: number) => Math.min(255, n).toString(16).padStart(2, "0");
  return `#${h(v)}${h(v)}${h(v + 14)}`;
};

interface Trail {
  /** Where the white trail ends, in fractional pixels; the bar's own width when there is none. */
  end: number;
  /** The bar's width at the last draw, the frame of that draw, and the frame of the latest hit. */
  width: number;
  frame: number;
  hitAt: number;
  /** The HUD's draw that last showed the hero: a trail no draw showed is dropped. */
  draw: number;
}

export function createHud<Image>(
  make: MakeSurface<Image>,
  baker: SpriteBaker<Image>,
): Hud<Image> {
  const lettering = createLettering(make);
  const trails = new Map<number, Trail>();
  const names = new Map<string, string>();
  const greys = new WeakMap<Sprite, Map<Palette | undefined, Palette>>();
  const lives: string[] = [];
  let draws = 0;

  /** The portrait in its look, or that look gone grey: one palette per portrait and look, so each bakes once. */
  const greyed = (sprite: Sprite, swap: Palette | undefined) => {
    let bySwap = greys.get(sprite);
    if (!bySwap) greys.set(sprite, (bySwap = new Map()));
    let palette = bySwap.get(swap);
    if (!palette) {
      const entries = Object.entries(sprite.palette);
      palette = Object.fromEntries(
        entries.map(([key, color]) => [key, grey(swap?.[key] ?? color)]),
      );
      bySwap.set(swap, palette);
    }
    return palette;
  };
  /** A seat's name as the font writes it, worked out once per name. */
  const nameOf = (raw: string) => {
    let name = names.get(raw);
    if (name === undefined) {
      if (names.size >= 64) names.clear();
      names.set(raw, (name = fontText(raw, NAME_GLYPHS)));
    }
    return name;
  };
  const livesText = (n: number) => {
    const count = Math.min(99, Math.max(0, Math.floor(n)));
    return (lives[count] ??= `×${count}`);
  };
  /** The trail's end for a bar `width` wide now: held a moment after each hit, then drained, and gone on a heal. */
  const trailOf = (id: number, width: number, frame: number) => {
    let t = trails.get(id);
    if (!t)
      trails.set(id, (t = { end: width, width, frame, hitAt: frame, draw: 0 }));
    t.draw = draws;
    if (width < t.width) t.hitAt = frame;
    const from = Math.max(t.frame, t.hitAt + TRAIL_HOLD);
    t.end = Math.max(width, t.end - Math.max(0, frame - from) * TRAIL_DRAIN);
    t.width = width;
    t.frame = frame;
    return Math.round(t.end);
  };
  const write = (
    pen: Pen<Image>,
    text: string,
    color: string,
    x: number,
    y: number,
  ) => {
    const label = lettering.label(text, color);
    blit(pen, label.image, label.w, label.h, x, y);
  };
  const frameBox = (pen: Pen<Image>, x0: number, color: string) => {
    pen.fillStyle = color;
    fill(pen, x0 + FRAME.x, FRAME.y, FRAME.size, FRAME.size);
    pen.fillStyle = HUD_COLORS.plate;
    fill(pen, x0 + FRAME.x + 1, FRAME.y + 1, FRAME.size - 2, FRAME.size - 2);
  };

  const emptyPanel = (
    pen: Pen<Image>,
    x0: number,
    seat: number,
    raw: string | null,
    frame: number,
    open: boolean,
  ) => {
    const c = HUD_COLORS;
    frameBox(pen, x0, c.empty);
    const tag = TAGS[seat]!;
    const inner = FRAME.size - 2;
    const tx = x0 + FRAME.x + 1 + ((inner - textWidth(tag)) >> 1);
    const ty = FRAME.y + 1 + ((inner - GLYPH_H) >> 1);
    write(pen, tag, c.empty, tx, ty);
    // A player the font cannot write (all emoji, say) still holds the seat: shown by its tag, as a hero's panel does.
    const name = raw === null ? "" : nameOf(raw) || tag;
    if (name) {
      // A player seated mid-run plays from the next one.
      write(pen, name, c.dim, x0 + NAME.x, NAME.y);
      write(pen, "NEXT RUN", c.empty, x0 + NAME.x, BAR.y);
    } else if (open && Math.floor(frame / JOIN_FRAMES) % 2 === 0)
      write(pen, "JOIN", c.dim, x0 + NAME.x, ty);
  };

  const heroPanel = (
    pen: Pen<Image>,
    x0: number,
    hero: HeroView,
    raw: string | null,
    frame: number,
    looks: Looks,
  ) => {
    const c = HUD_COLORS;
    const accent = SEAT_COLORS[hero.seat % SEAT_COLORS.length]!;
    const out = hero.anim === "out" || hero.lives <= 0;
    frameBox(pen, x0, out ? c.outFrame : accent);
    const blinking =
      !out &&
      (hero.invulnerable || hero.anim === "dead" || hero.anim === "respawn");
    if (!blinking || blinksOn(frame)) {
      const { portrait } = HEROES[hero.kind];
      const look = looks.get(hero.id)?.swap;
      const swap = out ? greyed(portrait, look) : look;
      const b = baker.bake(portrait, { swap });
      blit(pen, b.image, b.w, b.h, x0 + FRAME.x + 1, FRAME.y + 1);
    }

    // The name, cut to what fits before the lives at the right.
    const left = livesText(hero.lives);
    const livesX = x0 + PANEL_W - 1 - textWidth(left);
    const room = Math.floor((livesX - 2 - (x0 + NAME.x) + 1) / ADVANCE);
    let name = (raw === null ? "" : nameOf(raw)) || TAGS[hero.seat % CAPACITY]!;
    if (name.length > room) name = name.slice(0, room).trimEnd();
    write(pen, name, out ? c.outText : accent, x0 + NAME.x, NAME.y);
    write(pen, left, out ? c.outText : c.text, livesX, NAME.y);

    // The health bar, its lost part trailing white, notched into segments.
    const bx = x0 + BAR.x,
      by = BAR.y;
    pen.fillStyle = c.ink;
    fill(pen, bx - 1, by - 1, BAR.w + 2, BAR.h + 2);
    pen.fillStyle = c.track;
    fill(pen, bx, by, BAR.w, BAR.h);
    const width = barWidth(hero.hp, hero.maxHp);
    const trail = trailOf(hero.id, width, frame);
    if (width > 0) {
      const tone = healthTone(hero.hp / hero.maxHp);
      pen.fillStyle = tone.color;
      fill(pen, bx, by, width, BAR.h);
      pen.fillStyle = tone.light;
      fill(pen, bx, by, width, 1);
    }
    if (trail > width) {
      pen.fillStyle = c.trail;
      fill(pen, bx + width, by, trail - width, BAR.h);
    }
    pen.fillStyle = c.ink;
    for (let x = SEGMENT - 1; x < BAR.w; x += SEGMENT)
      fill(pen, bx + x, by, 1, BAR.h);

    drawPots(pen, x0 + POTS.x, POTS.y, NO_POTS);
  };

  return {
    draw(pen, view, frame, looks, seats) {
      const c = HUD_COLORS;
      pen.fillStyle = c.strip;
      fill(pen, 0, 0, VIEW_W, HUD_H - 2);
      pen.fillStyle = c.rule;
      fill(pen, 0, HUD_H - 2, VIEW_W, 1);
      pen.fillStyle = c.ink;
      fill(pen, 0, HUD_H - 1, VIEW_W, 1);
      draws++;
      for (let seat = 0; seat < CAPACITY; seat++) {
        const x0 = seat * PANEL_W;
        const raw = seats?.names[seat] ?? null;
        let hero: HeroView | undefined;
        for (const h of view.heroes) if (h.seat === seat) hero ??= h;
        if (seats?.you === seat) {
          pen.fillStyle = SEAT_COLORS[seat % SEAT_COLORS.length]!;
          fill(pen, x0, HUD_H - 2, PANEL_W, 1);
        }
        if (hero) heroPanel(pen, x0, hero, raw, frame, looks);
        else emptyPanel(pen, x0, seat, raw, frame, seats?.open !== false);
      }
      // A hero gone from the world takes its trail with it.
      for (const [id, trail] of trails)
        if (trail.draw !== draws) trails.delete(id);
    },
  };
}
