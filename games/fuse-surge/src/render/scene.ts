import type { RiderView, SurgeView, WorldView } from "../engine/view.js";
import {
  DUCK_H,
  GATE_X,
  HIGH,
  HIGH_BOTTOM,
  LOW_TOP,
  STAND_H,
  STEPS_PER_SECOND,
  footholds,
  secondsLeft,
} from "../engine/view-kit.js";
import { createCueWatch, type Cue } from "./cues.js";
import {
  DANGER,
  DECK,
  DECK_FACE,
  DECK_LINE,
  GATE,
  INK,
  NIGHT,
  PIT,
  PIT_DEEP,
  PIXEL_FONT,
  SURGE_CORE,
  SURGE_HIGH,
  SURGE_LOW,
  TEXT,
  TEXT_DIM,
  WHITE,
  hexA,
  laneColor,
  laneDeep,
  laneLight,
} from "./palette.js";

/**
 * Draws one frame of a Fuse Surge match on a 2D canvas: the deck seen from above and to one side, a lane for each
 * rider running back to front, the pit beyond the deck's edge on the left, the surges sweeping in from the right,
 * the effects and the scoreboard, on a 960 × 540 picture scaled to fit the canvas and centred in it.
 *
 * It keeps no loop, timer or physics of its own: the app calls `draw` from its frame callback with the view to show
 * and the wall clock, and everything cosmetic here (poses, particles, banners, the shake) moves only as far as that
 * clock says. Nothing here feeds back into the match.
 */
export interface SceneCanvas {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
}
export interface SceneOptions {
  /** Device pixels per CSS pixel; the window's unless given. */
  pixelRatio?: () => number;
  /** Where the effects' scatter comes from; `Math.random` unless given. */
  random?: () => number;
  /** No shake and calmer banners. */
  reducedMotion?: boolean;
}
export interface Scene {
  resize(): void;
  /**
   * Draws `view` at wall time `nowMs` and returns what happened since the last frame, for the sound. `local` is this
   * device's rider slot, or −1 for a watcher or a shared screen; `names` label the riders by slot.
   */
  draw(
    view: WorldView,
    nowMs: number,
    local: number,
    names?: readonly string[],
  ): readonly Cue[];
  destroy(): void;
}

const W = 960,
  H = 540,
  MAX_RATIO = 2;
/** The deck's front edge (nearest the viewer) and how far up the picture its back edge is. */
const FRONT_Y = 418,
  DEPTH = 196,
  /** The back of the deck sits this much to the right per pixel of depth. */
  SKEW = 0.44,
  /** The deck's edge over the pit at the front, and picture pixels per deck pixel along it and up from it. */
  EDGE_SX = 176,
  X_SCALE = 0.78,
  Y_SCALE = 0.8,
  FACE = 22;
/** One sprite pixel. */
const PX = 3;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  ms: number;
  size: number;
  color: string;
}
interface Banner {
  text: string;
  sub: string;
  color: string;
  at: number;
  ms: number;
}
/** What the renderer remembers of a rider between frames: all of it cosmetic. */
interface Puppet {
  squash: number;
  flash: number;
  cheer: number;
  spin: number;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

export function createScene(
  canvas: SceneCanvas,
  options: SceneOptions = {},
): Scene {
  const g = canvas.getContext("2d");
  const random = options.random ?? Math.random;
  const ratio =
    options.pixelRatio ??
    (() => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const calm = options.reducedMotion === true;
  let box = { w: -1, h: -1, r: -1 };
  const watch = createCueWatch();
  let lastNow = -1;
  let destroyed = false;
  let particles: Particle[] = [];
  let banner: Banner | undefined;
  let shake = 0;
  /** How far the rails' lights have run, deck px: they move with the surges, so the speed can be seen. */
  let flow = 0;
  const puppets: Puppet[] = [];
  const puppet = (slot: number): Puppet =>
    (puppets[slot] ??= { squash: 0, flash: 0, cheer: 0, spin: 0 });

  const resize = () => {
    const r = Math.min(MAX_RATIO, Math.max(1, ratio())),
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    // Setting a canvas's size clears it, so a size that has not changed is left alone.
    if (box.w === w && box.h === h && box.r === r) return;
    box = { w, h, r };
    canvas.width = Math.max(1, Math.round(w * r));
    canvas.height = Math.max(1, Math.round(h * r));
  };

  // ---- where things are ----
  /** A lane's line on the picture: lane 0 is at the back. */
  const laneY = (lane: number, lanes: number) =>
    FRONT_Y - DEPTH + (DEPTH * (lane + 0.5)) / lanes;
  /** The picture x of deck position `x` on the depth line `y`. */
  const sx = (x: number, y: number) =>
    EDGE_SX + x * X_SCALE + (FRONT_Y - y) * SKEW;
  const BACK_Y = FRONT_Y - DEPTH;

  const burst = (
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    up = 0,
    gravity = 700,
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2,
        v = speed * (0.35 + random() * 0.65);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - up,
        gravity,
        life: 0,
        ms: 260 + random() * 380,
        size: random() < 0.5 ? PX : PX * 2,
        color,
      });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  };

  const say = (
    text: string,
    sub: string,
    color: string,
    now: number,
    ms: number,
  ) => {
    banner = { text, sub, color, at: now, ms };
  };

  // ---- cues: what just happened, as effects ----
  const react = (
    cues: readonly Cue[],
    view: WorldView,
    now: number,
    names: readonly string[],
  ) => {
    const lanes = view.riders.length;
    const at = (slot: number) => {
      const rider = view.riders[slot]!,
        y = laneY(slot, lanes);
      return { x: sx(rider.x, y), y: y - Math.max(0, rider.y) * Y_SCALE };
    };
    const label = (slot: number) =>
      (names[slot] || `RIDER ${slot + 1}`).toUpperCase();
    for (const cue of cues)
      switch (cue.kind) {
        case "land": {
          puppet(cue.slot).squash = 1;
          const p = at(cue.slot);
          burst(p.x, p.y, 4, hexA(TEXT, 0.7), 60, 20, 300);
          break;
        }
        case "jump":
          puppet(cue.slot).squash = -0.8;
          break;
        case "hit": {
          const p = at(cue.slot);
          puppet(cue.slot).flash = 1;
          burst(p.x, p.y - 30, 16, SURGE_CORE, 260, 80);
          burst(p.x, p.y - 30, 10, laneColor(cue.slot), 200, 60);
          if (!calm) shake = Math.max(shake, cue.out ? 12 : 7);
          break;
        }
        case "recover": {
          const p = at(cue.slot);
          burst(p.x, p.y - 20, 12, GATE, 140, 120, 200);
          break;
        }
        case "dodge":
          if (cue.streak > 0) puppet(cue.slot).cheer = 0.4;
          break;
        case "count":
          if (cue.seconds > 0)
            say(String(cue.seconds), `ROUND ${view.round}`, TEXT, now, 900);
          break;
        case "go":
          say("GO!", "", GATE, now, 700);
          break;
        case "round": {
          for (const slot of cue.winners) puppet(slot).cheer = 1;
          const who = cue.winners.map(label);
          if (cue.reason === "time")
            say("TIME!", `${who.join(" · ")} DRAW THE ROUND`, TEXT, now, 2600);
          else if (cue.reason === "wipe")
            say(
              "DOUBLE KO",
              `${who.join(" · ")} DRAW THE ROUND`,
              DANGER,
              now,
              2600,
            );
          else if (cue.winners.length === 1)
            say(
              who[0]!,
              "LAST ONE STANDING",
              laneColor(cue.winners[0]!),
              now,
              2600,
            );
          break;
        }
        case "over":
          for (const slot of cue.winners) {
            puppet(slot).cheer = 1;
            const p = at(slot);
            burst(p.x, p.y - 60, 40, laneColor(slot), 320, 220, 500);
            burst(p.x, p.y - 60, 20, WHITE, 260, 200, 500);
          }
          break;
        default:
          break;
      }
  };

  // ---- the backdrop: the chamber, the pit and the deck ----
  const backdrop = (c: CanvasRenderingContext2D, now: number) => {
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, INK);
    sky.addColorStop(0.55, NIGHT);
    sky.addColorStop(1, "#12082e");
    c.fillStyle = sky;
    c.fillRect(-40, -40, W + 80, H + 80);
    // Far pillars of the chamber, with a strip light each.
    for (let i = 0; i < 7; i++) {
      const x = 60 + i * 150;
      c.fillStyle = hexA("#0f2257", 0.55);
      c.fillRect(x, 40, 34, BACK_Y - 40);
      c.fillStyle = hexA(
        i % 2 ? PIT : "#16e7ff",
        0.16 + 0.05 * Math.sin(now / 700 + i),
      );
      c.fillRect(x + 14, 52, 6, BACK_Y - 70);
    }
    // The pit's glow rising from below, strongest on the left where the deck ends.
    const glow = c.createRadialGradient(120, H + 40, 20, 120, H + 40, 520);
    glow.addColorStop(0, hexA(PIT, 0.75));
    glow.addColorStop(0.5, hexA(PIT_DEEP, 0.55));
    glow.addColorStop(1, hexA(PIT_DEEP, 0));
    c.fillStyle = glow;
    c.fillRect(-40, 0, W + 80, H + 40);
    // Plasma in the pit: chunky bands that slide and pulse.
    for (let row = 0; row < 9; row++) {
      const y = FRONT_Y + FACE + 10 + row * 12;
      for (let col = 0; col < 34; col++) {
        const wave =
          Math.sin(col * 0.6 + now / (420 + row * 35) + row * 1.7) +
          Math.sin(col * 0.23 - now / 900 + row);
        if (wave < 0.2) continue;
        c.fillStyle = hexA(
          row % 2 ? PIT : "#ff8ad1",
          clamp01(0.1 + wave * 0.16 + row * 0.03),
        );
        c.fillRect(-20 + col * 30 + ((row * 13) % 30), y, 24, 6);
      }
    }
  };

  const deck = (c: CanvasRenderingContext2D, view: WorldView, now: number) => {
    const lanes = view.riders.length;
    const far = W + 120;
    // The side face under the front edge, and the end face over the pit.
    c.fillStyle = DECK_FACE;
    c.beginPath();
    c.moveTo(sx(0, FRONT_Y), FRONT_Y);
    c.lineTo(far, FRONT_Y);
    c.lineTo(far, FRONT_Y + FACE);
    c.lineTo(sx(0, FRONT_Y), FRONT_Y + FACE);
    c.closePath();
    c.fill();
    c.fillStyle = "#050c26";
    c.beginPath();
    c.moveTo(sx(0, FRONT_Y), FRONT_Y);
    c.lineTo(sx(0, BACK_Y), BACK_Y);
    c.lineTo(sx(0, BACK_Y), BACK_Y + FACE);
    c.lineTo(sx(0, FRONT_Y), FRONT_Y + FACE);
    c.closePath();
    c.fill();
    // The top.
    const top = c.createLinearGradient(0, BACK_Y, 0, FRONT_Y);
    top.addColorStop(0, "#0a1538");
    top.addColorStop(1, DECK);
    c.fillStyle = top;
    c.beginPath();
    c.moveTo(sx(0, BACK_Y), BACK_Y);
    c.lineTo(far, BACK_Y);
    c.lineTo(far, FRONT_Y);
    c.lineTo(sx(0, FRONT_Y), FRONT_Y);
    c.closePath();
    c.fill();
    // Lane lines, back to front.
    c.lineWidth = 2;
    for (let lane = 0; lane <= lanes; lane++) {
      const y = BACK_Y + (DEPTH * lane) / lanes;
      c.strokeStyle = hexA(DECK_LINE, lane === 0 || lane === lanes ? 0.9 : 0.4);
      c.beginPath();
      c.moveTo(sx(0, y), y);
      c.lineTo(far, y);
      c.stroke();
    }
    // Each lane wears its rider's colour along the deck.
    for (let lane = 0; lane < lanes; lane++) {
      const y0 = BACK_Y + (DEPTH * lane) / lanes,
        y1 = BACK_Y + (DEPTH * (lane + 1)) / lanes;
      c.fillStyle = hexA(laneColor(lane), 0.05);
      c.beginPath();
      c.moveTo(sx(0, y0), y0);
      c.lineTo(far, y0);
      c.lineTo(far, y1);
      c.lineTo(sx(0, y1), y1);
      c.closePath();
      c.fill();
    }
    const cross = (
      x: number,
      color: string,
      width: number,
      dash: number[] = [],
    ) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.setLineDash(dash);
      c.beginPath();
      c.moveTo(sx(x, BACK_Y), BACK_Y);
      c.lineTo(sx(x, FRONT_Y), FRONT_Y);
      c.stroke();
      c.setLineDash([]);
    };
    // Footholds: the start line, then one for every hit a rider can take, redder toward the edge.
    const steps = footholds(view.maxHits);
    steps.forEach((x, index) => {
      const danger = steps.length > 1 ? index / (steps.length - 1) : 0;
      cross(
        x,
        index === 0
          ? hexA(TEXT, 0.5)
          : hexA(danger > 0.99 ? DANGER : "#ffb347", 0.35 + danger * 0.45),
        index === 0 ? 3 : 2,
        index === 0 ? [] : [6, 6],
      );
    });
    // The flip gate.
    const flipping = view.surges.some((surge) => surge.flips);
    cross(
      GATE_X,
      hexA(GATE, flipping ? 0.55 + 0.35 * Math.sin(now / 70) : 0.22),
      flipping ? 4 : 2,
      [3, 9],
    );
    // The edge over the pit: a hazard strip that pulses.
    cross(0, hexA(PIT, 0.7 + 0.3 * Math.sin(now / 240)), 5);
    cross(10, hexA(DANGER, 0.5), 2, [8, 6]);
    // Rail lights along the front and back edges, running with the surges.
    for (const y of [BACK_Y, FRONT_Y])
      for (let i = -1; i < 14; i++) {
        const x = ((((i * 90 - flow) % 1260) + 1260) % 1260) - 60;
        if (x < 0) continue;
        c.fillStyle = hexA("#16e7ff", 0.5);
        c.fillRect(sx(x, y) - 7, y - 2, 14, 4);
      }
  };

  // ---- a surge: a wall of charge across every lane ----
  const band = (kind: number): [number, number] =>
    kind === HIGH
      ? [HIGH_BOTTOM * Y_SCALE, HIGH_BOTTOM * Y_SCALE + 30]
      : [3, LOW_TOP * Y_SCALE - 2];
  const surgeColor = (surge: SurgeView, now: number) => {
    const own = surge.kind === HIGH ? SURGE_HIGH : SURGE_LOW;
    if (!surge.flips) return own;
    // About to flip: it flickers toward the colour it will be.
    return Math.floor(now / 90) % 2
      ? own
      : surge.kind === HIGH
        ? SURGE_LOW
        : SURGE_HIGH;
  };
  /** The part of a surge crossing one lane, from the lane's back line to its front line. */
  const surgeSlice = (
    c: CanvasRenderingContext2D,
    surge: SurgeView,
    y0: number,
    y1: number,
    now: number,
    dim: number,
  ) => {
    const [low, high] = band(surge.kind);
    const color = surgeColor(surge, now);
    const blocks = 3;
    for (let i = 0; i < blocks; i++) {
      const a = y0 + ((y1 - y0) * i) / blocks,
        b = y0 + ((y1 - y0) * (i + 1)) / blocks;
      const flicker =
        0.55 + 0.45 * Math.sin(now / 45 + surge.id * 7.3 + a * 0.31 + i * 2.1);
      c.fillStyle = hexA(
        color,
        (surge.kind === HIGH ? 0.5 : 0.35 + 0.3 * flicker) * dim,
      );
      c.beginPath();
      c.moveTo(sx(surge.x, a), a - high);
      c.lineTo(sx(surge.x, b), b - high);
      c.lineTo(sx(surge.x, b), b - low);
      c.lineTo(sx(surge.x, a), a - low);
      c.closePath();
      c.fill();
      // The hot core, a little ragged.
      const mid = (low + high) / 2 + (flicker - 0.5) * 6;
      c.fillStyle = hexA(SURGE_CORE, (0.6 + 0.4 * flicker) * dim);
      c.fillRect(sx(surge.x, (a + b) / 2) - 3, (a + b) / 2 - mid - 3, 6, 6);
    }
    c.strokeStyle = hexA(color, 0.95 * dim);
    c.lineWidth = 3;
    for (const height of [low, high]) {
      c.beginPath();
      c.moveTo(sx(surge.x, y0), y0 - height);
      c.lineTo(sx(surge.x, y1), y1 - height);
      c.stroke();
    }
  };
  /** What goes with a surge once: its glow on the deck, its carriages on the rails and the arrow that says what to do. */
  const surgeTrim = (
    c: CanvasRenderingContext2D,
    surge: SurgeView,
    now: number,
    dim: number,
  ) => {
    const color = surgeColor(surge, now);
    const floating = surge.kind === HIGH;
    // A low surge burns along the deck; a high one only throws a thin shadow there, so the gap under it reads.
    c.strokeStyle = hexA(floating ? INK : color, (floating ? 0.45 : 0.3) * dim);
    c.lineWidth = floating ? 5 : 14;
    c.beginPath();
    c.moveTo(sx(surge.x, BACK_Y), BACK_Y);
    c.lineTo(sx(surge.x, FRONT_Y), FRONT_Y);
    c.stroke();
    const [low, high] = band(surge.kind);
    for (const y of [BACK_Y, FRONT_Y]) {
      const x = sx(surge.x, y);
      // The carriage on each rail: a block at the surge's height, on a thin mast when it rides high.
      c.fillStyle = hexA(color, 0.55 * dim);
      if (floating) c.fillRect(x - 1, y - low, 3, low);
      c.fillStyle = hexA(color, dim);
      c.fillRect(x - 5, y - high - 4, 10, high - low + 6);
      c.fillStyle = hexA(SURGE_CORE, dim);
      c.fillRect(x - 2, y - high - 4, 4, 4);
    }
    c.fillStyle = hexA(color, dim);
    // An arrow under the front carriage: up for a surge to jump, down for one to duck.
    const ax = sx(surge.x, FRONT_Y),
      ay = FRONT_Y + FACE + 12,
      up = surge.kind !== HIGH;
    c.beginPath();
    c.moveTo(ax, ay + (up ? -8 : 8));
    c.lineTo(ax + 9, ay + (up ? 6 : -6));
    c.lineTo(ax - 9, ay + (up ? 6 : -6));
    c.closePath();
    c.fill();
    if (surge.flips) {
      c.font = `8px ${PIXEL_FONT}`;
      c.textAlign = "center";
      c.fillStyle = hexA(GATE, dim);
      c.fillText("FLIP", ax, ay + 26);
    }
  };

  // ---- a rider: a little pixel figure with a fuse on its helmet ----
  const figure = (
    c: CanvasRenderingContext2D,
    slot: number,
    pose: {
      legs: number;
      torso: number;
      arms: "down" | "up" | "fore" | "flail";
      step: number;
      white: number;
    },
    now: number,
  ) => {
    const tone = (color: string) =>
      pose.white > 0 && Math.floor(now / 50) % 2 ? WHITE : color;
    const main = tone(laneColor(slot)),
      light = tone(laneLight(slot)),
      deep = tone(laneDeep(slot));
    const r = (
      col: number,
      row: number,
      w: number,
      h: number,
      fill: string,
    ) => {
      c.fillStyle = fill;
      c.fillRect(col * PX, -(row + h) * PX, w * PX, h * PX);
    };
    const legs = pose.legs,
      a = pose.step > 0 ? 1 : 0,
      b = pose.step < 0 ? 1 : 0;
    // Legs and boots; a step lifts one foot.
    r(-3, a, 2, legs - a, deep);
    r(1, b, 2, legs - b, deep);
    r(-3, a, 3, 1, light);
    r(1, b, 3, 1, light);
    const waist = legs;
    r(-3, waist, 6, pose.torso, main);
    r(-3, waist, 6, 1, deep);
    if (pose.torso >= 4) r(0, waist + pose.torso - 3, 2, 2, light);
    const shoulder = waist + pose.torso;
    if (pose.arms === "down") {
      r(-5, shoulder - 5, 2, 5, deep);
      r(3, shoulder - 5, 2, 5, deep);
    } else if (pose.arms === "up") {
      r(-5, shoulder - 1, 2, 6, deep);
      r(3, shoulder - 1, 2, 6, deep);
      r(-5, shoulder + 4, 2, 1, light);
      r(3, shoulder + 4, 2, 1, light);
    } else if (pose.arms === "fore") {
      r(3, shoulder - 2, 4, 2, deep);
      r(-5, shoulder - 3, 2, 3, deep);
    } else {
      const wave = Math.floor(now / 80) % 2;
      r(-6, shoulder - (wave ? 1 : 4), 3, 2, deep);
      r(3, shoulder - (wave ? 4 : 1), 3, 2, deep);
    }
    // The helmet, its visor facing the surges, and the fuse on top.
    r(-4, shoulder, 8, 6, main);
    r(-3, shoulder + 6, 6, 1, main);
    r(-4, shoulder, 8, 1, deep);
    r(0, shoulder + 2, 4, 3, INK);
    r(1, shoulder + 3, 3, 1, light);
    r(-2, shoulder + 7, 1, 2, light);
    r(
      -2,
      shoulder + 9,
      1,
      1,
      Math.floor(now / 120 + slot) % 2 ? "#ffe46b" : WHITE,
    );
  };

  const rider = (
    c: CanvasRenderingContext2D,
    view: WorldView,
    each: RiderView,
    now: number,
    dtMs: number,
    local: boolean,
    name: string,
  ) => {
    const lanes = view.riders.length,
      y = laneY(each.slot, lanes),
      x = sx(each.x, y);
    // A finished match no longer moves: whoever was still up stands on the deck for the result, not frozen mid-hop.
    if (view.phase === "over" && !each.out)
      each = { ...each, y: 0, vy: 0, air: false, duck: false };
    const p = puppet(each.slot);
    p.squash += (0 - p.squash) * clamp01(dtMs / 90);
    p.flash = Math.max(0, p.flash - dtMs / 420);
    p.cheer = Math.max(0, p.cheer - dtMs / 2600);
    const won =
      (view.phase === "break" && view.lastWinners.includes(each.slot)) ||
      (view.phase === "over" && view.winners.includes(each.slot));
    const up = each.y * Y_SCALE;
    // Over the pit a rider drops out of the picture and shrinks with the fall.
    const sunk = each.y < 0 ? clamp01(-each.y / 420) : 0;
    if (sunk >= 1) return;
    if (each.out) p.spin += dtMs / 110;
    else p.spin = 0;
    // The shadow stays on the deck and thins as the rider rises.
    if (each.x >= 0 && each.y >= 0) {
      const lift = clamp01(up / 130);
      c.fillStyle = hexA(INK, 0.5 - 0.3 * lift);
      c.beginPath();
      c.ellipse(x, y + 1, 17 - 7 * lift, 5 - 2 * lift, 0, 0, Math.PI * 2);
      c.fill();
    }
    const walking =
      !each.out &&
      !each.reeling &&
      !each.air &&
      Math.abs(each.x - each.foothold) > 1.5;
    const idle = Math.sin(now / 260 + each.slot * 1.9);
    let pose: Parameters<typeof figure>[2];
    let lean = 0;
    if (each.out) {
      pose = { legs: 6, torso: 7, arms: "flail", step: 0, white: p.flash };
      lean = -p.spin;
    } else if (each.reeling) {
      pose = { legs: 6, torso: 7, arms: "flail", step: 0, white: 1 };
      lean = -0.5;
    } else if (each.air) {
      // Rising: knees up and arms high. Falling or diving: stretched out, arms down.
      pose =
        each.vy > 0.5
          ? { legs: 4, torso: 7, arms: "up", step: 0, white: 0 }
          : {
              legs: 7,
              torso: 7,
              arms: each.vy < -6 ? "down" : "up",
              step: 0,
              white: 0,
            };
      lean = each.vy < -6 ? 0.18 : -0.06;
    } else if (each.duck) {
      pose = { legs: 2, torso: 3, arms: "fore", step: 0, white: 0 };
    } else if (won || p.cheer > 0.5) {
      pose = { legs: 7, torso: 7, arms: "up", step: 0, white: 0 };
    } else if (walking) {
      pose = {
        legs: 7,
        torso: 7,
        arms: "down",
        step: Math.floor(now / 110) % 2 ? 1 : -1,
        white: 0,
      };
      lean = 0.1;
    } else {
      pose = { legs: 7, torso: 7, arms: "down", step: 0, white: 0 };
    }
    // Just struck and not yet fair game again: it blinks.
    const blink = each.safe && !each.reeling && Math.floor(now / 70) % 2 === 1;
    const bob = !each.air && !each.duck && !each.out ? Math.round(idle) : 0;
    const hop =
      won && !each.air ? Math.abs(Math.sin(now / 150 + each.slot)) * 10 : 0;
    c.save();
    c.translate(Math.round(x), Math.round(y - up - hop + bob));
    const scale = 1 - sunk * 0.6;
    c.scale(scale * (1 + p.squash * 0.18), scale * (1 - p.squash * 0.18));
    if (lean) {
      c.translate(0, -30);
      c.rotate(lean);
      c.translate(0, 30);
    }
    c.globalAlpha = (blink ? 0.45 : 1) * (1 - sunk);
    figure(c, each.slot, pose, now);
    c.restore();
    if (each.out) return;
    // Above the head: the name (the local rider's with a marker) and the streak's pips.
    const head = y - up - hop - (each.duck ? DUCK_H : STAND_H) * Y_SCALE - 16;
    c.textAlign = "center";
    c.font = `8px ${PIXEL_FONT}`;
    c.fillStyle = local ? WHITE : hexA(laneLight(each.slot), 0.9);
    c.fillText(local ? `▼ ${name}` : name, x, head);
    if (view.recover && each.hits > 0) {
      const pips = view.streakFor;
      for (let i = 0; i < pips; i++) {
        c.fillStyle = i < each.streak ? GATE : hexA(TEXT_DIM, 0.5);
        c.fillRect(x - (pips * 7) / 2 + i * 7, head + 4, 5, 4);
      }
    }
  };

  // ---- the board: the clock, the speed, and a card for every rider ----
  const board = (
    c: CanvasRenderingContext2D,
    view: WorldView,
    now: number,
    local: number,
    names: readonly string[],
  ) => {
    const seconds = secondsLeft(view.clock);
    const urgent = view.phase === "play" && seconds <= 10;
    c.textAlign = "center";
    c.font = `28px ${PIXEL_FONT}`;
    c.fillStyle = urgent ? hexA(DANGER, 0.7 + 0.3 * Math.sin(now / 90)) : TEXT;
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    c.fillText(clock, W / 2, 46);
    c.font = `9px ${PIXEL_FONT}`;
    c.fillStyle = TEXT_DIM;
    c.fillText(
      view.target > 1
        ? `ROUND ${view.round} · FIRST TO ${view.target}`
        : `ROUND ${view.round}`,
      W / 2,
      66,
    );
    // The surge speed, as a bar that fills and a multiple of where the round began.
    const times = view.speedStart > 0 ? view.speed / view.speedStart : 1;
    const fill = clamp01((times - 1) / 2);
    c.textAlign = "right";
    c.fillStyle = TEXT_DIM;
    c.fillText("SURGE SPEED", W - 24, 30);
    c.fillStyle = hexA(DECK_LINE, 0.7);
    c.fillRect(W - 164, 38, 140, 10);
    c.fillStyle = fill > 0.66 ? DANGER : fill > 0.33 ? "#ffb347" : GATE;
    c.fillRect(W - 164, 38, Math.round(140 * Math.max(0.04, fill)), 10);
    c.fillStyle = TEXT;
    c.fillText(`x${times.toFixed(1)}`, W - 24, 64);
    // A legend, so the two colours never need guessing.
    c.textAlign = "left";
    c.fillStyle = SURGE_LOW;
    c.fillRect(24, 22, 14, 8);
    c.fillStyle = TEXT_DIM;
    c.fillText("LOW: JUMP", 46, 30);
    c.fillStyle = SURGE_HIGH;
    c.fillRect(24, 40, 14, 8);
    c.fillStyle = TEXT_DIM;
    c.fillText("HIGH: DUCK", 46, 48);
    // The cards.
    const count = view.riders.length,
      width = Math.min(176, (W - 48 - (count - 1) * 10) / count),
      left = (W - (count * width + (count - 1) * 10)) / 2,
      topY = 470;
    for (const each of view.riders) {
      const x = left + each.slot * (width + 10);
      c.fillStyle = hexA(INK, 0.78);
      c.fillRect(x, topY, width, 56);
      c.fillStyle = hexA(laneColor(each.slot), each.out ? 0.35 : 1);
      c.fillRect(x, topY, 5, 56);
      if (each.slot === local) {
        c.strokeStyle = hexA(WHITE, 0.8);
        c.lineWidth = 2;
        c.strokeRect(x + 1, topY + 1, width - 2, 54);
      }
      c.textAlign = "left";
      c.font = `9px ${PIXEL_FONT}`;
      c.fillStyle = each.out ? TEXT_DIM : TEXT;
      const name = (names[each.slot] || `RIDER ${each.slot + 1}`).toUpperCase();
      c.fillText(
        name.length > 12 ? `${name.slice(0, 11)}…` : name,
        x + 14,
        topY + 18,
      );
      // Round wins, of the target.
      for (let i = 0; i < view.target; i++) {
        c.fillStyle = i < each.wins ? "#ffe46b" : hexA(TEXT_DIM, 0.35);
        c.fillRect(x + 14 + i * 12, topY + 26, 9, 9);
      }
      // Hits it can still take.
      if (each.out) {
        c.fillStyle = DANGER;
        c.fillText("OUT", x + 14, topY + 50);
      } else {
        const left = view.maxHits - each.hits,
          size = view.maxHits > 6 ? 7 : 10;
        for (let i = 0; i < view.maxHits; i++) {
          c.fillStyle = i < left ? laneColor(each.slot) : hexA(DANGER, 0.3);
          c.fillRect(x + 14 + i * (size + 3), topY + 41, size, 6);
        }
      }
    }
  };

  const draw: Scene["draw"] = (view, nowMs, local, names = []) => {
    if (destroyed || !g) return [];
    if (box.w !== canvas.clientWidth || box.h !== canvas.clientHeight) resize();
    const dtMs = lastNow < 0 ? 0 : Math.min(100, Math.max(0, nowMs - lastNow));
    lastNow = nowMs;
    const cues = watch(view);
    react(cues, view, nowMs, names);
    flow += view.speed * (dtMs / 1000) * STEPS_PER_SECOND;

    const scale = Math.min(canvas.width / W, canvas.height / H);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = INK;
    g.fillRect(0, 0, canvas.width, canvas.height);
    shake = Math.max(0, shake - dtMs / 22);
    const jx = shake ? (random() - 0.5) * shake : 0,
      jy = shake ? (random() - 0.5) * shake : 0;
    g.setTransform(
      scale,
      0,
      0,
      scale,
      (canvas.width - W * scale) / 2 + jx * scale,
      (canvas.height - H * scale) / 2 + jy * scale,
    );
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    backdrop(g, nowMs);
    deck(g, view, nowMs);
    // Lanes back to front: each lane's slice of every surge, then its rider, so nearer things cover farther ones.
    const lanes = view.riders.length;
    // Surges are spent once a round is over, and burn out as they leave the deck for the pit.
    const spent = view.phase === "play" ? 1 : 0.35;
    const dim = (surge: SurgeView) => spent * clamp01(1 + surge.x / 110);
    for (const surge of view.surges) surgeTrim(g, surge, nowMs, dim(surge));
    for (let lane = 0; lane < lanes; lane++) {
      const y0 = BACK_Y + (DEPTH * lane) / lanes,
        y1 = BACK_Y + (DEPTH * (lane + 1)) / lanes;
      for (const surge of view.surges)
        surgeSlice(g, surge, y0, y1, nowMs, dim(surge));
      const each = view.riders[lane]!;
      rider(
        g,
        view,
        each,
        nowMs,
        dtMs,
        lane === local,
        (names[lane] || "").toUpperCase(),
      );
    }
    // Particles.
    particles = particles.filter((p) => (p.life += dtMs) < p.ms);
    for (const p of particles) {
      const dt = dtMs / 1000;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.fillStyle = p.color.startsWith("#")
        ? hexA(p.color, 1 - p.life / p.ms)
        : p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    board(g, view, nowMs, local, names);
    if (banner) {
      const age = nowMs - banner.at;
      if (age > banner.ms) banner = undefined;
      else {
        const pop = calm ? 1 : 1 + 0.5 * Math.max(0, 1 - age / 160);
        const alpha = clamp01((banner.ms - age) / 250);
        g.textAlign = "center";
        g.font = `${Math.round((banner.text.length > 9 ? 34 : 56) * pop)}px ${PIXEL_FONT}`;
        g.fillStyle = hexA(INK, 0.7 * alpha);
        g.fillText(banner.text, W / 2 + 4, 170 + 4);
        g.fillStyle = hexA(banner.color, alpha);
        g.fillText(banner.text, W / 2, 170);
        if (banner.sub) {
          g.font = `12px ${PIXEL_FONT}`;
          g.fillStyle = hexA(TEXT, alpha);
          g.fillText(banner.sub, W / 2, 202);
        }
      }
    }
    g.restore();
    return cues;
  };

  return {
    resize,
    draw,
    destroy() {
      destroyed = true;
      particles = [];
    },
  };
}
