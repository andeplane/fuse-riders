import {
  DOCKS_PX,
  FLOOR_PX,
  VIEW_H,
  VIEW_W,
  type Rect,
} from "../engine/view-kit.js";
import { DEPOT, hexA } from "./palette.js";
import {
  SPRITE_SCALE,
  drawCargo,
  roundRect,
  tint,
  type MakeSurface,
  type Paint,
  type Surface,
} from "./sprites.js";

/**
 * The depot at night, painted once: the quay and the water round it, the brass-railed wall with its lamps, the tiled
 * floor with its grates, and the two loading docks. The docks' moving lights are drawn every frame by `drawDocks`.
 */

/** A cosmetic hash for the floor's variety: the same depot every time, from nothing but the tile's place. */
export function noise(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 0x1_0000_0000;
}

const WALL = 12;
const TILE = 32;

export function createBackdrop(make: MakeSurface): Surface {
  const surface = make(VIEW_W * SPRITE_SCALE, VIEW_H * SPRITE_SCALE);
  const g = surface.getContext("2d") as Paint;
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  paintQuay(g);
  paintFloor(g, FLOOR_PX);
  DOCKS_PX.forEach((dock, index) => paintDock(g, dock, index));
  paintWall(g, FLOOR_PX);
  paintLamps(g, FLOOR_PX);
  return surface;
}

function paintQuay(g: Paint): void {
  g.fillStyle = DEPOT.night;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  // Planks round the depot, darker toward the edges of the screen.
  for (let y = 0; y < VIEW_H; y += 9)
    for (let x = (y / 9) % 2 ? -20 : 0; x < VIEW_W; x += 40) {
      const shade = 0.05 + noise(x, y) * 0.07;
      g.fillStyle = `rgba(140,110,90,${shade})`;
      g.fillRect(x + 1, y + 1, 38, 7);
    }
  const vignette = g.createRadialGradient(
    VIEW_W / 2,
    VIEW_H / 2,
    200,
    VIEW_W / 2,
    VIEW_H / 2,
    620,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,12,0.75)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  // Water along the bottom edge, with lamp light on it.
  const water = g.createLinearGradient(0, VIEW_H - 22, 0, VIEW_H);
  water.addColorStop(0, "#0b1a3a");
  water.addColorStop(1, "#050b1d");
  g.fillStyle = water;
  g.fillRect(0, VIEW_H - 20, VIEW_W, 20);
  for (let i = 0; i < 60; i++) {
    const x = noise(i, 3) * VIEW_W,
      y = VIEW_H - 18 + noise(i, 7) * 16;
    g.fillStyle = hexA(DEPOT.lamp, 0.12 + noise(i, 9) * 0.2);
    g.fillRect(x, y, 6 + noise(i, 11) * 14, 1);
  }
  // Stacked cargo and barrels on the quay beside the depot.
  const props: [number, number, number][] = [
    [20, 40, 0],
    [36, 58, 1],
    [22, 470, 0],
    [940, 40, 3],
    [924, 60, 0],
    [940, 470, 1],
    [930, 452, 0],
    [20, 150, 2],
    [940, 150, 0],
    [20, 400, 1],
    [940, 400, 3],
  ];
  for (const [x, y, kind] of props) {
    g.save();
    g.translate(x, y);
    g.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(g, -8, -6, 18, 15, 3);
    g.fill();
    drawCargo(g, kind);
    g.restore();
  }
  // Cranes' gantries in the corners, as dark silhouettes against the night.
  g.strokeStyle = "#1a1826";
  g.lineWidth = 3;
  for (const [x, flip] of [
    [8, 1],
    [952, -1],
  ] as const) {
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x + flip * 44, 4);
    g.moveTo(x + flip * 8, 0);
    g.lineTo(x + flip * 8, 30);
    g.stroke();
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(x + flip * i * 9, 4);
      g.lineTo(x + flip * (i * 9 + 9), 0);
      g.stroke();
    }
    g.lineWidth = 3;
  }
}

function paintFloor(g: Paint, floor: Rect): void {
  g.fillStyle = DEPOT.grout;
  g.fillRect(
    floor.left,
    floor.top,
    floor.right - floor.left,
    floor.bottom - floor.top,
  );
  for (let y = floor.top; y < floor.bottom; y += TILE)
    for (let x = floor.left; x < floor.right; x += TILE) {
      const n = noise(x, y),
        w = Math.min(TILE, floor.right - x) - 1.5,
        h = Math.min(TILE, floor.bottom - y) - 1.5;
      g.fillStyle =
        n < 0.33
          ? DEPOT.floor
          : n < 0.8
            ? tint(DEPOT.floor, 0.04)
            : DEPOT.floorLight;
      g.fillRect(x + 0.75, y + 0.75, w, h);
      // A worn corner now and then.
      if (noise(y, x) > 0.86) {
        g.fillStyle = "rgba(255,255,255,0.025)";
        g.fillRect(x + 3, y + 3, w / 2, h / 3);
      }
    }
  // Grates and manhole covers, never on the docks.
  const spots: [number, number, "grate" | "cover"][] = [
    [260, 150, "grate"],
    [690, 170, "cover"],
    [470, 420, "grate"],
    [240, 400, "cover"],
    [720, 410, "grate"],
    [480, 128, "cover"],
  ];
  for (const [x, y, kind] of spots) {
    if (kind === "grate") {
      g.fillStyle = "#0e131d";
      roundRect(g, x - 14, y - 11, 28, 22, 2);
      g.fill();
      g.strokeStyle = "#2c3548";
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = "#05070c";
      for (let i = -10; i <= 8; i += 4) g.fillRect(x + i, y - 8, 2, 16);
    } else {
      g.beginPath();
      g.arc(x, y, 12, 0, Math.PI * 2);
      g.fillStyle = "#151b28";
      g.fill();
      g.strokeStyle = "#323c52";
      g.lineWidth = 1.5;
      g.stroke();
      g.strokeStyle = "#232b3c";
      g.lineWidth = 1;
      for (let r = 4; r < 11; r += 3) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }
  // Oil stains.
  for (let i = 0; i < 9; i++) {
    const x = floor.left + 60 + noise(i, 21) * (floor.right - floor.left - 120),
      y = floor.top + 40 + noise(i, 23) * (floor.bottom - floor.top - 80),
      r = 10 + noise(i, 25) * 18;
    const stain = g.createRadialGradient(x, y, 0, x, y, r);
    stain.addColorStop(0, "rgba(0,0,0,0.28)");
    stain.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = stain;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.7, noise(i, 27) * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Painted lane marks round the middle of the floor.
  g.strokeStyle = "rgba(242,182,50,0.11)";
  g.lineWidth = 3;
  g.setLineDash([14, 12]);
  g.beginPath();
  g.ellipse(
    (floor.left + floor.right) / 2,
    (floor.top + floor.bottom) / 2,
    250,
    128,
    0,
    0,
    Math.PI * 2,
  );
  g.stroke();
  g.setLineDash([]);
}

function hazard(g: Paint, x: number, y: number, w: number, h: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = "#15120a";
  g.fillRect(x, y, w, h);
  g.fillStyle = DEPOT.hazard;
  for (let i = -h; i < w + h; i += 10) {
    g.beginPath();
    g.moveTo(x + i, y);
    g.lineTo(x + i + 5, y);
    g.lineTo(x + i + 5 - h, y + h);
    g.lineTo(x + i - h, y + h);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function paintDock(g: Paint, dock: Rect, index: number): void {
  const w = dock.right - dock.left,
    h = dock.bottom - dock.top,
    left = index === 0;
  // The bay: a darker, lit floor.
  const light = g.createLinearGradient(
    left ? dock.left : dock.right,
    0,
    left ? dock.right : dock.left,
    0,
  );
  light.addColorStop(0, "rgba(255,196,90,0.28)");
  light.addColorStop(1, "rgba(255,196,90,0.05)");
  g.fillStyle = "#0f1522";
  g.fillRect(dock.left, dock.top, w, h);
  g.fillStyle = light;
  g.fillRect(dock.left, dock.top, w, h);
  // Hazard stripes along its open sides.
  hazard(g, dock.left, dock.top - 5, w, 5);
  hazard(g, dock.left, dock.bottom, w, 5);
  // The station on the quay behind the wall: a gate with a lit doorway.
  const gx = left ? 4 : VIEW_W - 50,
    gy = dock.top - 14;
  g.fillStyle = "#1b1622";
  roundRect(g, gx, gy, 46, h + 28, 4);
  g.fill();
  g.strokeStyle = DEPOT.brassDark;
  g.lineWidth = 2;
  g.stroke();
  const door = g.createLinearGradient(gx, 0, gx + 46, 0);
  door.addColorStop(left ? 0 : 1, "rgba(255,196,90,0.1)");
  door.addColorStop(left ? 1 : 0, "rgba(255,210,120,0.75)");
  g.fillStyle = door;
  roundRect(g, gx + 8, dock.top + 6, 38, h - 12, 3);
  g.fill();
  // Rivets.
  g.fillStyle = DEPOT.brass;
  for (let i = 0; i < 6; i++) {
    g.fillRect(gx + 3, gy + 6 + i * ((h + 16) / 5), 2, 2);
    g.fillRect(gx + 41, gy + 6 + i * ((h + 16) / 5), 2, 2);
  }
}

function paintWall(g: Paint, floor: Rect): void {
  const outer = {
    left: floor.left - WALL,
    top: floor.top - WALL,
    right: floor.right + WALL,
    bottom: floor.bottom + WALL,
  };
  g.save();
  g.beginPath();
  g.rect(
    outer.left,
    outer.top,
    outer.right - outer.left,
    outer.bottom - outer.top,
  );
  g.rect(
    floor.left,
    floor.top,
    floor.right - floor.left,
    floor.bottom - floor.top,
  );
  g.clip("evenodd");
  g.fillStyle = DEPOT.wall;
  g.fillRect(
    outer.left,
    outer.top,
    outer.right - outer.left,
    outer.bottom - outer.top,
  );
  // Iron plates with rivets.
  g.strokeStyle = "#17141c";
  g.lineWidth = 1;
  for (let x = outer.left; x < outer.right; x += 40) {
    g.beginPath();
    g.moveTo(x, outer.top);
    g.lineTo(x, outer.top + WALL);
    g.moveTo(x, outer.bottom - WALL);
    g.lineTo(x, outer.bottom);
    g.stroke();
  }
  for (let y = outer.top; y < outer.bottom; y += 40) {
    g.beginPath();
    g.moveTo(outer.left, y);
    g.lineTo(outer.left + WALL, y);
    g.moveTo(outer.right - WALL, y);
    g.lineTo(outer.right, y);
    g.stroke();
  }
  g.fillStyle = "#7d6a55";
  for (let x = outer.left + 6; x < outer.right; x += 20) {
    g.fillRect(x, outer.top + 3, 1.6, 1.6);
    g.fillRect(x, outer.bottom - 5, 1.6, 1.6);
  }
  for (let y = outer.top + 6; y < outer.bottom; y += 20) {
    g.fillRect(outer.left + 3, y, 1.6, 1.6);
    g.fillRect(outer.right - 5, y, 1.6, 1.6);
  }
  g.restore();
  // The brass rail along the floor's edge, open at the docks.
  g.strokeStyle = DEPOT.brass;
  g.lineWidth = 2.5;
  g.strokeRect(
    floor.left - 1.5,
    floor.top - 1.5,
    floor.right - floor.left + 3,
    floor.bottom - floor.top + 3,
  );
  g.strokeStyle = hexA(DEPOT.brassLight, 0.5);
  g.lineWidth = 0.8;
  g.strokeRect(
    floor.left - 2.6,
    floor.top - 2.6,
    floor.right - floor.left + 5.2,
    floor.bottom - floor.top + 5.2,
  );
  for (const dock of DOCKS_PX) {
    const x =
      dock.left === floor.left ? floor.left - WALL - 1 : floor.right - 1;
    g.fillStyle = "#0f1522";
    g.fillRect(x, dock.top, WALL + 2, dock.bottom - dock.top);
  }
}

function paintLamps(g: Paint, floor: Rect): void {
  const lamps: [number, number][] = [];
  for (let x = floor.left + 60; x < floor.right - 30; x += 140)
    lamps.push([x, floor.top - 6], [x + 70, floor.bottom + 6]);
  for (const y of [floor.top + 60, floor.bottom - 60])
    lamps.push([floor.left - 6, y], [floor.right + 6, y]);
  g.save();
  g.globalCompositeOperation = "lighter";
  for (const [x, y] of lamps) {
    const glow = g.createRadialGradient(x, y, 0, x, y, 80);
    glow.addColorStop(0, "rgba(255,190,90,0.22)");
    glow.addColorStop(0.4, "rgba(255,170,70,0.08)");
    glow.addColorStop(1, "rgba(255,160,60,0)");
    g.fillStyle = glow;
    g.fillRect(x - 80, y - 80, 160, 160);
  }
  g.restore();
  for (const [x, y] of lamps) {
    g.fillStyle = "#14121a";
    roundRect(g, x - 4, y - 4, 8, 8, 2);
    g.fill();
    g.beginPath();
    g.arc(x, y, 2.6, 0, Math.PI * 2);
    g.fillStyle = "#ffe2a0";
    g.fill();
  }
}

/** The docks' live parts: chevrons running into the wall, brighter as the round runs out, and the DELIVER signs. */
export function drawDocks(
  g: Paint,
  time: number,
  urgency: number,
  busy: readonly boolean[],
): void {
  DOCKS_PX.forEach((dock, index) => {
    const left = index === 0,
      cy = (dock.top + dock.bottom) / 2,
      w = dock.right - dock.left;
    g.save();
    g.beginPath();
    g.rect(dock.left, dock.top, w, dock.bottom - dock.top);
    g.clip();
    for (let i = 0; i < 4; i++) {
      const phase = (((time / 700 + i / 4) % 1) + 1) % 1,
        x = left ? dock.right - phase * w : dock.left + phase * w,
        alpha =
          (0.15 + 0.35 * urgency + (busy[index] ? 0.3 : 0)) *
          Math.sin(phase * Math.PI);
      g.strokeStyle = hexA(DEPOT.lamp, Math.max(0, alpha));
      g.lineWidth = 4;
      g.beginPath();
      const dir = left ? -1 : 1;
      g.moveTo(x - dir * 8, cy - 22);
      g.lineTo(x + dir * 6, cy);
      g.lineTo(x - dir * 8, cy + 22);
      g.stroke();
    }
    g.restore();
    // The sign above the bay.
    const sx = left ? dock.left + 40 : dock.right - 40,
      sy = dock.top - 20;
    g.fillStyle = "#0d0f19";
    roundRect(g, sx - 34, sy - 9, 68, 18, 3);
    g.fill();
    g.strokeStyle = hexA(DEPOT.lamp, 0.55 + 0.45 * urgency);
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle =
      urgency > 0 && Math.floor(time / 300) % 2 ? "#fff1c4" : DEPOT.lamp;
    g.font = "8px 'Press Start 2P', monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("DELIVER", sx, sy + 1);
  });
}
