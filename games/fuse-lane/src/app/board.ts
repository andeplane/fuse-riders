import { RING } from "../game/index.js";
import { roundRect, shade, type Art } from "./art.js";
import type { BoardPlace, BoardPlayer } from "./presenter.js";

/**
 * The city board on a 2D canvas: the loop road as a rounded rectangle that fits whatever shape the canvas is (wide on
 * a desktop, tall on a phone), the 13 buildings along it at their ring positions, and every player's avatar walking
 * the road between two frames. It draws only what it is handed each frame; the hit test maps a tap to a place.
 */
export interface Point {
  x: number;
  y: number;
}
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
  /** A big centre label (the week, or "MONDAY"). */
  centre: string;
}

export interface Geometry {
  width: number;
  height: number;
  /** The road's rounded rectangle and its corner radius. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
  /** Building size in px. */
  size: number;
  road: number;
}

/** The board's shape for a canvas of `width` × `height` CSS px. */
export function geometry(width: number, height: number): Geometry {
  const short = Math.min(width, height);
  const size = Math.max(44, Math.min(150, short * 0.15));
  const inset = Math.max(18, short * 0.06);
  return {
    width,
    height,
    left: inset,
    top: inset,
    right: width - inset,
    bottom: height - inset,
    radius: short * 0.12,
    size,
    road: Math.max(10, short * 0.045),
  };
}

/** The point on the road at ring position `ring` (fractional), clockwise from the top left corner. */
export function roadPoint(g: Geometry, ring: number): Point {
  const r = g.radius,
    w = g.right - g.left - 2 * r,
    h = g.bottom - g.top - 2 * r,
    arc = (Math.PI / 2) * r;
  const segments = [w, arc, h, arc, w, arc, h, arc];
  const total = segments.reduce((sum, length) => sum + length, 0);
  let d = ((((ring / RING) % 1) + 1) % 1) * total;
  // Start a quarter arc in, so position 0 sits at the top left where the top edge begins.
  const corners = [
    { x: g.right - r, y: g.top + r, from: -Math.PI / 2 },
    { x: g.right - r, y: g.bottom - r, from: 0 },
    { x: g.left + r, y: g.bottom - r, from: Math.PI / 2 },
    { x: g.left + r, y: g.top + r, from: Math.PI },
  ];
  for (let index = 0; index < 8; index++) {
    const length = segments[index]!;
    if (d <= length || index === 7) {
      const f = length ? Math.min(1, d / length) : 0;
      switch (index) {
        case 0:
          return { x: g.left + r + f * w, y: g.top };
        case 2:
          return { x: g.right, y: g.top + r + f * h };
        case 4:
          return { x: g.right - r - f * w, y: g.bottom };
        case 6:
          return { x: g.left, y: g.bottom - r - f * h };
        default: {
          const corner = corners[(index - 1) / 2]!,
            angle = corner.from + (f * Math.PI) / 2;
          return {
            x: corner.x + Math.cos(angle) * r,
            y: corner.y + Math.sin(angle) * r,
          };
        }
      }
    }
    d -= length;
  }
  return { x: g.left, y: g.top };
}

/** Where a building at ring position `ring` stands: inside the loop, beside the road. */
export function buildingPoint(g: Geometry, ring: number): Point {
  const a = roadPoint(g, ring - 0.5),
    b = roadPoint(g, ring + 0.5),
    length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Clockwise on screen, the inside of the loop is the tangent turned a quarter clockwise.
  const nx = -(b.y - a.y) / length,
    ny = (b.x - a.x) / length,
    p = roadPoint(g, ring);
  const out = g.size * 0.62 + g.road / 2;
  return { x: p.x + nx * out, y: p.y + ny * out };
}

/**
 * Ring positions for the buildings, nudged apart where two places sit closer on the road than a building is wide
 * (Roomshare and KeyNest are 7 steps apart), so no building hides another. Each keeps its order around the loop.
 */
export function spread(g: Geometry, rings: readonly number[]): number[] {
  const perimeter =
    2 * (g.right - g.left + g.bottom - g.top) - (8 - 2 * Math.PI) * g.radius;
  const gap = Math.min(RING / rings.length, (g.size * 1.08 * RING) / perimeter);
  const order = rings
    .map((ring, index) => ({ ring, index }))
    .sort((a, b) => a.ring - b.ring);
  const at = order.map((entry) => entry.ring);
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < at.length; i++) {
      const j = (i + 1) % at.length;
      let distance = at[j]! - at[i]!;
      if (j === 0) distance += RING;
      if (distance < gap - 1e-6) {
        const push = (gap - distance) / 2;
        at[i] = at[i]! - push;
        at[j] = at[j]! + push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const result: number[] = [];
  order.forEach((entry, k) => (result[entry.index] = (at[k]! + RING) % RING));
  return result;
}
const spotCache = new WeakMap<Geometry, Map<string, Point[]>>();
/**
 * Where each building stands: beside the road at its (spread) ring position, then pushed apart in the plane where
 * two still overlap (the corners of a narrow phone board fold neighbours into each other), kept inside the loop.
 * Remembered per geometry, since the board asks every frame.
 */
export function buildingSpots(
  g: Geometry,
  places: readonly { ring: number }[],
): Point[] {
  const key = places.map((place) => place.ring).join(",");
  let byKey = spotCache.get(g);
  if (!byKey) spotCache.set(g, (byKey = new Map()));
  const known = byKey.get(key);
  if (known) return known;
  const spots = spread(
    g,
    places.map((place) => place.ring),
  ).map((ring) => buildingPoint(g, ring));
  const room = g.size * 1.12,
    margin = g.road / 2 + g.size * 0.5;
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i]!,
          b = spots[j]!,
          dx = b.x - a.x,
          dy = b.y - a.y,
          distance = Math.hypot(dx, dy) || 1;
        if (distance >= room) continue;
        const push = (room - distance) / 2;
        a.x -= (dx / distance) * push;
        a.y -= (dy / distance) * push;
        b.x += (dx / distance) * push;
        b.y += (dy / distance) * push;
        moved = true;
      }
    for (const spot of spots) {
      spot.x = Math.min(g.right - margin, Math.max(g.left + margin, spot.x));
      spot.y = Math.min(g.bottom - margin, Math.max(g.top + margin, spot.y));
    }
    if (!moved) break;
  }
  byKey.set(key, spots);
  return spots;
}

/** The place under a point, or -1. */
export function placeAt(
  g: Geometry,
  places: readonly { ring: number }[],
  x: number,
  y: number,
): number {
  let best = -1,
    bestDistance = Infinity;
  const spots = buildingSpots(g, places);
  places.forEach((_, index) => {
    const centre = spots[index]!,
      distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance < g.size * 0.62 && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** A position between two ring positions, the short way round. */
export function ringBetween(
  from: number,
  to: number,
  fraction: number,
): number {
  let delta = to - from;
  if (delta > RING / 2) delta -= RING;
  if (delta < -RING / 2) delta += RING;
  return (from + delta * Math.max(0, Math.min(1, fraction)) + RING) % RING;
}

export function drawBoard(
  context: CanvasRenderingContext2D,
  g: Geometry,
  frame: BoardFrame,
  art: Art,
): void {
  const { width, height } = g;
  context.clearRect(0, 0, width, height);
  // Ground: the picture covering the canvas, or a soft lawn.
  const ground = art.image("board-ground");
  if (ground) {
    const asset = art.asset("board-ground")!,
      scale = Math.max(width / asset.width, height / asset.height);
    const w = asset.width * scale,
      h = asset.height * scale;
    context.drawImage(
      ground as unknown as CanvasImageSource,
      (width - w) / 2,
      (height - h) / 2,
      w,
      h,
    );
  } else {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#c9f2d6");
    gradient.addColorStop(1, "#a9e2c0");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }
  // The loop road.
  const roadPath = () =>
    roundRect(
      context,
      g.left,
      g.top,
      g.right - g.left,
      g.bottom - g.top,
      g.radius,
    );
  context.lineJoin = "round";
  roadPath();
  context.strokeStyle = "#16213e";
  context.lineWidth = g.road + 5;
  context.stroke();
  roadPath();
  context.strokeStyle = "#5b6378";
  context.lineWidth = g.road;
  context.stroke();
  roadPath();
  context.setLineDash([g.road * 0.6, g.road * 0.8]);
  context.strokeStyle = "#fff4e0";
  context.lineWidth = Math.max(1.5, g.road * 0.12);
  context.stroke();
  context.setLineDash([]);
  // The plaza and the centre label.
  const cx = width / 2,
    cy = height / 2,
    plaza = Math.min(g.right - g.left, g.bottom - g.top) * 0.62;
  if (art.image("board-plaza")) art.draw(context, "board-plaza", cx, cy, plaza);
  if (frame.centre) {
    context.font = `800 ${Math.max(14, g.size * 0.3)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineWidth = 6;
    context.strokeStyle = "#ffffffcc";
    context.strokeText(frame.centre, cx, cy);
    context.fillStyle = "#16213e";
    context.fillText(frame.centre, cx, cy);
  }
  // Buildings, top to bottom so lower ones overlap the ones behind.
  const order = frame.places
    .map((place, index) => ({
      place,
      at: buildingSpots(g, frame.places)[index]!,
    }))
    .sort((a, b) => a.at.y - b.at.y);
  for (const { place, at } of order) {
    const size = g.size;
    if (place.here || place.dest || place.index === frame.hover) {
      context.beginPath();
      context.ellipse(
        at.x,
        at.y + size * 0.3,
        size * 0.55,
        size * 0.2,
        0,
        0,
        Math.PI * 2,
      );
      const pulse = place.dest ? 0.5 + 0.5 * Math.sin(frame.time * 6) : 1;
      context.fillStyle = place.here
        ? "#3ddc8499"
        : `rgba(255, 210, 63, ${0.35 + 0.35 * pulse})`;
      context.fill();
    }
    art.draw(context, `building-${place.id}`, at.x, at.y + size * 0.42, size);
    // Name pill.
    const font = Math.max(9, Math.min(14, size * 0.13));
    context.font = `700 ${font}px system-ui, sans-serif`;
    const text = place.name,
      tw = context.measureText(text).width + font;
    const py = at.y + size * 0.48;
    roundRect(context, at.x - tw / 2, py, tw, font * 1.5, font * 0.75);
    context.fillStyle = place.here ? "#3ddc84" : "#fffffff0";
    context.fill();
    context.strokeStyle = "#16213e";
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = "#16213e";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, at.x, py + font * 0.78);
    if (place.work) {
      const bx = at.x + size * 0.38,
        by = at.y - size * 0.4;
      context.beginPath();
      context.arc(bx, by, font, 0, Math.PI * 2);
      context.fillStyle = "#ffd23f";
      context.fill();
      context.stroke();
      context.fillStyle = "#16213e";
      context.fillText("W", bx, by + 1);
    }
  }
  // Avatars: on the road, or at the door of the place they are in; spread so nobody hides behind anybody.
  const avatar = Math.max(26, g.size * 0.42);
  const inside = new Map<number, number>();
  const drawn = frame.players
    .map((player, index) => {
      const before = frame.before.get(player.id) ?? player.pos;
      const ring = ringBetween(before, player.pos, frame.fraction);
      const walking = player.dest >= 0 && before !== player.pos;
      let at = roadPoint(g, ring);
      if (player.inside >= 0) {
        const n = inside.get(player.inside) ?? 0;
        inside.set(player.inside, n + 1);
        const door = buildingSpots(g, frame.places)[player.inside]!;
        at = {
          x: door.x + (n - 1.5) * avatar * 0.42,
          y: door.y + g.size * 0.36,
        };
      } else {
        at = { x: at.x + (index - 2) * 3, y: at.y + avatar * 0.25 };
      }
      const left =
        before !== player.pos &&
        roadPoint(g, player.pos).x < roadPoint(g, before).x;
      return { player, at, walking, left };
    })
    .sort(
      (a, b) => Number(a.player.you) - Number(b.player.you) || a.at.y - b.at.y,
    );
  for (const { player, at, walking, left } of drawn) {
    context.save();
    if (player.done) context.globalAlpha = 0.55;
    const id = `avatar-${player.avatar}-${walking ? "walk" : "idle"}`;
    if (art.image(id)) {
      if (left) {
        context.translate(at.x, 0);
        context.scale(-1, 1);
        context.translate(-at.x, 0);
      }
      art.draw(context, id, at.x, at.y, avatar, Math.floor(frame.time * 6));
    } else {
      // Placeholder: a disc in the player's colour with their initial, bobbing while they walk.
      const r = avatar * 0.36,
        bob = walking ? Math.abs(Math.sin(frame.time * 10)) * r * 0.25 : 0;
      context.fillStyle = "#0b1d3a40";
      context.beginPath();
      context.ellipse(at.x, at.y, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(at.x, at.y - r - bob, r, 0, Math.PI * 2);
      context.fillStyle = player.color;
      context.fill();
      context.lineWidth = player.you ? 3.5 : 2;
      context.strokeStyle = player.you ? "#ffffff" : "#16213e";
      context.stroke();
      context.fillStyle = "#16213e";
      context.font = `800 ${r}px system-ui, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        (player.name[0] ?? "?").toUpperCase(),
        at.x,
        at.y - r - bob + 1,
      );
    }
    context.restore();
    if (player.you) {
      // A small marker over your own head.
      const y = at.y - avatar * 0.95;
      context.beginPath();
      context.moveTo(at.x - 6, y - 8);
      context.lineTo(at.x + 6, y - 8);
      context.lineTo(at.x, y);
      context.closePath();
      context.fillStyle = shade(player.color, -0.1);
      context.fill();
      context.strokeStyle = "#16213e";
      context.lineWidth = 1.5;
      context.stroke();
    }
  }
}
