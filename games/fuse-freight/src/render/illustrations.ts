import { DEPOT, hexA, seatColor } from "./palette.js";
import {
  SPRITE_SCALE,
  blit,
  createSprites,
  drawLoco,
  drawWagon,
  roundRect,
  type MakeSurface,
  type Paint,
  type Sprites,
  type Surface,
} from "./sprites.js";
import { seatShade } from "./palette.js";

/**
 * The pictures around the game: the lobby's five loading bays with a train parked in each taken one, the four
 * how-to-play panels (steer, collect, steal, deliver) as little looping animations, and the train icon on every HUD
 * card. They use the depot's own sprites and are cosmetic only: none of them runs the rules.
 */
const FONT = "'Press Start 2P', monospace";

/** A locomotive pulling one wagon, facing right, for a card or a roster row. */
export function trainIcon(make: MakeSurface, slot: number): Surface {
  const width = 64,
    height = 28;
  const surface = make(width * SPRITE_SCALE, height * SPRITE_SCALE);
  const g = surface.getContext("2d") as Paint;
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  g.save();
  g.translate(16, height / 2);
  drawWagon(g, seatColor(slot), seatShade(slot), 0);
  g.restore();
  g.save();
  g.translate(42, height / 2);
  drawLoco(g, seatColor(slot), seatShade(slot));
  g.restore();
  return surface;
}

export interface Bay {
  slot: number;
  /** A train is parked here: the seat is taken. */
  taken: boolean;
  you: boolean;
}

/** The lobby's loading bays, 480×190 logical: numbered doors, one train in each taken bay. */
export function createBays(g: Paint, make: MakeSurface) {
  const sprites = createSprites(make);
  return {
    draw(bays: readonly Bay[], time: number): void {
      const W = 480,
        H = 190;
      g.fillStyle = DEPOT.night;
      g.fillRect(0, 0, W, H);
      g.fillStyle = DEPOT.floor;
      g.fillRect(0, 70, W, H - 70);
      for (let x = 0; x < W; x += 24) {
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(x, 70, 1, H - 70);
      }
      const width = W / 5;
      bays.forEach((bay, index) => {
        const x = index * width,
          color = seatColor(bay.slot);
        // The shed front and its door.
        g.fillStyle = "#1c1826";
        g.fillRect(x + 4, 8, width - 8, 64);
        g.fillStyle = bay.taken ? hexA(DEPOT.lamp, 0.5) : "#0b0d16";
        roundRect(g, x + 14, 30, width - 28, 42, 6);
        g.fill();
        g.strokeStyle = DEPOT.brassDark;
        g.lineWidth = 2;
        g.stroke();
        // The number plate.
        g.fillStyle = "#07080e";
        roundRect(g, x + width / 2 - 13, 10, 26, 18, 3);
        g.fill();
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.stroke();
        g.fillStyle = color;
        g.font = `10px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(bay.slot + 1), x + width / 2, 20);
        // The lane painted in front of it.
        g.strokeStyle = hexA(color, bay.taken ? 0.8 : 0.25);
        g.lineWidth = 2;
        g.strokeRect(x + 12, 76, width - 24, H - 84);
        if (bay.taken) {
          const bob = Math.sin(time / 400 + index) * 0.6;
          blit(
            g,
            sprites.wagon(bay.slot, index % 4),
            x + width / 2,
            170 + bob,
            -Math.PI / 2,
          );
          blit(
            g,
            sprites.wagon(bay.slot, (index + 2) % 4),
            x + width / 2,
            136 + bob,
            -Math.PI / 2,
          );
          blit(
            g,
            sprites.loco(bay.slot),
            x + width / 2,
            97 + bob,
            -Math.PI / 2,
          );
          const glow = g.createRadialGradient(
            x + width / 2,
            66,
            2,
            x + width / 2,
            66,
            30,
          );
          glow.addColorStop(0, hexA(color, 0.35));
          glow.addColorStop(1, hexA(color, 0));
          g.fillStyle = glow;
          g.fillRect(x + width / 2 - 30, 36, 60, 60);
          if (bay.you) {
            g.fillStyle = "#ffffff";
            g.font = `7px ${FONT}`;
            g.fillText("YOU", x + width / 2, 40);
          }
        } else {
          g.fillStyle = "#4b5068";
          g.font = `7px ${FONT}`;
          g.fillText("OPEN", x + width / 2, 130);
        }
      });
    },
  };
}

export const RULES = ["steer", "collect", "steal", "deliver"] as const;
export type Rule = (typeof RULES)[number];

/** One how-to-play panel's animation on a 240×120 logical canvas. */
export function createRulePanel(g: Paint, make: MakeSurface, rule: Rule) {
  const sprites = createSprites(make);
  return {
    draw(time: number): void {
      const W = 240,
        H = 120;
      g.fillStyle = DEPOT.floor;
      g.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 24)
        for (let y = 0; y < H; y += 24) {
          g.fillStyle =
            (x + y) % 48 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.12)";
          g.fillRect(x + 1, y + 1, 22, 22);
        }
      const t = (((time / 4000) % 1) + 1) % 1;
      switch (rule) {
        case "steer":
          steer(g, sprites, t);
          break;
        case "collect":
          collect(g, sprites, t);
          break;
        case "steal":
          steal(g, sprites, t);
          break;
        case "deliver":
          deliver(g, sprites, t, time);
          break;
      }
    },
  };
}

/** A train along `path(s)`, its locomotive at `s`, `wagons` behind it; its heading from the path's slope. */
function train(
  g: Paint,
  sprites: Sprites,
  slot: number,
  path: (s: number) => [number, number],
  s: number,
  kinds: readonly number[],
): void {
  const angle = (at: number) => {
    const [ax, ay] = path(at - 2),
      [bx, by] = path(at + 2);
    return Math.atan2(by - ay, bx - ax);
  };
  kinds.forEach((kind, index) => {
    const at = s - 40 - index * 34,
      [x, y] = path(at);
    blit(g, sprites.wagon(slot, kind), x, y, angle(at));
  });
  const [x, y] = path(s);
  blit(g, sprites.loco(slot), x, y, angle(s));
}

function key(
  g: Paint,
  x: number,
  y: number,
  label: string,
  lit: boolean,
): void {
  g.fillStyle = lit ? hexA("#27e3ff", 0.35) : "rgba(6,8,16,0.7)";
  roundRect(g, x - 12, y - 11, 24, 22, 4);
  g.fill();
  g.strokeStyle = lit ? "#27e3ff" : "#3a4260";
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = lit ? "#ffffff" : "#8b93b0";
  g.font = `9px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, x, y + 1);
}

function steer(g: Paint, sprites: Sprites, t: number): void {
  // The train weaves up the panel: a left, then a right.
  const path = (s: number): [number, number] => [
    120 + Math.sin(s / 38) * 34,
    150 - s,
  ];
  const s = 20 + t * 190;
  train(g, sprites, 0, path, s, [0, 3]);
  const slope = Math.cos(s / 38);
  key(g, 30, 60, "◀", slope > 0.25);
  key(g, 210, 60, "▶", slope < -0.25);
}

function collect(g: Paint, sprites: Sprites, t: number): void {
  const path = (s: number): [number, number] => [s, 66];
  const s = -20 + t * 300,
    cartX = 150;
  const coupled = s > cartX + 4;
  if (!coupled) {
    blit(g, sprites.cart(1), cartX, 66, 0.3);
    g.strokeStyle = hexA(DEPOT.lamp, 0.4 + 0.3 * Math.sin(t * 40));
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cartX, 66, 17, 0, Math.PI * 2);
    g.stroke();
  }
  train(g, sprites, 0, path, s, coupled ? [0, 1] : [0]);
  if (coupled && s < cartX + 70) {
    g.fillStyle = "#27e3ff";
    g.font = `9px ${FONT}`;
    g.textAlign = "center";
    g.fillText("+1 WAGON", s - 40, 36);
  }
}

function steal(g: Paint, sprites: Sprites, t: number): void {
  // Magenta runs right with three wagons; cyan cuts up across its tail.
  const pink = (s: number): [number, number] => [s, 50];
  const s = 60 + t * 190;
  const crossX = 120,
    cut = s - 40 - 34 > crossX + 6;
  train(g, sprites, 1, pink, s, cut ? [2] : [2, 0, 3]);
  if (cut) {
    const since = Math.min(1, (s - 40 - 34 - crossX - 6) / 60);
    blit(
      g,
      sprites.cart(0),
      crossX - 4 - since * 10,
      50 - since * 14,
      0.4 + since,
    );
    blit(
      g,
      sprites.cart(3),
      crossX - 30 - since * 6,
      50 + since * 16,
      -0.3 - since,
    );
    if (since < 0.8) {
      g.fillStyle = "#27e3ff";
      g.font = `10px ${FONT}`;
      g.textAlign = "center";
      g.fillText("CUT!", crossX, 20);
      g.fillStyle = "#fff3b0";
      for (let i = 0; i < 8; i++) {
        const a = i * 0.8 + since * 3;
        g.fillRect(
          crossX + Math.cos(a) * since * 26,
          50 + Math.sin(a) * since * 22,
          2,
          2,
        );
      }
    }
  }
  const cyan = (u: number): [number, number] => [crossX + 2, 140 - u];
  train(g, sprites, 0, cyan, -20 + t * 230, [1]);
}

function deliver(g: Paint, sprites: Sprites, t: number, time: number): void {
  // The dock on the right.
  g.fillStyle = "#0f1522";
  g.fillRect(180, 30, 60, 70);
  const light = g.createLinearGradient(240, 0, 180, 0);
  light.addColorStop(0, "rgba(255,196,90,0.45)");
  light.addColorStop(1, "rgba(255,196,90,0.05)");
  g.fillStyle = light;
  g.fillRect(180, 30, 60, 70);
  g.fillStyle = DEPOT.hazard;
  for (let x = 180; x < 240; x += 10) {
    g.fillRect(x, 26, 5, 4);
    g.fillRect(x, 100, 5, 4);
  }
  const path = (s: number): [number, number] => [s, 65];
  const s = -40 + t * 290,
    inside = s > 190;
  train(g, sprites, 0, path, Math.min(s, 214), inside ? [] : [0, 2, 1]);
  if (inside) {
    const since = (s - 190) / 70;
    g.fillStyle = hexA("#27e3ff", Math.max(0, 1 - since));
    g.font = `16px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("+3", 150, 30 - since * 12);
    g.strokeStyle = hexA(DEPOT.lamp, Math.max(0, 0.9 - since));
    g.lineWidth = 3;
    g.beginPath();
    g.arc(210, 65, 14 + since * 40, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = Math.floor(time / 400) % 2 ? DEPOT.lamp : "#fff1c4";
  g.font = `7px ${FONT}`;
  g.textAlign = "center";
  g.fillText("DELIVER", 210, 16);
}
