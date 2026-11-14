import type { BallView, BlobView, WorldView } from "../engine/view.js";
import {
  BALL_RADIUS,
  BODY_RADIUS,
  BODY_UP,
  COURT_H,
  COURT_W,
  HEAD_RADIUS,
  HEAD_UP,
  MAX_TOUCHES,
  NET_CAP_RADIUS,
  NET_TOP_Y,
  NET_X,
  POLE_HALF,
  SAND_Y,
  STEPS_PER_SECOND,
  serveSeconds,
} from "../engine/view-kit.js";
import { advanced, cuesBetween, type Cue } from "./cues.js";
import { createJelly, type JellyPose } from "./jelly.js";
import {
  BALL,
  BALL_HOT,
  DUSK,
  INK,
  NET,
  NIGHT,
  PIXEL_FONT,
  PUPIL,
  SAND,
  SAND_DEEP,
  SIDE,
  SIDE_DEEP,
  SIDE_LIGHT,
  SIDE_NAMES,
  WHITE,
  hexA,
  sideColor,
} from "./palette.js";

/**
 * Draws one frame of a Fuse Volley match on a 2D canvas: the beach, the net, the two jelly blobs and the ball, the
 * effects and the scoreboard, on the court (800×600, 1400×600 two a side or 1440×600 three a side) scaled to fit the canvas and centred in
 * it.
 *
 * It keeps no loop, timer or physics of its own: the app calls `draw` from its frame callback with the view to show
 * and the wall clock, and everything cosmetic here (the jelly, particles, the ball's trail, the shake) moves only as
 * far as that clock says. Nothing here feeds back into the match. The generated art is optional: anything missing is
 * drawn procedurally, so tests and a failed download still show a playable court.
 */
export interface SceneArt {
  court?: CanvasImageSource;
  blobs?: readonly [
    CanvasImageSource | undefined,
    CanvasImageSource | undefined,
  ];
  ball?: CanvasImageSource;
}
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
  /** The art loaded so far; asked every frame, so images that arrive late are used from then on. */
  art?: () => SceneArt;
}
export interface Scene {
  resize(): void;
  /**
   * Draws `view` at wall time `nowMs`. `local` is this device's blob slot, or −1 for a watcher or a shared screen;
   * `names` label the two sides and `tags`, when given, each blob by slot (two and three a side show them under the blobs).
   * Returns what happened since the last frame, for the app's sounds and haptics.
   */
  draw(
    view: WorldView,
    nowMs: number,
    local: number,
    names?: readonly [string, string],
    tags?: readonly string[],
  ): readonly Cue[];
  destroy(): void;
}

type CounterKey = "hitCounter" | "netCounter" | "floorCounter" | "pointCounter";
type Counters = Record<CounterKey, number>;
const COUNTED: Partial<Record<Cue["kind"], CounterKey>> = {
  hit: "hitCounter",
  net: "netCounter",
  floor: "floorCounter",
  point: "pointCounter",
};
const counters = (view: WorldView): Counters => ({
  hitCounter: view.hitCounter,
  netCounter: view.netCounter,
  floorCounter: view.floorCounter,
  pointCounter: view.pointCounter,
});

const MAX_RATIO = 3,
  TAU = Math.PI * 2;
/** The sprite's art: its alpha box is 326 × 433 of a 384 × 448 image, feet on the bottom edge. */
const SPRITE_W = 384,
  SPRITE_H = 448,
  SPRITE_BODY_H = 433;
/** Where the backdrop is cut to widen it, in 800 px court units: left of here is the sun, right of it the palms. */
const ART_CUT = 640,
  BAND_MAX = 380;
/** An image's width in its own pixels. */
function artWidth(image: CanvasImageSource): number {
  const size = image as { naturalWidth?: number; width?: unknown };
  if (typeof size.naturalWidth === "number" && size.naturalWidth > 0)
    return size.naturalWidth;
  return typeof size.width === "number" && size.width > 0
    ? size.width
    : COURT_W;
}
/** The head's top above the feet in an unsquashed blob, px. */
const BLOB_H = HEAD_UP[0] + HEAD_RADIUS;

/** The scale and offset that fit a `courtW`-wide court inside a `width`×`height` canvas, centred. */
export function letterbox(
  width: number,
  height: number,
  courtW: number = COURT_W,
): { scale: number; x: number; y: number } {
  const scale = Math.max(0, Math.min(width / courtW, height / COURT_H));
  return {
    scale,
    x: (width - courtW * scale) / 2,
    y: (height - COURT_H * scale) / 2,
  };
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
}
interface Ring {
  x: number;
  y: number;
  from: number;
  to: number;
  life: number;
  max: number;
  color: string;
}
interface Banner {
  text: string;
  sub: string;
  color: string;
  at: number;
  ms: number;
}

export function createScene(
  canvas: SceneCanvas,
  options: SceneOptions = {},
): Scene {
  const g = canvas.getContext("2d");
  const random = options.random ?? Math.random;
  const ratio =
    options.pixelRatio ??
    (() => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const art: () => SceneArt = options.art ?? (() => ({}));
  const calm = options.reducedMotion === true;
  const jelly = createJelly(random);
  let box = { w: -1, h: -1, r: -1 };
  let previous: WorldView | undefined;
  let high: Counters | undefined;
  let lastNow = -1;
  let destroyed = false;
  let particles: Particle[] = [];
  let rings: Ring[] = [];
  let banner: Banner | undefined;
  let shake = 0;
  let ballSquash = 0;
  let trail: { x: number; y: number; at: number }[] = [];
  const flashes: [number, number] = [0, 0];
  /** The court being drawn: its width and the net's line, px. */
  let W = COURT_W,
    netX = NET_X;

  const resize = () => {
    const r = Math.min(MAX_RATIO, Math.max(1, ratio())),
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    box = { w, h, r };
    canvas.width = Math.max(1, Math.round(w * r));
    canvas.height = Math.max(1, Math.round(h * r));
  };

  const burst = (
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    up = 0,
    gravity = 900,
    size = 3,
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = random() * TAU,
        v = speed * (0.35 + random() * 0.65);
      const max = 0.35 + random() * 0.45;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v - up,
        life: max,
        max,
        size: size * (0.6 + random() * 0.8),
        color,
        gravity,
      });
    }
    if (particles.length > 400) particles = particles.slice(-400);
  };
  const ring = (
    x: number,
    y: number,
    from: number,
    to: number,
    color: string,
    max = 0.3,
  ) => rings.push({ x, y, from, to, life: max, max, color });

  const names = (given?: readonly [string, string]) =>
    given ?? ([SIDE_NAMES[0], SIDE_NAMES[1]] as const);

  /** Reacts to what happened: jelly kicks, particles, rings, shake and banners. */
  const react = (
    cues: readonly Cue[],
    view: WorldView,
    now: number,
    labels: readonly [string, string],
  ) => {
    for (const cue of cues) {
      switch (cue.kind) {
        case "hit": {
          const strength = Math.min(1, cue.speed / 8);
          jelly.kick(cue.slot, 0.5 + strength * 0.5);
          flashes[cue.side] = 1;
          ring(
            cue.x,
            cue.y,
            BALL_RADIUS,
            BALL_RADIUS + 26,
            SIDE_LIGHT[cue.side],
            0.28,
          );
          burst(cue.x, cue.y, 10, SIDE[cue.side], 260, 60, 500, 3);
          ballSquash = 0.22;
          if (!calm) shake = Math.max(shake, 2 + strength * 3);
          break;
        }
        case "net":
          burst(cue.x, cue.y, 8, NET, 220, 40, 500, 2.5);
          ring(cue.x, cue.y, 10, 34, NET, 0.22);
          break;
        case "floor":
          ballSquash = Math.min(0.3, cue.speed / 20);
          burst(
            cue.x,
            SAND_Y - 2,
            6 + Math.round(Math.min(10, cue.speed * 1.5)),
            SAND,
            180,
            140,
            900,
            2.6,
          );
          break;
        case "land":
          jelly.kick(cue.slot, 0.8);
          burst(cue.x, SAND_Y - 1, 7, hexA(SAND, 0.9), 120, 70, 700, 2.2);
          break;
        case "jump":
          jelly.spring(cue.slot, 1);
          break;
        case "point": {
          const winner = cue.loser === 0 ? 1 : 0;
          ring(view.ball.x, view.ball.y, 20, 140, SIDE[winner], 0.6);
          burst(view.ball.x, view.ball.y, 26, SIDE[winner], 380, 120, 600, 3.5);
          if (!calm) shake = Math.max(shake, 5);
          const matchPoint = cue.matchPoint !== -1 && view.winner === -1;
          banner = {
            text: cue.scored
              ? `POINT ${labels[winner].toUpperCase()}`
              : "SIDE OUT",
            sub: cue.scored
              ? matchPoint
                ? "MATCH POINT"
                : `${view.score[0]} – ${view.score[1]}`
              : `${labels[winner].toUpperCase()} SERVES`,
            color: SIDE[winner],
            at: now,
            ms: 1500,
          };
          break;
        }
        case "over":
          banner = {
            text: `${labels[cue.winner].toUpperCase()} WINS!`,
            sub: `${view.score[0]} – ${view.score[1]}`,
            color: SIDE[cue.winner],
            at: now,
            ms: 1e9,
          };
          for (let i = 0; i < 4; i++)
            burst(
              W / 4 + random() * (W / 2),
              150 + random() * 150,
              22,
              SIDE[cue.winner],
              420,
              100,
              400,
              3.5,
            );
          break;
        default:
          break;
      }
    }
  };

  // ---- drawing ----
  const drawCourt = (c: CanvasRenderingContext2D, now: number) => {
    const court = art().court;
    if (court) {
      drawArtCourt(c, court);
      return;
    }
    const sky = c.createLinearGradient(0, 0, 0, SAND_Y);
    sky.addColorStop(0, INK);
    sky.addColorStop(0.55, NIGHT);
    sky.addColorStop(1, DUSK);
    c.fillStyle = sky;
    c.fillRect(0, 0, W, SAND_Y);
    // A sun on the horizon and a calm sea.
    c.fillStyle = hexA(BALL, 0.85);
    c.beginPath();
    c.arc(190, 350, 46, Math.PI, 0);
    c.fill();
    c.fillStyle = hexA("#1a2a70", 0.9);
    c.fillRect(0, 350, W, SAND_Y - 350);
    for (let i = 0; i < 6; i++) {
      c.fillStyle = hexA(SIDE[i % 2]!, 0.08 + 0.04 * Math.sin(now / 900 + i));
      c.fillRect(0, 360 + i * 22, W, 2);
    }
    const sand = c.createLinearGradient(0, SAND_Y, 0, COURT_H);
    sand.addColorStop(0, SAND);
    sand.addColorStop(1, SAND_DEEP);
    c.fillStyle = sand;
    c.fillRect(0, SAND_Y, W, COURT_H - SAND_Y);
    c.fillStyle = hexA(SIDE[0], 0.8);
    c.fillRect(0, SAND_Y - 1, W, 2);
  };

  /**
   * The generated backdrop is 4:3 for the 800 px court. A wider court keeps the image at the same scale, palms and sun
   * where they were on the left and the right palms at the far edge, and widens the open sky, sea and sand between
   * them: bands cut from just left of the right palms, laid down flipped and unflipped in turn so every seam meets
   * itself.
   */
  const drawArtCourt = (
    c: CanvasRenderingContext2D,
    court: CanvasImageSource,
  ) => {
    if (W <= COURT_W) {
      c.drawImage(court, 0, 0, COURT_W, COURT_H);
      return;
    }
    const k = artWidth(court) / COURT_W;
    const extra = W - COURT_W;
    let bands = 2;
    while (extra / bands > BAND_MAX) bands += 2;
    const band = extra / bands;
    const piece = (from: number, width: number, x: number) =>
      c.drawImage(
        court,
        from * k,
        0,
        width * k,
        COURT_H * k,
        x,
        0,
        width + 0.6,
        COURT_H,
      );
    piece(0, ART_CUT, 0);
    for (let i = 0; i < bands; i++) {
      const x = ART_CUT + i * band;
      if (i % 2 === 0) {
        c.save();
        c.translate(x + band, 0);
        c.scale(-1, 1);
        piece(ART_CUT - band, band, -0.3);
        c.restore();
      } else piece(ART_CUT - band, band, x);
    }
    piece(ART_CUT, COURT_W - ART_CUT, ART_CUT + extra);
  };

  const drawNet = (c: CanvasRenderingContext2D, now: number) => {
    const top = NET_TOP_Y,
      half = Math.max(3, POLE_HALF / 2);
    // The mesh: a neon grid hanging from the cap to two thirds of the way down.
    c.save();
    c.globalAlpha = 0.5;
    c.strokeStyle = NET;
    c.lineWidth = 1;
    const meshBottom = top + (SAND_Y - top) * 0.62;
    for (let y = top + 8; y <= meshBottom; y += 12) {
      c.beginPath();
      c.moveTo(netX - half - 6, y);
      c.lineTo(netX + half + 6, y);
      c.stroke();
    }
    c.restore();
    // The pole, glowing.
    const glow = c.createLinearGradient(netX - half * 3, 0, netX + half * 3, 0);
    glow.addColorStop(0, hexA(NET, 0));
    glow.addColorStop(0.5, hexA(NET, 0.35 + 0.05 * Math.sin(now / 500)));
    glow.addColorStop(1, hexA(NET, 0));
    c.fillStyle = glow;
    c.fillRect(netX - half * 3, top, half * 6, SAND_Y - top);
    const pole = c.createLinearGradient(netX - half, 0, netX + half, 0);
    pole.addColorStop(0, "#1d6c86");
    pole.addColorStop(0.5, WHITE);
    pole.addColorStop(1, "#1d6c86");
    c.fillStyle = pole;
    c.fillRect(netX - half, top, half * 2, SAND_Y - top);
    // The cap the ball rolls off.
    c.fillStyle = WHITE;
    c.shadowColor = NET;
    c.shadowBlur = 14;
    c.beginPath();
    c.arc(netX, top, Math.max(NET_CAP_RADIUS, half + 1), 0, TAU);
    c.fill();
    c.shadowBlur = 0;
  };

  const drawShadow = (
    c: CanvasRenderingContext2D,
    x: number,
    height: number,
    width: number,
  ) => {
    const lift = Math.max(0, height);
    const fade = Math.max(0.12, 1 - lift / 420);
    c.fillStyle = `rgba(4,2,20,${(0.42 * fade).toFixed(3)})`;
    c.beginPath();
    c.ellipse(
      x,
      SAND_Y + 6,
      width * (0.55 + 0.45 * fade),
      7 * fade + 2,
      0,
      0,
      TAU,
    );
    c.fill();
  };

  const drawBlob = (
    c: CanvasRenderingContext2D,
    blob: BlobView,
    pose: JellyPose,
    ball: BallView,
    local: boolean,
  ) => {
    const side = blob.side;
    const height = HEAD_UP[blob.frame]! + HEAD_RADIUS;
    const squash = BLOB_H / height;
    const h = height * pose.stretch,
      w =
        BLOB_H * (SPRITE_W / SPRITE_BODY_H) * Math.sqrt(squash / pose.stretch);
    const image = art().blobs?.[side];
    c.save();
    c.translate(blob.x, blob.y);
    c.transform(1, 0, -pose.lean, 1, 0, 0);
    // A glow in the side's colour; brighter for a moment after a touch.
    c.shadowColor = SIDE[side];
    c.shadowBlur = 12 + 18 * flashes[side];
    if (image) {
      const drawnH = h * (SPRITE_H / SPRITE_BODY_H);
      c.drawImage(image, -w / 2, -drawnH, w, drawnH);
    } else {
      const body = c.createRadialGradient(
        -10,
        -h * 0.55,
        4,
        0,
        -h * 0.4,
        h * 0.7,
      );
      body.addColorStop(0, SIDE_LIGHT[side]);
      body.addColorStop(0.45, SIDE[side]);
      body.addColorStop(1, SIDE_DEEP[side]);
      c.fillStyle = body;
      const bodyY = -(BODY_UP[blob.frame]! * pose.stretch),
        headY = -(HEAD_UP[blob.frame]! * pose.stretch);
      c.beginPath();
      c.ellipse(
        0,
        bodyY,
        BODY_RADIUS,
        BODY_UP[blob.frame]! * pose.stretch,
        0,
        0,
        TAU,
      );
      c.fill();
      c.beginPath();
      c.arc(0, headY, HEAD_RADIUS, 0, TAU);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = hexA(WHITE, 0.55);
      c.beginPath();
      c.ellipse(-9, headY - 10, 7, 4, -0.5, 0, TAU);
      c.fill();
    }
    c.shadowBlur = 0;
    if (flashes[side] > 0.02) {
      c.globalCompositeOperation = "lighter";
      c.fillStyle = hexA(SIDE_LIGHT[side], 0.25 * flashes[side]);
      c.beginPath();
      c.arc(0, -(HEAD_UP[blob.frame]! * pose.stretch), HEAD_RADIUS + 4, 0, TAU);
      c.fill();
      c.globalCompositeOperation = "source-over";
    }
    // Eyes on the head, looking at the ball.
    const eyeY = -(HEAD_UP[blob.frame]! * pose.stretch) - 4;
    const toward = side === 0 ? 1 : -1;
    const lookX = ball.x - blob.x,
      lookY = ball.y - (blob.y + eyeY),
      distance = Math.hypot(lookX, lookY) || 1;
    for (const dx of [-9, 9]) {
      const ex = dx + toward * 3;
      const open = 1 - pose.blink * 0.92;
      c.fillStyle = WHITE;
      c.beginPath();
      c.ellipse(ex, eyeY, 6.6, 8.6 * open, 0, 0, TAU);
      c.fill();
      if (open > 0.3) {
        c.fillStyle = PUPIL;
        c.beginPath();
        c.arc(
          ex + (lookX / distance) * 2.8,
          eyeY + (lookY / distance) * 3.6 * open,
          3.4,
          0,
          TAU,
        );
        c.fill();
        c.fillStyle = WHITE;
        c.beginPath();
        c.arc(
          ex + (lookX / distance) * 2.8 - 1.2,
          eyeY + (lookY / distance) * 3.6 * open - 1.4,
          1.1,
          0,
          TAU,
        );
        c.fill();
      }
    }
    c.restore();
    if (local) {
      // A small marker over this device's own blob.
      const y = blob.y - h - 22;
      c.fillStyle = SIDE[side];
      c.beginPath();
      c.moveTo(blob.x - 7, y);
      c.lineTo(blob.x + 7, y);
      c.lineTo(blob.x, y + 9);
      c.closePath();
      c.fill();
    }
  };

  /**
   * Three a side, the lanes: dashed lines across the sand in each side's colour, fading up into the air, and the middle
   * lane (which serves) lit faintly on each side, so the rotation reads at a glance.
   */
  const drawLanes = (c: CanvasRenderingContext2D, view: WorldView) => {
    const lines = view.court.lanes;
    if (lines.length !== 4) return;
    const [farLeft, nearLeft, nearRight, farRight] = lines as [
      number,
      number,
      number,
      number,
    ];
    for (const [side, from, to] of [
      [0, farLeft, nearLeft],
      [1, nearRight, farRight],
    ] as const) {
      const glow = c.createLinearGradient(0, SAND_Y - 60, 0, COURT_H);
      glow.addColorStop(0, hexA(SIDE[side], 0));
      glow.addColorStop(0.45, hexA(SIDE[side], 0.1));
      glow.addColorStop(1, hexA(SIDE[side], 0.16));
      c.fillStyle = glow;
      c.fillRect(from, SAND_Y - 60, to - from, COURT_H - SAND_Y + 60);
    }
    c.save();
    c.lineWidth = 3;
    c.setLineDash([10, 8]);
    for (const x of lines) {
      const side = x < view.court.net ? 0 : 1;
      const fade = c.createLinearGradient(0, SAND_Y - 90, 0, COURT_H);
      fade.addColorStop(0, hexA(SIDE[side], 0));
      fade.addColorStop(0.5, hexA(SIDE[side], 0.55));
      fade.addColorStop(1, hexA(SIDE[side], 0.8));
      c.strokeStyle = fade;
      c.beginPath();
      c.moveTo(x, SAND_Y - 90);
      c.lineTo(x, COURT_H);
      c.stroke();
    }
    c.restore();
  };

  /** Two or three a side, a name on the sand under each blob, so teammates of one colour can tell themselves apart. */
  const drawTag = (
    c: CanvasRenderingContext2D,
    blob: BlobView,
    tag: string,
  ) => {
    if (!tag) return;
    const text = Array.from(tag.toUpperCase()).slice(0, 10).join("");
    c.font = `8px ${PIXEL_FONT}`;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillStyle = hexA(INK, 0.6);
    c.fillText(text, blob.x + 1, SAND_Y + 31);
    c.fillStyle = hexA(SIDE_LIGHT[blob.side], 0.9);
    c.fillText(text, blob.x, SAND_Y + 30);
  };

  const drawBall = (
    c: CanvasRenderingContext2D,
    ball: BallView,
    now: number,
  ) => {
    // A short fading trail while it flies fast.
    const speed = Math.hypot(ball.vx, ball.vy);
    for (const [i, point] of trail.entries()) {
      const age = (now - point.at) / 140;
      if (age >= 1) continue;
      const alpha =
        (1 - age) * 0.22 * Math.min(1, speed / 5) * ((i + 1) / trail.length);
      c.fillStyle = hexA(BALL, alpha);
      c.beginPath();
      c.arc(point.x, point.y, BALL_RADIUS * (0.55 + 0.4 * (1 - age)), 0, TAU);
      c.fill();
    }
    const image = art().ball;
    const squashX = 1 + ballSquash,
      squashY = 1 - ballSquash;
    c.save();
    c.translate(ball.x, ball.y);
    c.scale(squashX, squashY);
    c.shadowColor = BALL;
    c.shadowBlur = 16;
    c.rotate(ball.spin * TAU * 4);
    if (image) {
      c.drawImage(
        image,
        -BALL_RADIUS,
        -BALL_RADIUS,
        BALL_RADIUS * 2,
        BALL_RADIUS * 2,
      );
    } else {
      c.fillStyle = BALL;
      c.beginPath();
      c.arc(0, 0, BALL_RADIUS, 0, TAU);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = hexA(BALL_HOT, 0.9);
      c.lineWidth = 3;
      for (const angle of [0, TAU / 3, (2 * TAU) / 3]) {
        c.beginPath();
        c.arc(
          Math.cos(angle) * 22,
          Math.sin(angle) * 22,
          26,
          angle + 2.2,
          angle + 4.1,
        );
        c.stroke();
      }
    }
    c.restore();
  };

  /** The ball above the top edge (there is no ceiling): a marker where it will come back down. */
  const drawBallMarker = (c: CanvasRenderingContext2D, ball: BallView) => {
    if (ball.y + BALL_RADIUS > 0) return;
    const height = Math.round(-ball.y);
    c.fillStyle = BALL;
    c.beginPath();
    c.moveTo(ball.x, 6);
    c.lineTo(ball.x - 10, 22);
    c.lineTo(ball.x + 10, 22);
    c.closePath();
    c.fill();
    c.font = `10px ${PIXEL_FONT}`;
    c.textAlign = "center";
    c.fillText(`${height}`, ball.x, 38);
  };

  const drawHud = (
    c: CanvasRenderingContext2D,
    view: WorldView,
    labels: readonly [string, string],
    now: number,
  ) => {
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    for (const side of [0, 1] as const) {
      const x = side === 0 ? W / 4 : (3 * W) / 4;
      c.font = `44px ${PIXEL_FONT}`;
      c.shadowColor = SIDE[side];
      c.shadowBlur = 16;
      c.fillStyle = WHITE;
      c.fillText(String(view.score[side]), x, 78);
      c.shadowBlur = 0;
      c.font = `10px ${PIXEL_FONT}`;
      c.fillStyle = SIDE_LIGHT[side];
      c.fillText(labels[side].toUpperCase(), x, 100);
      // The serving side has a ball beside its score.
      if (view.server === side && view.phase !== "over") {
        const bx = x + (side === 0 ? -58 : 58),
          bounce = Math.abs(Math.sin(now / 260)) * 4;
        c.fillStyle = BALL;
        c.shadowColor = BALL;
        c.shadowBlur = 10;
        c.beginPath();
        c.arc(bx, 60 - bounce, 8, 0, TAU);
        c.fill();
        c.shadowBlur = 0;
      }
      // Touches used this rally: three pips.
      const used = view.blobs.find((blob) => blob.side === side)?.touches ?? 0;
      for (let i = 0; i < MAX_TOUCHES; i++) {
        const px = x - 16 + i * 16;
        c.beginPath();
        c.arc(px, 116, 4.5, 0, TAU);
        if (i < used) {
          c.fillStyle = i === MAX_TOUCHES - 1 ? WHITE : SIDE[side];
          c.fill();
        } else {
          c.strokeStyle = hexA(SIDE[side], 0.55);
          c.lineWidth = 1.5;
          c.stroke();
        }
      }
    }
    // The rule, low on the sand: the top of the court is where a high ball's marker shows.
    c.font = `9px ${PIXEL_FONT}`;
    c.fillStyle = hexA(INK, 0.55);
    const rule =
      view.scoring === "rally"
        ? `QUICK · FIRST TO ${view.target}`
        : `CLASSIC · FIRST TO ${view.target}`;
    c.fillText(rule, W / 2 + 1, COURT_H - 13);
    c.fillStyle = hexA(WHITE, 0.7);
    c.fillText(rule, W / 2, COURT_H - 14);
    if (view.phase === "serve") {
      if (view.matchPoint !== -1) {
        const pulse = 0.6 + 0.4 * Math.sin(now / 160);
        c.font = `14px ${PIXEL_FONT}`;
        c.fillStyle = hexA(SIDE[view.matchPoint], pulse);
        c.fillText("MATCH POINT", W / 2, 160);
      }
      const seconds = serveSeconds(view);
      if (seconds <= 3 && view.remaining > 0) {
        c.font = `16px ${PIXEL_FONT}`;
        c.fillStyle = hexA(WHITE, 0.85);
        c.fillText(
          String(seconds),
          view.ball.x,
          view.ball.y - BALL_RADIUS - 14,
        );
      }
    }
    if (banner) {
      const age = now - banner.at;
      if (age > banner.ms) banner = undefined;
      else {
        const grow = calm ? 1 : Math.min(1, age / 140);
        const fade = Math.min(1, (banner.ms - age) / 300);
        c.save();
        c.globalAlpha = fade;
        c.translate(W / 2, 230);
        c.scale(0.7 + 0.3 * grow, 0.7 + 0.3 * grow);
        c.font = `30px ${PIXEL_FONT}`;
        c.shadowColor = banner.color;
        c.shadowBlur = 24;
        c.fillStyle = WHITE;
        c.fillText(banner.text, 0, 0);
        c.shadowBlur = 0;
        c.font = `13px ${PIXEL_FONT}`;
        c.fillStyle = banner.color;
        c.fillText(banner.sub, 0, 34);
        c.restore();
      }
    }
  };

  const advanceEffects = (dt: number) => {
    for (const p of particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y > SAND_Y + 4 && p.vy > 0) {
        p.y = SAND_Y + 4;
        p.vy *= -0.3;
        p.vx *= 0.6;
      }
    }
    particles = particles.filter((p) => p.life > 0);
    for (const r of rings) r.life -= dt;
    rings = rings.filter((r) => r.life > 0);
    shake *= Math.exp(-dt * 14);
    ballSquash *= Math.exp(-dt * 12);
    flashes[0] *= Math.exp(-dt * 8);
    flashes[1] *= Math.exp(-dt * 8);
  };

  const drawEffects = (c: CanvasRenderingContext2D) => {
    c.globalCompositeOperation = "lighter";
    for (const r of rings) {
      const t = 1 - r.life / r.max;
      c.strokeStyle = hexA(r.color, (1 - t) * 0.9);
      c.lineWidth = 3 * (1 - t) + 1;
      c.beginPath();
      c.arc(r.x, r.y, r.from + (r.to - r.from) * t, 0, TAU);
      c.stroke();
    }
    for (const p of particles) {
      c.fillStyle = p.color.startsWith("#")
        ? hexA(p.color, p.life / p.max)
        : p.color;
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    c.globalCompositeOperation = "source-over";
  };

  return {
    resize,
    draw(view, nowMs, local, given, tags) {
      if (destroyed || !g) return [];
      if (
        box.w !== canvas.clientWidth ||
        box.h !== canvas.clientHeight ||
        box.r !== Math.min(MAX_RATIO, Math.max(1, ratio()))
      )
        resize();
      const dt =
        lastNow < 0 ? 0 : Math.min(0.1, Math.max(0, (nowMs - lastNow) / 1000));
      lastNow = nowMs;
      const labels = names(given);
      W = view.court.width;
      netX = view.court.net;
      // A new match, or a view from before the last one: start the presentation over.
      if (previous && view.step < previous.step - STEPS_PER_SECOND) {
        previous = undefined;
        banner = undefined;
        jelly.reset();
        trail = [];
      }
      // A predicted hit that a rollback took back and then happened for real sounds once: each counter fires only
      // past the furthest it has been shown this match.
      if (!previous || !high) high = counters(view);
      const cues = cuesBetween(previous, view).filter((cue) => {
        const key = COUNTED[cue.kind];
        if (!key) return true;
        if (!advanced(high![key], view[key])) return false;
        high![key] = view[key];
        return true;
      });
      previous = view;
      react(cues, view, nowMs, labels);
      advanceEffects(dt);
      if (view.ball.live || view.phase === "serve") {
        const lastPoint = trail.at(-1);
        if (
          !lastPoint ||
          Math.hypot(lastPoint.x - view.ball.x, lastPoint.y - view.ball.y) > 30
        )
          trail = [];
        trail.push({ x: view.ball.x, y: view.ball.y, at: nowMs });
        if (trail.length > 9) trail.shift();
      }
      const poses = jelly.update(view.blobs, nowMs);

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = INK;
      g.fillRect(0, 0, canvas.width, canvas.height);
      const fit = letterbox(canvas.width, canvas.height, W);
      const jolt = shake > 0.2 ? shake : 0;
      g.setTransform(
        fit.scale,
        0,
        0,
        fit.scale,
        fit.x + (random() - 0.5) * jolt * fit.scale,
        fit.y + (random() - 0.5) * jolt * fit.scale,
      );
      g.save();
      g.beginPath();
      g.rect(0, 0, W, COURT_H);
      g.clip();
      drawCourt(g, nowMs);
      drawLanes(g, view);
      for (const blob of view.blobs)
        drawShadow(g, blob.x, SAND_Y - blob.y, BODY_RADIUS);
      drawShadow(
        g,
        view.ball.x,
        SAND_Y - (view.ball.y + BALL_RADIUS),
        BALL_RADIUS * 0.8,
      );
      drawNet(g, nowMs);
      if (tags && view.court.team > 1)
        for (const blob of view.blobs)
          drawTag(g, blob, tags[view.blobs.indexOf(blob)] ?? "");
      for (const [slot, blob] of view.blobs.entries())
        drawBlob(g, blob, poses[slot]!, view.ball, slot === local);
      drawBall(g, view.ball, nowMs);
      drawEffects(g);
      drawBallMarker(g, view.ball);
      drawHud(g, view, labels, nowMs);
      g.restore();
      return cues;
    },
    destroy() {
      destroyed = true;
      particles = [];
      rings = [];
    },
  };
}

export { sideColor };
