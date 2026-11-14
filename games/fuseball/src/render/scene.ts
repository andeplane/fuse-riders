import type { BubbleView, RiderView, WorldView } from "../engine/view.js";
import {
  BALL_RADIUS,
  BUBBLE_RADIUS,
  FIELD_COOL_STEPS,
  GATE_OPEN_STEPS,
  RIDER_RADIUS,
  VIEW_H,
  VIEW_W,
  isCircle,
  mapOf,
  moverPlace,
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
  GADGET,
  GADGET_DARK,
  GRID,
  INK,
  LEDGE,
  NIGHT,
  PIXEL_FONT,
  PORTAL,
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
import { WIRE_BACK, isWire, liquids, skulls, wireSolids } from "./wire.js";

/**
 * Draws one frame of a Fuseball match on a 2D canvas: the arena, the riders, their bubbles and the ball, the
 * effects and the lettering, on a 640×360 screen scaled to fit the canvas and centred in it. A duel's arena fills
 * that screen. A team arena is bigger, and is seen through a camera: the whole of it where that leaves the riders
 * big enough to read (a desktop, a TV), and otherwise (a phone) a closer view that keeps this device's rider and the
 * ball in frame.
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
   * Draws `view` at wall time `nowMs`. `localSlot` is this device's side, or −1 for a watcher or a shared screen;
   * `names` replaces CYAN and MAGENTA on the winner's banner; `localIndex` is this device's rider's place among the
   * riders (its side when left out, which is its place in a duel). Returns what happened since the last frame, for
   * the app's sounds.
   */
  draw(
    view: WorldView,
    nowMs: number,
    localSlot: 0 | 1 | -1,
    names?: readonly [string, string],
    localIndex?: number,
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

/** What the camera shows: the arena point at the middle of the screen, and screen pixels per arena pixel. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
/** Riders drawn smaller than this many CSS pixels across are too small to play: the camera moves in. */
export const MIN_RIDER_CSS = 16;
/** Room kept round the rider and the ball in a close view, in arena pixels. */
const FRAME_MARGIN = 90,
  /** How fast the camera closes on where it wants to be: most of the way in this many seconds. */
  CAMERA_EASE_S = 0.22;

/**
 * Where the camera wants to be. `cssScale` is CSS pixels per screen pixel, and `local` this device's rider's place
 * (−1 for none).
 *
 * An arena no bigger than the screen is shown whole at its own size, as a duel always was. A bigger one is shown
 * whole too when its riders stay at least `MIN_RIDER_CSS` across, or when this device has no rider to follow.
 * Otherwise the view closes in on the box round this device's rider and the ball, as far as full size, and stays
 * inside the arena.
 */
export function cameraFor(
  map: Pick<MapDef, "w" | "h"> & Partial<Pick<MapDef, "wrapX" | "wrapY">>,
  view: Pick<WorldView, "riders" | "ball" | "frozen">,
  local: number,
  cssScale: number,
): Camera {
  const whole = Math.min(1, VIEW_W / map.w, VIEW_H / map.h),
    centre = { x: map.w / 2, y: map.h / 2, zoom: whole },
    me = view.riders[local];
  if (!me || RIDER_RADIUS * 2 * whole * cssScale >= MIN_RIDER_CSS)
    return centre;
  const seen = view.ball.live || view.frozen ? view.ball : me,
    // A ball that is nearer across a seam cannot share a frame with the rider: the frame stays on the rider.
    ball = {
      x: map.wrapX && Math.abs(seen.x - me.x) > map.w / 2 ? me.x : seen.x,
      y: map.wrapY && Math.abs(seen.y - me.y) > map.h / 2 ? me.y : seen.y,
    },
    wide = Math.abs(ball.x - me.x) + 2 * FRAME_MARGIN,
    tall = Math.abs(ball.y - me.y) + 2 * FRAME_MARGIN,
    zoom = Math.max(whole, Math.min(1, VIEW_W / wide, VIEW_H / tall)),
    hold = (at: number, size: number, screen: number) => {
      const half = screen / zoom / 2;
      return half * 2 >= size
        ? size / 2
        : Math.max(half, Math.min(size - half, at));
    };
  return {
    x: hold((me.x + ball.x) / 2, map.w, VIEW_W),
    y: hold((me.y + ball.y) / 2, map.h, VIEW_H),
    zoom,
  };
}

/**
 * Where to draw something `reach` pixels across centred on (`x`, `y`): where it is, and again one field over on
 * each wrapping axis whose seam it overlaps, so a body leaving by one edge is already arriving at the other.
 */
type Seams = Pick<MapDef, "wrapX" | "wrapY"> & Partial<Pick<MapDef, "w" | "h">>;
export function copies(
  map: Seams,
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
  const ys = along(y, map.h ?? VIEW_H, map.wrapY);
  return along(x, map.w ?? VIEW_W, map.wrapX).flatMap((cx) =>
    ys.map((cy) => ({ x: cx, y: cy })),
  );
}

/**
 * Where to draw a solid: where it is, and one field back on each wrapping axis it runs past the end of, so the
 * part over the edge shows at the start.
 */
export function solidCopies(map: Seams, solid: Rect): Rect[] {
  const w = map.w ?? VIEW_W,
    h = map.h ?? VIEW_H,
    xs =
      map.wrapX && solid.x + solid.w > w ? [solid.x, solid.x - w] : [solid.x],
    ys =
      map.wrapY && solid.y + solid.h > h ? [solid.y, solid.y - h] : [solid.y];
  return xs.flatMap((x) => ys.map((y) => ({ ...solid, x, y })));
}

/** The team whose goal a force field stands nearest to, which is the one it guards; −1 with no goal on the map. */
export function guarded(map: MapDef, field: Rect): -1 | 0 | 1 {
  let team: -1 | 0 | 1 = -1,
    nearest = Infinity;
  const along = (d: number, size: number, wraps: boolean) =>
    wraps ? Math.min(Math.abs(d), size - Math.abs(d)) : Math.abs(d);
  for (const goal of map.goals) {
    const gx = isCircle(goal) ? goal.x : goal.x + goal.w / 2,
      gy = isCircle(goal) ? goal.y : goal.y + goal.h / 2,
      far =
        along(gx - (field.x + field.w / 2), map.w, map.wrapX) +
        along(gy - (field.y + field.h / 2), map.h, map.wrapY);
    if (far < nearest) {
      nearest = far;
      team = goal.team;
    }
  }
  return team;
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
  /** Where the camera is, eased towards where it wants to be; undefined until the first frame of an arena. */
  let camera: (Camera & { map: MapDef; at: number }) | undefined;
  const look = (
    map: MapDef,
    view: WorldView,
    local: number,
    now: number,
  ): Camera => {
    const ratio = box?.ratio ?? 1,
      want = cameraFor(map, view, local, fit.scale / ratio);
    if (!camera || camera.map !== map || options.reducedMotion)
      camera = { ...want, map, at: now };
    else {
      const k =
        1 - Math.exp(-Math.max(0, now - camera.at) / 1000 / CAMERA_EASE_S);
      camera.x += (want.x - camera.x) * k;
      camera.y += (want.y - camera.y) * k;
      camera.zoom += (want.zoom - camera.zoom) * k;
      camera.at = now;
    }
    return camera;
  };

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
    const W = map.w,
      H = map.h;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, NIGHT);
    sky.addColorStop(1, INK);
    // An outline arena stands on plain black, with no grid.
    g.fillStyle = isWire(map) ? WIRE_BACK : sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = hexA(GRID, isWire(map) ? 0 : 0.7);
    for (let x = 40; x < W; x += 40) g.fillRect(x, 0, 1, H);
    for (let y = 40; y < H; y += 40) g.fillRect(0, y, W, 1);
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
      seam(0, 0, 14, 0, 14, H);
      seam(W, 0, W - 14, 0, 14, H);
      g.fillStyle = hexA(EDGE, 0.55);
      for (let y = -12 + drift; y < H; y += 12) {
        g.fillRect(0, y, 1, 5);
        g.fillRect(W - 1, H - y - 5, 1, 5);
      }
    }
    if (map.wrapY) {
      seam(0, 0, 0, 14, W, 14);
      seam(0, H, 0, H - 14, W, 14);
      g.fillStyle = hexA(EDGE, 0.55);
      for (let x = -12 + drift; x < W; x += 12) {
        g.fillRect(x, 0, 5, 1);
        g.fillRect(W - x - 5, H - 1, 5, 1);
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

  /**
   * The gadgets, each in a look of its own so none reads as a wall, a goal or a team's bubble: a force field is a
   * curtain of light in the colour of the goal it guards, with a pip for every strike it can still take; a gate is
   * an amber hazard plate that slides apart; a bumper is a white-cored violet stud; a portal pair shares a hue.
   */
  const gadgets = (map: MapDef, view: WorldView, now: number) => {
    map.barriers.forEach((barrier, i) => {
      const state = view.barriers[i];
      if (!state) return;
      for (const b of solidCopies(map, barrier)) {
        const tall = b.h >= b.w,
          long = tall ? b.h : b.w,
          mx = b.x + b.w / 2,
          my = b.y + b.h / 2;
        if (barrier.kind === "field") {
          const team = guarded(map, barrier),
            color = team === -1 ? EDGE : TEAM[team],
            light = team === -1 ? WHITE : TEAM_LIGHT[team],
            struck = Math.min(1, state.timer / FIELD_COOL_STEPS);
          // The emitters at either end stay when the field is down.
          g.fillStyle = state.up ? light : hexA(color, 0.5);
          if (tall) {
            g.fillRect(b.x - 2, b.y - 2, b.w + 4, 3);
            g.fillRect(b.x - 2, b.y + b.h - 1, b.w + 4, 3);
          } else {
            g.fillRect(b.x - 2, b.y - 2, 3, b.h + 4);
            g.fillRect(b.x + b.w - 1, b.y - 2, 3, b.h + 4);
          }
          if (!state.up) {
            // Broken: a few dying sparks of its outline, nothing in the ball's way.
            g.fillStyle = hexA(color, 0.25 + 0.2 * struck);
            for (let at = 6; at < long - 4; at += 12)
              if (tall) g.fillRect(mx - 0.5, b.y + at, 1, 3);
              else g.fillRect(b.x + at, my - 0.5, 3, 1);
            continue;
          }
          const glow = 0.16 + 0.1 * state.left + 0.5 * struck;
          g.fillStyle = hexA(color, glow * 0.5);
          g.fillRect(b.x - 3, b.y, b.w + 6, b.h);
          g.fillStyle = hexA(struck > 0.5 ? WHITE : color, glow);
          g.fillRect(b.x, b.y, b.w, b.h);
          // Light running along both faces.
          g.fillStyle = hexA(light, 0.9);
          const run = (now / 40) % 8;
          for (let at = run; at < long - 3; at += 8)
            if (tall) {
              g.fillRect(b.x, b.y + at, 1, 4);
              g.fillRect(b.x + b.w - 1, b.y + long - at - 4, 1, 4);
            } else {
              g.fillRect(b.x + at, b.y, 4, 1);
              g.fillRect(b.x + long - at - 4, b.y + b.h - 1, 4, 1);
            }
          // One pip for every strike it can still take.
          g.fillStyle = WHITE;
          for (let pip = 0; pip < state.left; pip++) {
            const at = (pip - (state.left - 1) / 2) * 9;
            if (tall) g.fillRect(mx - 2, my + at - 2, 4, 4);
            else g.fillRect(mx + at - 2, my - 2, 4, 4);
          }
          continue;
        }
        // A gate: two leaves that meet in the middle when shut and slide apart when knocked.
        const open = state.up
            ? 0
            : Math.min(
                1,
                state.timer / 24,
                (GATE_OPEN_STEPS - state.timer) / 12 + 0.3,
              ),
          leaf = (long / 2) * (1 - 0.82 * open);
        const plate = (x: number, y: number, w: number, h: number) => {
          g.fillStyle = GADGET_DARK;
          g.fillRect(x, y, w, h);
          g.fillStyle = GADGET;
          // Hazard stripes.
          for (let at = 0; at < (tall ? h : w); at += 8)
            if (tall) g.fillRect(x, y + at, w, 4);
            else g.fillRect(x + at, y, 4, h);
          g.fillStyle = hexA(WHITE, 0.8);
          if (tall) g.fillRect(x, y, 1, h);
          else g.fillRect(x, y, w, 1);
        };
        if (tall) {
          plate(b.x, b.y, b.w, leaf);
          plate(b.x, b.y + b.h - leaf, b.w, leaf);
        } else {
          plate(b.x, b.y, leaf, b.h);
          plate(b.x + b.w - leaf, b.y, leaf, b.h);
        }
        if (!state.up) {
          // How long it stays open, running down between the leaves.
          const left = state.timer / GATE_OPEN_STEPS,
            span = (long - 2 * leaf) * left;
          g.fillStyle = hexA(GADGET, 0.75);
          if (tall) g.fillRect(mx - 1, my - span / 2, 2, span);
          else g.fillRect(mx - span / 2, my - 1, span, 2);
        }
      }
    });

    // A ledge is only its top edge: a bright line with open slats under it, so it reads as something to come up
    // through, not a wall.
    for (const ledge of map.ledges) {
      g.fillStyle = hexA(LEDGE, 0.1);
      g.fillRect(ledge.x, ledge.y, ledge.w, ledge.h);
      g.fillStyle = LEDGE;
      g.fillRect(ledge.x, ledge.y, ledge.w, 2);
      g.fillStyle = hexA(LEDGE, 0.55);
      for (let x = ledge.x + 2; x < ledge.x + ledge.w - 3; x += 8)
        g.fillRect(x, ledge.y + 2, 4, ledge.h - 2);
      g.fillStyle = WHITE;
      g.fillRect(ledge.x, ledge.y, 2, 2);
      g.fillRect(ledge.x + ledge.w - 2, ledge.y, 2, 2);
    }

    // A mover is a solid on a rail: the rail shows where it goes, and its end lights say which way it is going.
    for (const mover of map.movers) {
      const at = moverPlace(mover, view.clock),
        upright = mover.travel.y !== 0,
        going = moverPlace(mover, view.clock + 1),
        ahead = upright ? going.y - at.y : going.x - at.x,
        mx = mover.x + mover.w / 2,
        my = mover.y + mover.h / 2;
      g.fillStyle = hexA(LEDGE, 0.22);
      const far = Math.abs(upright ? mover.travel.y : mover.travel.x),
        sign = Math.sign(upright ? mover.travel.y : mover.travel.x);
      for (let d = 0; d <= far; d += 6)
        if (upright) g.fillRect(mx - 0.5, my + sign * d - 1, 1, 2);
        else g.fillRect(mx + sign * d - 1, my - 0.5, 2, 1);
      g.fillStyle = EDGE_DIM;
      g.fillRect(at.x, at.y, mover.w, mover.h);
      g.fillStyle = SOLID;
      g.fillRect(at.x + 1, at.y + 2, mover.w - 2, mover.h - 3);
      g.fillStyle = LEDGE;
      g.fillRect(at.x, at.y, mover.w, 2);
      // The lights at the end it is heading for burn brighter.
      const light = (x: number, y: number, lead: boolean) => {
        g.fillStyle = hexA(LEDGE, lead ? 1 : 0.35);
        g.fillRect(x, y, 3, 3);
      };
      const low = at.y + mover.h - 5;
      if (upright) {
        light(at.x + 3, ahead < 0 ? at.y + 3 : low, true);
        light(at.x + mover.w - 6, ahead < 0 ? at.y + 3 : low, true);
      } else {
        light(at.x + 3, at.y + 4, ahead < 0);
        light(at.x + mover.w - 6, at.y + 4, ahead > 0);
      }
    }

    for (const bumper of map.bumpers) {
      const beat = 0.5 + 0.5 * Math.sin(now / 240 + bumper.x),
        // The ball close by sets it ringing.
        near = Math.hypot(view.ball.x - bumper.x, view.ball.y - bumper.y),
        ring = view.ball.live ? Math.max(0, 1 - (near - bumper.r) / 26) : 0;
      for (const at of copies(map, bumper.x, bumper.y, bumper.r + 8)) {
        const halo = g.createRadialGradient(
          at.x,
          at.y,
          bumper.r - 2,
          at.x,
          at.y,
          bumper.r + 8 + 4 * ring,
        );
        halo.addColorStop(0, hexA(EDGE, 0.5 + 0.4 * ring));
        halo.addColorStop(1, hexA(EDGE, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(at.x, at.y, bumper.r + 8 + 4 * ring, 0, TAU);
        g.fill();
        g.beginPath();
        g.arc(at.x, at.y, bumper.r, 0, TAU);
        g.fillStyle = SOLID;
        g.fill();
        g.lineWidth = 2.5;
        g.strokeStyle = ring > 0.5 ? WHITE : EDGE;
        g.stroke();
        g.beginPath();
        g.arc(at.x, at.y, bumper.r * (0.42 + 0.08 * beat), 0, TAU);
        g.fillStyle = hexA(WHITE, 0.75 + 0.25 * ring);
        g.fill();
        g.fillStyle = EDGE;
        g.fillRect(at.x - 1, at.y - 1, 2, 2);
      }
    }

    for (const portal of map.portals) {
      const color = PORTAL[portal.hue];
      [portal.a, portal.b].forEach((end, which) => {
        for (const at of copies(map, end.x, end.y, portal.r + 8)) {
          const well = g.createRadialGradient(
            at.x,
            at.y,
            1,
            at.x,
            at.y,
            portal.r + 6,
          );
          well.addColorStop(0, hexA(INK, 0.95));
          well.addColorStop(0.55, hexA(color, 0.3));
          well.addColorStop(1, hexA(color, 0));
          g.fillStyle = well;
          g.beginPath();
          g.arc(at.x, at.y, portal.r + 6, 0, TAU);
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = color;
          g.beginPath();
          g.arc(at.x, at.y, portal.r, 0, TAU);
          g.stroke();
          // Three arcs spiralling in; the two ends of a pair turn opposite ways.
          g.strokeStyle = hexA(WHITE, 0.85);
          g.lineWidth = 1.5;
          const turn = (which === 0 ? 1 : -1) * (now / 260);
          for (let arm = 0; arm < 3; arm++) {
            const start = turn + (arm * TAU) / 3;
            g.beginPath();
            g.arc(at.x, at.y, portal.r - 3 - arm * 2.5, start, start + 1.1);
            g.stroke();
          }
        }
      });
    }
  };

  const bubble = (map: MapDef, b: BubbleView, now: number) => {
    if (!b.active) return;
    const age = fx.bubbleAge(b.index, now),
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
    // In a goal the ball is gone, once the freeze that shows where it went in is over.
    if (!b.live && !view.frozen) {
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
    if (r.zapped && !view.frozen) {
      // What is left of a zapped rider: a flicker where they stood, once the shards have flown.
      if (fx.zapAge(r.index, now) < 500) return;
      g.globalAlpha = 0.1 + 0.06 * Math.sin(now / 70);
      for (const at of copies(map, r.x, r.y, RIDER_RADIUS + 4))
        drawRider(g, frame, r.slot, at.x, at.y, r.facing);
      g.globalAlpha = 1;
      return;
    }
    const held = view.bubbles[r.index];
    for (const at of copies(map, r.x, r.y, RIDER_RADIUS + 8)) {
      // A hard bubble is held on a thread of light.
      if (held?.active && held.hard) {
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
    draw(view, nowMs, localSlot, names, localIndex = localSlot) {
      if (dead) return [];
      if (
        !box ||
        box.w !== canvas.clientWidth ||
        box.h !== canvas.clientHeight ||
        box.ratio !== Math.max(1, Math.min(MAX_RATIO, ratioOf() || 1))
      )
        resize();
      const found = fx.update(view, nowMs),
        map = mapOf(view.mapId, view.seed),
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
      // The camera: the arena point it looks at goes to the middle of the screen.
      const eye = look(map, view, localIndex, nowMs);
      g.translate(VIEW_W / 2, VIEW_H / 2);
      g.scale(eye.zoom, eye.zoom);
      g.translate(-eye.x, -eye.y);
      backdrop(map, nowMs);
      for (const c of map.clouds) cloud(c, nowMs, view.slow);
      const scored = view.phase === "zap" || view.phase === "over";
      for (const shape of map.goals)
        goal(shape, nowMs, scored && view.lastScorer === shape.team);
      liquids(g, map, nowMs);
      if (isWire(map)) {
        wireSolids(g, map);
        skulls(g, map);
      } else solids(map);
      gadgets(map, view, nowMs);
      fx.drawBehind(g);
      for (const b of view.bubbles) bubble(map, b, nowMs);
      ball(map, view, nowMs);
      for (const r of view.riders)
        if (r.index !== localIndex) rider(map, view, r, nowMs, false);
      // This device's rider last, so it is never hidden behind the others.
      for (const r of view.riders)
        if (r.index === localIndex) rider(map, view, r, nowMs, true);
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
      camera = undefined;
      fx.reset();
      hud.reset();
    },
  };
}
