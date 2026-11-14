/**
 * The arena itself on a 480 by 270 canvas: backgrounds, platforms, hives, gates, piles, the snail, the units and the
 * effects on top. It draws one blended view and keeps nothing between frames except caches of things that never
 * change (the platform layer of a map, glyph layouts).
 */
import {
  PILE_HEIGHT,
  QUEEN_LETHAL,
  RESPAWN_STEPS,
  S,
  TICK_HZ,
  WARRIOR_LETHAL,
  type GateView,
  type MapDef,
  type RoundView,
  type UnitView,
} from "../engine/index.js";
import {
  dashLift,
  diveReach,
  dashStreak,
  gateDoor,
  unitPose,
  unitSheet,
  type BodyShape,
  type FlapClock,
} from "./animation.js";
import {
  layoutText,
  textWidth,
  type FontName,
  type TextPixel,
} from "./font.js";
import {
  botTagAlpha,
  eggStates,
  hiveAnchor,
  hiveSheet,
  outlineOf,
  RIM,
  respawnCount,
  tagOf,
  type Danger,
  type Outline,
} from "./hud-model.js";
import {
  platformTiles,
  type TileSheet,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  wrapOffsets,
} from "./layout.js";
import {
  animationFrame,
  frameIndex,
  frameRect,
  sheetDuration,
  teamName,
} from "./manifest.js";
import {
  circlePoints,
  discHalfWidth,
  Ghosts,
  particleColor,
  RING_LIFE,
  TEXT_LIFE,
  toneColors,
  type EffectPool,
} from "./particles.js";
import { makeCanvas, type Ctx, type Sprites } from "./textures.js";

export const INK = "#05061a";

/** The outline of an after-image, after the arcade's pale yellow. */
const GHOST_EDGE = "#fff3a0";
/** The steel and the outline of the swords in the art, for the stretch of a diving blade drawn here. */
const BLADE = "#d8f1ff",
  BLADE_EDGE = "#020715";
/** A gate's doors spring open over this long when the Warrior is out, in seconds. */
export const DOOR = { open: 0.4 } as const;
/** A sword that has cooled down glints at its tip for this long, in seconds. */
export const GLINT_SECONDS = 0.22;

export interface SceneFrame {
  /** The blended view to draw and its time in steps. */
  readonly view: RoundView;
  readonly time: number;
  /** Wall-clock seconds, for things that move whether or not the game does. */
  readonly now: number;
  /** Change of y per step by slot, for jump and fall poses. */
  readonly dy: readonly number[];
  readonly localSlot: number;
  /** The page asked for the local player's unit to be outlined. */
  readonly highlight: boolean;
  readonly names: readonly string[];
  readonly flaps: FlapClock;
  readonly pool: EffectPool;
  /** After-images of diving and speed units: the scene leaves them and draws them. */
  readonly ghosts: Ghosts;
  /** How each slot's body is squashed or stretched this frame. */
  readonly shapes: readonly BodyShape[];
  /** Wall-clock second each gate last let its Warrior out. */
  readonly gateOpened: readonly number[];
  /** Wall-clock second each slot's sword last became ready again. */
  readonly readied: readonly number[];
  /** Where the Queen whose death won the round fell, and her team, once the ending shows it. */
  readonly fallen: {
    readonly x: number;
    readonly y: number;
    team: number;
  } | null;
  /** Wall-clock second each hole was last filled, keyed `team:hole`. */
  readonly holePops: ReadonlyMap<string, number>;
  readonly danger: Danger;
  /** Camera offset this frame; far layers follow it less. */
  readonly shakeX: number;
  readonly shakeY: number;
}

interface Mote {
  x: number;
  y: number;
  speed: number;
  phase: number;
  color: string;
}

export class Scene {
  private readonly glyphs = new Map<string, TextPixel[]>();
  private platforms: { id: number; canvas: HTMLCanvasElement } | null = null;
  private readonly motes: Mote[] = [];

  constructor(private readonly sprites: Sprites) {
    // A fixed scatter: the same sky every time, so screenshots compare.
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 46; i += 1)
      this.motes.push({
        x: random() * VIEW_WIDTH,
        y: random() * VIEW_HEIGHT,
        speed: 1.5 + random() * 4,
        phase: random() * 6.28,
        color: ["#16e7ff", "#ff2e9d", "#b9a4ff", "#ffffff"][i % 4] ?? "#fff",
      });
  }

  text(
    ctx: Ctx,
    text: string,
    x: number,
    y: number,
    color: string,
    font: FontName = "small",
  ): void {
    const key = `${font}|${text}`;
    let pixels = this.glyphs.get(key);
    if (!pixels) {
      pixels = layoutText(text, font);
      if (this.glyphs.size > 400) this.glyphs.clear();
      this.glyphs.set(key, pixels);
    }
    ctx.fillStyle = color;
    const px = Math.round(x),
      py = Math.round(y);
    for (const pixel of pixels) ctx.fillRect(px + pixel.x, py + pixel.y, 1, 1);
  }

  /** Text centred on `x` with a dark edge so it reads over anything. */
  label(
    ctx: Ctx,
    text: string,
    x: number,
    y: number,
    color: string,
    font: FontName = "small",
  ): void {
    const left = Math.round(x - textWidth(text, font) / 2);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const)
      this.text(ctx, text, left + dx, y + dy, INK, font);
    this.text(ctx, text, left, y, color, font);
  }

  draw(ctx: Ctx, frame: SceneFrame): void {
    const { view } = frame;
    this.background(ctx, frame);
    ctx.drawImage(this.platformLayer(view.map), 0, 0);
    view.hives.forEach((holes, team) => this.hive(ctx, team, holes, frame));
    this.eggs(ctx, frame);
    for (const gate of view.gates) this.gate(ctx, gate);
    for (const pile of view.piles) this.pile(ctx, pile);
    // The rider sits astride, its far leg behind the shell; a meal is half inside the mouth.
    this.units(ctx, frame, (unit) => unit.eaten || unit.riding);
    this.snail(ctx, frame);
    // The nets stand in front of the track: the snail crawls into its basket.
    this.goals(ctx, frame);
    this.afterImages(ctx, frame);
    this.fallen(ctx, frame);
    this.units(ctx, frame, (unit) => !unit.eaten && !unit.riding);
    this.doors(ctx, frame);
    this.berries(ctx, frame);
    this.effects(ctx, frame);
    this.tags(ctx, frame);
  }

  private background(ctx: Ctx, frame: SceneFrame): void {
    const { sprites } = this;
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    const layer = (id: string, sway: number): void => {
      const def = sprites.def(id);
      const image = sprites.art.images.get(id);
      if (!def || !image) return;
      // A layer further away follows the camera less: undo part of the shake the whole picture gets later.
      const depth = 1 - def.parallax;
      const x = Math.round(-frame.shakeX * depth * 0.7 + sway),
        y = Math.round(-frame.shakeY * depth * 0.7);
      for (const offset of [-VIEW_WIDTH, 0, VIEW_WIDTH])
        ctx.drawImage(image, x + offset, y);
    };
    layer("bg-far", 0);
    for (const mote of this.motes) {
      const glow =
        0.5 + 0.5 * Math.sin(frame.now * (0.6 + mote.speed * 0.2) + mote.phase);
      if (glow < 0.35) continue;
      const y =
        (((mote.y - frame.now * mote.speed) % VIEW_HEIGHT) + VIEW_HEIGHT) %
        VIEW_HEIGHT;
      const x = mote.x + Math.sin(frame.now * 0.3 + mote.phase) * 3;
      ctx.globalAlpha = glow * 0.55;
      ctx.fillStyle = mote.color;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    ctx.globalAlpha = 1;
    layer("bg-mid", Math.sin(frame.now * 0.17) * 2);
    layer("bg-near", 0);
  }

  private platformLayer(map: MapDef): HTMLCanvasElement {
    if (this.platforms?.id === map.id) return this.platforms.canvas;
    const { canvas, ctx } = makeCanvas(VIEW_WIDTH, VIEW_HEIGHT);
    const def = this.sprites.def("tiles");
    const image = this.sprites.art.images.get("tiles");
    if (def && image) {
      const sheet: TileSheet = {
        tile: def.frameWidth,
        has: (name) => name in def.frames,
        rows: (name) =>
          (this.sprites.box("tiles", frameIndex(def, name))?.bottom ??
            def.frameHeight - 1) + 1,
      };
      for (const rect of map.platforms) {
        const pieces = platformTiles(rect, sheet);
        const thin = rect.h <= sheet.tile && rect.y + rect.h < VIEW_HEIGHT;
        // A soft shadow under each ledge lifts it off the background.
        if (thin) {
          ctx.fillStyle = "rgba(3,4,20,0.35)";
          ctx.fillRect(
            rect.x + 2,
            rect.y + (pieces[0]?.h ?? rect.h),
            rect.w - 4,
            2,
          );
        }
        for (const piece of pieces) {
          const { sx, sy } = frameRect(def, frameIndex(def, piece.frame));
          ctx.drawImage(
            image,
            sx + piece.sx,
            sy + piece.sy,
            piece.w,
            piece.h,
            piece.x,
            piece.y,
            piece.w,
            piece.h,
          );
        }
      }
    }
    this.platforms = { id: map.id, canvas };
    return canvas;
  }

  private hive(
    ctx: Ctx,
    team: number,
    holes: RoundView["hives"][number],
    frame: SceneFrame,
  ): void {
    const { map } = frame.view;
    const id = hiveSheet(
      map.name,
      team,
      (sheet) => this.sprites.def(sheet) !== undefined,
    );
    const def = id ? this.sprites.def(id) : undefined;
    if (!id || !def) return;
    const holeId = def.hole ?? `hive-hole-${teamName(team)}`;
    const holeDef = this.sprites.def(holeId);
    // The wall goes where its drawn holes land on the engine's; art that does not say stands on the wall's rect.
    const wall = map.hiveWalls[team === 1 ? 1 : 0];
    const fitted = hiveAnchor(holes, def);
    const at = fitted ?? {
      x: Math.floor(wall.x + wall.w / 2),
      y: wall.y + wall.h,
    };
    const blink =
      frame.danger.lastBerry[team] === true &&
      Math.floor(frame.now * 6) % 2 === 0;
    this.sprites.draw(ctx, id, 0, at.x, at.y);
    if (blink) {
      // One berry from winning: the whole hive flickers.
      ctx.globalAlpha = 0.3;
      this.sprites.draw(
        ctx,
        id,
        0,
        at.x,
        at.y,
        false,
        this.sprites.silhouette(id, "#ffffff"),
      );
      ctx.globalAlpha = 1;
    }
    if (!holeDef) return;
    const filledFrame = frameIndex(holeDef, "filled");
    const emptyFrame = frameIndex(holeDef, "empty");
    holes.forEach((hole, index) => {
      // Empty cells are in the hive's art when its layout is this map's; otherwise every hole is drawn here, where
      // the engine has it. A filled one goes over its cell and flashes as the berry lands.
      if (!hole.filled) {
        if (!fitted) this.sprites.draw(ctx, holeId, emptyFrame, hole.x, hole.y);
        return;
      }
      this.sprites.draw(ctx, holeId, filledFrame, hole.x, hole.y);
      const popped = frame.now - (frame.holePops.get(`${team}:${index}`) ?? -9);
      if (popped < 0 || popped >= 0.3) return;
      ctx.globalAlpha = popped < 0.1 ? 1 : 0.6 * (1 - (popped - 0.1) / 0.2);
      this.sprites.draw(
        ctx,
        holeId,
        filledFrame,
        hole.x,
        hole.y,
        false,
        this.sprites.silhouette(holeId, "#ffffff"),
      );
      ctx.globalAlpha = 1;
    });
  }

  /** The Queens' spare lives, standing where the map says: whole, hatching or an empty shell. */
  private eggs(ctx: Ctx, frame: SceneFrame): void {
    const { view } = frame;
    view.spares.forEach((spots, team) => {
      const id = `egg-${teamName(team)}`;
      const def = this.sprites.def(id);
      if (!def) return;
      const queen = view.units.find(
        (unit) => unit.kind === "queen" && unit.team === team,
      );
      const states = eggStates(spots, queen?.dead === true && !view.winner);
      spots.forEach((spot, index) => {
        const state = states[index] ?? "full";
        // The egg that is hatching rocks all through the wait, faster and further as the Queen is about to come out.
        const near = queen?.respawn ?? 0;
        const rock =
          state === "cracked"
            ? Math.round(
                Math.sin(frame.now * (10 + 30 * near)) * (0.6 + 0.7 * near),
              )
            : 0;
        this.sprites.draw(
          ctx,
          id,
          frameIndex(def, state),
          spot.x + rock,
          spot.y - 1,
          team === 1,
        );
      });
    });
  }

  private goals(ctx: Ctx, frame: SceneFrame): void {
    const { view } = frame;
    view.map.nets.forEach((net, team) => {
      const id = `goal-${teamName(team)}`;
      const near = frame.danger.snailNear[team] === true;
      // Each team's net is drawn for its own side, so nothing is mirrored here.
      const x = Math.floor(net.x + net.w / 2),
        y = net.y + net.h - 1;
      this.sprites.draw(ctx, id, 0, x, y);
      if (near && Math.floor(frame.now * 6) % 2 === 0) {
        ctx.globalAlpha = 0.7;
        this.sprites.draw(
          ctx,
          id,
          0,
          x,
          y,
          false,
          this.sprites.silhouette(id, "#ffffff"),
        );
        ctx.globalAlpha = 1;
      }
    });
  }

  private gate(ctx: Ctx, gate: GateView): void {
    const id = `gate-${gate.kind}`;
    const def = this.sprites.def(id);
    if (!def) return;
    // The ornament takes its owner's colour, and the frame of a gate in use has the berry in its socket.
    const owner = gate.owner < 0 ? "neutral" : teamName(gate.owner);
    const name = gate.user >= 0 ? `${owner}Active` : owner;
    this.sprites.draw(ctx, id, frameIndex(def, name), gate.x, gate.y - 1);
  }

  private pile(ctx: Ctx, pile: RoundView["piles"][number]): void {
    const def = this.sprites.def("berry-pile");
    if (!def) return;
    // One frame per number of berries left.
    const frame =
      def.frames[`${pile.count}`] ??
      Math.max(0, Math.min(def.frameCount - 1, pile.count));
    if (pile.hanging)
      this.sprites.drawHanging(
        ctx,
        "berry-pile",
        frame,
        pile.x,
        pile.y - PILE_HEIGHT / S,
      );
    else this.sprites.draw(ctx, "berry-pile", frame, pile.x, pile.y - 1);
  }

  private snailFrame(frame: SceneFrame): number {
    const def = this.sprites.def("snail");
    if (!def) return 0;
    const { snail } = frame.view;
    const seconds = frame.time / TICK_HZ;
    if (snail.victim >= 0) return animationFrame(def, "eat", seconds);
    if (snail.rider >= 0) return animationFrame(def, "crawl", seconds);
    return animationFrame(def, "idle", seconds);
  }

  private snail(ctx: Ctx, frame: SceneFrame): void {
    const { snail } = frame.view;
    this.sprites.drawWrapped(
      ctx,
      "snail",
      this.snailFrame(frame),
      snail.x,
      snail.y - 1,
      snail.facing < 0,
    );
  }

  /** Where a unit is drawn: on the saddle when riding, shaking in the mouth when eaten, else where it is. */
  private place(unit: UnitView, frame: SceneFrame): { x: number; y: number } {
    const { snail } = frame.view;
    const def = this.sprites.def("snail");
    if (unit.riding && def) {
      const saddle = def.saddle[this.snailFrame(frame)] ?? def.anchor;
      return {
        x: snail.x + snail.facing * (saddle[0] - def.anchor[0]),
        y: snail.y - 1 - def.anchor[1] + saddle[1],
      };
    }
    if (unit.eaten) {
      const shiver = Math.floor(frame.now * 24) % 2;
      // Half inside the mouth where the art says it is, else just in front of the snail.
      if (def?.mouth)
        return {
          x: snail.x + snail.facing * (def.mouth[0] - def.anchor[0]) + shiver,
          y: snail.y - 1 - def.anchor[1] + def.mouth[1],
        };
      return {
        x:
          snail.x + snail.facing * (this.sprites.sizes.snailFront + 2) + shiver,
        y: snail.y - 1,
      };
    }
    // A Worker using a gate stands in its doorway, between the pillars, wherever in the gate it stopped.
    const gate = frame.view.gates.find((entry) => entry.user === unit.slot);
    if (gate) return { x: gate.x, y: unit.y - 1 };
    return { x: unit.x, y: unit.y - 1 };
  }

  private emerging(unit: UnitView, frame: SceneFrame): boolean {
    return frame.pool.sprites.some(
      (sprite) =>
        sprite.slot === unit.slot &&
        unit.grounded &&
        Math.abs(unit.x - sprite.x) <=
          (this.sprites.def(sprite.sheet)?.frameWidth ?? 0) / 2,
    );
  }

  private units(
    ctx: Ctx,
    frame: SceneFrame,
    pick: (unit: UnitView) => boolean,
  ): void {
    const { view } = frame;
    const rank = (unit: UnitView): number =>
      (unit.slot === frame.localSlot ? 10 : 0) +
      (unit.kind === "queen" ? 2 : unit.kind === "warrior" ? 1 : 0);
    const order = view.units.filter(pick).sort((a, b) => rank(a) - rank(b));
    for (const unit of order) {
      if (unit.dead) {
        this.waiting(ctx, unit, frame);
        continue;
      }
      // A new Warrior is the gate's rising figure until that has played, unless it has already flown off.
      if (this.emerging(unit, frame)) continue;
      const inGate = view.gates.some((gate) => gate.user === unit.slot);
      const pose = unitPose(this.sprites.art.manifest, unit, {
        time: frame.time,
        dy: frame.dy[unit.slot] ?? 0,
        sinceFlap: frame.flaps.since(unit.slot, frame.time),
        inGate,
      });
      const stood = this.place(unit, frame);
      const base = unitSheet(unit);
      const gap = this.below(base, pose.frame);
      const at = { x: stood.x, y: stood.y - dashLift(unit, gap) };
      const flip = unit.facing < 0;
      // A dive, and a speed unit always, leave after-images where they have been; a dash has its streak.
      if (
        !inGate &&
        !unit.riding &&
        !unit.eaten &&
        !unit.dashing &&
        (unit.speed || unit.diving)
      )
        frame.ghosts.note({
          slot: unit.slot,
          team: unit.team,
          sheet: this.sprites.def(base)?.flash ?? base,
          frame: pose.frame,
          x: Math.round(at.x),
          y: Math.round(at.y),
          flip,
          born: frame.now,
        });
      this.shaped(ctx, at, frame.shapes[unit.slot], (x) => {
        if (unit.dashing) this.streak(ctx, unit, base, pose.frame, x, at.y);
        const outline = outlineOf(unit, frame.localSlot, frame.highlight);
        if (outline && !inGate)
          this.rim(ctx, unit, pose.frame, { x, y: at.y }, flip, outline);
        else if (unit.speed && !inGate)
          this.rim(ctx, unit, pose.frame, { x, y: at.y }, flip, {
            color: this.sprites.ramp(unit.team)[2] ?? "#fff",
            offsets: RIM,
          });
        else if (unit.dashing && unit.kind === "queen")
          // Flat out she is four pixels of body: a bright edge in her colour keeps her the biggest thing in a fight.
          this.rim(ctx, unit, pose.frame, { x, y: at.y }, flip, {
            color: this.sprites.ramp(unit.team)[3] ?? "#fff",
            offsets: RIM,
          });
        if (pose.flash && pose.sheet !== base) {
          // The white silhouette over the sprite, not instead of it: the unit stays readable while it blinks.
          this.sprites.draw(ctx, base, pose.frame, x, at.y, flip);
          ctx.globalAlpha = 0.38;
          this.sprites.draw(ctx, pose.sheet, pose.frame, x, at.y, flip);
          ctx.globalAlpha = 1;
        } else this.sprites.draw(ctx, pose.sheet, pose.frame, x, at.y, flip);
        if (unit.diving) this.diveBlade(ctx, base, pose.frame, x, at.y, flip);
        this.glint(ctx, unit, base, pose.frame, x, at.y, frame);
      });
    }
  }

  /**
   * Runs `paint` once for every copy of a unit the wrap needs, each stretched about the unit's feet by `shape`.
   * `paint` gets the x to draw at.
   */
  private shaped(
    ctx: Ctx,
    at: { x: number; y: number },
    shape: BodyShape | undefined,
    paint: (x: number) => void,
  ): void {
    // Half the widest unit cell: a lunging sword reaches that far.
    const reach = Math.max(
      this.sprites.sizes.queen,
      Math.ceil((this.sprites.def("queen-cyan")?.frameWidth ?? 0) / 2) + 1,
    );
    for (const offset of wrapOffsets(at.x - reach, at.x + reach)) {
      const x = Math.round(at.x) + offset;
      if (!shape || (shape.w === 1 && shape.h === 1)) {
        paint(x);
        continue;
      }
      // The anchor row is the feet's own row: the ground is the line under it.
      const ground = Math.round(at.y) + 1;
      ctx.save();
      ctx.translate(x + 0.5, ground);
      ctx.scale(shape.w, shape.h);
      ctx.translate(-(x + 0.5), -ground);
      paint(x);
      ctx.restore();
    }
  }

  /** Rows between a frame's lowest painted one and its anchor row: negative when it is painted below the feet. */
  private below(sheet: string, poseFrame: number): number {
    const def = this.sprites.def(sheet);
    const box = this.sprites.box(sheet, poseFrame);
    return def && box ? def.anchor[1] - box.bottom : 0;
  }

  /**
   * A diving Queen's blade, drawn on down to where the engine's ends when the art's is shorter: white in a dark
   * edge like the painted one, under its lowest pixel.
   */
  private diveBlade(
    ctx: Ctx,
    sheet: string,
    poseFrame: number,
    x: number,
    y: number,
    flip: boolean,
  ): void {
    const foot = this.sprites.foot(sheet, poseFrame);
    if (!foot) return;
    const reach = diveReach(foot.down);
    if (reach === 0) return;
    const px = x + (flip ? -foot.ahead : foot.ahead),
      py = Math.round(y) + foot.down;
    ctx.fillStyle = BLADE_EDGE;
    ctx.fillRect(px - 1, py, 3, reach + 1);
    ctx.fillStyle = BLADE;
    ctx.fillRect(px, py, 1, reach);
  }

  /** The speed lines behind a dashing unit: white at the body, its colour behind, fading out. */
  private streak(
    ctx: Ctx,
    unit: UnitView,
    sheet: string,
    poseFrame: number,
    x: number,
    y: number,
  ): void {
    const def = this.sprites.def(sheet);
    const box = this.sprites.box(sheet, poseFrame);
    if (!def || !box) return;
    const ramp = this.sprites.ramp(unit.team);
    const lines = dashStreak(
      unit.attackStep,
      unit.kind === "queen" ? QUEEN_LETHAL : WARRIOR_LETHAL,
      def.anchor[1] - box.bottom,
      def.anchor[1] - box.top,
      def.anchor[0] - box.left,
    );
    const py = Math.round(y);
    for (const line of lines)
      for (let i = 0; i < line.length; i += 1) {
        ctx.globalAlpha = 0.85 * (1 - i / line.length);
        ctx.fillStyle = i < 2 ? "#ffffff" : (ramp[3] ?? "#fff");
        ctx.fillRect(x - unit.facing * (line.back + i), py - line.up, 1, 1);
      }
    ctx.globalAlpha = 1;
  }

  /** The glint at a sword's tip as it becomes ready again: a small white star that opens and fades. */
  private glint(
    ctx: Ctx,
    unit: UnitView,
    sheet: string,
    poseFrame: number,
    x: number,
    y: number,
    frame: SceneFrame,
  ): void {
    const age = frame.now - (frame.readied[unit.slot] ?? -9);
    if (age < 0 || age >= GLINT_SECONDS || unit.kind === "worker") return;
    const tip = this.sprites.tip(sheet, poseFrame);
    if (!tip) return;
    const t = age / GLINT_SECONDS;
    const tx = x + unit.facing * tip.ahead,
      ty = Math.round(y) - tip.up;
    const arm = t < 0.5 ? 2 : 1;
    ctx.globalAlpha = 1 - t * t;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tx - arm, ty, arm * 2 + 1, 1);
    ctx.fillRect(tx, ty - arm, 1, arm * 2 + 1);
    ctx.globalAlpha = 1;
  }

  /** The Queen whose death won the round, where she fell, once the ending closes in on her. */
  private fallen(ctx: Ctx, frame: SceneFrame): void {
    const { fallen } = frame;
    if (!fallen) return;
    this.sprites.drawWrapped(
      ctx,
      `win-military-${teamName(fallen.team)}`,
      0,
      fallen.x,
      fallen.y + Math.round(this.sprites.sizes.queen / 2) - 1,
      fallen.team === 1,
    );
  }

  /** The after-images, each fading evenly over its short life inside a pale outline. */
  private afterImages(ctx: Ctx, frame: SceneFrame): void {
    for (const ghost of frame.ghosts.list) {
      const left = Ghosts.left(ghost, frame.now);
      if (left <= 0 || left >= 1) continue;
      const edge = this.sprites.silhouette(ghost.sheet, GHOST_EDGE);
      const body = this.sprites.silhouette(
        ghost.sheet,
        this.sprites.ramp(ghost.team)[2] ?? "#fff",
      );
      ctx.globalAlpha = left * 0.22;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const)
        this.sprites.drawWrapped(
          ctx,
          ghost.sheet,
          ghost.frame,
          ghost.x + dx,
          ghost.y + dy,
          ghost.flip,
          edge,
        );
      ctx.globalAlpha = left * 0.5;
      this.sprites.drawWrapped(
        ctx,
        ghost.sheet,
        ghost.frame,
        ghost.x,
        ghost.y,
        ghost.flip,
        body,
      );
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A gate's doors. While the gate is offered the berry the doorway only glows, softly pulsing: the Worker may still
   * walk out. When the gate takes it the doors slam shut into a cocoon for the two seconds it holds the Worker, a
   * line of light climbing the seam as the time runs, and they spring open when the Warrior is out.
   */
  private doors(ctx: Ctx, frame: SceneFrame): void {
    const { sizes } = this.sprites;
    const worker = this.sprites.def("worker-cyan");
    const box = this.sprites.box("worker-cyan");
    if (!worker) return;
    // The doorway is a Worker and a pixel each side wide, and as tall as one.
    const half = Math.ceil(
      ((box ? box.right - box.left + 1 : worker.frameWidth) + 2) / 2,
    );
    const tall = sizes.worker + 1;
    frame.view.gates.forEach((gate, index) => {
      const user = frame.view.units[gate.user];
      const door = gateDoor(gate.progress);
      const ramp = this.sprites.ramp(
        user ? user.team : gate.owner < 0 ? 0 : gate.owner,
      );
      const top = gate.y - sizes.worker - 1;
      if (user && door.closed <= 0) {
        // Offered: light between the pillars and a bright frame round the doorway, breathing faster as the gate
        // is about to take the berry.
        const beat = 0.5 + 0.5 * Math.sin(frame.now * (14 + 10 * door.offer));
        ctx.fillStyle = ramp[3] ?? "#fff";
        ctx.globalAlpha = 0.1 + 0.18 * beat;
        ctx.fillRect(gate.x - half, top, half * 2 + 1, tall);
        ctx.globalAlpha = 0.35 + 0.6 * beat * (0.4 + 0.6 * door.offer);
        ctx.fillRect(gate.x - half, top - 1, half * 2 + 1, 1);
        ctx.fillRect(gate.x - half - 1, top, 1, tall);
        ctx.fillRect(gate.x + half + 1, top, 1, tall);
        ctx.globalAlpha = 1;
        return;
      }
      const closed = user
        ? door.closed
        : 1 - (frame.now - (frame.gateOpened[index] ?? -9)) / DOOR.open;
      if (closed <= 0) return;
      const tinted = user !== undefined || gate.owner >= 0;
      const leaf = Math.round(half * Math.min(1, closed));
      for (const side of [-1, 1] as const) {
        const x = side < 0 ? gate.x - half : gate.x + half - leaf + 1;
        // Dark steel whoever holds the gate, so the Worker's colour behind it does not read as an open door.
        ctx.fillStyle = "#1b1d44";
        ctx.fillRect(x, top, leaf, tall);
        // The leading edge of each leaf in the gate's colour.
        ctx.fillStyle = tinted ? (ramp[2] ?? "#d8e6ff") : "#d8e6ff";
        ctx.fillRect(side < 0 ? x + leaf - 1 : x, top, 1, tall);
      }
      if (!user || door.closed < 1) return;
      // Shut: the cocoon's ribs, and the light climbing its seam.
      ctx.fillStyle = ramp[2] ?? "#888";
      for (let row = top + 2; row < top + tall - 1; row += 3) {
        ctx.fillRect(gate.x - half + 1, row, half - 2, 1);
        ctx.fillRect(gate.x + 2, row, half - 2, 1);
      }
      const lit = Math.round(tall * door.lock);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(gate.x, top + tall - lit, 1, lit);
      // About to open: the whole cocoon flickers white.
      if (door.lock > 0.85 && Math.floor(frame.now * 20) % 2 === 0) {
        ctx.globalAlpha = 0.45;
        ctx.fillRect(gate.x - half, top, half * 2 + 1, tall);
        ctx.globalAlpha = 1;
      }
    });
  }

  /**
   * A rim round a unit, a pixel outside its silhouette. A speed unit wears its team's colour: its art is gold from
   * helmet to outline, and at one pixel per pixel the small team-coloured torso alone does not say whose it is. The
   * local player's unit wears the highlight while the page asks for it.
   */
  private rim(
    ctx: Ctx,
    unit: UnitView,
    poseFrame: number,
    at: { x: number; y: number },
    flip: boolean,
    outline: Outline,
  ): void {
    const id = unitSheet(unit);
    const shape = this.sprites.def(id)?.flash ?? id;
    const tint = this.sprites.silhouette(shape, outline.color);
    for (const [dx, dy] of outline.offsets)
      this.sprites.draw(
        ctx,
        shape,
        poseFrame,
        at.x + dx,
        at.y + dy,
        flip,
        tint,
      );
  }

  /**
   * A dead unit on its way back. A Worker rises out of the ground where it will stand, over the whole wait; a Queen
   * is in her egg, which rocks. The player's own unit also gets the seconds left.
   */
  private waiting(ctx: Ctx, unit: UnitView, frame: SceneFrame): void {
    const { view } = frame;
    if (view.winner) return;
    const { sizes } = this.sprites;
    const ramp = this.sprites.ramp(unit.team);
    let at = view.map.spawns[unit.slot];
    if (unit.kind === "queen") {
      at = view.spares[unit.team]?.find((spare) => spare.present);
    } else if (at) {
      const sheet = unitSheet({ ...unit, speed: false });
      const def = this.sprites.def(sheet);
      if (def) {
        const hidden = Math.round(sizes.worker * (1 - unit.respawn));
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          at.x - def.frameWidth,
          at.y - def.frameHeight,
          def.frameWidth * 2,
          def.frameHeight,
        );
        ctx.clip();
        this.sprites.draw(
          ctx,
          sheet,
          animationFrame(def, "idle", 0),
          at.x,
          at.y - 1 + hidden,
          unit.team === 1,
        );
        ctx.restore();
      }
    }
    if (!at || unit.slot !== frame.localSlot) return;
    const lift =
      (unit.kind === "queen" ? this.eggHeight(unit.team) : sizes.worker) + 9;
    this.label(
      ctx,
      `${respawnCount(unit.respawn, RESPAWN_STEPS / TICK_HZ)}`,
      at.x + 0.5,
      at.y - lift,
      ramp[3] ?? "#fff",
    );
  }

  private eggHeight(team: number): number {
    const id = `egg-${teamName(team)}`;
    const def = this.sprites.def(id);
    return def ? def.anchor[1] - (this.sprites.box(id)?.top ?? 0) + 1 : 0;
  }

  private berries(ctx: Ctx, frame: SceneFrame): void {
    const def = this.sprites.def("berry");
    if (!def) return;
    const at = animationFrame(def, "loose", frame.time / TICK_HZ);
    for (const berry of frame.view.loose)
      this.sprites.drawWrapped(
        ctx,
        "berry",
        at,
        berry.x,
        // A loose berry's `y` is the surface it would rest on: its lowest row sits one above.
        berry.y - (def.frameHeight - def.anchor[1]),
      );
  }

  private effects(ctx: Ctx, frame: SceneFrame): void {
    const { pool } = frame;
    for (const playing of pool.sprites) {
      const def = this.sprites.def(playing.sheet);
      if (!def) continue;
      const at = Math.min(
        def.frameCount - 1,
        Math.floor(playing.age * def.fps),
      );
      this.sprites.drawWrapped(
        ctx,
        playing.sheet,
        at,
        playing.x,
        playing.y,
        playing.flip,
      );
    }
    for (const ring of pool.rings) {
      const t = ring.age / RING_LIFE;
      const radius = ring.radius * (1 - (1 - t) ** 3);
      const colors = toneColors(ring.tone, this.sprites.ramp(ring.team));
      ctx.fillStyle = colors[t < 0.5 ? colors.length - 1 : 0] ?? "#fff";
      ctx.globalAlpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const x = Math.round(ring.x),
        y = Math.round(ring.y);
      for (const [dx, dy] of circlePoints(radius))
        for (const offset of wrapOffsets(x - radius, x + radius))
          ctx.fillRect(x + dx + offset, y + dy, 1, 1);
    }
    ctx.globalAlpha = 1;
    for (const flare of pool.flares) {
      // White that grows as it fades: a core for a clash, the whole sky round a dying Queen.
      const t = flare.age / flare.life;
      const radius = Math.max(1, Math.round(flare.radius * (0.25 + 0.75 * t)));
      // Gone fast: what it lit up shows through before it has finished growing.
      ctx.globalAlpha = (1 - t) ** 2;
      ctx.fillStyle = "#ffffff";
      const x = Math.round(flare.x),
        y = Math.round(flare.y);
      for (let dy = -radius; dy <= radius; dy += 1) {
        const half = discHalfWidth(radius, dy);
        for (const offset of wrapOffsets(x - half, x + half + 1))
          ctx.fillRect(x - half + offset, y + dy, half * 2 + 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    for (const p of pool.particles) {
      if (p.age < 0) continue;
      const left = 1 - p.age / p.life;
      ctx.globalAlpha = left < 0.3 ? left / 0.3 : 1;
      ctx.fillStyle = particleColor(p);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const rising of pool.texts) {
      const t = rising.age / TEXT_LIFE;
      const colors = toneColors(rising.tone, this.sprites.ramp(rising.team));
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      this.label(
        ctx,
        rising.text,
        rising.x,
        rising.y - 12 * (1 - (1 - t) ** 2),
        colors[1] ?? "#fff",
      );
    }
    ctx.globalAlpha = 1;
  }

  private tags(ctx: Ctx, frame: SceneFrame): void {
    for (const unit of frame.view.units) {
      if (unit.dead || unit.eaten || this.emerging(unit, frame)) continue;
      if (frame.view.gates.some((gate) => gate.user === unit.slot)) continue;
      const at = this.place(unit, frame);
      const head = this.sprites.sizes[unit.kind] + 3;
      const ramp = this.sprites.ramp(unit.team);
      const mine = unit.slot === frame.localSlot;
      const tag = tagOf(frame.names[unit.slot], unit.bot);
      const botAlpha = botTagAlpha(frame.view.step);
      const half = Math.ceil(textWidth(tag) / 2) + 2;
      for (const offset of wrapOffsets(at.x - half, at.x + half)) {
        const x = Math.round(at.x) + offset;
        let y = Math.round(at.y) - head;
        if (tag === "BOT" && unit.bot && !mine) {
          // Bots are named only while the round opens: after that the tags would compete with the fight.
          if (botAlpha > 0) {
            ctx.globalAlpha = botAlpha;
            this.label(ctx, tag, x + 0.5, y - 5, ramp[2] ?? "#888");
            ctx.globalAlpha = 1;
          }
        } else if (tag) {
          this.label(
            ctx,
            tag,
            x + 0.5,
            y - 5,
            unit.bot && tag === "BOT"
              ? (ramp[1] ?? "#888")
              : mine
                ? "#ffffff"
                : (ramp[3] ?? "#fff"),
          );
          y -= 8;
        }
        if (!mine) continue;
        // The local player's marker: a gold arrow that bobs.
        const bob = Math.round(Math.sin(frame.now * 7) * 1.2);
        const top = y - 6 + bob;
        ctx.fillStyle = INK;
        ctx.fillRect(x - 4, top - 1, 9, 3);
        ctx.fillRect(x - 3, top + 2, 7, 1);
        ctx.fillRect(x - 2, top + 3, 5, 1);
        ctx.fillRect(x - 1, top + 4, 3, 1);
        ctx.fillStyle = "#ffd23f";
        ctx.fillRect(x - 3, top, 7, 1);
        ctx.fillRect(x - 2, top + 1, 5, 1);
        ctx.fillRect(x - 1, top + 2, 3, 1);
        ctx.fillRect(x, top + 3, 1, 1);
        ctx.fillStyle = "#fff3a0";
        ctx.fillRect(x - 3, top, 7, 1);
      }
    }
  }

  /**
   * Darkens what would glow too much, on the copy of the picture the glow is made from: the snail's cream body is
   * the largest near-white thing on the screen and would otherwise carry a halo brighter than any team colour.
   */
  dimForGlow(ctx: Ctx, frame: SceneFrame): void {
    const { snail } = frame.view;
    ctx.globalAlpha = 0.72;
    this.sprites.drawWrapped(
      ctx,
      "snail",
      this.snailFrame(frame),
      snail.x + frame.shakeX,
      snail.y - 1 + frame.shakeY,
      snail.facing < 0,
      this.sprites.silhouette("snail", INK),
    );
    ctx.globalAlpha = 1;
  }

  /** Seconds a sheet plays for, 0 when the manifest has no such sheet. */
  duration = (sheet: string): number => {
    const def = this.sprites.def(sheet);
    return def ? sheetDuration(def) : 0;
  };
}
