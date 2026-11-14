import type { BubbleView, RiderView, WorldView } from "../engine/view.js";
import {
  BALL_RADIUS,
  BUBBLE_RADIUS,
  RIDER_RADIUS,
  VIEW_H,
  VIEW_W,
  isCircle,
  mapOf,
  type Circle,
  type Goal,
  type MapDef,
  type Rect,
} from "../engine/view-kit.js";
import { createEffects, type Cue } from "./effects.js";
import { createHud } from "./hud.js";
import {
  BALL,
  BALL_HOT,
  CLOUD,
  EDGE,
  EDGE_DIM,
  GRID,
  INK,
  NIGHT,
  PIXEL_FONT,
  SOLID,
  SOLID_DARK,
  TEAM,
  TEAM_DEEP,
  TEAM_LIGHT,
  teamColor,
  WHITE,
  hexA,
} from "./palette.js";
import { drawRider, frameFor, type Paint } from "./sprites.js";

/**
 * Draws one frame of a Fuseball match on a 2D canvas: the arena, the riders, their bubbles and the ball, the
 * effects and the lettering, on a 640×360 field scaled to fit the canvas and centred in it.
 *
 * It keeps no loop, timer or physics of its own: the app calls `draw` from its frame callback with the view to
 * show (usually `blend` of the last two) and the wall clock, and everything cosmetic here — particles, the ball's
 * tail, the shake — moves only as far as that clock says. Nothing here feeds back into the match.
 */
export interface SceneCanvas {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  getContext(kind: "2d"): Paint | null;
}
export interface SceneOptions {
  /** Device pixels per CSS pixel; the window's unless given. */
  pixelRatio?: () => number;
  /** Where the effects' scatter comes from; `Math.random` unless given. */
  random?: () => number;
  /** No shake and a gentler goal flash. */
  reducedMotion?: boolean;
}
export interface Scene {
  /** Fits the canvas's backing store to its CSS box and the pixel ratio. `draw` does it too when the box changes. */
  resize(): void;
  /**
   * Draws `view` at wall time `nowMs`. `localSlot` is this device's rider, or −1 for a watcher or a shared screen;
   * `names` replaces CYAN and MAGENTA on the winner's banner. Returns what happened since the last frame, for the
   * app's sounds.
   */
  draw(
    view: WorldView,
    nowMs: number,
    localSlot: 0 | 1 | -1,
    names?: readonly [string, string],
  ): readonly Cue[];
  /** Forgets every effect; `draw` does nothing afterwards. */
  destroy(): void;
}

const MAX_RATIO = 3,
  TAIL = 7,
  TAU = Math.PI * 2;

/** The scale and offset that fit the 640×360 field inside a `width`×`height` canvas, centred. */
export function letterbox(
  width: number,
  height: number,
): { scale: number; x: number; y: number } {
  const scale = Math.max(0, Math.min(width / VIEW_W, height / VIEW_H));
  return {
    scale,
    x: (width - VIEW_W * scale) / 2,
    y: (height - VIEW_H * scale) / 2,
  };
}

/**
 * Where to draw something `reach` pixels across centred on (`x`, `y`): where it is, and again one field over on
 * each wrapping axis whose seam it overlaps, so a body leaving by one edge is already arriving at the other.
 */
export function copies(
  map: Pick<MapDef, "wrapX" | "wrapY">,
  x: number,
  y: number,
  reach: number,
): { x: number; y: number }[] {
  const along = (at: number, size: number, wraps: boolean) => {
    const all = [at];
    if (wraps && at < reach) all.push(at + size);
    if (wraps && at > size - reach) all.push(at - size);
    return all;
  };
  const ys = along(y, VIEW_H, map.wrapY);
  return along(x, VIEW_W, map.wrapX).flatMap((cx) =>
    ys.map((cy) => ({ x: cx, y: cy })),
  );
}

/**
 * Where to draw a solid: where it is, and one field back on each wrapping axis it runs past the end of, so the
 * part over the edge shows at the start.
 */
export function solidCopies(
  map: Pick<MapDef, "wrapX" | "wrapY">,
  solid: Rect,
): Rect[] {
  const xs =
      map.wrapX && solid.x + solid.w > VIEW_W
        ? [solid.x, solid.x - VIEW_W]
        : [solid.x],
    ys =
      map.wrapY && solid.y + solid.h > VIEW_H
        ? [solid.y, solid.y - VIEW_H]
        : [solid.y];
  return xs.flatMap((x) => ys.map((y) => ({ ...solid, x, y })));
}

export function createScene(
  canvas: SceneCanvas,
  options: SceneOptions = {},
): Scene {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Fuseball needs a 2D canvas");
  const g: Paint = context;
  const ratioOf =
    options.pixelRatio ??
    (() => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const fx = createEffects(options),
    hud = createHud();
  let fit = letterbox(canvas.width, canvas.height),
    box: { w: number; h: number; ratio: number } | undefined,
    dead = false;
  /** Where the ball has just been, newest last: its tail. */
  let tail: { x: number; y: number }[] = [];

  const resize = () => {
    const ratio = Math.max(1, Math.min(MAX_RATIO, ratioOf() || 1)),
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    box = { w, h, ratio };
    // A canvas that is not laid out keeps the size it was given.
    if (w > 0 && h > 0) {
      const width = Math.max(1, Math.round(w * ratio)),
        height = Math.max(1, Math.round(h * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }
    fit = letterbox(canvas.width, canvas.height);
  };

  const backdrop = (map: MapDef, now: number) => {
    const sky = g.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, NIGHT);
    sky.addColorStop(1, INK);
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.fillStyle = hexA(GRID, 0.7);
    for (let x = 40; x < VIEW_W; x += 40) g.fillRect(x, 0, 1, VIEW_H);
    for (let y = 40; y < VIEW_H; y += 40) g.fillRect(0, y, VIEW_W, 1);
    // An open edge glows and its dashes drift outwards: what leaves here comes back on the far side.
    const drift = (now / 60) % 12,
      seam = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        w: number,
        h: number,
      ) => {
        const glow = g.createLinearGradient(x0, y0, x1, y1);
        glow.addColorStop(0, hexA(EDGE, 0.2));
        glow.addColorStop(1, hexA(EDGE, 0));
        g.fillStyle = glow;
        g.fillRect(Math.min(x0, x1), Math.min(y0, y1), w, h);
      };
    g.fillStyle = hexA(EDGE, 0.2);
    if (map.wrapX) {
      seam(0, 0, 14, 0, 14, VIEW_H);
      seam(VIEW_W, 0, VIEW_W - 14, 0, 14, VIEW_H);
      g.fillStyle = hexA(EDGE, 0.55);
      for (let y = -12 + drift; y < VIEW_H; y += 12) {
        g.fillRect(0, y, 1, 5);
        g.fillRect(VIEW_W - 1, VIEW_H - y - 5, 1, 5);
      }
    }
    if (map.wrapY) {
      seam(0, 0, 0, 14, VIEW_W, 14);
      seam(0, VIEW_H, 0, VIEW_H - 14, VIEW_W, 14);
      g.fillStyle = hexA(EDGE, 0.55);
      for (let x = -12 + drift; x < VIEW_W; x += 12) {
        g.fillRect(x, 0, 5, 1);
        g.fillRect(VIEW_W - x - 5, VIEW_H - 1, 5, 1);
      }
    }
  };

  const cloud = (c: Circle, now: number, slow: boolean) => {
    const lift = slow ? 1.9 : 1,
      body = g.createRadialGradient(c.x, c.y, c.r * 0.1, c.x, c.y, c.r);
    body.addColorStop(0, hexA(CLOUD, 0.2 * lift));
    body.addColorStop(0.75, hexA(CLOUD, 0.1 * lift));
    body.addColorStop(1, hexA(CLOUD, 0.03));
    g.fillStyle = body;
    g.beginPath();
    g.arc(c.x, c.y, c.r, 0, TAU);
    g.fill();
    // Seven lobes drifting round the middle make it smoke and not a disc.
    g.fillStyle = hexA(CLOUD, 0.055 * lift);
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * TAU + now / 4200 + Math.sin(now / 1900 + i),
        reach = c.r * (0.42 + 0.1 * Math.sin(now / 1300 + i * 2));
      g.beginPath();
      g.arc(
        c.x + Math.cos(angle) * reach,
        c.y + Math.sin(angle) * reach,
        c.r * (0.4 + 0.08 * Math.sin(now / 900 + i * 1.7)),
        0,
        TAU,
      );
      g.fill();
    }
    // The dotted rim is the zone's real edge.
    g.fillStyle = hexA(CLOUD, slow ? 0.9 : 0.4);
    const dots = Math.round(c.r * 0.7);
    for (let i = 0; i < dots; i++) {
      const angle = (i / dots) * TAU + now / 9000;
      g.fillRect(
        c.x + Math.cos(angle) * c.r - 0.5,
        c.y + Math.sin(angle) * c.r - 0.5,
        1,
        1,
      );
    }
  };

  const solids = (map: MapDef) => {
    const all = map.solids.flatMap((solid) => solidCopies(map, solid));
    // Outlines first and bodies over them, so two solids that touch read as one shape.
    for (const s of all) {
      g.fillStyle = EDGE_DIM;
      g.fillRect(s.x, s.y, s.w, s.h);
      g.fillStyle = EDGE;
      g.fillRect(s.x, s.y, s.w, 2);
    }
    for (const s of all) {
      g.fillStyle = SOLID;
      g.fillRect(s.x + 1, s.y + 2, s.w - 2, s.h - 3);
    }
    g.fillStyle = SOLID_DARK;
    for (const s of all) {
      // Rivets every eight pixels: pixel texture that says "wall" without a tile sheet.
      for (let y = s.y + 5; y < s.y + s.h - 3; y += 8)
        for (let x = s.x + 4; x < s.x + s.w - 3; x += 8) g.fillRect(x, y, 2, 2);
    }
  };

  const goal = (shape: Goal, now: number, lit: boolean) => {
    const color = TEAM[shape.team],
      pulse = 0.5 + 0.5 * Math.sin(now / 320 + shape.team * 2),
      boost = lit ? 1.6 : 1;
    if (isCircle(shape)) {
      const { x, y, r } = shape;
      const body = g.createRadialGradient(x, y, 1, x, y, r + 10);
      body.addColorStop(0, hexA(color, 0.5 * boost));
      body.addColorStop(0.6, hexA(color, 0.2 * boost));
      body.addColorStop(1, hexA(color, 0));
      g.fillStyle = body;
      g.beginPath();
      g.arc(x, y, r + 10, 0, TAU);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.stroke();
      // Four arcs turning inside the rim.
      g.strokeStyle = TEAM_LIGHT[shape.team];
      g.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        const start = now / 500 + (i * TAU) / 4;
        g.beginPath();
        g.arc(x, y, r - 5 - pulse * 2, start, start + 0.8);
        g.stroke();
      }
      g.fillStyle = TEAM_LIGHT[shape.team];
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
      return;
    }
    const { x, y, w, h } = shape;
    g.fillStyle = hexA(color, 0.1 * boost);
    g.fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle = hexA(color, (0.2 + 0.1 * pulse) * boost);
    g.fillRect(x, y, w, h);
    // Bars of light run along it, towards the far end.
    g.fillStyle = hexA(TEAM_LIGHT[shape.team], 0.55);
    const run = (now / 45) % 10;
    if (h >= w)
      for (let at = y + run; at < y + h - 1; at += 10)
        g.fillRect(x + 2, at, w - 4, 2);
    else
      for (let at = x + run; at < x + w - 1; at += 10)
        g.fillRect(at, y + 2, 2, h - 4);
    g.fillStyle = color;
    g.fillRect(x, y, w, 1);
    g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x, y, 1, h);
    g.fillRect(x + w - 1, y, 1, h);
  };

  const bubble = (map: MapDef, b: BubbleView, now: number) => {
    if (!b.active) return;
    const age = fx.bubbleAge(b.slot, now),
      // It swells past its size and settles in the first sixth of a second.
      swell =
        age < 160
          ? 0.4 + 0.6 * (age / 160) + 0.25 * Math.sin((age / 160) * Math.PI)
          : 1,
      r = (BUBBLE_RADIUS + 0.6 * Math.sin(now / 210 + b.slot * 3)) * swell,
      color = TEAM[b.slot],
      light = TEAM_LIGHT[b.slot];
    for (const at of copies(map, b.x, b.y, BUBBLE_RADIUS + 8)) {
      g.beginPath();
      g.arc(at.x, at.y, r, 0, TAU);
      g.fillStyle = hexA(color, b.hard ? 0.34 : 0.14);
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = hexA(color, 0.2);
      g.stroke();
      g.lineWidth = b.hard ? 2.5 : 1.5;
      g.strokeStyle = b.hard ? light : color;
      g.stroke();
      if (b.hard) {
        // The second ring: nothing pops this one.
        g.beginPath();
        g.arc(at.x, at.y, r + 4.5, 0, TAU);
        g.lineWidth = 5;
        g.strokeStyle = hexA(color, 0.25);
        g.stroke();
        g.lineWidth = 2;
        g.strokeStyle = color;
        g.stroke();
      }
      g.beginPath();
      g.arc(at.x, at.y, r - 4, Math.PI * 1.05, Math.PI * 1.5);
      g.lineWidth = 1.5;
      g.strokeStyle = hexA(WHITE, 0.8);
      g.stroke();
      g.fillStyle = hexA(WHITE, 0.7);
      g.fillRect(at.x + r * 0.35, at.y + r * 0.4, 2, 2);
    }
  };

  const ball = (map: MapDef, view: WorldView, now: number) => {
    const b = view.ball;
    if (!b.live) {
      tail = [];
      return;
    }
    const prev = tail[tail.length - 1];
    if (prev && Math.abs(prev.x - b.x) + Math.abs(prev.y - b.y) > 60) tail = [];
    tail.push({ x: b.x, y: b.y });
    if (tail.length > TAIL) tail.shift();
    const tint = b.touch < 0 ? BALL : teamColor(b.touch);
    tail.forEach((at, i) => {
      if (i === tail.length - 1) return;
      const part = (i + 1) / tail.length;
      g.beginPath();
      g.arc(at.x, at.y, BALL_RADIUS * (0.3 + 0.6 * part), 0, TAU);
      g.fillStyle = hexA(tint, 0.16 * part);
      g.fill();
    });
    const turn = b.x / BALL_RADIUS;
    for (const at of copies(map, b.x, b.y, BALL_RADIUS + 6)) {
      const glow = g.createRadialGradient(
        at.x,
        at.y,
        BALL_RADIUS - 2,
        at.x,
        at.y,
        BALL_RADIUS + 9,
      );
      glow.addColorStop(0, hexA(tint, 0.45));
      glow.addColorStop(1, hexA(tint, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(at.x, at.y, BALL_RADIUS + 9, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(at.x, at.y, BALL_RADIUS, 0, TAU);
      g.fillStyle = BALL;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = tint === BALL ? "#b8860b" : tint;
      g.stroke();
      // A dark band across it turns as it travels.
      g.strokeStyle = "#7a5200";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(
        at.x + Math.cos(turn) * (BALL_RADIUS - 2),
        at.y + Math.sin(turn) * (BALL_RADIUS - 2),
      );
      g.lineTo(
        at.x - Math.cos(turn) * (BALL_RADIUS - 2),
        at.y - Math.sin(turn) * (BALL_RADIUS - 2),
      );
      g.stroke();
      g.beginPath();
      g.arc(at.x - 2.5, at.y - 2.5, 2.6, 0, TAU);
      g.fillStyle = BALL_HOT;
      g.fill();
      if (view.phase === "countdown") {
        g.beginPath();
        g.arc(at.x, at.y, BALL_RADIUS + 5 + 3 * Math.sin(now / 150), 0, TAU);
        g.lineWidth = 1;
        g.strokeStyle = hexA(BALL, 0.7);
        g.stroke();
      }
    }
  };

  const rider = (
    map: MapDef,
    view: WorldView,
    r: RiderView,
    now: number,
    local: boolean,
  ) => {
    const frame = frameFor(r);
    if (r.zapped) {
      // What is left of a zapped rider: a flicker where they stood, once the shards have flown.
      if (fx.zapAge(r.slot, now) < 500) return;
      g.globalAlpha = 0.1 + 0.06 * Math.sin(now / 70);
      for (const at of copies(map, r.x, r.y, RIDER_RADIUS + 4))
        drawRider(g, frame, r.slot, at.x, at.y, r.facing);
      g.globalAlpha = 1;
      return;
    }
    const held = view.bubbles[r.slot];
    for (const at of copies(map, r.x, r.y, RIDER_RADIUS + 8)) {
      // A hard bubble is held on a thread of light.
      if (held.active && held.hard) {
        const dx = held.x - r.x,
          dy = held.y - r.y;
        if (Math.abs(dx) + Math.abs(dy) < 160) {
          g.fillStyle = hexA(TEAM_LIGHT[r.slot], 0.7);
          for (let i = 1; i < 8; i++)
            g.fillRect(
              at.x + (dx * i) / 8 - 0.5,
              at.y + (dy * i) / 8 - 0.5,
              1,
              1,
            );
        }
      }
      // The fuse: it trails from the helmet against the rider's motion and burns at the tip.
      const low = frame === "slide" ? 8 : 0,
        fx0 = at.x - r.facing * (frame === "slide" ? 6 : 3),
        fy0 = at.y - RIDER_RADIUS + low,
        sx = Math.max(-2.4, Math.min(2.4, -r.vx * 1.3 - r.facing * 0.9)),
        sy = Math.max(-2.4, Math.min(2.4, -r.vy * 1.3 - 0.9));
      g.fillStyle = TEAM_DEEP[r.slot];
      for (let i = 1; i <= 4; i++)
        g.fillRect(fx0 + sx * i - 1, fy0 + sy * i - 1 + i * i * 0.12, 2, 2);
      const tipX = fx0 + sx * 5,
        tipY = fy0 + sy * 5 + 3,
        flick = Math.floor(now / 55 + r.slot) % 3;
      g.fillStyle = hexA(BALL, 0.4);
      g.fillRect(tipX - 2.5, tipY - 0.5, 5, 1);
      g.fillRect(tipX - 0.5, tipY - 2.5, 1, 5);
      g.fillStyle = flick === 0 ? WHITE : BALL;
      g.fillRect(tipX - 1.5, tipY - 1.5, 3, 3);
      if (flick === 1) g.fillRect(tipX + 2, tipY - 3, 1, 1);
      if (flick === 2) g.fillRect(tipX - 3, tipY + 1, 1, 1);

      if (r.sliding) {
        // Speed lines behind a slide.
        g.fillStyle = hexA(TEAM_LIGHT[r.slot], 0.6);
        for (let i = 0; i < 3; i++)
          g.fillRect(
            at.x - r.facing * (12 + i * 5 + ((now / 30 + i * 3) % 5)) - 3,
            at.y + 2 + i * 3,
            6,
            1,
          );
      }
      drawRider(g, frame, r.slot, at.x, at.y, r.facing);
      if (!local) continue;
      // This device's rider wears a marker, and says so while the countdown runs.
      const top = at.y - RIDER_RADIUS - 9 - Math.sin(now / 180) * 1.5;
      g.fillStyle = WHITE;
      g.fillRect(at.x - 3, top, 6, 1);
      g.fillRect(at.x - 2, top + 1, 4, 1);
      g.fillRect(at.x - 1, top + 2, 2, 1);
      if (view.phase === "countdown") {
        g.font = `6px ${PIXEL_FONT}`;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.fillStyle = TEAM_LIGHT[r.slot];
        g.fillText("YOU", at.x, top - 3);
      }
    }
  };

  return {
    resize,
    draw(view, nowMs, localSlot, names) {
      if (dead) return [];
      if (
        !box ||
        box.w !== canvas.clientWidth ||
        box.h !== canvas.clientHeight ||
        box.ratio !== Math.max(1, Math.min(MAX_RATIO, ratioOf() || 1))
      )
        resize();
      const found = fx.update(view, nowMs),
        map = mapOf(view.mapId),
        shake = fx.shake();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.fillStyle = INK;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.save();
      g.setTransform(fit.scale, 0, 0, fit.scale, fit.x, fit.y);
      g.beginPath();
      g.rect(0, 0, VIEW_W, VIEW_H);
      g.clip();
      g.save();
      g.translate(shake.x, shake.y);
      backdrop(map, nowMs);
      for (const c of map.clouds) cloud(c, nowMs, view.slow);
      const scored = view.phase === "zap" || view.phase === "over";
      for (const shape of map.goals)
        goal(shape, nowMs, scored && view.lastScorer === shape.team);
      solids(map);
      fx.drawBehind(g);
      for (const b of view.bubbles) bubble(map, b, nowMs);
      ball(map, view, nowMs);
      for (const r of view.riders)
        if (r.slot !== localSlot) rider(map, view, r, nowMs, false);
      // This device's rider last, so it is never hidden behind the other.
      for (const r of view.riders)
        if (r.slot === localSlot) rider(map, view, r, nowMs, true);
      fx.drawFront(g);
      g.restore();
      fx.drawOverlay(g);
      hud.draw(g, view, nowMs, localSlot, names);
      g.restore();
      return found;
    },
    destroy() {
      dead = true;
      tail = [];
      fx.reset();
      hud.reset();
    },
  };
}
