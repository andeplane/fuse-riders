/**
 * The Z-style battlefield: a Canvas 2D view of a `WorldView` through a camera, one integer-scaled art-pixel canvas.
 * Ground is baked once per match; every sprite comes from the cache; effects come from deduped engine events.
 * Positions between two frames are interpolated for display only; nothing here writes to the simulation.
 */
import { SUB, TILE_PX, type UnitKind, type WorldView } from "../engine/view.js";
import * as cam from "./camera.js";
import {
  EventDedupe,
  Effects,
  effectsOf,
  type Effect,
  type StampedEvent,
} from "./cues.js";
import { bakeGround } from "./ground.js";
import type { Img } from "./pixel/image.js";
import { BIOME } from "./pixel/palette.js";
import { routeMarks, type RouteMark } from "./route.js";
import {
  NO_OVERLAY,
  TARGET_HEX,
  TargetPulse,
  type Overlay,
  type Renderer,
  type ZoomAnchor,
} from "./renderer.js";
import * as art from "./sprites.js";

type Surface = HTMLCanvasElement;
/** Makes an offscreen canvas; the composition root supplies the document's. */
export type CanvasFactory = (w: number, h: number) => Surface;

const px = (v: number) => v / SUB;
const TILE = SUB * TILE_PX;
const CULL = 72;
const BOOM = [0.5, 0.85, 1, 0.7];

export class Battlefield implements Renderer {
  readonly camera = { x: 0, y: 0 };
  view: cam.Viewport = { w: 1, h: 1, scale: 1 };
  /** Whether the camera follows this device's hero: a pan stops it, Space sets it again. */
  follow = true;
  overlay: Overlay = NO_OVERLAY;
  private readonly pulse = new TargetPulse();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new art.SpriteCache((img) => this.toCanvas(img));
  private readonly dedupe = new EventDedupe();
  private readonly effects = new Effects();
  private ground: Surface | undefined;
  /** Scorch decals waiting for the ground to be baked. */
  private scorches: Effect[] = [];
  private matchId = "";
  private latest: WorldView | undefined;
  private kinds = new Map<number, UnitKind>();
  /** Last facing (1 east, −1 west) by `u<id>`, `h<seat>` or `b<id>`. */
  private readonly facing = new Map<string, number>();
  private dpr = 1;
  private rows = cam.TARGET_ROWS;
  private cssBox: [number, number] = [1, 1];

  constructor(
    readonly canvas: Surface,
    private readonly makeCanvas: CanvasFactory,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  private toCanvas(img: Img): Surface {
    const canvas = this.makeCanvas(img.w, img.h);
    const ctx = canvas.getContext("2d")!;
    const data = ctx.createImageData(img.w, img.h);
    data.data.set(img.d);
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  /** Fits the viewport to a `cssW` × `cssH` box: the canvas holds art pixels and CSS scales them by a whole number. */
  resize(cssW: number, cssH: number, dpr: number, world: WorldView): void {
    this.dpr = dpr;
    this.cssBox = [cssW, cssH];
    const v = cam.fitViewport(cssW, cssH, dpr, ...size(world), this.rows);
    this.view = v;
    if (this.canvas.width !== v.w) this.canvas.width = v.w;
    if (this.canvas.height !== v.h) this.canvas.height = v.h;
    this.canvas.style.width = `${(v.w * v.scale) / dpr}px`;
    this.canvas.style.height = `${(v.h * v.scale) / dpr}px`;
  }

  /** Pans by CSS pixels and stops following the hero. */
  pan(dx: number, dy: number, world: WorldView): void {
    this.follow = false;
    const k = this.dpr / this.view.scale;
    const { x, y } = this.camera;
    Object.assign(
      this.camera,
      cam.clampCamera(x + dx * k, y + dy * k, this.view, ...size(world)),
    );
  }

  /** Zooms by changing the art rows shown; the scale stays a whole number, so it steps between 1×, 2×, 3×… */
  zoom(factor: number, anchor?: ZoomAnchor): void {
    const rows = cam.zoomRows(this.rows, factor);
    // At a zoom limit nothing moves, so the hero stays followed.
    if (anchor && rows === this.rows) return;
    this.rows = rows;
    const world = this.latest;
    if (!world) return;
    if (anchor) this.follow = false;
    // The art pixel under the anchor holds still, or without one the centre of the view.
    const before = this.view.scale / this.dpr;
    const [ax, ay] = anchor
      ? [anchor.x, anchor.y]
      : [(this.view.w * before) / 2, (this.view.h * before) / 2];
    const [px, py] = [this.camera.x + ax / before, this.camera.y + ay / before];
    this.resize(...this.cssBox, this.dpr, world);
    const after = this.view.scale / this.dpr;
    Object.assign(
      this.camera,
      cam.clampCamera(
        px - ax / after,
        py - ay / after,
        this.view,
        ...size(world),
      ),
    );
  }

  /** Nothing to free: the canvases go with the page. */
  dispose(): void {}

  /** Centres the camera on fractions `fx`, `fy` of the map (a minimap click) and stops following the hero. */
  lookAt(fx: number, fy: number, world: WorldView): void {
    this.follow = false;
    Object.assign(this.camera, cam.centreOn(fx, fy, this.view, ...size(world)));
  }

  /** The camera's box in fractions of the map, for the minimap. */
  box(world: WorldView) {
    return cam.cameraBox(this.camera, this.view, ...size(world));
  }

  /** The map tile under a point `dx`, `dy` CSS pixels from the canvas's top-left. */
  tileAt(dx: number, dy: number, world: WorldView) {
    const at = cam.screenToArt(dx, dy, this.camera, this.view, this.dpr);
    return cam.artToTile(at.x, at.y, TILE_PX, world.width, world.height);
  }

  /** A new match starts clean: no effects or decals, the camera back on the hero, the ground baked afresh. */
  private adopt(matchId: string): void {
    if (matchId === this.matchId) return;
    this.matchId = matchId;
    this.effects.clear();
    this.facing.clear();
    this.follow = true;
    this.ground = undefined;
    this.scorches = [];
  }

  /** An engine event, once per match however often rollback delivers it. */
  event(matchId: string, stamped: StampedEvent, now: number): void {
    this.adopt(matchId);
    if (!this.dedupe.accept(matchId, stamped)) return;
    const event = stamped.event;
    if (event.type === "shot" && event.to.x !== event.from.x)
      this.facing.set(
        event.from.of[0]! + event.from.id,
        event.to.x > event.from.x ? 1 : -1,
      );
    const site = (id: number) => {
      const b = this.latest?.buildings.find((each) => each.id === id);
      return b && { x: b.x * TILE_PX + 4, y: b.y * TILE_PX + 8 };
    };
    const torch = (id: number) => this.kinds.get(id) === "torch";
    for (const e of effectsOf(event, now, site, torch))
      if (e.kind !== "scorch") this.effects.add([e]);
      else if (this.scorches.length < 256) this.scorches.push(e);
    this.burn();
  }

  /** Burns waiting scorch decals into the baked ground, for the rest of the match. */
  private burn(): void {
    const ctx = this.scorches.length && this.ground?.getContext("2d");
    if (!ctx) return;
    for (const e of this.scorches) {
      const seed = Math.floor(e.x + e.y) % 3;
      const s = this.sprites.get(art.scorchArt(e.size, seed));
      ctx.drawImage(s.surface, Math.round(e.x - s.ax), Math.round(e.y - s.ay));
    }
    this.scorches = [];
  }

  /** Blits a sprite with its anchor at art pixel (x, y) on the map. */
  private blit(sprite: art.SpriteArt, x: number, y: number, alpha = 1): void {
    const s = this.sprites.get(sprite);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(
      s.surface,
      Math.round(x - s.ax - this.camera.x),
      Math.round(y - s.ay - this.camera.y),
    );
    this.ctx.globalAlpha = 1;
  }

  /** Draws `world`, interpolated from `older` by `t` (0 to 1), for this device's `self` seat at wall-clock `now`. */
  // prettier-ignore
  draw(matchId: string, world: WorldView, older: WorldView | undefined, t: number, self: number, now: number): void {
    this.adopt(matchId);
    if (!this.ground) {
      this.ground = this.toCanvas(bakeGround(world, 3, BIOME[world.biome]));
      this.burn();
    }
    if (world !== this.latest) {
      this.latest = world;
      this.kinds = new Map(world.units.map((u) => [u.id, u.kind]));
    }
    const before = new Map(older?.units.map((u) => [u.id, u]));
    const heroBefore = new Map(older?.heroes.map((h) => [h.seat, h]));
    const lerp = (a: number, b: number) => px(a + (b - a) * t);
    const face = (key: string, dx: number, team: number) => {
      if (Math.abs(dx) >= 2) this.facing.set(key, dx > 0 ? 1 : -1);
      return this.facing.get(key) ?? (team === 0 ? 1 : -1);
    };
    const { w, h } = this.view;
    const mine = world.heroes.find((hero) => hero.seat === self && hero.hp > 0);
    const prev = mine && (heroBefore.get(mine.seat) ?? mine);
    const [fx, fy] = this.follow && mine && prev
      ? [lerp(prev.x, mine.x) - w / 2, lerp(prev.y, mine.y) - h / 2]
      : [this.camera.x, this.camera.y];
    Object.assign(this.camera, cam.clampCamera(fx, fy, this.view, ...size(world)));
    const { x: cx, y: cy } = this.camera;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.ground, cx, cy, w, h, 0, 0, w, h);
    const visible = (x: number, y: number) =>
      x > cx - CULL && y > cy - CULL && x < cx + w + CULL && y < cy + h + CULL;

    // Everything standing on the ground, back to front by depth `d`. A building sorts by its tile's top edge, so
    // whatever stands on its tile (a hero at its fort) draws in front of it.
    const items: { x: number; y: number; d: number; s: art.SpriteArt }[] = [];
    const bars: [number, number, number, number][] = [];
    const marks: [number, number, "stun" | "rally"][] = [];
    const smoke = Math.floor(now / 220) % art.SMOKE_FRAMES;
    for (const f of world.flags) {
      const x = f.x * TILE_PX + 4, y = f.y * TILE_PX + 6;
      if (visible(x, y)) items.push({ x, y, d: y, s: art.flagArt(f.team) });
    }
    for (const b of world.buildings) {
      const turret = b.kind === "turret";
      const x = b.x * TILE_PX + 4, y = b.y * TILE_PX + (turret ? 4 : 8);
      if (!visible(x, y)) continue;
      const dir = this.facing.get(`b${b.id}`) ?? (b.x * 2 < world.width ? 1 : -1);
      items.push({ x, y, d: b.y * TILE_PX, s: art.buildingArt(b.kind, b.team, b.hp <= 0, smoke, dir) });
      if (b.hp > 0 && b.hp < b.maxHp)
        bars.push([x, y - (turret ? 10 : b.kind === "fort" ? 54 : 34), b.hp / b.maxHp, 16]);
    }
    for (const u of world.units) {
      const p = before.get(u.id) ?? u;
      const x = lerp(p.x, u.x), y = lerp(p.y, u.y);
      if (!visible(x, y)) continue;
      const dir = face(`u${u.id}`, u.x - p.x, u.team);
      items.push({ x, y, d: y, s: art.unitArt(u.kind, u.team, dir) });
      const top = u.kind === "lightTank" ? 10 : 12;
      if (u.hp < u.maxHp) bars.push([x, y - top, u.hp / u.maxHp, 8]);
      if (u.stunned || u.rallied) marks.push([x, y - top - 4, u.stunned ? "stun" : "rally"]);
    }
    for (const hero of world.heroes) {
      const p = heroBefore.get(hero.seat) ?? hero;
      const x = lerp(p.x, hero.x), y = lerp(p.y, hero.y);
      if (hero.hp <= 0 || !visible(x, y)) continue;
      const dir = face(`h${hero.seat}`, hero.x - p.x, hero.team);
      if (hero.seat === self) items.push({ x, y, d: y - 0.5, s: art.ringArt(9, "#f8d030") });
      items.push({ x, y, d: y, s: art.heroArt(hero.team, dir) });
      bars.push([x, y - 19, hero.hp / hero.maxHp, 14]);
    }
    items.sort((a, b) => a.d - b.d);
    for (const { x, y, s } of items) this.blit(s, x, y);
    this.drawEffects(now);
    for (const [x, y, kind] of marks) this.blit(art.markArt(kind, Math.floor(now / 200)), x, y);
    const ctx = this.ctx;
    for (const [x, y, frac, width] of bars) {
      const bx = Math.round(x - width / 2 - cx), by = Math.round(y - cy);
      ctx.fillStyle = "#101010";
      ctx.fillRect(bx - 1, by - 1, width + 2, 4);
      ctx.fillStyle = "#3a1010";
      ctx.fillRect(bx, by, width, 2);
      ctx.fillStyle = frac > 0.5 ? "#6ad83a" : frac > 0.25 ? "#f8d030" : "#e8483c";
      ctx.fillRect(bx, by, Math.round(width * Math.max(0, Math.min(1, frac))), 2);
    }
    if (mine && prev) {
      const hx = prev.x + (mine.x - prev.x) * t, hy = prev.y + (mine.y - prev.y) * t;
      this.drawRoute(routeMarks(mine.route, hx, hy));
      this.drawTargeting(mine.target, hx, hy, now);
    }
  }

  /** The queued route: a dashed leg to each waypoint and its rings, in its kind's colour, fading along the way. */
  // prettier-ignore
  private drawRoute(marks: readonly RouteMark[]): void {
    const ctx = this.ctx, { x: cx, y: cy } = this.camera;
    ctx.lineWidth = 1;
    for (const m of marks) {
      ctx.strokeStyle = `#${m.hex.toString(16).padStart(6, "0")}`;
      ctx.globalAlpha = 0.7 * m.fade;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(px(m.fromX) - cx, px(m.fromY) - cy);
      ctx.lineTo(px(m.x) - cx, px(m.y) - cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = m.fade;
      for (const r of m.rings)
        if (r > 0) {
          ctx.beginPath();
          ctx.arc(px(m.x) - cx, px(m.y) - cy, Math.max(1, px(r)), 0, Math.PI * 2);
          ctx.stroke();
        }
    }
    ctx.globalAlpha = 1;
  }

  /** The aiming rings, the marks, and a ring and line to the hero's target (sub-pixels in, art pixels drawn). */
  // prettier-ignore
  private drawTargeting(target: WorldView["heroes"][number]["target"], hx: number, hy: number, now: number): void {
    const ctx = this.ctx, { x: cx, y: cy } = this.camera, o = this.overlay;
    const ring = (x: number, y: number, r: number, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(px(x) - cx, px(y) - cy, Math.max(2, px(r)), 0, Math.PI * 2);
      ctx.stroke();
    };
    ctx.strokeStyle = `#${TARGET_HEX.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 1;
    if (o.range > 0) ring(hx, hy, o.range, 0.55);
    if (o.area > 0 && o.cursor) ring(o.cursor.x, o.cursor.y, o.area, 0.9);
    for (const m of o.marks) ring(m.x, m.y, TILE * 0.45, 0.9);
    const pulse = this.pulse.of(target, now);
    if (target) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(px(hx) - cx, px(hy) - cy);
      ctx.lineTo(px(target.x) - cx, px(target.y) - cy);
      ctx.stroke();
      ring(target.x, target.y, TILE * (0.6 + pulse * 0.6), target.chosen ? 1 : 0.6);
    }
    ctx.globalAlpha = 1;
  }

  // prettier-ignore
  private drawEffects(now: number): void {
    this.effects.prune(now);
    for (const e of this.effects.live) {
      // An event can stamp an effect a moment after the frame's clock read: start it at age 0.
      const age = Math.max(0, (now - e.born) / e.life),
        dx = e.x2 - e.x, dy = e.y2 - e.y, n = Math.hypot(dx, dy);
      if (e.kind === "tracer") {
        // A dashed trail whose tail slides toward the target as the shot flies.
        this.ctx.fillStyle = "#fff4a0";
        for (let i = Math.floor(n * age * 0.6); i < n; i++)
          if (i % 5 < 3)
            this.ctx.fillRect(Math.round(e.x + (dx * i) / n - this.camera.x), Math.round(e.y + (dy * i) / n - this.camera.y), 1, 1);
      } else if (e.kind === "flame") {
        const dir = dx >= 0 ? 1 : -1;
        this.blit(art.flameArt(Math.max(4, Math.min(14, Math.round(n))), dir), e.x + dir * 3, e.y);
      } else if (e.kind === "boom") {
        const frame = Math.min(BOOM.length - 1, Math.floor(age * BOOM.length));
        const r = Math.max(2, Math.round(e.size * BOOM[frame]!));
        this.blit(art.boomArt(r, frame * 13 + r), e.x, e.y, frame === BOOM.length - 1 ? 0.6 : 1);
      } else if (e.kind === "ring") {
        const r = Math.max(3, Math.round((e.size * (0.25 + 0.75 * age)) / 2) * 2);
        this.blit(art.ringArt(r, e.colour), e.x, e.y, 1 - age * 0.7);
      }
    }
  }
}

const size = (world: WorldView): [number, number] => [
  world.width * TILE_PX,
  world.height * TILE_PX,
];
