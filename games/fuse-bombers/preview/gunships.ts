/**
 * Dev-only gunship sheet: `pnpm exec vite`, then open /games/fuse-bombers/preview/gunships.html. It is not in the build.
 * Six gunships in the six player colours per row, one row per state, ghosts underneath, at 1× on the night sky; on the
 * right the same sheet at 0.35× (the big map's widest camera) on the night and the day sky. `?t=SECONDS` runs the
 * animation to that moment and freezes it (for screenshots); `?circles` outlines the hit circles, `?day` puts the 1× sheet on the day sky.
 */
import Phaser from "phaser";
import {
  GhostArt,
  GHOST_RADIUS,
  GunshipArt,
  GUNSHIP_RADIUS,
  type GhostState,
  type GunshipState,
} from "../src/render/gunship-art.js";
import { PLAYER_COLORS } from "../src/render/palette.js";

const WIDTH = 1600;
const HEIGHT = 900;
const SHEET = { x0: 250, dx: 135, y0: 105, dy: 122, width: 1030 } as const;
const ROWS = [
  "loaded",
  "flying",
  "reloading\n+ shield",
  "damaged\n+ hits",
  "ghosts",
  "wreck",
] as const;
const MINI_ZOOM = 0.35;
/** The moment the committed screenshot is taken (`?t=2.3`), and the wreck row's loop: 2 s down, 1.4 s flying. */
const SHOT_T = 2.3;
const WRECK_CYCLE = 3.4;
const TURN = (2 * Math.PI) / 3.6;

const params = new URLSearchParams(location.search);
const freezeAt = params.has("t") ? Number(params.get("t")) : undefined;
const circles = params.has("circles");
/** `?day` puts the 1× sheet on the day sky instead of the night sky. */
const NIGHT = params.has("day") ? "#7dc0f5" : "#0a1226";
/** `?zoom=3&at=250,105` magnifies the 1× view around a point, to check details. */
const zoom = Number(params.get("zoom") ?? 1);
const [atX, atY] = (params.get("at") ?? "").split(",").map(Number);

/** An 8-way held-bit direction toward (ax, ay), as `thrustDirection` would give it. */
function heldToward(ax: number, ay: number): { x: number; y: number } {
  const m = Math.hypot(ax, ay);
  if (m < 1e-6) return { x: 0, y: 0 };
  const x = Math.abs(ax) > 0.38 * m ? Math.sign(ax) : 0;
  const y = Math.abs(ay) > 0.38 * m ? Math.sign(ay) : 0;
  const s = x !== 0 && y !== 0 ? Math.SQRT1_2 : 1;
  return { x: x * s, y: y * s };
}

/** A path around (cx, cy) with its velocity and the held direction that would steer it. */
function orbit(
  cx: number,
  cy: number,
  t: number,
  phase: number,
  rx: number,
  ry: number,
) {
  const w = 1.25;
  const a = w * t + phase;
  const held = heldToward(-rx * Math.cos(a), -ry * 4 * Math.sin(2 * a));
  return {
    x: cx + rx * Math.cos(a),
    y: cy + ry * Math.sin(2 * a),
    vx: -rx * w * Math.sin(a),
    vy: 2 * ry * w * Math.cos(2 * a),
    thrustX: held.x,
    thrustY: held.y,
  };
}

class Sheet extends Phaser.Scene {
  private ships: { art: GunshipArt; row: number; col: number }[] = [];
  private ghosts: { art: GhostArt; col: number }[] = [];
  private clock = 0;

  create(): void {
    const main = this.cameras.main;
    main.setViewport(0, 0, SHEET.width, HEIGHT).setBackgroundColor(NIGHT);
    main.centerOn(SHEET.width / 2, HEIGHT / 2);
    if (zoom > 0 && zoom !== 1)
      main.setZoom(zoom).centerOn(atX ?? SHEET.width / 2, atY ?? HEIGHT / 2);
    const labels: Phaser.GameObjects.GameObject[] = [];
    const text = (
      x: number,
      y: number,
      s: string,
      size = 15,
      color = "#c9d4f2",
    ) =>
      labels.push(
        this.add
          .text(x, y, s, {
            fontFamily: "monospace",
            fontSize: `${size}px`,
            color,
            align: "left",
          })
          .setOrigin(0, 0.5),
      );
    text(24, 28, "FUSE BOMBERS · GUNSHIPS", 20, "#ffe08a");
    text(24, 52, "1× · launcher turning a full circle", 13, "#7f8db3");
    ROWS.forEach((label, row) =>
      text(24, SHEET.y0 + row * SHEET.dy, label.toUpperCase(), 14),
    );

    const hit = this.add.graphics().setDepth(100);
    labels.push(hit);
    PLAYER_COLORS.forEach((_, col) => {
      ROWS.forEach((label, row) => {
        if (label === "ghosts") return;
        this.ships.push({ art: new GunshipArt(this, 10 + row), row, col });
        if (circles) {
          hit.lineStyle(1, 0xffffff, 0.35);
          hit.strokeCircle(
            SHEET.x0 + col * SHEET.dx,
            SHEET.y0 + row * SHEET.dy,
            GUNSHIP_RADIUS,
          );
        }
      });
      this.ghosts.push({ art: new GhostArt(this, 20), col });
      if (circles) {
        hit.lineStyle(1, 0xffffff, 0.35);
        const y = SHEET.y0 + ROWS.indexOf("ghosts") * SHEET.dy;
        hit.strokeCircle(SHEET.x0 + col * SHEET.dx, y, GHOST_RADIUS);
      }
    });

    const centre = {
      x: SHEET.x0 + 2.5 * SHEET.dx,
      y: SHEET.y0 + 2.5 * SHEET.dy,
    };
    // The labels of these two views are in gunships.html: text under a zoomed camera would shrink with it.
    for (const [y, sky] of [
      [10, "#0a1226"],
      [HEIGHT / 2 + 5, "#7dc0f5"],
    ] as const)
      this.cameras
        .add(SHEET.width + 10, y, WIDTH - SHEET.width - 20, HEIGHT / 2 - 15)
        .setZoom(MINI_ZOOM)
        .setBackgroundColor(sky)
        .centerOn(centre.x, centre.y)
        .ignore(labels);

    if (freezeAt !== undefined && Number.isFinite(freezeAt)) {
      for (let t = 0; t < freezeAt; t += 1 / 60) this.tick(1 / 60);
    }
  }

  update(_time: number, delta: number): void {
    if (freezeAt === undefined) this.tick(Math.min(delta, 100) / 1000);
  }

  private tick(dt: number): void {
    const t = (this.clock += dt);
    for (const { art, row, col } of this.ships) {
      const cx = SHEET.x0 + col * SHEET.dx;
      const cy = SHEET.y0 + row * SHEET.dy;
      art.update(
        {
          color: PLAYER_COLORS[col]!,
          seed: col,
          facing: col % 2 === 0 ? 1 : -1,
        },
        this.state(ROWS[row]!, col, cx, cy, t),
        dt,
      );
    }
    for (const { art, col } of this.ghosts) {
      const row = ROWS.indexOf("ghosts");
      const o = orbit(
        SHEET.x0 + col * SHEET.dx,
        SHEET.y0 + row * SHEET.dy,
        t,
        col * 1.1,
        22,
        7,
      );
      const ghost: GhostState = { ...o, loaded: col % 2 === 0 };
      art.update(
        {
          color: PLAYER_COLORS[col]!,
          seed: col,
          facing: col % 2 === 0 ? 1 : -1,
        },
        ghost,
        dt,
      );
    }
  }

  private state(
    row: (typeof ROWS)[number],
    col: number,
    cx: number,
    cy: number,
    t: number,
  ): GunshipState {
    const angle = t * TURN + col * (Math.PI / 3);
    const still = { x: cx, y: cy, vx: 0, vy: 0, thrustX: 0, thrustY: 0 };
    const base = {
      ...still,
      angle,
      hp: 100,
      maxHp: 100,
      shield: 0,
      loaded: true,
      reload: 1,
      alive: true,
    };
    switch (row) {
      case "loaded":
        return base;
      case "flying":
        return {
          ...base,
          ...orbit(cx, cy, t, col * 0.8, 26, 9),
          loaded: col % 2 === 0,
        };
      case "reloading\n+ shield": {
        const shield = [1, 0, 0.6, 0, 0.3, 0][col] ?? 0;
        // Column 0's shield takes a hit every two seconds, the last one just before the screenshot.
        const hits = col === 0 ? Math.floor((t - SHOT_T + 2.06) / 2) % 4 : 0;
        return {
          ...base,
          loaded: false,
          reload: (t * 0.4 + col / 6) % 1,
          shield: Math.max(0, shield - hits * 0.2),
        };
      }
      case "damaged\n+ hits": {
        const floor = col < 3 ? 45 : 20;
        // Columns 2 and 5 were hit just before the screenshot, so it shows their flash.
        const offset = [0.7, 0.3, 0, 1.1, 0.5, 0][col] ?? 0;
        const hits = Math.floor((t - SHOT_T + 1.65 + offset) / 1.6) % 4;
        return { ...base, hp: floor - hits * 2, thrustY: col === 4 ? -1 : 0 };
      }
      case "wreck": {
        // At the screenshot moment the columns show the ship just before, and 0.03, 0.12, 0.3, 0.6 and 1 s into, its wreck.
        const since = [-0.5, 0.03, 0.12, 0.3, 0.6, 1][col] ?? 0;
        const deadFor =
          (((t - SHOT_T + since) % WRECK_CYCLE) + WRECK_CYCLE) % WRECK_CYCLE;
        return { ...base, alive: deadFor >= WRECK_CYCLE - 1.4, hp: 20 };
      }
      default:
        return base;
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#050912",
  banner: false,
  audio: { noAudio: true },
  scene: Sheet,
});
