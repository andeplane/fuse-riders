/**
 * What lies over the arena and does not shake with it. The arcade original has no HUD: the eggs stand in the world
 * and the hive's holes are the score. So this is only light: the flash of a big hit, and at the end the iris that
 * closes on what decided the round, with who won written above it and how below.
 */
import type { RoundView } from "../engine/index.js";
import {
  hexHalfWidth,
  IRIS_RADIUS,
  irisCentre,
  irisRadius,
  victoryFocus,
  victoryLines,
} from "./hud-model.js";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./layout.js";
import type { Sizes } from "./metrics.js";
import type { Ctx } from "./textures.js";
import { FONTS, textWidth, type FontName } from "./font.js";

export interface HudFrame {
  readonly view: RoundView;
  readonly now: number;
  /** Wall-clock second the round was won, or null to leave the ending to the page. */
  readonly wonAt: number | null;
  /** White over everything, 0 to 1. */
  readonly flash: number;
}

/** What the HUD needs of the scene: its text and the colours and sizes of the art. */
export interface HudArt {
  readonly sizes: Sizes;
  ramp(team: number): readonly string[];
  label(
    ctx: Ctx,
    text: string,
    x: number,
    y: number,
    color: string,
    font?: FontName,
  ): void;
}

/** The most a hit whitens the picture: a flash is a blink of light, never a blank frame. */
const FLASH_ALPHA = 0.55;
const BLACK = "#000000";
/** Seconds after the win at which the words appear. */
const WORDS_AT = 0.7;
/** The winner's line is the small font doubled. */
const TITLE_SCALE = 2;

export class Hud {
  constructor(private readonly art: HudArt) {}

  draw(ctx: Ctx, frame: HudFrame): void {
    if (frame.flash > 0) {
      ctx.globalAlpha = Math.min(1, frame.flash) * FLASH_ALPHA;
      ctx.fillStyle = "#fff3d6";
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      ctx.globalAlpha = 1;
    }
    if (frame.view.winner && frame.wonAt !== null)
      this.iris(ctx, frame.view, frame.view.winner, frame.now - frame.wonAt);
  }

  /** Black closes in to a hexagon round the deciding moment. */
  private iris(
    ctx: Ctx,
    view: RoundView,
    winner: NonNullable<RoundView["winner"]>,
    age: number,
  ): void {
    const radius = irisRadius(age);
    const centre = irisCentre(victoryFocus(view, this.art.sizes));
    const ramp = this.art.ramp(winner.team);
    for (let y = 0; y < VIEW_HEIGHT; y += 1) {
      const half = hexHalfWidth(radius, y - centre.y);
      ctx.fillStyle = BLACK;
      if (half <= 0) {
        ctx.fillRect(0, y, VIEW_WIDTH, 1);
        continue;
      }
      const left = Math.round(centre.x - half),
        right = Math.round(centre.x + half);
      if (left > 0) ctx.fillRect(0, y, left, 1);
      if (right < VIEW_WIDTH) ctx.fillRect(right, y, VIEW_WIDTH - right, 1);
      // The hexagon's rim in the winner's colour.
      ctx.fillStyle = ramp[2] ?? "#fff";
      const edge =
        hexHalfWidth(radius, y - centre.y - 1) <= 0 ||
        hexHalfWidth(radius, y - centre.y + 1) <= 0;
      if (edge) ctx.fillRect(left, y, right - left, 1);
      else {
        ctx.fillRect(left - 1, y, 2, 1);
        ctx.fillRect(right - 1, y, 2, 1);
      }
    }
    if (age < WORDS_AT) return;
    const lines = victoryLines(winner, view.timeUp);
    const reach = Math.round((IRIS_RADIUS * Math.sqrt(3)) / 2);
    // The words sit over and under the hexagon, kept whole on the screen.
    const widest = Math.max(
      textWidth(lines.title) * TITLE_SCALE,
      textWidth(lines.kind),
    );
    const x = Math.min(
      VIEW_WIDTH - widest / 2 - 4,
      Math.max(widest / 2 + 4, centre.x),
    );
    const titleHeight = FONTS.small.height * TITLE_SCALE;
    const top = Math.max(4, centre.y - reach - titleHeight - 6);
    ctx.save();
    ctx.translate(Math.round(x), top);
    ctx.scale(TITLE_SCALE, TITLE_SCALE);
    this.art.label(ctx, lines.title, 0, 0, ramp[3] ?? "#fff");
    ctx.restore();
    this.art.label(
      ctx,
      lines.kind,
      x,
      Math.min(VIEW_HEIGHT - 8, centre.y + reach + 8),
      "#ffffff",
    );
  }
}
