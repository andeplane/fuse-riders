import type { RiderView, WorldView } from "../engine/view.js";
import { LEVELS, WHEEL_RADIUS, inAir, type Level } from "../engine/view-kit.js";
import { drawBike, type BikeSprites } from "./bike.js";
import {
  AHEAD_SHARE,
  cameraTarget,
  followCamera,
  levelBounds,
  paneGrid,
  paneScale,
  type Camera,
  type Pane,
} from "./camera.js";
import { cueGate, cuesBetween, type Cue } from "./cues.js";
import { createEffects } from "./effects.js";
import { paneHud, type PaneHud } from "./hud.js";
import { drawApple, drawFlower, drawKiller } from "./objects.js";
import {
  CYAN,
  GOLD,
  INK,
  PINK,
  PIXEL_FONT,
  WHITE,
  hexA,
  slotColor,
} from "./palette.js";
import {
  drawTerrain,
  groundTile,
  toScreen,
  type CanvasFactory,
  type TerrainArt,
  type Window,
} from "./terrain.js";

/**
 * Draws one frame of an Elasto Fuse race on a 2D canvas: one pane per followed rider (this device's own, or every
 * rider on a shared screen), each with its camera, the level's ground and sky, the objects as that rider has them,
 * every bike (the pane's own solid, the others as ghosts), the sparks and the words on top.
 *
 * It keeps no loop, timer or physics of its own: the app calls `draw` from its frame callback with the view to show
 * and the wall clock, and everything cosmetic here (cameras, particles, the flower's pulse) moves only as far as that
 * clock says. Nothing here feeds back into the race. The generated art is optional: anything missing is drawn
 * procedurally, so tests and a failed download still show a playable race.
 */
export interface SceneArt extends TerrainArt {
  apple?: CanvasImageSource;
  flower?: CanvasImageSource;
  killer?: CanvasImageSource;
  /** The bike and rider sprites in a slot's colour, when they are ready. */
  bike?(slot: number): BikeSprites | undefined;
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
  /** Fewer sparks and no dust. */
  reducedMotion?: boolean;
  /** The art loaded so far; asked every frame, so images that arrive late are used from then on. */
  art?: () => SceneArt;
  /** Makes the canvas the ground's tile is drawn on; without it the ground is a flat colour. */
  createCanvas?: CanvasFactory;
}
/** What one frame shows beside the race itself. */
export interface Shot {
  /** The rider slots to follow, one pane each (1 to 5). */
  follow: readonly number[];
  /** This device's rider slot, or −1: its engine is the one heard. */
  local: number;
  /** Each rider's name by slot: ghosts' tags and, with several panes, each pane's label. */
  names?: readonly string[];
  /** A line at the bottom: the level's name and the race's number. */
  title?: string;
  /**
   * CSS pixels of the canvas that touch buttons float over (a phone on its side): the clusters in its bottom
   * corners, `left` and `right` wide and `bottom` high. The bike rides in the gap between them.
   */
  covered?: { left: number; right: number; bottom: number };
}
export interface Drawn {
  /** What happened since the last frame, for the app's sounds and haptics. */
  cues: readonly Cue[];
  /** The local rider's engine, for the hum: how fast the driven wheel turns (0 to 1) and whether the gas is held. */
  rev: number;
  gas: boolean;
}
export interface Scene {
  resize(): void;
  draw(view: WorldView, nowMs: number, shot: Shot): Drawn;
  destroy(): void;
}

const MAX_RATIO = 3;
/** The wheel spin, radians a second, that counts as flat out. */
const TOP_SPIN = 45;
/** Which way is down for a rider's `gravity`: 0 up, 1 down, 2 left, 3 right. */
const DOWN: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
];
const TONES: Readonly<Record<PaneHud["tone"], string>> = {
  count: GOLD,
  go: "#4dff7c",
  crash: PINK,
  finish: GOLD,
  "": WHITE,
};

interface Follow {
  camera: Camera;
  ahead: number;
}

export function createScene(
  canvas: SceneCanvas,
  options: SceneOptions = {},
): Scene {
  const g = canvas.getContext("2d");
  const ratio =
    options.pixelRatio ??
    (() => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const random = options.random ?? Math.random;
  const effects = createEffects(random);
  const follows = new Map<number, Follow>();
  const gate = cueGate();
  let destroyed = false,
    last: WorldView | undefined,
    lastMs = -1,
    level = -1,
    rev = 0,
    tile: CanvasImageSource | undefined,
    tileAsked = false,
    dustOwed = 0;

  const pixelRatio = () => Math.max(1, Math.min(MAX_RATIO, ratio() || 1));
  const resize = () => {
    const scale = pixelRatio();
    const width = Math.max(1, Math.round(canvas.clientWidth * scale)),
      height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  };

  const react = (cues: readonly Cue[], view: WorldView) => {
    const few = options.reducedMotion ? 0.4 : 1;
    for (const cue of cues) {
      if (cue.kind === "apple")
        effects.burst(cue.x, cue.y, GOLD, Math.round(16 * few), 5, {
          life: 0.5,
          size: 0.09,
          fall: 5,
          tag: cue.slot,
        });
      else if (cue.kind === "crash") {
        const color = slotColor(cue.slot);
        effects.burst(cue.x, cue.y, color, Math.round(26 * few), 7, {
          life: 0.8,
          up: 2,
        });
        effects.burst(cue.x, cue.y, WHITE, Math.round(10 * few), 4, {
          life: 0.4,
          size: 0.06,
        });
      } else if (cue.kind === "finish")
        for (const color of [GOLD, PINK, slotColor(cue.slot)])
          effects.burst(cue.x, cue.y, color, Math.round(18 * few), 8, {
            life: 1.1,
            fall: 3,
            up: 3,
            tag: view.riders.length > 1 ? cue.slot : -1,
          });
    }
  };

  /** Dust behind the driven wheel while the gas is held and the wheel is on the ground. */
  const dust = (map: Level, rider: RiderView, slot: number, dt: number) => {
    if (options.reducedMotion || rider.status !== "riding" || !rider.gas)
      return;
    const rear = rider.bike.flipped ? rider.bike.right : rider.bike.left;
    const [gx, gy] = DOWN[rider.gravity] ?? DOWN[1]!;
    const probe = WHEEL_RADIUS + 0.12;
    if (inAir(map, rear.x + gx * probe, rear.y + gy * probe)) return;
    dustOwed += dt * 45;
    const back = rider.bike.flipped ? 1 : -1,
      cos = Math.cos(rider.bike.rot),
      sin = Math.sin(rider.bike.rot);
    for (; dustOwed >= 1; dustOwed--)
      effects.dust(
        rear.x + gx * WHEEL_RADIUS * 0.9,
        rear.y + gy * WHEEL_RADIUS * 0.9,
        cos * back - gx * 0.4,
        sin * back - gy * 0.4,
        "#8ea0d8",
        slot,
      );
  };

  const text = (
    words: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = "left",
  ) => {
    if (!g || !words) return;
    g.font = `${Math.round(size)}px ${PIXEL_FONT}`;
    g.textAlign = align;
    g.textBaseline = "top";
    g.lineJoin = "round";
    g.strokeStyle = hexA(INK, 0.85);
    g.lineWidth = Math.max(2, size * 0.32);
    g.strokeText(words, x, y);
    g.fillStyle = color;
    g.fillText(words, x, y);
  };

  const drawPane = (
    view: WorldView,
    map: Level,
    pane: Pane,
    slot: number,
    seconds: number,
    dt: number,
    shot: Shot,
    art: SceneArt,
    scale: number,
  ) => {
    if (!g) return;
    const rider = view.riders[slot];
    if (!rider) return;
    const zoom = paneScale(pane.w / scale, pane.h / scale) * scale;
    const unitsWide = pane.w / zoom,
      unitsHigh = pane.h / zoom;
    // Touch buttons over the pane's bottom corners: the bike keeps its place a little ahead of the back edge of the
    // gap between them, not of the pane, and rides a little higher.
    const cover = shot.covered,
      coverLeft = Math.min(pane.w * 0.4, (cover?.left ?? 0) * scale),
      coverRight = Math.min(pane.w * 0.4, (cover?.right ?? 0) * scale);
    const lift =
      (Math.min(pane.h * 0.6, (cover?.bottom ?? 0) * scale) * 0.25) / zoom;
    const behind = rider.bike.flipped ? coverRight : coverLeft;
    const anchor =
      behind + (0.5 - AHEAD_SHARE) * (pane.w - coverLeft - coverRight);
    // The look-ahead eases through a turn-around; the camera then closes on where that puts it.
    const wanted =
      ((rider.bike.flipped ? -1 : 1) * (pane.w / 2 - anchor)) / zoom;
    let follow = follows.get(slot);
    const ahead = follow
      ? follow.ahead + (wanted - follow.ahead) * (1 - Math.exp(-dt / 420))
      : wanted;
    const camera = followCamera(
      follow?.camera,
      cameraTarget(
        rider.bike,
        levelBounds(map),
        unitsWide,
        unitsHigh,
        ahead,
        lift,
      ),
      dt,
    );
    follow = { camera, ahead };
    follows.set(slot, follow);
    const window: Window = { pane, camera, scale: zoom };

    g.save();
    g.beginPath();
    g.rect(pane.x, pane.y, pane.w, pane.h);
    g.clip();
    drawTerrain(g, map, window, seconds, art, tile);

    // The world, y up.
    g.save();
    g.translate(pane.x + pane.w / 2, pane.y + pane.h / 2);
    g.scale(zoom, -zoom);
    g.translate(-camera.x, -camera.y);
    const halfW = unitsWide / 2 + 1,
      halfH = unitsHigh / 2 + 1;
    const seen = (x: number, y: number) =>
      Math.abs(x - camera.x) <= halfW && Math.abs(y - camera.y) <= halfH;
    const ready = rider.apples >= view.apples;
    let apple = 0;
    for (const object of map.objects) {
      const index = object.kind === "apple" ? apple++ : -1;
      if (!seen(object.x, object.y)) continue;
      if (object.kind === "apple") {
        // This pane's rider has its own apples: the ones it ate are gone here and nowhere else.
        if (rider.taken & (1 << index)) continue;
        drawApple(
          g,
          object.x,
          object.y,
          seconds,
          object.gravity ?? 0,
          art.apple,
        );
      } else if (object.kind === "flower")
        drawFlower(g, object.x, object.y, seconds, ready, art.flower);
      else drawKiller(g, object.x, object.y, seconds, art.killer);
    }
    // The others as ghosts, then this pane's own bike on top.
    for (const [other, ghost] of view.riders.entries()) {
      if (other === slot || !seen(ghost.bike.x, ghost.bike.y)) continue;
      g.globalAlpha = ghost.status === "dead" ? 0.2 : 0.4;
      drawBike(g, ghost.bike, {
        color: slotColor(other),
        sprites: art.bike?.(other),
      });
    }
    g.globalAlpha = rider.status === "dead" ? 0.55 : 1;
    drawBike(g, rider.bike, {
      color: slotColor(slot),
      sprites: art.bike?.(slot),
    });
    g.globalAlpha = 1;
    effects.draw(g, slot);
    g.restore();

    // Words, in pixels.
    const unit = Math.max(8, Math.min(14, pane.w / scale / 52)) * scale;
    for (const [other, ghost] of view.riders.entries()) {
      const name = shot.names?.[other];
      if (other === slot || !name || !seen(ghost.bike.x, ghost.bike.y))
        continue;
      const at = toScreen(window, ghost.bike.head.x, ghost.bike.head.y + 0.55);
      g.globalAlpha = 0.75;
      text(
        name,
        at.x,
        at.y - unit * 0.7,
        unit * 0.62,
        slotColor(other),
        "center",
      );
      g.globalAlpha = 1;
    }
    const hud = paneHud(view, slot);
    if (hud) {
      const pad = unit * 0.9;
      let y = pane.y + pad;
      const left = pane.x + pad;
      const split = shot.follow.length > 1;
      if (split && shot.names?.[slot]) {
        text(shot.names[slot], left, y, unit * 0.8, slotColor(slot));
        y += unit * 1.5;
      }
      text(hud.clock, left, y, unit * 1.5, WHITE);
      y += unit * 2.3;
      text(
        `APPLES ${hud.apples}`,
        left,
        y,
        unit * 0.8,
        ready ? "#4dff7c" : GOLD,
      );
      y += unit * 1.5;
      if (hud.place) {
        text(hud.place, left, y, unit * 0.8, slotColor(slot));
        y += unit * 1.5;
      }
      if (hud.closing) text(hud.closing, left, y, unit * 0.8, PINK);
      if (hud.banner) {
        const big = hud.tone === "count" || hud.tone === "go";
        const size = Math.min(
          unit * (big ? 4 : 1.5),
          (pane.w * 0.9) / Math.max(1, hud.banner.length),
        );
        text(
          hud.banner,
          pane.x + pane.w / 2,
          pane.y + pane.h * 0.24,
          size,
          TONES[hud.tone],
          "center",
        );
      }
    }
    g.restore();
  };

  return {
    resize,
    draw(view, nowMs, shot) {
      const nothing: Drawn = { cues: [], rev: 0, gas: false };
      if (destroyed || !g) return nothing;
      const scale = pixelRatio();
      if (
        canvas.width !== Math.max(1, Math.round(canvas.clientWidth * scale)) ||
        canvas.height !== Math.max(1, Math.round(canvas.clientHeight * scale))
      )
        resize();
      const map = LEVELS[view.level];
      if (!map) return nothing;
      const dt = lastMs < 0 ? 0 : Math.max(0, Math.min(100, nowMs - lastMs));
      lastMs = nowMs;
      if (view.level !== level) {
        // Another level: the cameras, the sparks and the last view belong to the one before.
        level = view.level;
        follows.clear();
        effects.clear();
        last = undefined;
      }
      if (!tileAsked && options.createCanvas) {
        tileAsked = true;
        tile = groundTile(options.createCanvas);
      }
      const cues = gate(cuesBetween(last, view), nowMs);
      react(cues, view);

      // The local rider's engine: how fast its driven wheel turned since the last frame.
      const mine = view.riders[shot.local],
        was = last?.riders[shot.local];
      let spin = 0;
      if (mine && was && dt > 0 && mine.status === "riding") {
        const now = mine.bike.flipped ? mine.bike.right : mine.bike.left,
          then = mine.bike.flipped ? was.bike.right : was.bike.left;
        const turned = Math.abs(now.rot - then.rot);
        // A wrapped angle or a restart is not a spin.
        if (turned < Math.PI)
          spin = Math.min(1, ((turned / dt) * 1000) / TOP_SPIN);
      }
      rev += (spin - rev) * (1 - Math.exp(-dt / 90));
      if (!mine || mine.status !== "riding" || view.phase !== "racing") rev = 0;

      if (view.phase === "racing")
        for (const slot of shot.follow) {
          const rider = view.riders[slot];
          if (rider) dust(map, rider, slot, dt / 1000);
        }
      effects.step(dt / 1000);
      last = view;

      const seconds = nowMs / 1000;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.fillStyle = INK;
      g.fillRect(0, 0, canvas.width, canvas.height);
      const slots = shot.follow.filter((slot) => view.riders[slot]);
      const panes = paneGrid(slots.length || 1, canvas.width, canvas.height);
      const art = options.art?.() ?? {};
      slots.forEach((slot, index) => {
        const pane = panes[index];
        if (pane)
          drawPane(view, map, pane, slot, seconds, dt, shot, art, scale);
      });
      if (shot.title) {
        const unit =
          Math.max(8, Math.min(13, canvas.width / scale / 60)) * scale;
        g.globalAlpha = 0.8;
        text(
          shot.title,
          canvas.width / 2,
          canvas.height - unit * 1.9,
          unit * 0.72,
          CYAN,
          "center",
        );
        g.globalAlpha = 1;
      }
      return {
        cues,
        rev,
        gas: !!mine && mine.gas && mine.status === "riding",
      };
    },
    destroy() {
      destroyed = true;
      effects.clear();
      follows.clear();
    },
  };
}
