/**
 * What sits on top of the arena and does not shake with it: each team's eggs and berry pips, the snail's progress
 * strip, the pulse at the edge of a team on its last egg, the flash of a big hit and the victory banner.
 */
import type { RoundView } from "../engine/index.js";
import { stripMarker, type Danger } from "./hud-model.js";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./layout.js";
import { frameIndex, teamName } from "./manifest.js";
import {
  BERRY_COLORS,
  easeOutBack,
  GOLD_COLORS,
  type Particle,
} from "./particles.js";
import { INK } from "./scene.js";
import type { Ctx, Sprites } from "./textures.js";

export interface HudFrame {
  readonly view: RoundView;
  readonly now: number;
  readonly danger: Danger;
  /** Wall-clock second each team last lost an egg. */
  readonly eggLost: readonly number[];
  /** Wall-clock second the round was won, or null. */
  readonly wonAt: number | null;
  /** White over everything, 0 to 1. */
  readonly flash: number;
}

const EGG_SPACING = 13,
  EGG_Y = 12,
  CRACK_SECONDS = 0.7,
  PIP_Y = 22,
  PIP_PITCH = 4,
  STRIP_Y = 5,
  /** The most a hit whitens the picture: a flash is a blink of light, never a blank frame. */
  FLASH_ALPHA = 0.55;
export const BANNER_Y = 122;

export class Hud {
  private confetti: Particle[] = [];
  private last = 0;

  constructor(private readonly sprites: Sprites) {}

  draw(ctx: Ctx, frame: HudFrame): void {
    const dt = Math.min(0.1, Math.max(0, frame.now - this.last));
    this.last = frame.now;
    this.edges(ctx, frame);
    for (const team of [0, 1]) {
      this.eggs(ctx, team, frame);
      this.pips(ctx, team, frame);
    }
    this.strip(ctx, frame);
    if (frame.flash > 0) {
      ctx.globalAlpha = Math.min(1, frame.flash) * FLASH_ALPHA;
      ctx.fillStyle = "#fff3d6";
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      ctx.globalAlpha = 1;
    }
    if (frame.view.winner && frame.wonAt !== null)
      this.banner(ctx, frame, frame.view.winner, frame.now - frame.wonAt, dt);
    else this.confetti = [];
  }

  /** A team on its last egg has its side of the screen breathing in its colour. */
  private edges(ctx: Ctx, frame: HudFrame): void {
    frame.danger.lastEgg.forEach((last, team) => {
      if (!last) return;
      const strength = 0.5 + 0.5 * Math.sin(frame.now * 5.5);
      ctx.fillStyle = this.sprites.ramp(team)[2] ?? "#fff";
      for (let band = 0; band < 6; band += 1) {
        ctx.globalAlpha = strength * (1 - band / 6) * 0.2;
        ctx.fillRect(
          team === 0 ? band * 3 : VIEW_WIDTH - (band + 1) * 3,
          0,
          3,
          VIEW_HEIGHT,
        );
      }
      ctx.globalAlpha = 1;
    });
  }

  private eggs(ctx: Ctx, team: number, frame: HudFrame): void {
    const id = `egg-${teamName(team)}`;
    const def = this.sprites.def(id);
    if (!def) return;
    const left = frame.view.eggs[team] ?? 0;
    const since = frame.now - (frame.eggLost[team] ?? -9);
    const total = Math.max(3, left);
    for (let i = 0; i < total; i += 1) {
      const x =
        team === 0 ? 14 + i * EGG_SPACING : VIEW_WIDTH - 14 - i * EGG_SPACING;
      const justLost = i === left && since >= 0 && since < CRACK_SECONDS;
      const name = i < left ? "full" : justLost ? "cracked" : "broken";
      // The egg that just broke jumps; the last one left trembles.
      const lastOne =
        left === 1 && i === 0 && frame.danger.lastEgg[team] === true;
      const jolt = justLost
        ? Math.round(Math.sin(since * 40) * 2 * (1 - since / CRACK_SECONDS))
        : 0;
      const bob = lastOne ? Math.round(Math.sin(frame.now * 12)) : 0;
      this.sprites.draw(
        ctx,
        id,
        frameIndex(def, name),
        x + jolt,
        EGG_Y + bob,
        team === 1,
      );
      if (lastOne && Math.floor(frame.now * 5) % 2 === 0) {
        ctx.globalAlpha = 0.55;
        this.sprites.draw(
          ctx,
          id,
          frameIndex(def, name),
          x,
          EGG_Y + bob,
          team === 1,
          this.sprites.silhouette(id, "#ffffff"),
        );
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * One pip per hive hole under the eggs, lit as berries are banked: how close a team is, read as a bar. The
   * number itself is on the hive's plaque.
   */
  private pips(ctx: Ctx, team: number, frame: HudFrame): void {
    const holes = frame.view.hives[team]?.length ?? 0;
    const banked = frame.view.berries[team] ?? 0;
    const ramp = this.sprites.ramp(team);
    const blink =
      frame.danger.lastBerry[team] === true &&
      Math.floor(frame.now * 6) % 2 === 0;
    for (let i = 0; i < holes; i += 1) {
      const x =
        team === 0 ? 8 + i * PIP_PITCH : VIEW_WIDTH - 11 - i * PIP_PITCH;
      ctx.fillStyle = INK;
      ctx.fillRect(x - 1, PIP_Y - 1, 5, 5);
      const lit = i < banked;
      ctx.fillStyle = lit
        ? blink
          ? "#ffffff"
          : (BERRY_COLORS[1] ?? "#7fd42a")
        : (ramp[0] ?? "#223");
      ctx.fillRect(x, PIP_Y, 3, 3);
      if (lit) {
        ctx.fillStyle = blink ? "#ffffff" : (BERRY_COLORS[2] ?? "#ecffa6");
        ctx.fillRect(x, PIP_Y, 2, 1);
      }
    }
  }

  /** The snail's race at the top of the screen: a marker on a strip between the two goals. */
  private strip(ctx: Ctx, frame: HudFrame): void {
    const def = this.sprites.def("snail-strip");
    if (!def?.lane) return;
    const { view, danger } = frame;
    const left = Math.round((VIEW_WIDTH - def.frameWidth) / 2);
    const near = danger.snailClose.findIndex(Boolean);
    const beat = near >= 0 && Math.floor(frame.now * 6) % 2 === 0;
    // A plate behind it, so it reads over whatever flies past.
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = INK;
    ctx.fillRect(
      left - 2,
      STRIP_Y - 2,
      def.frameWidth + 4,
      def.frameHeight + 4,
    );
    ctx.globalAlpha = 1;
    this.sprites.draw(ctx, "snail-strip", 0, left, STRIP_Y);
    const marker = stripMarker(view, def.lane);
    const middle = Math.round((def.lane[0] + def.lane[1]) / 2);
    if (marker !== middle) {
      // The ground won so far, in the colour of the team it is being won for.
      const team = marker < middle ? 0 : 1;
      const ramp = this.sprites.ramp(team);
      ctx.fillStyle = (beat ? ramp[3] : ramp[2]) ?? "#fff";
      ctx.fillRect(
        left + Math.min(marker, middle),
        STRIP_Y + 3,
        Math.abs(marker - middle) + 1,
        1,
      );
    }
    if (near >= 0) {
      // Nearly home: the strip is framed in the colour of the team about to win and the goal it is heading for
      // throbs, leaving the goal's own picture in view.
      const ramp = this.sprites.ramp(near);
      const cap = left + def.lane[near === 1 ? 1 : 0];
      const top = STRIP_Y - 2,
        height = def.frameHeight + 4;
      ctx.fillStyle = beat ? "#ffffff" : (ramp[2] ?? "#fff");
      ctx.fillRect(left - 2, top, def.frameWidth + 4, 1);
      ctx.fillRect(left - 2, top + height - 1, def.frameWidth + 4, 1);
      ctx.fillRect(cap - 6, top, 1, height);
      ctx.fillRect(cap + 6, top, 1, height);
      ctx.globalAlpha = beat ? 0.3 : 0.12;
      ctx.fillRect(cap - 5, top + 1, 11, height - 2);
      ctx.globalAlpha = 1;
    }
    const flip = view.snail.facing < 0;
    const lift = beat ? 1 : 0;
    this.sprites.draw(
      ctx,
      "snail-marker",
      0,
      left + marker,
      STRIP_Y + 6 - lift,
      flip,
    );
    if (beat) {
      ctx.globalAlpha = 0.6;
      this.sprites.draw(
        ctx,
        "snail-marker",
        0,
        left + marker,
        STRIP_Y + 6 - lift,
        flip,
        this.sprites.silhouette("snail-marker", "#ffffff"),
      );
      ctx.globalAlpha = 1;
    }
  }

  private banner(
    ctx: Ctx,
    frame: HudFrame,
    winner: NonNullable<RoundView["winner"]>,
    age: number,
    dt: number,
  ): void {
    const ramp = this.sprites.ramp(winner.team);
    const id = `banner-${winner.kind}-${teamName(winner.team)}`;
    const def = this.sprites.def(id);
    if (!def) return;
    // The arena dims so the banner owns the screen.
    ctx.globalAlpha = Math.min(0.5, age * 1.6);
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.globalAlpha = 1;
    const land = easeOutBack(Math.min(1, age / 0.5));
    const y = Math.round(BANNER_Y - (1 - land) * 170);
    const halfHeight = def.frameHeight / 2;
    // Light bars that shoot out to both edges once it lands.
    const reach = Math.round(
      VIEW_WIDTH * Math.max(0, Math.min(1, (age - 0.35) / 0.3)),
    );
    if (reach > 0) {
      for (const [dy, color, alpha] of [
        [-halfHeight - 5, ramp[2], 0.9],
        [halfHeight + 4, ramp[2], 0.9],
        [-halfHeight - 8, ramp[1], 0.6],
        [halfHeight + 7, ramp[1], 0.6],
      ] as const) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color ?? "#fff";
        ctx.fillRect(VIEW_WIDTH / 2 - reach / 2, y + dy, reach, dy < 0 ? 2 : 2);
      }
      ctx.globalAlpha = 1;
    }
    this.sprites.draw(ctx, id, 0, VIEW_WIDTH / 2, y);
    // A glint that sweeps the banner every couple of seconds.
    const sweep = ((age - 0.6) % 2.2) / 0.5;
    if (age > 0.6 && sweep >= 0 && sweep < 1) {
      const left = VIEW_WIDTH / 2 - def.anchor[0],
        top = y - def.anchor[1];
      ctx.save();
      ctx.beginPath();
      ctx.rect(left + 2, top + 2, def.frameWidth - 4, def.frameHeight - 4);
      ctx.clip();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#ffffff";
      const x = left - 20 + sweep * (def.frameWidth + 40);
      for (let row = 0; row < def.frameHeight; row += 1)
        ctx.fillRect(Math.round(x - row * 0.5), top + row, 9, 1);
      ctx.restore();
    }
    this.celebrate(ctx, ramp, age, dt);
  }

  /** Confetti in the winner's colours, falling for as long as the banner is up. */
  private celebrate(
    ctx: Ctx,
    ramp: readonly string[],
    age: number,
    dt: number,
  ): void {
    const colors = [ramp[2], ramp[3], GOLD_COLORS[0], "#ffffff"];
    const wanted = age < 0.4 ? 0 : age < 5 ? 3 : 1;
    for (let i = 0; i < wanted && this.confetti.length < 220; i += 1)
      this.confetti.push({
        x: Math.random() * VIEW_WIDTH,
        y: -4,
        vx: (Math.random() - 0.5) * 30,
        vy: 30 + Math.random() * 50,
        age: 0,
        life: 4 + Math.random() * 2,
        color: colors[Math.floor(Math.random() * colors.length)] ?? "#fff",
        size: Math.random() < 0.5 ? 2 : 1,
        gravity: 12,
      });
    for (const p of this.confetti) {
      p.age += dt;
      p.vy += p.gravity * dt;
      p.x += (p.vx + Math.sin(p.age * 6 + p.life * 9) * 18) * dt;
      p.y += p.vy * dt;
      // Flutter: a piece turning edge-on vanishes for a moment.
      if (Math.sin(p.age * 14 + p.life * 5) < -0.6) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(
        Math.round(p.x),
        Math.round(p.y),
        p.size,
        p.size === 2 ? 1 : 2,
      );
    }
    this.confetti = this.confetti.filter(
      (p) => p.age < p.life && p.y < VIEW_HEIGHT + 4,
    );
  }
}
