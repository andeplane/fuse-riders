import { CITY, STREETS, doorOf, type MapPoint } from "../game/index.js";
import {
  drawBurst,
  drawCloudShadows,
  drawDaylight,
  drawGlints,
  drawRoute,
  glints,
} from "./ambience.js";
import { roundRect, type Art } from "./art.js";
import {
  bounds,
  route,
  standingPoints,
  stepPoint,
  toScreen,
  walkerAt,
  type BoardView,
  type Camera,
  type Point,
} from "./layout.js";
import type { BoardPlace, BoardPlayer } from "./presenter.js";

/**
 * The city on a 2D canvas: the city's map picture (Fusetown, the harbour town) covering the board, with the game laid
 * over it: a glow on the place you are in, walking to or pointing at, every player walking the streets (or waiting in
 * front of the place they are in), the parts of the picture that stand in front of the streets, and the places' name
 * labels. The picture is scaled once per layout into an offscreen canvas; each frame blits it at the camera and draws
 * the rest on top. The geometry is `layout.ts`; this file only draws.
 */
export interface BoardFrame {
  places: BoardPlace[];
  players: BoardPlayer[];
  /** Each player's step in the frame before, to walk smoothly between log ticks. */
  before: ReadonlyMap<string, number>;
  /** How far from the frame before to this one, 0..1. */
  fraction: number;
  /** Seconds since the page opened: walk cycles and pulses. */
  time: number;
  /** A place to outline (the pointer is over it). */
  hover: number;
  /** The share of this device's player's hours left, 0..1, for the week's light (leave out: plain daylight). */
  daylight?: number;
  /** The players who just walked into a place, and how many seconds ago. */
  arrivals?: readonly { id: string; age: number }[];
}
export interface BoardOptions {
  /** Draw the street graph, the doors and the tap outlines over the picture (`?debug-roads`). */
  debug?: boolean;
  /** Reduced motion: no drifting clouds or twinkling water, and the way you walk stands still. */
  calm?: boolean;
}

const GLINTS = glints();

const INK = "#26304a";
const OUTLINE = "#2f3a52";
export const FONT = `"Nunito Variable", "Nunito", ui-rounded, system-ui, sans-serif`;
/** An avatar's height in map px. */
const AVATAR = 56;

/** The label's font size on screen for a view. */
export const labelFont = (view: BoardView): number =>
  Math.max(11, Math.min(15, 15.5 * view.scale));

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

/** While the picture is missing: a lawn with the streets drawn as roads and the buildings as labelled blocks. */
function drawPlaceholder(
  c: CanvasRenderingContext2D,
  scale: number,
  art: Art,
): void {
  c.fillStyle = "#8cc363";
  c.fillRect(0, 0, CITY.map.width * scale, CITY.map.height * scale);
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const [width, color] of [
    [46, "#e9e1cf"],
    [36, "#5d6679"],
  ] as const) {
    c.lineWidth = width * scale;
    c.strokeStyle = color;
    for (const edge of CITY.edges) {
      const from = CITY.nodes.find((node) => node.id === edge.from)!.at,
        to = CITY.nodes.find((node) => node.id === edge.to)!.at;
      c.beginPath();
      for (const [k, [x, y]] of [from, ...edge.via, to].entries())
        if (k === 0) c.moveTo(x * scale, y * scale);
        else c.lineTo(x * scale, y * scale);
      c.stroke();
    }
  }
  for (const place of CITY.places) {
    const box = bounds(place.tap),
      asset = art.asset(`building-${place.id}`);
    c.fillStyle = asset?.color ?? "#9ab";
    c.strokeStyle = OUTLINE;
    c.lineWidth = Math.max(1.5, 3 * scale);
    roundRect(
      c,
      (box.x + box.w * 0.12) * scale,
      (box.y + box.h * 0.2) * scale,
      box.w * 0.76 * scale,
      box.h * 0.6 * scale,
      14 * scale,
    );
    c.fill();
    c.stroke();
  }
}

const pictureCache = new WeakMap<
  BoardView,
  { canvas: HTMLCanvasElement; key: string }
>();

/** The map scaled to the view (once per layout, and again when the picture loads). */
function picture(view: BoardView, art: Art, ratio: number): HTMLCanvasElement {
  const image = art.image(CITY.map.art),
    key = `${ratio},${image ? 1 : 0}`,
    known = pictureCache.get(view);
  if (known && known.key === key) return known.canvas;
  const canvas = makeCanvas(view.mapWidth * ratio, view.mapHeight * ratio),
    c = canvas.getContext("2d")!;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  if (image)
    c.drawImage(
      image as unknown as CanvasImageSource,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  else drawPlaceholder(c, view.scale * ratio, art);
  pictureCache.set(view, { canvas, key });
  return canvas;
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
  context.save();
  context.translate(x, y);
  context.scale(1, ry / rx);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, rx);
  gradient.addColorStop(0, `rgba(20, 30, 40, ${alpha})`);
  gradient.addColorStop(1, "rgba(20, 30, 40, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, rx, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** One walker: an avatar sprite (or a disc with an initial) and a coloured ring at the feet. */
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
  contactShadow(c, at.x, at.y, size * 0.3, size * 0.11, 0.45);
  c.save();
  c.strokeStyle = player.color;
  c.lineWidth = player.you ? 3 : 2;
  c.beginPath();
  c.ellipse(at.x, at.y, size * 0.27, size * 0.1, 0, 0, Math.PI * 2);
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
}

/** The marker over this device's player: drawn last, so no label hides it. */
function drawMarker(
  c: CanvasRenderingContext2D,
  player: BoardPlayer,
  at: Point,
  size: number,
  time: number,
): void {
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

/** A glow round a place's building: green inside, pulsing amber on the way, white under the pointer. */
function drawGlow(
  c: CanvasRenderingContext2D,
  view: BoardView,
  camera: Camera,
  place: BoardPlace,
  time: number,
): void {
  const box = bounds(CITY.places[place.index]!.tap);
  const at = toScreen(view, camera, [box.x, box.y]),
    w = box.w * view.scale,
    h = box.h * view.scale;
  const pulse = place.dest ? 0.5 + 0.5 * Math.sin(time * 5) : 1;
  const color = place.here
    ? "46, 204, 113"
    : place.dest
      ? "255, 196, 61"
      : "255, 255, 255";
  c.save();
  roundRect(c, at.x, at.y, w, h, Math.min(w, h) * 0.12);
  c.fillStyle = `rgba(${color}, ${0.1 + 0.08 * pulse})`;
  c.fill();
  c.lineWidth = 3;
  c.strokeStyle = `rgba(${color}, ${0.6 + 0.4 * pulse})`;
  c.shadowColor = `rgb(${color})`;
  c.shadowBlur = 14;
  c.stroke();
  c.restore();
}

const hoursText = (value: number) => {
  const rounded = Math.round(value * 2) / 2;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
};

/** The places' name labels: white pills with an ink outline (green inside, amber on the way, the walk on hover). */
function drawLabels(
  c: CanvasRenderingContext2D,
  view: BoardView,
  camera: Camera,
  places: readonly BoardPlace[],
  hover: number,
): void {
  const font = labelFont(view);
  const plate = `800 ${font}px ${FONT}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const place of places) {
    const at = toScreen(view, camera, CITY.places[place.index]!.label);
    const name =
      place.index === hover && place.hours > 0
        ? `${place.name} · ${hoursText(place.hours)}`
        : place.name;
    c.font = plate;
    const tw = c.measureText(name).width + font * 1.2,
      th = font * 1.7;
    if (
      at.x + tw / 2 < 0 ||
      at.x - tw / 2 > view.width ||
      at.y + th < 0 ||
      at.y - th > view.height
    )
      continue;
    c.save();
    c.shadowColor = "rgba(20, 30, 50, 0.3)";
    c.shadowBlur = 5;
    c.shadowOffsetY = 1.5;
    roundRect(c, at.x - tw / 2, at.y - th / 2, tw, th, th / 2);
    c.fillStyle = place.here ? "#2ecc71" : place.dest ? "#ffc43d" : "#fffdf6";
    c.fill();
    c.restore();
    roundRect(c, at.x - tw / 2, at.y - th / 2, tw, th, th / 2);
    c.lineWidth = 1.5;
    c.strokeStyle = OUTLINE;
    c.stroke();
    c.fillStyle = INK;
    c.fillText(name, at.x, at.y + 0.5);
    if (place.work) {
      const bx = at.x + tw / 2 - 2,
        by = at.y - th / 2 - 2;
      c.beginPath();
      c.arc(bx, by, font * 0.72, 0, Math.PI * 2);
      c.fillStyle = "#ffc43d";
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = OUTLINE;
      c.stroke();
      c.fillStyle = INK;
      c.font = `900 ${font * 0.8}px ${FONT}`;
      c.fillText("W", bx, by + 0.5);
    }
  }
}

/** The street graph, the doors and the tap outlines over the picture, to check the tracing (`?debug-roads`). */
function drawDebug(
  c: CanvasRenderingContext2D,
  view: BoardView,
  camera: Camera,
): void {
  const screen = (at: MapPoint) => toScreen(view, camera, at);
  c.save();
  c.lineWidth = 1.5;
  c.font = `700 11px ${FONT}`;
  for (const place of CITY.places) {
    c.beginPath();
    for (const [k, point] of place.tap.entries()) {
      const p = screen(point);
      if (k === 0) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    }
    c.closePath();
    c.strokeStyle = "rgba(255, 64, 160, 0.9)";
    c.setLineDash([6, 4]);
    c.stroke();
    c.setLineDash([]);
  }
  for (const occluder of CITY.occluders) {
    c.beginPath();
    for (const [k, point] of occluder.shape.entries()) {
      const p = screen(point);
      if (k === 0) c.moveTo(p.x, p.y);
      else c.lineTo(p.x, p.y);
    }
    c.closePath();
    c.strokeStyle = "#ff3b30";
    c.stroke();
  }
  c.lineWidth = 3;
  c.strokeStyle = "rgba(255, 230, 0, 0.95)";
  STREETS.neighbours.forEach((around, step) => {
    const a = screen(stepPoint(step));
    for (const other of around)
      if (other > step) {
        const b = screen(stepPoint(other));
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
  });
  STREETS.points.forEach((point, step) => {
    const p = screen(point),
      node = step < CITY.nodes.length;
    c.beginPath();
    c.arc(p.x, p.y, node ? 5 : 2.5, 0, Math.PI * 2);
    c.fillStyle = node ? "#1e90ff" : "#ffe600";
    c.fill();
    c.strokeStyle = "#000";
    c.lineWidth = 1;
    c.stroke();
  });
  c.textAlign = "left";
  c.textBaseline = "bottom";
  CITY.places.forEach((place, index) => {
    const p = screen(stepPoint(STREETS.doors[index]!));
    c.beginPath();
    c.arc(p.x, p.y, 6, 0, Math.PI * 2);
    c.fillStyle = "#ff3b30";
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = "#000";
    c.strokeText(place.id, p.x + 7, p.y - 4);
    c.fillStyle = "#fff";
    c.fillText(place.id, p.x + 7, p.y - 4);
  });
  c.restore();
}

export function drawBoard(
  context: CanvasRenderingContext2D,
  view: BoardView,
  camera: Camera,
  frame: BoardFrame,
  art: Art,
  ratio = 1,
  options: BoardOptions = {},
): void {
  const map = picture(view, art, ratio);
  context.clearRect(0, 0, view.width, view.height);
  context.drawImage(map, camera.x, camera.y, view.mapWidth, view.mapHeight);
  if (!options.calm) drawGlints(context, view, camera, GLINTS, frame.time);

  for (const place of frame.places)
    if (place.here || place.dest || place.index === frame.hover)
      drawGlow(context, view, camera, place, frame.time);

  // The walkers, back to front.
  const size = Math.max(28, AVATAR * view.scale);
  const moves = frame.players.map((player) => {
    const before = frame.before.get(player.id) ?? player.pos;
    return {
      before,
      ...walkerAt(
        before,
        player.pos,
        player.dest >= 0 ? player.dest : player.inside,
        frame.fraction,
      ),
    };
  });
  const spots = standingPoints(
    frame.players.map((player, index) => ({
      at: moves[index]!.at,
      step: player.pos,
      inside: player.inside,
    })),
    (size * 0.55) / view.scale,
  );
  const walkers = frame.players
    .map((player, index) => ({
      player,
      ground: spots[index]![1],
      at: toScreen(view, camera, spots[index]!),
      walking:
        player.inside < 0 &&
        player.dest >= 0 &&
        moves[index]!.before !== player.pos,
      left: moves[index]!.facing < 0,
      moving: moves[index]!.at,
    }))
    .sort(
      (a, b) =>
        a.ground - b.ground || Number(a.player.you) - Number(b.player.you),
    );
  // The way you are walking: from where you are now, along the rest of the streets, to the door.
  for (const walker of walkers) {
    const player = walker.player;
    if (!player.you || player.dest < 0 || player.inside >= 0) continue;
    const steps =
      route(player.pos, doorOf(player.dest), player.dest, STREETS.size) ?? [];
    drawRoute(
      context,
      [
        toScreen(view, camera, walker.moving),
        ...steps.map((step) => toScreen(view, camera, stepPoint(step))),
      ],
      player.color,
      view.scale,
      frame.time,
      options.calm,
    );
  }
  for (const walker of walkers)
    drawWalker(
      context,
      art,
      walker.player,
      walker.at,
      size,
      walker.walking,
      walker.left,
      frame.time,
    );

  // The parts of the picture in front of the streets, over the walkers behind them.
  for (const occluder of CITY.occluders) {
    const box = bounds(occluder.shape),
      top = toScreen(view, camera, [box.x, box.y]);
    const covered = walkers.some(
      (walker) =>
        walker.ground < occluder.base &&
        walker.at.x + size * 0.4 > top.x &&
        walker.at.x - size * 0.4 < top.x + box.w * view.scale &&
        walker.at.y > top.y &&
        walker.at.y - size < top.y + box.h * view.scale,
    );
    if (!covered) continue;
    context.save();
    context.beginPath();
    for (const [k, point] of occluder.shape.entries()) {
      const p = toScreen(view, camera, point);
      if (k === 0) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    }
    context.closePath();
    context.clip();
    context.drawImage(map, camera.x, camera.y, view.mapWidth, view.mapHeight);
    context.restore();
  }

  for (const arrival of frame.arrivals ?? []) {
    const walker = walkers.find((one) => one.player.id === arrival.id);
    if (walker)
      drawBurst(
        context,
        walker.at,
        arrival.age,
        walker.player.color,
        view.scale,
      );
  }
  if (!options.calm) drawCloudShadows(context, view, camera, frame.time);
  if (frame.daylight !== undefined) drawDaylight(context, view, frame.daylight);

  if (options.debug) drawDebug(context, view, camera);
  // Labels on top, except on a picture too small to read (the menu's), and your marker over everything.
  if (view.scale >= 0.42)
    drawLabels(context, view, camera, frame.places, frame.hover);
  for (const walker of walkers)
    if (walker.player.you)
      drawMarker(context, walker.player, walker.at, size, frame.time);
}
