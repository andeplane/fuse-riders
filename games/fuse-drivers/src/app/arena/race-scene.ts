import Phaser from "phaser";
import { config } from "../../game/sim/config.js";
import { dronePosition } from "../../game/sim/items.js";
import type { Track } from "../../game/sim/track.js";
import { lerp } from "../../game/sim/truck.js";
import {
  FRAMES,
  SPRITE_CELL,
  TRUCK_CELL,
  TRUCK_COLORS,
  queueArenaAssets,
} from "./assets.js";
import type { ArenaFrame } from "./frame.js";
import {
  createTrackArt,
  ensureOilSlickTexture,
  type TrackArt,
} from "./track-art.js";

/** World units per sprite cell: a 44 u long top-down truck around its 28 u collision circle. */
const TRUCK_SCALE = 44 / (TRUCK_CELL * 0.92);
/** The arcade camera looks down at an angle: a rotated truck is squashed vertically after rotation... */
export const TILT = 0.72;
/** ...and stacked on darker copies of itself, one per layer, so its sides show below the roof. */
const SIDE_LAYERS = 5;
/** Two whole turns over a spin-out, so the whirl starts and ends on the truck's heading. */
const SPIN_PER_TICK = (4 * Math.PI) / config.truck.spinOutTicks;
/** World units per sprite pixel for the 128 px item cells: a mine or box is about 36 u across. */
const SPRITE_SCALE = 36 / SPRITE_CELL;
/** Screen pixels around the race view for the grandstand (top, below the HUD strip) and the side crowds. */
export const STANDS = { top: 158, side: 56 } as const;

/**
 * Where the race camera sits in the 1600x900 design space, and how far it zooms: the world fills the screen
 * below the HUD strip, leaving a grandstand band on top and crowd strips at the sides, like the concept art.
 * The HUD draws its stadium around exactly this rectangle, so both work it out the same way.
 */
export function raceViewport(track: Track): {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
} {
  const worldW = track.cols * config.tile,
    worldH = track.rows * config.tile;
  const zoom = Math.min(
    (config.screen.width - 2 * STANDS.side) / worldW,
    (config.screen.height - STANDS.top) / worldH,
  );
  return {
    x: (config.screen.width - worldW * zoom) / 2,
    y: config.screen.height - worldH * zoom,
    width: worldW * zoom,
    height: worldH * zoom,
    zoom,
  };
}

/** Keep a map of images in step with an array of ids: create, update, destroy. */
function syncSet<T extends { id: number }>(
  map: Map<number, Phaser.GameObjects.Image>,
  items: readonly T[],
  make: (item: T) => Phaser.GameObjects.Image,
  update: (image: Phaser.GameObjects.Image, item: T) => void,
): void {
  const seen = new Set<number>();
  for (const item of items) {
    seen.add(item.id);
    let image = map.get(item.id);
    if (!image) {
      image = make(item);
      map.set(item.id, image);
    }
    update(image, item);
  }
  for (const [id, image] of map)
    if (!seen.has(id)) {
      image.destroy();
      map.delete(id);
    }
}

/**
 * The race itself, drawn in world units: the track's baked picture, the trucks on their tilted stacks, the
 * item boxes and every projectile. It renders from the view it is handed and never from an event.
 */
export class RaceScene extends Phaser.Scene {
  static readonly KEY = "fd-race";

  private readonly assetBase: string;
  private readonly onReady: () => void;

  private art?: TrackArt;
  private artTrack?: string;
  private boxes: Phaser.GameObjects.Sprite[] = [];
  /** Each truck: side layers and body in a container squashed by TILT. */
  private trucks: Phaser.GameObjects.Container[] = [];
  private bodies: Phaser.GameObjects.Image[] = [];
  private sides: Phaser.GameObjects.Image[][] = [];
  private shields: Phaser.GameObjects.Image[] = [];
  /** A dark copy of each truck in its own squashed container, so no truck draws its shadow over another. */
  private shadows: Phaser.GameObjects.Container[] = [];
  private wasWrecked: boolean[] = [];
  private missiles = new Map<number, Phaser.GameObjects.Image>();
  private mines = new Map<number, Phaser.GameObjects.Image>();
  private oils = new Map<number, Phaser.GameObjects.Image>();
  private drones = new Map<number, Phaser.GameObjects.Image>();
  /** Recent simulated positions per missile, for the dotted trail. */
  private trails = new Map<number, { x: number; y: number }[]>();
  private marks?: Phaser.GameObjects.Graphics;
  private dust?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(assetBase: string, onReady: () => void) {
    super(RaceScene.KEY);
    this.assetBase = assetBase;
    this.onReady = onReady;
  }

  preload(): void {
    queueArenaAssets(this.load, this.assetBase);
  }

  create(): void {
    if (!this.anims.exists("fd-box-pulse"))
      this.anims.create({
        key: "fd-box-pulse",
        frames: this.anims.generateFrameNumbers("itembox", {
          frames: [0, 1, 2, 3],
        }),
        frameRate: 6,
        repeat: -1,
      });
    if (!this.anims.exists("fd-explode"))
      this.anims.create({
        key: "fd-explode",
        frames: this.anims.generateFrameNumbers("explosion", {
          frames: [...FRAMES.explosionFrames],
        }),
        frameRate: 12,
      });
    ensureOilSlickTexture(this);
    this.dust = this.add
      .particles(0, 0, "dust", {
        frame: [...FRAMES.dust],
        lifespan: 450,
        speed: { min: 5, max: 30 },
        scale: { start: SPRITE_SCALE * 0.5, end: SPRITE_SCALE * 0.9 },
        alpha: { start: 0.7, end: 0 },
        emitting: false,
      })
      .setDepth(8);
    this.marks = this.add.graphics().setDepth(12);
    this.onReady();
  }

  private frameCamera(track: Track): void {
    const view = raceViewport(track);
    this.cameras.main
      .setViewport(view.x, view.y, view.width, view.height)
      .setZoom(view.zoom)
      .centerOn((track.cols * config.tile) / 2, (track.rows * config.tile) / 2);
  }

  private buildTrack(track: Track): void {
    this.art?.destroy();
    for (const box of this.boxes) box.destroy();
    this.art = createTrackArt(this, track);
    this.artTrack = track.name;
    this.boxes = track.items.map((p) =>
      this.add
        .sprite(p.x, p.y, "itembox", 0)
        .setScale(SPRITE_SCALE)
        .setDepth(4)
        .play("fd-box-pulse"),
    );
    this.frameCamera(track);
  }

  private buildTrucks(count: number): void {
    for (const truck of this.trucks) truck.destroy();
    for (const shadow of this.shadows) shadow.destroy();
    for (const shield of this.shields) shield.destroy();
    this.trucks = [];
    this.shadows = [];
    this.shields = [];
    this.bodies = [];
    this.sides = [];
    this.wasWrecked = Array.from({ length: count }, () => false);
    for (let slot = 0; slot < count; slot++) {
      const key = `truck-${TRUCK_COLORS[slot % TRUCK_COLORS.length]!}`;
      const copy = (): Phaser.GameObjects.Image =>
        this.add.image(0, 0, key).setScale(TRUCK_SCALE);
      const sides = Array.from({ length: SIDE_LAYERS }, (_, k) =>
        copy()
          .setTint(k === 0 ? 0x202028 : 0x50505c)
          .setY(-k),
      );
      const body = copy().setY(-SIDE_LAYERS);
      this.shadows.push(
        this.add
          .container(0, 0, [copy().setTint(0x000000).setAlpha(0.35)])
          .setScale(1, TILT)
          .setDepth(9),
      );
      this.sides.push(sides);
      this.bodies.push(body);
      this.trucks.push(
        this.add
          .container(0, 0, [...sides, body])
          .setScale(1, TILT)
          .setDepth(10),
      );
      this.shields.push(
        this.add
          .image(0, 0, "projectiles", FRAMES.projectiles.shield)
          .setScale(SPRITE_SCALE * 2.2)
          .setAlpha(0.55)
          .setDepth(11)
          .setVisible(false),
      );
    }
  }

  private explode(x: number, y: number): void {
    const boom = this.add
      .sprite(x, y, "explosion", 0)
      .setScale(SPRITE_SCALE * 2.2)
      .setDepth(20)
      .play("fd-explode");
    boom.once("animationcomplete", () => boom.destroy());
  }

  paint(frame: ArenaFrame): void {
    const { race, track, poses, alpha, newTick } = frame;
    if (this.artTrack !== track.name) this.buildTrack(track);
    if (this.trucks.length !== race.trucks.length)
      this.buildTrucks(race.trucks.length);
    const marks = this.marks;
    if (!marks) return;
    marks.clear();

    race.trucks.forEach((t, slot) => {
      const p = poses[slot];
      const container = this.trucks[slot];
      const shadow = this.shadows[slot];
      const body = this.bodies[slot];
      const shield = this.shields[slot];
      const sides = this.sides[slot];
      if (!p || !container || !shadow || !body || !shield || !sides) return;
      const wrecked = t.respawnAtTick !== 0;
      if (wrecked && !this.wasWrecked[slot]) this.explode(t.x, t.y);
      this.wasWrecked[slot] = wrecked;
      const air = race.tick < t.airborneUntilTick;
      // Cosmetic effects sample once per simulated tick, so their density does not follow the frame rate.
      if (
        newTick &&
        !air &&
        !wrecked &&
        t.speed > t.stats.topSpeed * 0.6 &&
        this.dust
      )
        this.dust.emitParticleAt(
          p.x - Math.cos(p.heading) * 20,
          p.y - Math.sin(p.heading) * 20,
        );
      // The sprite's nose points up and heading 0 points right; a spin-out whirls it around its heading.
      const rotation =
        p.heading +
        Math.PI / 2 +
        (race.tick < t.spinUntilTick
          ? (t.spinUntilTick - race.tick - alpha) * SPIN_PER_TICK
          : 0);
      const lift = air ? 12 : 0,
        grow = air ? 1.1 : 1;
      shadow
        .setPosition(p.x + (air ? 8 : 3), p.y + (air ? 14 : 5))
        .setVisible(!wrecked)
        .setDepth(t.onBridge ? 14 : 9);
      const shadowBody = shadow.list[0];
      if (shadowBody instanceof Phaser.GameObjects.Image)
        shadowBody.setRotation(rotation);
      for (const layer of [...sides, body]) layer.setRotation(rotation);
      container
        .setPosition(p.x, p.y - lift)
        .setScale(grow, grow * TILT)
        .setVisible(!(race.tick < t.invulnerableUntilTick && race.tick % 6 < 3))
        .setDepth(t.onBridge ? 15 : 10);
      shield
        .setPosition(p.x, p.y)
        .setVisible(!wrecked && race.tick < t.shieldUntilTick);
      // A wrecked truck stays where it died as a burnt hulk until it respawns at the last checkpoint.
      body
        .setTexture(
          wrecked
            ? "wreck"
            : `truck-${TRUCK_COLORS[slot % TRUCK_COLORS.length]!}`,
        )
        .setTint(race.tick < t.stunUntilTick ? 0x8080ff : 0xffffff);
      if (t.lockedUntilTick > race.tick && !wrecked)
        this.drawLock(marks, p.x, p.y);
    });

    const prevMissiles = new Map(
      (frame.previous?.missiles ?? []).map((m) => [m.id, m]),
    );
    syncSet(
      this.missiles,
      race.missiles,
      (m) =>
        this.add
          .image(m.x, m.y, "projectiles", FRAMES.projectiles.missile)
          .setScale(SPRITE_SCALE * 0.6)
          .setDepth(9),
      (image, m) => {
        const p = prevMissiles.get(m.id) ?? m;
        image
          .setPosition(lerp(p.x, m.x, alpha), lerp(p.y, m.y, alpha))
          .setRotation(m.heading + Math.PI / 2);
      },
    );
    if (newTick) {
      for (const id of [...this.trails.keys()])
        if (!this.missiles.has(id)) this.trails.delete(id);
      for (const m of race.missiles) {
        const trail = this.trails.get(m.id) ?? [];
        trail.push({ x: m.x, y: m.y });
        if (trail.length > 9) trail.shift();
        this.trails.set(m.id, trail);
      }
    }
    for (const trail of this.trails.values()) {
      // The newest point sits under the missile itself, so skip it.
      trail.slice(0, -1).forEach((pt, k) => {
        marks
          .fillStyle(0xff3030, (k + 1) / trail.length)
          .fillCircle(pt.x, pt.y, 3.5);
      });
    }

    syncSet(
      this.mines,
      race.mines,
      (m) =>
        this.add
          .image(m.x, m.y, "projectiles", FRAMES.projectiles.mineUnarmed)
          .setScale(SPRITE_SCALE * 0.7)
          .setDepth(3),
      (image, m) =>
        image.setFrame(
          race.tick - m.droppedTick >= config.items.mine.armTicks &&
            race.tick % 10 < 5
            ? FRAMES.projectiles.mineArmed
            : FRAMES.projectiles.mineUnarmed,
        ),
    );
    syncSet(
      this.oils,
      race.oils,
      (o) =>
        this.add
          .image(o.x, o.y, "fd:oil-slick")
          .setScale((config.items.oil.radius * 2) / 128)
          .setDepth(2),
      (image, o) =>
        image.setAlpha(
          Math.min(
            1,
            (config.items.oil.lifeTicks - (race.tick - o.droppedTick)) / 60,
          ),
        ),
    );
    syncSet(
      this.drones,
      race.drones,
      () =>
        this.add
          .image(0, 0, "projectiles", FRAMES.projectiles.drone)
          .setScale(SPRITE_SCALE * 0.8)
          .setDepth(13),
      (image, d) => {
        const owner = race.trucks[d.owner],
          pose = poses[d.owner];
        if (!owner || !pose) return;
        const p = dronePosition(d, { ...owner, ...pose }, race.tick + alpha);
        image.setPosition(p.x, p.y).setRotation(race.tick * 0.5);
      },
    );
    const slots = race.trucks.length;
    this.boxes.forEach((box, i) => {
      const until = race.boxCooldowns[i * slots + frame.focus] ?? 0;
      box.setAlpha(race.tick < until ? 0.4 : 1);
    });
  }

  private drawLock(
    marks: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
  ): void {
    const r = 30,
      l = 10;
    marks.lineStyle(4, 0xff3030);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      marks
        .beginPath()
        .moveTo(x + sx * r, y + sy * (r - l))
        .lineTo(x + sx * r, y + sy * r)
        .lineTo(x + sx * (r - l), y + sy * r)
        .strokePath();
    }
  }

  /** Drop everything that outlives a single frame, so a re-mount starts from a clean map. */
  reset(): void {
    this.trails.clear();
    for (const map of [this.missiles, this.mines, this.oils, this.drones]) {
      for (const image of map.values()) image.destroy();
      map.clear();
    }
    this.wasWrecked = this.wasWrecked.map(() => false);
  }
}
