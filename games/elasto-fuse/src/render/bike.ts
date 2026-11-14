import type { BikeView, WheelView } from "../engine/view.js";
import { HEAD_RADIUS, WHEEL_RADIUS } from "../engine/view-kit.js";
import { GOLD, GRAPHITE, GRAPHITE_LIGHT, WHITE, hexA } from "./palette.js";

/**
 * One bike and its rider, drawn in world units with y up (the scene has already flipped the canvas). The wheels, the
 * frame, the head and the body point come from the view; the suspension struts and the rider's limbs are worked out
 * here, the limbs by two-bone IK from the hips to the footpeg and from the shoulder to the handlebar. With sprites
 * the generated art is laid on the same joints; without them everything is drawn as neon line art.
 */
export interface BikeSprites {
  wheel?: CanvasImageSource;
  frame?: CanvasImageSource;
  torso?: CanvasImageSource;
  head?: CanvasImageSource;
  thigh?: CanvasImageSource;
  shin?: CanvasImageSource;
  upperArm?: CanvasImageSource;
  forearm?: CanvasImageSource;
}
export interface BikeLook {
  /** The rider's seat colour, `#rrggbb`. */
  color: string;
  sprites?: BikeSprites;
}

/** The art's scale and pivots (`art-brief.md`): 240 px a world unit, limbs between joints at x 24 and 136. */
const ART_PX = 240,
  FRAME_W = 512,
  FRAME_H = 320,
  WHEEL_PX = 256,
  HEAD_PX = 160,
  LIMB = { w: 160, h: 64, a: 24, b: 136 },
  TORSO = { w: 192, h: 96, a: 24, b: 168 };

/** Where things sit on the frame, facing right, in world units from its centre. */
export const PEG = { x: 0.02, y: -0.3 },
  GRIP = { x: 0.45, y: 0.28 },
  SWINGARM = { x: -0.12, y: -0.26 },
  FORK = { x: 0.5, y: 0.2 },
  /** The hips from the rider's sprung body point: back and down onto the seat. */
  HIP = { x: -0.2, y: -0.2 };
export const THIGH = 0.37,
  SHIN = 0.37,
  UPPER_ARM = 0.4,
  FOREARM = 0.4;

export interface Vec {
  x: number;
  y: number;
}

/**
 * The middle joint of a two-bone limb from `a` to `b` with bones `l1` and `l2`: on the left of the line from `a` to
 * `b` for `bend` 1, on its right for −1. A target out of reach leaves the limb straight towards it; one too close
 * folds it as far as the bones allow.
 */
export function twoBone(
  a: Vec,
  b: Vec,
  l1: number,
  l2: number,
  bend: 1 | -1,
): Vec {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = Math.hypot(dx, dy);
  const ux = d > 1e-9 ? dx / d : 1,
    uy = d > 1e-9 ? dy / d : 0;
  const reach = Math.max(Math.abs(l1 - l2), Math.min(l1 + l2, d));
  const along =
    reach > 1e-9 ? (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach) : 0;
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along)) * bend;
  return { x: a.x + ux * along - uy * off, y: a.y + uy * along + ux * off };
}

/** The rider's joints for a bike, in world units. */
export interface Pose {
  hip: Vec;
  neck: Vec;
  shoulder: Vec;
  head: Vec;
  knee: Vec;
  foot: Vec;
  elbow: Vec;
  hand: Vec;
  /** The swingarm's and the fork's ends on the frame, and the hubs they reach: rear first. */
  struts: readonly [readonly [Vec, Vec], readonly [Vec, Vec]];
}

export function poseOf(bike: BikeView): Pose {
  const dir = bike.flipped ? -1 : 1,
    cos = Math.cos(bike.rot),
    sin = Math.sin(bike.rot);
  /** A point of the frame, given facing right. */
  const at = (point: Vec, from: Vec = bike): Vec => ({
    x: from.x + cos * point.x * dir - sin * point.y,
    y: from.y + sin * point.x * dir + cos * point.y,
  });
  const hip = at(HIP, bike.body),
    head = { x: bike.head.x, y: bike.head.y };
  const spine = Math.hypot(hip.x - head.x, hip.y - head.y) || 1;
  const sx = (hip.x - head.x) / spine,
    sy = (hip.y - head.y) / spine;
  const neck = {
    x: head.x + sx * HEAD_RADIUS * 0.9,
    y: head.y + sy * HEAD_RADIUS * 0.9,
  };
  const shoulder = { x: neck.x + sx * 0.1, y: neck.y + sy * 0.1 };
  const foot = at(PEG),
    hand = at(GRIP);
  const rear = bike.flipped ? bike.right : bike.left,
    front = bike.flipped ? bike.left : bike.right;
  return {
    hip,
    neck,
    shoulder,
    head,
    foot,
    hand,
    // The knee points forward and the elbow hangs down, whichever way the bike faces.
    knee: twoBone(hip, foot, THIGH, SHIN, dir === 1 ? 1 : -1),
    elbow: twoBone(shoulder, hand, UPPER_ARM, FOREARM, dir === 1 ? -1 : 1),
    struts: [
      [at(SWINGARM), { x: rear.x, y: rear.y }],
      [at(FORK), { x: front.x, y: front.y }],
    ],
  };
}

type G = CanvasRenderingContext2D;

/** Strokes the current path as a neon tube: a wide soft halo under a bright core. */
function neon(g: G, color: string, width: number, halo = 0.24): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = hexA(color, halo);
  g.lineWidth = width * 3.4;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}
const line = (g: G, a: Vec, b: Vec): void => {
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
};
function bone(g: G, a: Vec, b: Vec, width: number, color: string): void {
  line(g, a, b);
  g.lineCap = "round";
  g.strokeStyle = color;
  g.lineWidth = width;
  g.stroke();
}

/** A sprite laid between two joints: its pivots `a` and `b` px along its middle line land on `from` and `to`. */
function segment(
  g: G,
  image: CanvasImageSource,
  from: Vec,
  to: Vec,
  shape: { w: number; h: number; a: number; b: number },
  dir: number,
): void {
  const length = Math.hypot(to.x - from.x, to.y - from.y),
    k = Math.max(length, 0.05) / (shape.b - shape.a);
  g.save();
  g.translate(from.x, from.y);
  g.rotate(Math.atan2(to.y - from.y, to.x - from.x));
  // The image's y runs down and the world's up; a bike facing left is the same picture mirrored.
  g.scale(k, -k * dir);
  g.drawImage(image, -shape.a, -shape.h / 2, shape.w, shape.h);
  g.restore();
}

function drawWheel(g: G, wheel: WheelView, look: BikeLook): void {
  g.save();
  g.translate(wheel.x, wheel.y);
  g.rotate(wheel.rot);
  const R = WHEEL_RADIUS;
  if (look.sprites?.wheel) {
    const k = (R * 2) / WHEEL_PX;
    g.scale(k, -k);
    g.drawImage(look.sprites.wheel, -WHEEL_PX / 2, -WHEEL_PX / 2);
    g.restore();
    return;
  }
  // The tyre: a dark ring out to the radius that collides, with knobs that show it turning.
  g.beginPath();
  g.arc(0, 0, R - 0.055, 0, Math.PI * 2);
  g.strokeStyle = "#0a0f24";
  g.lineWidth = 0.11;
  g.stroke();
  g.beginPath();
  g.arc(0, 0, R - 0.02, 0, Math.PI * 2);
  g.setLineDash([0.07, 0.087]);
  g.lineCap = "butt";
  g.strokeStyle = GRAPHITE_LIGHT;
  g.lineWidth = 0.04;
  g.stroke();
  g.setLineDash([]);
  // Spokes: one bright, so the eye can follow the rotation.
  const rim = R - 0.125;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    g.beginPath();
    g.moveTo(Math.cos(angle) * 0.05, Math.sin(angle) * 0.05);
    g.lineTo(Math.cos(angle) * rim, Math.sin(angle) * rim);
    g.lineCap = "round";
    g.strokeStyle = i === 0 ? WHITE : hexA(look.color, i % 2 ? 0.45 : 0.7);
    g.lineWidth = i === 0 ? 0.035 : 0.018;
    g.stroke();
  }
  g.beginPath();
  g.arc(0, 0, rim, 0, Math.PI * 2);
  neon(g, look.color, 0.035, 0.3);
  g.beginPath();
  g.arc(0, 0, 0.06, 0, Math.PI * 2);
  g.fillStyle = look.color;
  g.fill();
  g.beginPath();
  g.arc(rim, 0, 0.03, 0, Math.PI * 2);
  g.fillStyle = WHITE;
  g.fill();
  g.restore();
}

/** The frame as neon line art, in its own coordinates facing right. */
function drawFrame(g: G, color: string): void {
  const poly = (points: readonly (readonly [number, number])[]) => {
    g.beginPath();
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  // Exhaust, behind everything.
  g.beginPath();
  g.moveTo(0.12, -0.27);
  g.lineTo(-0.28, -0.2);
  g.lineTo(-0.6, 0.0);
  neon(g, GOLD, 0.04, 0.2);
  // Engine block.
  poly([
    [-0.2, -0.34],
    [0.22, -0.34],
    [0.34, -0.1],
    [0.12, 0.04],
    [-0.22, 0.02],
    [-0.3, -0.16],
  ]);
  g.fillStyle = GRAPHITE;
  g.fill();
  g.lineJoin = "round";
  g.strokeStyle = GRAPHITE_LIGHT;
  g.lineWidth = 0.03;
  g.stroke();
  g.beginPath();
  g.arc(0.02, -0.16, 0.1, 0, Math.PI * 2);
  g.strokeStyle = hexA(color, 0.7);
  g.lineWidth = 0.022;
  g.stroke();
  // Backbone: tail to steering head.
  g.beginPath();
  g.moveTo(-0.72, 0.26);
  g.lineTo(-0.48, 0.1);
  g.lineTo(-0.02, 0.04);
  g.lineTo(0.5, 0.2);
  neon(g, color, 0.035);
  // Tank.
  g.beginPath();
  g.moveTo(-0.04, 0.05);
  g.quadraticCurveTo(0.12, 0.32, 0.44, 0.2);
  g.lineTo(0.36, 0.05);
  g.closePath();
  g.fillStyle = GRAPHITE;
  g.fill();
  g.fillStyle = hexA(color, 0.35);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 0.025;
  g.stroke();
  // Seat.
  g.beginPath();
  g.moveTo(-0.52, 0.15);
  g.lineTo(-0.06, 0.11);
  g.lineCap = "round";
  g.strokeStyle = "#39456f";
  g.lineWidth = 0.09;
  g.stroke();
  // Handlebar and headlight.
  g.beginPath();
  g.moveTo(0.5, 0.2);
  g.lineTo(GRIP.x, GRIP.y);
  g.strokeStyle = "#c8d4ff";
  g.lineWidth = 0.035;
  g.stroke();
  poly([
    [0.52, 0.12],
    [0.62, 0.16],
    [0.6, 0.3],
    [0.5, 0.28],
  ]);
  g.fillStyle = GRAPHITE;
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 0.02;
  g.stroke();
  g.beginPath();
  g.arc(0.61, 0.22, 0.035, 0, Math.PI * 2);
  g.fillStyle = GOLD;
  g.fill();
  // Footpeg.
  g.beginPath();
  g.moveTo(PEG.x - 0.07, PEG.y);
  g.lineTo(PEG.x + 0.07, PEG.y);
  g.strokeStyle = "#c8d4ff";
  g.lineWidth = 0.03;
  g.stroke();
}

const SUIT = "#34406c",
  SUIT_DARK = "#232c50";

/** Draws `bike` and its rider. The caller sets the opacity (a ghost is the same bike, translucent). */
export function drawBike(g: G, bike: BikeView, look: BikeLook): void {
  const pose = poseOf(bike),
    dir = bike.flipped ? -1 : 1,
    sprites = look.sprites ?? {};
  // Suspension: swingarm and fork, from the frame to wherever the springs have let the hubs go.
  for (const [from, to] of pose.struts) {
    bone(g, from, to, 0.075, GRAPHITE_LIGHT);
    line(g, from, to);
    neon(g, look.color, 0.022, 0.18);
  }
  drawWheel(g, bike.left, look);
  drawWheel(g, bike.right, look);
  g.save();
  g.translate(bike.x, bike.y);
  g.rotate(bike.rot);
  g.scale(dir, 1);
  if (sprites.frame) {
    g.scale(1 / ART_PX, -1 / ART_PX);
    g.drawImage(sprites.frame, -FRAME_W / 2, -FRAME_H / 2);
  } else drawFrame(g, look.color);
  g.restore();

  // The rider: leg, torso, arm, head.
  if (sprites.thigh) segment(g, sprites.thigh, pose.hip, pose.knee, LIMB, dir);
  else bone(g, pose.hip, pose.knee, 0.15, SUIT_DARK);
  if (sprites.shin) segment(g, sprites.shin, pose.knee, pose.foot, LIMB, dir);
  else {
    bone(g, pose.knee, pose.foot, 0.12, SUIT_DARK);
    // The boot, along the peg.
    const toe = {
      x: pose.foot.x + Math.cos(bike.rot) * 0.13 * dir,
      y: pose.foot.y + Math.sin(bike.rot) * 0.13 * dir,
    };
    bone(g, pose.foot, toe, 0.1, "#0c1128");
    line(g, pose.foot, toe);
    neon(g, look.color, 0.02, 0.2);
  }
  if (!sprites.thigh) {
    g.beginPath();
    g.moveTo(pose.hip.x, pose.hip.y);
    g.lineTo(pose.knee.x, pose.knee.y);
    if (!sprites.shin) g.lineTo(pose.foot.x, pose.foot.y);
    neon(g, look.color, 0.022, 0.16);
  }
  if (sprites.torso) segment(g, sprites.torso, pose.hip, pose.neck, TORSO, dir);
  else {
    bone(g, pose.hip, pose.neck, 0.24, SUIT);
    // Piping down the back.
    const nx = -(pose.neck.y - pose.hip.y),
      ny = pose.neck.x - pose.hip.x,
      n = Math.hypot(nx, ny) || 1,
      off = 0.085 * dir;
    line(
      g,
      { x: pose.hip.x + (nx / n) * off, y: pose.hip.y + (ny / n) * off },
      { x: pose.neck.x + (nx / n) * off, y: pose.neck.y + (ny / n) * off },
    );
    neon(g, look.color, 0.028, 0.2);
  }
  if (sprites.upperArm)
    segment(g, sprites.upperArm, pose.shoulder, pose.elbow, LIMB, dir);
  else bone(g, pose.shoulder, pose.elbow, 0.11, SUIT_DARK);
  if (sprites.forearm)
    segment(g, sprites.forearm, pose.elbow, pose.hand, LIMB, dir);
  else {
    bone(g, pose.elbow, pose.hand, 0.095, SUIT_DARK);
    g.beginPath();
    g.arc(pose.hand.x, pose.hand.y, 0.06, 0, Math.PI * 2);
    g.fillStyle = "#0c1128";
    g.fill();
  }
  if (!sprites.upperArm) {
    g.beginPath();
    g.moveTo(pose.shoulder.x, pose.shoulder.y);
    g.lineTo(pose.elbow.x, pose.elbow.y);
    if (!sprites.forearm) g.lineTo(pose.hand.x, pose.hand.y);
    neon(g, look.color, 0.02, 0.16);
  }
  // The helmet looks the way the bike faces and tilts with the frame.
  g.save();
  g.translate(pose.head.x, pose.head.y);
  g.rotate(bike.rot);
  g.scale(dir, 1);
  if (sprites.head) {
    const k = (HEAD_RADIUS * 2.1) / HEAD_PX;
    g.scale(k, -k);
    g.drawImage(sprites.head, -HEAD_PX / 2, -HEAD_PX / 2);
  } else {
    g.beginPath();
    g.arc(0, 0, HEAD_RADIUS, 0, Math.PI * 2);
    g.fillStyle = "#0d1430";
    g.fill();
    neon(g, look.color, 0.035, 0.28);
    // The visor: a bright band across the front.
    g.beginPath();
    g.moveTo(0.02, 0.07);
    g.arc(0, 0, HEAD_RADIUS - 0.045, 0.42, -0.5, true);
    g.lineTo(0.02, -0.07);
    g.closePath();
    g.fillStyle = hexA(look.color, 0.9);
    g.fill();
    g.beginPath();
    g.arc(0, 0, HEAD_RADIUS - 0.085, 0.3, -0.1, true);
    g.strokeStyle = hexA(WHITE, 0.85);
    g.lineWidth = 0.025;
    g.lineCap = "round";
    g.stroke();
  }
  g.restore();
}
