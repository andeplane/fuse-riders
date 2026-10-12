import { roundRect, type Art } from "./art.js";
import {
  doorPoint,
  ringBetween,
  ringToT,
  streetPoint,
  walkPoint,
  type Geometry,
  type Point,
} from "./layout.js";
import type { BoardPlace, BoardPlayer } from "./presenter.js";

/**
 * The city on a 2D canvas, in the soft sticker style of the art set: a calm lawn, a smooth flowing loop road with a
 * dashed centre line, the park (the ground picture and the plaza) inside it, and the 13 buildings as stickers along
 * the outside of the curve, each on a short path to the sidewalk, with a name label. Everything flat is drawn once
 * per layout into an offscreen canvas; each frame only the buildings, their highlights and the walkers are drawn
 * over it. The geometry is `layout.ts`; this file only draws.
 */
export interface BoardFrame {
  places: BoardPlace[];
  players: BoardPlayer[];
  /** Each player's ring position in the frame before, to walk smoothly between log ticks. */
  before: ReadonlyMap<string, number>;
  /** How far from the frame before to this one, 0..1. */
  fraction: number;
  /** Seconds since the page opened: walk cycles and pulses. */
  time: number;
  /** A place to outline (the pointer is over it). */
  hover: number;
}

const INK = "#26304a";
const FONT = `"Nunito Variable", "Nunito", ui-rounded, system-ui, sans-serif`;
const COLORS = {
  lawn: "#93cf5f",
  lawnEdge: "#7fbf55",
  outline: "#2f3a52",
  asphalt: "#5d6679",
  walk: "#f1ece0",
  curb: "#d9d2c2",
  dash: "#f7f4ea",
};

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

/** The street's centre line moved `offset` px outward, as a closed path. */
function loopPath(
  context: CanvasRenderingContext2D,
  g: Geometry,
  offset = 0,
): void {
  const steps = 240;
  context.beginPath();
  for (let i = 0; i < steps; i++) {
    const p = streetPoint(g, i / steps, offset);
    if (i === 0) context.moveTo(p.x, p.y);
    else context.lineTo(p.x, p.y);
  }
  context.closePath();
}

/** A soft dark patch right under something standing on the ground. */
function contactShadow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha: number,
): void {
  const gradient = context.createRadialGradient(x, y, 0, x, y, rx);
  gradient.addColorStop(0, `rgba(30, 50, 40, ${alpha})`);
  gradient.addColorStop(1, "rgba(30, 50, 40, 0)");
  context.save();
  context.translate(x, y);
  context.scale(1, ry / rx);
  context.translate(-x, -y);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, rx, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** The park's picture: the ground art covering the inside of the loop (turned for a tall loop), or a plain lawn. */
function drawPark(c: CanvasRenderingContext2D, g: Geometry, art: Art): void {
  const ground = art.image("board-ground");
  const inner = g.road / 2 + g.walk;
  c.save();
  loopPath(c, g, -inner);
  c.clip();
  c.fillStyle = "#97d35a";
  c.fillRect(0, 0, g.width, g.height);
  if (ground) {
    // The green part of the picture (inside its grey margin), scaled to cover the loop's box.
    const sx = 230,
      sy = 190,
      sw = 1590,
      sh = 1140;
    const x0 = g.left + inner,
      y0 = g.top + inner,
      w = g.right - g.left - 2 * inner,
      h = g.bottom - g.top - 2 * inner;
    const tall = h > w;
    const [bw, bh] = tall ? [h, w] : [w, h];
    const scale = Math.max(bw / sw, bh / sh);
    c.translate(x0 + w / 2, y0 + h / 2);
    if (tall) c.rotate(Math.PI / 2);
    c.drawImage(
      ground as unknown as CanvasImageSource,
      sx,
      sy,
      sw,
      sh,
      (-sw * scale) / 2,
      (-sh * scale) / 2,
      sw * scale,
      sh * scale,
    );
  }
  c.restore();
  // A soft shade inside the curb, so the park sits a little lower than the sidewalk.
  c.save();
  loopPath(c, g, -inner);
  c.clip();
  loopPath(c, g, -inner);
  c.lineWidth = Math.max(6, g.size * 0.1);
  c.strokeStyle = "rgba(40, 70, 40, 0.16)";
  c.stroke();
  c.restore();
  // The plaza in the middle.
  const plaza = art.asset("board-plaza"),
    image = art.image("board-plaza"),
    p = g.park;
  if (plaza && image && p.w > 40 && p.h > 40) {
    const scale = Math.min(
      (p.w * 0.92) / plaza.width,
      (p.h * 0.62) / plaza.height,
    );
    const w = plaza.width * scale,
      h = plaza.height * scale,
      cx = p.x + p.w / 2,
      cy = p.y + p.h / 2;
    contactShadow(c, cx + w * 0.03, cy + h * 0.12, w * 0.5, h * 0.42, 0.28);
    c.drawImage(
      image as unknown as CanvasImageSource,
      cx - w / 2,
      cy - h / 2,
      w,
      h,
    );
  }
}

const groundCache = new WeakMap<
  Geometry,
  { canvas: HTMLCanvasElement; key: string }
>();

/** Everything flat, drawn once per layout (and again when a picture loads) into an offscreen canvas. */
function ground(
  g: Geometry,
  art: Art,
  ratio: number,
  places: readonly BoardPlace[],
): HTMLCanvasElement {
  const key = [
      ratio,
      art.image("board-ground") ? 1 : 0,
      art.image("board-plaza") ? 1 : 0,
      places.map((place) => place.index).join("."),
    ].join(","),
    known = groundCache.get(g);
  if (known && known.key === key) return known.canvas;
  const canvas = makeCanvas(g.width * ratio, g.height * ratio),
    c = canvas.getContext("2d")!;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  const { width, height } = g,
    s = g.size;
  // The lawn: one calm green, a touch lighter in the middle.
  const lawn = c.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.2,
    width / 2,
    height / 2,
    Math.hypot(width, height) * 0.6,
  );
  lawn.addColorStop(0, COLORS.lawn);
  lawn.addColorStop(1, COLORS.lawnEdge);
  c.fillStyle = lawn;
  c.fillRect(0, 0, width, height);
  // A few broad, barely-there swells of light and shade, so the lawn is not a flat sheet.
  for (let k = 0; k < 7; k++) {
    const x = width * ((k * 0.37 + 0.11) % 1),
      y = height * ((k * 0.61 + 0.23) % 1),
      r = Math.max(width, height) * (0.16 + (k % 3) * 0.05);
    const swell = c.createRadialGradient(x, y, 0, x, y, r);
    swell.addColorStop(
      0,
      k % 2 ? "rgba(255, 255, 220, 0.09)" : "rgba(40, 90, 40, 0.07)",
    );
    swell.addColorStop(1, "rgba(0, 0, 0, 0)");
    c.fillStyle = swell;
    c.fillRect(0, 0, width, height);
  }

  // Short paved paths from each building to the sidewalk.
  const outer = g.road / 2 + g.walk;
  for (const place of places) {
    const lot = g.lots[g.placeLot[place.index]!]!;
    const door = streetPoint(g, lot.t, outer - 1),
      from = { x: lot.x, y: lot.y + s * 0.2 };
    const pathWidth = Math.max(5, s * 0.16);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(door.x, door.y);
    c.lineWidth = pathWidth + 3;
    c.strokeStyle = "rgba(47, 58, 82, 0.35)";
    c.stroke();
    c.lineWidth = pathWidth;
    c.strokeStyle = COLORS.walk;
    c.stroke();
    // The building's soft footprint.
    contactShadow(c, lot.x + s * 0.03, lot.y + s * 0.3, s * 0.5, s * 0.2, 0.3);
  }
  c.lineCap = "butt";

  // The road: a soft shadow, an ink outline, sidewalks, curbs, asphalt and a dashed centre line.
  c.lineJoin = "round";
  c.save();
  c.translate(s * 0.02, s * 0.04);
  loopPath(c, g);
  c.lineWidth = g.road + 2 * g.walk + 6;
  c.strokeStyle = "rgba(30, 60, 40, 0.18)";
  c.stroke();
  c.restore();
  loopPath(c, g);
  c.lineWidth = g.road + 2 * g.walk + 3;
  c.strokeStyle = COLORS.outline;
  c.stroke();
  loopPath(c, g);
  c.lineWidth = g.road + 2 * g.walk;
  c.strokeStyle = COLORS.walk;
  c.stroke();
  loopPath(c, g);
  c.lineWidth = g.road + Math.max(2, g.walk * 0.35);
  c.strokeStyle = COLORS.curb;
  c.stroke();
  loopPath(c, g);
  c.lineWidth = g.road + 2;
  c.strokeStyle = COLORS.outline;
  c.stroke();
  loopPath(c, g);
  c.lineWidth = g.road;
  c.strokeStyle = COLORS.asphalt;
  c.stroke();
  // A faint sheen along the far edge of the asphalt.
  loopPath(c, g, -g.road * 0.3);
  c.lineWidth = g.road * 0.25;
  c.strokeStyle = "rgba(255, 255, 255, 0.05)";
  c.stroke();
  loopPath(c, g);
  c.setLineDash([g.road * 0.5, g.road * 0.6]);
  c.lineCap = "round";
  c.lineWidth = Math.max(1.5, g.road * 0.08);
  c.strokeStyle = COLORS.dash;
  c.stroke();
  c.setLineDash([]);
  c.lineCap = "butt";

  drawPark(c, g, art);
  groundCache.set(g, { canvas, key });
  return canvas;
}

interface Sprite {
  /** Draw order: the ground line, back to front. */
  y: number;
  draw(context: CanvasRenderingContext2D): void;
}

/** A building sticker, or a simple block in its colour while the picture is missing. */
function drawBuilding(
  c: CanvasRenderingContext2D,
  art: Art,
  id: string,
  x: number,
  y: number,
  s: number,
): void {
  if (art.image(id)) {
    art.draw(c, id, x, y, s);
    return;
  }
  const asset = art.asset(id),
    w = s * 0.62,
    h = s * 0.5;
  c.save();
  c.fillStyle = asset?.color ?? "#9ab";
  c.strokeStyle = COLORS.outline;
  c.lineWidth = Math.max(1.5, s * 0.02);
  roundRect(c, x - w / 2, y - s * 0.12 - h, w, h, s * 0.06);
  c.fill();
  c.stroke();
  c.restore();
}

/** One walker: an avatar sprite (or a disc with an initial), a coloured ring at the feet, a marker over yours. */
function drawWalker(
  c: CanvasRenderingContext2D,
  art: Art,
  player: BoardPlayer,
  at: Point,
  size: number,
  walking: boolean,
  left: boolean,
  time: number,
): void {
  const id = `avatar-${player.avatar}-${walking ? "walk" : "idle"}`;
  contactShadow(c, at.x, at.y, size * 0.28, size * 0.1, 0.35);
  c.save();
  c.strokeStyle = player.color;
  c.lineWidth = player.you ? 3 : 2;
  c.beginPath();
  c.ellipse(at.x, at.y, size * 0.26, size * 0.09, 0, 0, Math.PI * 2);
  c.stroke();
  if (player.done) c.globalAlpha = 0.6;
  if (art.image(id)) {
    if (left) {
      c.translate(at.x, 0);
      c.scale(-1, 1);
      c.translate(-at.x, 0);
    }
    art.draw(c, id, at.x, at.y, size, Math.floor(time * 6));
  } else {
    const r = size * 0.32,
      bob = walking ? Math.abs(Math.sin(time * 10)) * r * 0.25 : 0;
    c.beginPath();
    c.arc(at.x, at.y - r - bob, r, 0, Math.PI * 2);
    c.fillStyle = player.color;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = "#fff";
    c.stroke();
    c.fillStyle = INK;
    c.font = `800 ${r}px ${FONT}`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText((player.name[0] ?? "?").toUpperCase(), at.x, at.y - r - bob + 1);
  }
  c.restore();
  if (!player.you) return;
  const y = at.y - size * 1.02 + Math.sin(time * 4) * 2;
  c.save();
  c.beginPath();
  c.moveTo(at.x - 7, y - 9);
  c.lineTo(at.x + 7, y - 9);
  c.lineTo(at.x, y);
  c.closePath();
  c.fillStyle = player.color;
  c.shadowColor = "rgba(0,0,0,0.3)";
  c.shadowBlur = 4;
  c.shadowOffsetY = 2;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = "#fff";
  c.stroke();
  c.restore();
}

/**
 * Where each player stands: walking on the inner sidewalk, or waiting at the door of the place they are in. Players
 * at the same door, or at the same spot of the sidewalk, fan out side by side along the street.
 */
export function standingPoints(
  g: Geometry,
  players: readonly { id: string; pos: number; inside: number }[],
  rings: readonly number[],
  avatar: number,
): Point[] {
  const groups = new Map<string, number[]>();
  players.forEach((player, index) => {
    const key =
      player.inside >= 0
        ? `in${player.inside}`
        : `at${Math.round(rings[index]! * 2)}`;
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const points: Point[] = [];
  for (const members of groups.values())
    members.forEach((index, k) => {
      const player = players[index]!;
      const base =
        player.inside >= 0
          ? doorPoint(g, player.inside)
          : streetPoint(
              g,
              ringToT(g, rings[index]!),
              -(g.road / 2 + g.walk * 0.5),
            );
      // Side by side along the street: the tangent is the normal turned a quarter.
      const spread = (k - (members.length - 1) / 2) * avatar * 0.5;
      points[index] = {
        x: base.x - base.ny * spread,
        y: base.y + base.nx * spread,
      };
    });
  return points;
}

export function drawBoard(
  context: CanvasRenderingContext2D,
  g: Geometry,
  frame: BoardFrame,
  art: Art,
  ratio = 1,
): void {
  const { width, height } = g;
  const s = g.size;
  context.clearRect(0, 0, width, height);
  context.drawImage(ground(g, art, ratio, frame.places), 0, 0, width, height);

  const sprites: Sprite[] = [];
  for (const place of frame.places) {
    const lot = g.lots[g.placeLot[place.index]!]!,
      id = `building-${place.id}`,
      ax = lot.x,
      ay = lot.y + s * 0.42;
    sprites.push({
      y: ay,
      draw: (c) => {
        if (place.here || place.dest || place.index === frame.hover) {
          // A glowing ring on the ground around the building.
          const pulse = place.dest ? 0.5 + 0.5 * Math.sin(frame.time * 5) : 1;
          c.save();
          c.beginPath();
          c.ellipse(
            lot.x,
            lot.y + s * 0.3,
            s * 0.5,
            s * 0.2,
            0,
            0,
            Math.PI * 2,
          );
          const color = place.here
            ? "46, 204, 113"
            : place.dest
              ? "255, 196, 61"
              : "255, 255, 255";
          c.fillStyle = `rgba(${color}, ${0.18 + 0.12 * pulse})`;
          c.fill();
          c.lineWidth = Math.max(2.5, s * 0.03);
          c.strokeStyle = `rgba(${color}, ${0.55 + 0.45 * pulse})`;
          c.shadowColor = `rgb(${color})`;
          c.shadowBlur = s * 0.1;
          c.stroke();
          c.restore();
        }
        drawBuilding(c, art, id, ax, ay, s);
      },
    });
  }
  const avatar = Math.max(24, s * 0.42);
  const rings = frame.players.map((player) =>
    ringBetween(
      frame.before.get(player.id) ?? player.pos,
      player.pos,
      frame.fraction,
    ),
  );
  const points = standingPoints(g, frame.players, rings, avatar);
  frame.players.forEach((player, index) => {
    const before = frame.before.get(player.id) ?? player.pos;
    const walking =
      player.inside < 0 && player.dest >= 0 && before !== player.pos;
    const ahead = walkPoint(
      g,
      ringBetween(before, player.pos, Math.min(1, frame.fraction + 0.15)),
    );
    const left = walking && ahead.x < walkPoint(g, rings[index]!).x - 0.01;
    const at = points[index]!;
    sprites.push({
      y: at.y + (player.you ? 0.5 : 0),
      draw: (c) =>
        drawWalker(c, art, player, at, avatar, walking, left, frame.time),
    });
  });
  sprites.sort((a, b) => a.y - b.y);
  for (const item of sprites) item.draw(context);

  // Name labels: white pills with an ink outline, under each building.
  const font = Math.max(10, Math.min(15, s * 0.12));
  const plate = `800 ${font}px ${FONT}`;
  context.font = plate;
  context.textAlign = "center";
  context.textBaseline = "middle";
  // Too small to read (the menu's picture): the buildings speak for themselves.
  const labels = s >= 64 ? frame.places : [];
  for (const place of labels) {
    const lot = g.lots[g.placeLot[place.index]!]!;
    const tw = context.measureText(place.name).width + font * 1.1,
      th = font * 1.6,
      x = Math.min(width - tw / 2 - 3, Math.max(tw / 2 + 3, lot.x)),
      y = lot.y + s * 0.44;
    context.save();
    context.shadowColor = "rgba(20, 30, 50, 0.25)";
    context.shadowBlur = 4;
    context.shadowOffsetY = 1.5;
    roundRect(context, x - tw / 2, y - th / 2, tw, th, th / 2);
    context.fillStyle = place.here
      ? "#2ecc71"
      : place.dest
        ? "#ffc43d"
        : "#fff";
    context.fill();
    context.restore();
    roundRect(context, x - tw / 2, y - th / 2, tw, th, th / 2);
    context.lineWidth = 1.5;
    context.strokeStyle = COLORS.outline;
    context.stroke();
    context.fillStyle = INK;
    context.fillText(place.name, x, y + 0.5);
    if (place.work) {
      const bx = x + tw / 2 - 2,
        by = y - th / 2 - 2;
      context.beginPath();
      context.arc(bx, by, font * 0.72, 0, Math.PI * 2);
      context.fillStyle = "#ffc43d";
      context.fill();
      context.lineWidth = 1.5;
      context.strokeStyle = COLORS.outline;
      context.stroke();
      context.fillStyle = INK;
      context.font = `900 ${font * 0.8}px ${FONT}`;
      context.fillText("W", bx, by + 0.5);
      context.font = plate;
    }
  }
}
