/**
 * The arena itself on a 480 by 270 canvas: backgrounds, platforms, hives, gates, piles, the snail, the units and the
 * effects on top. It draws one blended view and keeps nothing between frames except caches of things that never
 * change (the platform layer of a map, glyph layouts).
 */
import {
  RESPAWN_STEPS,
  TICK_HZ,
  type GateView,
  type MapDef,
  type RoundView,
  type UnitView,
} from "../engine/index.js";
import { unitPose, unitSheet, type FlapClock } from "./animation.js";
import {
  layoutText,
  textWidth,
  type FontName,
  type TextPixel,
} from "./font.js";
import {
  botTagAlpha,
  hiveAnchor,
  respawnCount,
  tagOf,
  type Danger,
} from "./hud-model.js";
import { wrapDistance } from "./interpolation.js";
import {
  platformTiles,
  TILE,
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
  RING_LIFE,
  TEXT_LIFE,
  toneColors,
  type EffectPool,
} from "./particles.js";
import { makeCanvas, type Ctx, type Sprites } from "./textures.js";

export const INK = "#05061a";

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
}

export interface SceneFrame {
  /** The blended view to draw and its time in steps. */
  readonly view: RoundView;
  readonly time: number;
  /** Wall-clock seconds, for things that move whether or not the game does. */
  readonly now: number;
  /** Change of y per step by slot, for jump and fall poses. */
  readonly dy: readonly number[];
  readonly localSlot: number;
  readonly names: readonly string[];
  readonly flaps: FlapClock;
  readonly pool: EffectPool;
  /** Recent positions by slot, oldest first. */
  readonly trails: readonly (readonly TrailPoint[])[];
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
    this.goals(ctx, frame);
    for (const gate of view.gates) this.gate(ctx, gate, frame);
    for (const pile of view.piles) this.pile(ctx, pile);
    // The rider sits astride, its far leg behind the shell; a meal is half inside the mouth.
    this.units(ctx, frame, (unit) => unit.eaten || unit.riding);
    this.snail(ctx, frame);
    this.units(ctx, frame, (unit) => !unit.eaten && !unit.riding);
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
    if (def && image)
      map.platforms.forEach((rect, index) => {
        // A soft shadow under each ledge lifts it off the background.
        if (index > 0) {
          ctx.fillStyle = "rgba(3,4,20,0.35)";
          ctx.fillRect(rect.x + 2, rect.y + TILE, rect.w - 4, 2);
        }
        for (const piece of platformTiles(rect, index === 0)) {
          const { sx, sy } = frameRect(def, frameIndex(def, piece.frame));
          ctx.drawImage(
            image,
            sx,
            sy,
            piece.w,
            piece.h,
            piece.x,
            piece.y,
            piece.w,
            piece.h,
          );
        }
      });
    this.platforms = { id: map.id, canvas };
    return canvas;
  }

  /** Where the hive sprite of `team` stands, or null when the map or the art has no hive for it. */
  private hiveAt(
    team: number,
    holes: RoundView["hives"][number],
  ): { x: number; y: number } | null {
    const def = this.sprites.def(`hive-${teamName(team)}`);
    return def ? hiveAnchor(holes, def) : null;
  }

  private hive(
    ctx: Ctx,
    team: number,
    holes: RoundView["hives"][number],
    frame: SceneFrame,
  ): void {
    const id = `hive-${teamName(team)}`,
      holeId = `hive-hole-${teamName(team)}`;
    const def = this.sprites.def(id),
      holeDef = this.sprites.def(holeId);
    const at = this.hiveAt(team, holes);
    if (!def || !holeDef || !at) return;
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
    const filledFrame = frameIndex(holeDef, "filled");
    holes.forEach((hole, index) => {
      if (!hole.filled) return;
      // The empty cells are in the hive's art; a filled one goes over its cell and flashes as the berry lands.
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

  private goals(ctx: Ctx, frame: SceneFrame): void {
    const { view } = frame;
    view.map.snail.goals.forEach((x, team) => {
      const near = frame.danger.snailNear[team] === true;
      const y = view.map.snail.y - 1;
      this.sprites.draw(ctx, `goal-${teamName(team)}`, 0, x, y, team === 1);
      if (near && Math.floor(frame.now * 6) % 2 === 0) {
        const white = this.sprites.silhouette(
          `goal-${teamName(team)}`,
          "#ffffff",
        );
        ctx.globalAlpha = 0.7;
        this.sprites.draw(
          ctx,
          `goal-${teamName(team)}`,
          0,
          x,
          y,
          team === 1,
          white,
        );
        ctx.globalAlpha = 1;
      }
    });
  }

  private gate(ctx: Ctx, gate: GateView, frame: SceneFrame): void {
    const id = `gate-${gate.kind}`;
    const def = this.sprites.def(id);
    if (!def) return;
    const owner = gate.owner < 0 ? "neutral" : teamName(gate.owner);
    const name = gate.user >= 0 ? `${owner}Active` : owner;
    this.sprites.draw(ctx, id, frameIndex(def, name), gate.x, gate.y - 1);
    if (gate.user < 0) return;
    // The berry that pays for the change rests on top of the gate while the Worker stands between the pillars.
    const berry = this.sprites.def("berry");
    if (berry)
      this.sprites.draw(
        ctx,
        "berry",
        0,
        gate.x,
        gate.y - this.sprites.sizes.gate - (Math.round(frame.now * 6) % 2),
      );
  }

  private pile(ctx: Ctx, pile: RoundView["piles"][number]): void {
    const def = this.sprites.def("berry-pile");
    if (!def) return;
    const y = pile.y - 1;
    this.sprites.draw(ctx, "berry-pile", 0, pile.x, y);
    const left = pile.x - def.anchor[0],
      top = y - def.anchor[1];
    const shown = Math.min(pile.count, def.slots.length);
    for (let i = 0; i < shown; i += 1) {
      const slot = def.slots[i];
      // Slots are top-left corners of 6 pixel berries; the berry frame is 8 wide with the berry in its middle.
      if (slot)
        this.sprites.draw(
          ctx,
          "berry",
          0,
          left + slot[0] + 3,
          top + slot[1] + 3,
        );
    }
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
    if (unit.eaten)
      return {
        x:
          snail.x +
          snail.facing * (this.sprites.sizes.snailFront + 2) +
          (Math.floor(frame.now * 24) % 2),
        y: snail.y - 1,
      };
    return { x: unit.x, y: unit.y - 1 };
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
      const inGate = view.gates.some((gate) => gate.user === unit.slot);
      const pose = unitPose(this.sprites.art.manifest, unit, {
        time: frame.time,
        dy: frame.dy[unit.slot] ?? 0,
        sinceFlap: frame.flaps.since(unit.slot, frame.time),
        inGate,
      });
      const at = this.place(unit, frame);
      const flip = unit.facing < 0;
      if (
        !inGate &&
        !unit.riding &&
        !unit.eaten &&
        (unit.speed || unit.diving) &&
        (unit.moving || !unit.grounded)
      )
        this.trail(ctx, unit, pose.frame, flip, frame);
      const base = unitSheet(unit);
      if (unit.speed && !inGate) this.teamRim(ctx, unit, pose.frame, at, flip);
      if (pose.flash && pose.sheet !== base) {
        // The white silhouette over the sprite, not instead of it: the unit stays readable while it blinks.
        this.sprites.drawWrapped(ctx, base, pose.frame, at.x, at.y, flip);
        ctx.globalAlpha = 0.38;
        this.sprites.drawWrapped(ctx, pose.sheet, pose.frame, at.x, at.y, flip);
        ctx.globalAlpha = 1;
      } else
        this.sprites.drawWrapped(ctx, pose.sheet, pose.frame, at.x, at.y, flip);
    }
  }

  /**
   * A rim of the team's colour round a speed unit: its art is gold from helmet to outline, and at one pixel per
   * pixel the small team-coloured torso alone does not say whose it is.
   */
  private teamRim(
    ctx: Ctx,
    unit: UnitView,
    poseFrame: number,
    at: { x: number; y: number },
    flip: boolean,
  ): void {
    const id = unitSheet(unit);
    const shape = this.sprites.def(id)?.flash ?? id;
    const tint = this.sprites.silhouette(
      shape,
      this.sprites.ramp(unit.team)[2] ?? "#fff",
    );
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const)
      this.sprites.drawWrapped(
        ctx,
        shape,
        poseFrame,
        at.x + dx,
        at.y + dy,
        flip,
        tint,
      );
  }

  /** After-images in the team's colour behind anything fast. */
  private trail(
    ctx: Ctx,
    unit: UnitView,
    poseFrame: number,
    flip: boolean,
    frame: SceneFrame,
  ): void {
    const id = unitSheet(unit);
    const flash = this.sprites.def(id)?.flash ?? id;
    const tint = this.sprites.silhouette(
      flash,
      this.sprites.ramp(unit.team)[2] ?? "#fff",
    );
    const points = frame.trails[unit.slot] ?? [];
    [
      [7, 0.14],
      [5, 0.22],
      [3, 0.34],
    ].forEach(([back, alpha]) => {
      const point = points[points.length - (back ?? 0)];
      if (!point || Math.abs(wrapDistance(point.x, unit.x)) > 48) return;
      if (Math.abs(point.y - unit.y) > 48) return;
      ctx.globalAlpha = alpha ?? 0;
      this.sprites.drawWrapped(
        ctx,
        flash,
        poseFrame,
        point.x,
        point.y - 1,
        flip,
        tint,
      );
    });
    ctx.globalAlpha = 1;
  }

  /** Where a dead unit waits: a Queen on her hive's roof pad, clear of the holes, the rest at their spawns. */
  private waitingPlace(
    unit: UnitView,
    view: RoundView,
  ): { x: number; y: number } | undefined {
    if (unit.kind === "queen") {
      const perch = this.sprites.def(`hive-${teamName(unit.team)}`)?.perch;
      const at = this.hiveAt(unit.team, view.hives[unit.team] ?? []);
      // The perch is the pad's top row and a spawn is the surface under the feet, one row lower.
      if (perch && at) return { x: at.x + perch[0], y: at.y + perch[1] + 1 };
    }
    return view.map.spawns[unit.slot];
  }

  /** A dead unit's place while it waits: its ghost, a ring that closes and the seconds left. */
  private waiting(ctx: Ctx, unit: UnitView, frame: SceneFrame): void {
    const { view } = frame;
    if (view.winner) return;
    const spawn = this.waitingPlace(unit, view);
    if (!spawn) return;
    const id = `respawn-${teamName(unit.team)}`;
    const ramp = this.sprites.ramp(unit.team);
    // The count sits over a Worker's head, and on a Queen's chest: her head is up among the HUD.
    const { sizes } = this.sprites;
    const lift =
      unit.kind === "queen" ? Math.round(sizes.queen / 2) : sizes.worker + 4;
    // A ghost of the unit where it will stand, firming up as the wait runs out; the beam joins in at the end.
    const sheet = unitSheet({ ...unit, speed: false });
    const def = this.sprites.def(sheet);
    if (def) {
      // Her own picture, thin as glass: a flat silhouette her size reads as a stain on the sky.
      ctx.globalAlpha =
        0.28 + 0.4 * unit.respawn + 0.06 * Math.sin(frame.now * 9 + unit.slot);
      this.sprites.draw(
        ctx,
        sheet,
        animationFrame(def, "idle", 0),
        spawn.x,
        spawn.y - 1,
        unit.team === 1,
      );
    }
    if (unit.respawn > 0.8) {
      ctx.globalAlpha = 0.7;
      this.sprites.draw(ctx, id, 1, spawn.x, spawn.y - 1);
    }
    ctx.globalAlpha = 1;
    // Workers come back in front of their hive: only a Queen and the player's own unit get the clock, so the
    // holes and the plaque stay readable.
    if (unit.kind !== "queen" && unit.slot !== frame.localSlot) return;
    // A ring of dots that closes as the wait runs out.
    const dots = 8;
    const lit = Math.round(unit.respawn * dots);
    for (let i = 0; i < dots; i += 1) {
      const angle = (i / dots) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = i < lit ? (ramp[3] ?? "#fff") : (ramp[0] ?? "#333");
      ctx.fillRect(
        Math.round(spawn.x + Math.cos(angle) * 6),
        Math.round(spawn.y - lift + Math.sin(angle) * 6),
        1,
        1,
      );
    }
    this.label(
      ctx,
      `${respawnCount(unit.respawn, RESPAWN_STEPS / TICK_HZ)}`,
      spawn.x + 0.5,
      spawn.y - lift - 2,
      ramp[3] ?? "#fff",
    );
  }

  private berries(ctx: Ctx, frame: SceneFrame): void {
    const def = this.sprites.def("berry");
    if (!def) return;
    const at = animationFrame(def, "loose", frame.time / TICK_HZ);
    for (const berry of frame.view.loose)
      this.sprites.drawWrapped(ctx, "berry", at, berry.x, berry.y - 4);
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
    for (const p of pool.particles) {
      const left = 1 - p.age / p.life;
      ctx.globalAlpha = left < 0.3 ? left / 0.3 : 1;
      ctx.fillStyle = p.color;
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
      if (unit.dead || unit.eaten) continue;
      if (frame.view.gates.some((gate) => gate.user === unit.slot)) continue;
      const at = this.place(unit, frame);
      const head = this.sprites.sizes[unit.kind] + 3;
      const ramp = this.sprites.ramp(unit.team);
      const mine = unit.slot === frame.localSlot;
      const tag = tagOf(frame.names[unit.slot], unit.bot);
      const botAlpha = botTagAlpha(frame.view.step);
      for (const offset of wrapOffsets(at.x - 20, at.x + 20)) {
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
