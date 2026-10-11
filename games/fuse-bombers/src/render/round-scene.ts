import Phaser from "phaser";
import {
  fuseProgress,
  GHOST_FLIGHT,
  GUNSHIP_FLIGHT,
  ghostOf,
  isGhostLoaded,
  isLoaded,
  launcherPivot,
  predictGhostBomb,
  predictTrajectory,
  thrustDirection,
  type CastleView,
  type GhostView,
  type RoundView,
  type TickEvent,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../engine/index.js";
import * as aim from "./aim.js";
import * as art from "./art.js";
import {
  createCamera,
  snapCamera,
  updateCamera,
  zoomLimits,
  type Camera,
} from "./camera.js";
import { Effects } from "./effects/effects.js";
import {
  framingPoints,
  hudScale,
  minScreenScale,
  shipMarkers,
  skyRect,
  type ShipMarker,
} from "./framing.js";
import {
  GHOST_HOOK,
  GhostArt,
  GunshipArt,
  type GunshipLook,
} from "./gunship-art.js";
import {
  css,
  gateColor,
  PLAYER_COLORS,
  playerColor,
  THEMES,
} from "./palette.js";
import { SHARED_SPRITES } from "./sprites.js";
import { TerrainLayer } from "./terrain-layer.js";

/** How one player looks on screen. */
export interface PlayerLook {
  readonly name: string;
  /** Envelope, launcher band, health bar, rockets and shield tint. */
  readonly color: number;
  /** A short label above the gunship, e.g. the player's button (`Q`, `PAD 1`) or `BOT`. */
  readonly tag?: string;
  /**
   * Set for humans only: a badge such as `PRESS Q` shown over the gunship at the start of each round. Humans also
   * get the bold aiming guide and see which gates and crates their angle would pass through.
   */
  readonly prompt?: string;
}

/**
 * Where the scene gets the round from. The app owns the fixed-step loop: each frame the scene hands it the real
 * elapsed time, then draws `view`. A different `view` object means a new round has started.
 */
export interface RoundSource {
  readonly view: RoundView;
  /** Advances by real time; the returned events all belong to the round `view` shows afterwards. */
  advance(deltaMs: number): readonly TickEvent[];
  /** Changes when a new round starts, for a source whose `view` is a new object every frame; else `view` itself. */
  readonly round?: unknown;
  /** A personal device's gunship (its ghost once it falls) for the camera to follow; absent, it frames every ship. */
  readonly follow?: number;
}

export interface RoundSceneData {
  readonly source: RoundSource;
  /** One look per player id; defaults to "PLAYER N" in the palette colours. */
  readonly players?: readonly PlayerLook[];
}

/**
 * Scene event emitted every frame after the engine advanced, with `(events, view)`. Effects and audio listen here.
 * The events always belong to the round `view` shows (see `RoundSource.advance`).
 */
export const ROUND_EVENTS = "round-events";

/**
 * Scene event emitted with `(view)` when a round starts (the first one too), before that frame's `ROUND_EVENTS`.
 * Listeners drop effects left over from the previous round here.
 */
export const ROUND_START = "round-start";

/** Draw order. Effects slot in between, e.g. explosions at `DEPTH.rockets + 1`. */
export const DEPTH = {
  backdrop: 0,
  gates: 10,
  crates: 15,
  terrain: 20,
  castles: 30,
  rockets: 40,
  hud: 50,
  fuse: 60,
  banner: 70,
} as const;

/** The canvas size: the HUD's coordinates, and the screen the world camera frames the world into. */
export const VIEW_WIDTH = 1600;
export const VIEW_HEIGHT = 900;
const [W, H] = [VIEW_WIDTH, VIEW_HEIGHT];
const INK = 0x1b1d26;
/** Ticks at the start of a round during which the `prompt` badges show (the countdown counts as tick 0). */
const PROMPT_TICKS = 240;
const FUSE = { y: 28, x0: 70, x1: 1510 } as const;
/** Screen rows kept clear of the world: the fuse along the top, the match's score bar (DOM) along the bottom. */
const HUD_BAND = 52;
/** What the framing camera frames into: the screen between the HUD bands (the world still shows under them). */
const REGION = { width: W, height: H - 2 * HUD_BAND } as const;
const WORLD = { width: WORLD_WIDTH, height: WORLD_HEIGHT } as const;
/** A crate's drawn size (world px) and the least it shows at on screen (the box itself is about 3/4 of it), so
 * crates read at the widest zoom. */
const CRATE_SIZE = 46;
const CRATE_MIN_PX = 32;
/** Screen px (at full HUD scale) from the launcher pivot up to the health bar, clear of the ready ring. */
const ABOVE_PIVOT = 16;
/** A text mark's scale for a HUD scale `k`: text shrinks half as much as the rings and bars, to stay legible. */
const textScale = (k: number) => 0.5 + 0.5 * k;

type Pool<O> = Map<number, O>;

/** One ghost on screen: the blimp (its loaded bomb included) and a human's key badge. */
interface GhostSprite {
  readonly art: GhostArt;
  readonly badge: Phaser.GameObjects.Text | undefined;
  destroy(): void;
}

/** The world camera's framing before shake: its zoom and the world point at the centre of the screen. */
export interface Frame {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

/** Where the ghost art hangs the loaded bomb, below the ghost's centre (under the gondola). */
const HANG_Y = (GHOST_HOOK * GHOST_FLIGHT.shape.radius) / 18;

/** Keeps one display object per live engine id: creates, places, and destroys those whose id is gone. */
function sync<T extends { readonly id: number }, O extends { destroy(): void }>(
  pool: Pool<O>,
  items: readonly T[],
  create: (item: T) => O,
  place: (object: O, item: T) => void,
): void {
  const live = new Set<number>();
  for (const item of items) {
    live.add(item.id);
    let object = pool.get(item.id);
    if (!object) pool.set(item.id, (object = create(item)));
    place(object, item);
  }
  for (const [id, object] of pool)
    if (!live.has(id)) {
      object.destroy();
      pool.delete(id);
    }
}

/**
 * Draws one round from its `RoundView`: backdrop, eroding terrain, gunships with launchers, health, reload and
 * shields, pooled rockets, ghost blimps, gates, crates, the fuse and a winner banner. It owns no rules or timers.
 * Start it again with new `RoundSceneData` to draw another match.
 *
 * Two cameras: the main one is the framing camera (camera.ts), framing every living gunship (ghosts pull it part of
 * the way) between the HUD bands and zooming between one old arena and the whole map. A HUD camera on top draws
 * labels, bars, guides, edge arrows for ships out of view, the fuse and the banner in screen pixels, so they stay
 * crisp at any zoom. Every object belongs to the world unless `toHud()` moves it to the HUD camera.
 */
export class RoundScene extends Phaser.Scene {
  static readonly KEY = "round";

  private source!: RoundSource;
  private players: readonly PlayerLook[] = [];
  private current: unknown = null; // `RoundSource.round`, or the view
  private backdrop!: Phaser.GameObjects.Image;
  private terrain!: TerrainLayer;
  private hud!: Phaser.GameObjects.Graphics;
  private gateGfx!: Phaser.GameObjects.Graphics;
  private flame!: Phaser.GameObjects.Image;
  private bomb!: Phaser.GameObjects.Image;
  private suddenDeath!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private ships: GunshipArt[] = [];
  private looks: GunshipLook[] = [];
  private tags: Phaser.GameObjects.Text[] = [];
  private prompts: (Phaser.GameObjects.Text | undefined)[] = [];
  private rockets: Phaser.GameObjects.Image[] = [];
  private rocketKeys: string[] = [];
  private shownRockets = 0;
  private gateLabels: Pool<Phaser.GameObjects.Text> = new Map();
  private crates: Pool<Phaser.GameObjects.Container> = new Map();
  private ghosts: Pool<GhostSprite> = new Map();
  private ui!: Phaser.Cameras.Scene2D.Camera;
  private camera!: Camera;
  /** The main camera's framing this frame (effects shake around it). */
  frame: Frame = { zoom: 1, x: W / 2, y: H / 2 };
  /** The size of the marks over ships this frame (`hudScale`). */
  private marks = 1;
  /** World to HUD (screen) coordinates through the main camera as it is now. */
  private readonly to: aim.Projection = {
    point: (x, y) => {
      const cam = this.cameras.main;
      const [cx, cy] = [cam.width / 2, cam.height / 2];
      return {
        x: (x - cam.scrollX - cx) * cam.zoom + cx,
        y: (y - cam.scrollY - cy) * cam.zoom + cy,
      };
    },
    size: (length) => length * this.cameras.main.zoom,
  };
  /** Explosions, trails, damage numbers and shake; exposed for browser checks. */
  effects!: Effects;

  constructor() {
    super(RoundScene.KEY);
  }

  init(data: RoundSceneData): void {
    this.source = data.source;
    this.players = data.players ?? [];
    this.current = null;
    this.ships = [];
    this.looks = [];
    this.tags = [];
    this.prompts = [];
    this.rockets = [];
    this.rocketKeys = [];
    this.shownRockets = 0;
    this.gateLabels = new Map();
    this.crates = new Map();
    this.ghosts = new Map();
  }

  preload(): void {
    const base = import.meta.env.BASE_URL;
    art.loadSprites(this, [
      ...PLAYER_COLORS,
      ...this.players.map((p) => p.color),
    ]);
    this.load.image("crate", `${base}${SHARED_SPRITES.crate}`);
    for (const [key, size] of [
      ["flame", 48],
      ["bomb", 64],
    ] as const)
      this.load.svg(key, `${base}${SHARED_SPRITES[key]}`, {
        width: size,
        height: size,
      });
  }

  create(): void {
    // The framing camera starts on the whole world between the HUD bands. The main camera fills the screen with the
    // pose's centre in the middle, which is the bands' middle too.
    this.camera = createCamera({ view: REGION, world: WORLD });
    this.setFrame();
    const { zoom, x, y } = this.frame;
    this.cameras.main.setZoom(zoom).centerOn(x, y);
    this.ui = this.cameras.add(0, 0, W, H, false, "hud");
    // Everything belongs to the world camera until `toHud()` moves it.
    const added = Phaser.Scenes.Events.ADDED_TO_SCENE;
    const world = (object: Phaser.GameObjects.GameObject) =>
      this.ui.ignore(object);
    this.events.on(added, world);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      this.events.off(added, world),
    );
    art.paintBackdrops(this, W, H);
    this.backdrop = this.add.image(0, 0, "backdrop-0");
    this.placeSky();
    this.gateGfx = this.add.graphics().setDepth(DEPTH.gates);
    this.terrain = new TerrainLayer(this, DEPTH.terrain);
    this.hud = this.toHud(this.add.graphics().setDepth(DEPTH.hud));
    this.flame = this.toHud(this.add.image(0, 0, "flame").setDepth(DEPTH.fuse));
    this.bomb = this.toHud(
      this.add.image(FUSE.x1 + 34, FUSE.y + 4, "bomb").setDepth(DEPTH.fuse),
    );
    this.suddenDeath = this.text(W / 2, 72, "SUDDEN DEATH!", 26, DEPTH.fuse);
    this.suddenDeath.setColor("#ff4a3a");
    this.banner = this.text(W / 2, H * 0.32, "", 56, DEPTH.banner);
    this.banner.setVisible(false);
    this.effects = new Effects(this, { frame: () => this.frame });
  }

  /** Moves an object from the world camera to the HUD camera (screen pixels). */
  private toHud<T extends Phaser.GameObjects.GameObject>(object: T): T {
    object.cameraFilter = 0;
    this.cameras.main.ignore(object);
    return object;
  }

  private setFrame(): void {
    const { centerX: x, centerY: y, zoom } = this.camera.pose;
    this.frame = { zoom, x, y };
    this.marks = hudScale(zoom);
  }

  /** The sky fills the screen behind the world, with a little parallax (`skyRect`). */
  private placeSky(): void {
    const { min, max } = zoomLimits(this.camera.settings);
    const screen = { width: W, height: H };
    const r = skyRect(this.camera.pose, screen, WORLD, min, max);
    this.backdrop.setPosition(r.x, r.y).setDisplaySize(r.width, r.height);
  }

  update(time: number, delta: number): void {
    // Raw frame time: Phaser's smoothed delta is clamped to 1/60 s while the window is unfocused.
    const events = this.source.advance(this.game.loop.rawDelta);
    const view = this.source.view;
    const round = this.source.round ?? view;
    const started = round !== this.current;
    if (started) this.startRound(view, round);
    // The camera's easing and the ships' animation are cosmetic and run on Phaser's smoothed frame time.
    const dt = delta / 1000;
    const ships = framingPoints(view);
    // A personal device follows its gunship, or its ghost, with the others in view while they fit.
    const id = this.source.follow ?? -1;
    const own = view.castles[id]?.alive ? view.castles[id] : ghostOf(view, id);
    const others = ships.filter((ship) => ship.id !== id);
    const frame = own ? { points: others, focus: own } : { points: ships };
    if (started) snapCamera(this.camera, frame);
    else updateCamera(this.camera, frame, dt);
    this.setFrame();
    // Frame and shake the world camera first: the HUD below projects through it, and drawn before it the HUD would
    // trail the world by a frame (this frame's explosions shake from the next one).
    this.effects.applyShake();
    this.placeSky();
    this.terrain.update(view.terrain, events);
    this.hud.clear();
    this.drawGates(view);
    const least = minScreenScale(CRATE_SIZE, this.frame.zoom, CRATE_MIN_PX);
    sync(
      this.crates,
      view.crates,
      (c) => this.createCrate(c.card),
      (crate, c) => {
        const grow = Math.min(1, (view.tick - c.spawnTick) / 15);
        crate.setPosition(c.x, c.y).setScale(grow * least);
      },
    );
    for (const c of view.castles) this.drawCastle(view, c, time, dt);
    sync(
      this.ghosts,
      view.ghosts.map((g) => ({ id: g.owner, g })),
      ({ g }) => this.createGhost(g.owner),
      (sprite, { g }) => this.drawGhost(view, g, sprite, time, dt),
    );
    this.drawRockets(view);
    for (const m of shipMarkers(ships, this.camera.pose, REGION, HUD_BAND))
      this.drawMarker(view, m);
    this.drawFuse(view, time);
    this.drawBanner(view);
    if (started) this.events.emit(ROUND_START, view);
    this.events.emit(ROUND_EVENTS, events, view);
  }

  private look(id: number): PlayerLook {
    return (
      this.players[id] ?? { name: `PLAYER ${id + 1}`, color: playerColor(id) }
    );
  }

  private text(
    x: number,
    y: number,
    value: string,
    size: number,
    depth: number,
  ) {
    const style = {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: `${size}px`,
      stroke: css(INK),
      strokeThickness: Math.round(size / 4),
    };
    return this.toHud(this.add.text(x, y, value, style))
      .setOrigin(0.5)
      .setDepth(depth);
  }

  /** A wooden crate with its card's badge pinned on it. */
  private createCrate(card: string): Phaser.GameObjects.Container {
    const box = this.add
      .image(0, 0, "crate")
      .setDisplaySize(CRATE_SIZE, CRATE_SIZE);
    const icon = this.add.image(0, 0, `card-${card}`).setScale(0.85);
    return this.add.container(0, 0, [box, icon]).setDepth(DEPTH.crates);
  }

  private startRound(view: RoundView, round: unknown): void {
    this.current = round;
    const theme = Math.abs(Math.trunc(view.config.seed)) % THEMES.length;
    this.backdrop.setTexture(`backdrop-${theme}`);
    this.terrain.reset(view.terrain, THEMES[theme] ?? THEMES[0]!);
    for (const object of [...this.ships, ...this.tags]) object.destroy();
    for (const object of this.prompts) object?.destroy();
    for (const pool of [this.gateLabels, this.crates, this.ghosts]) {
      for (const object of pool.values()) object.destroy();
      pool.clear();
    }
    this.tags = view.castles.map((c) =>
      this.text(0, 0, this.look(c.id).tag ?? "", 12, DEPTH.hud).setColor(
        css(this.look(c.id).color),
      ),
    );
    this.prompts = view.castles.map((c) => {
      const prompt = this.look(c.id).prompt;
      return prompt === undefined
        ? undefined
        : this.text(0, 0, prompt, 14, DEPTH.hud + 1);
    });
    // Geometry from the engine: the hit circle, the shield bubble and the launcher's pivot and barrel, so the drawn
    // barrel ends where the dotted guide starts. The HUD draws the reload ring, crisp at any zoom.
    const t = view.tuning;
    this.looks = view.castles.map((c) => ({
      color: this.look(c.id).color,
      radius: GUNSHIP_FLIGHT.shape.radius,
      seed: c.id,
      shieldRadius: t.shieldRadius,
      facing: c.x < WORLD_WIDTH / 2 ? 1 : -1,
      launcherOffset: t.launcherOffset,
      barrelLength: t.barrelLength,
      reloadRing: false,
    }));
    this.ships = view.castles.map(() => new GunshipArt(this, DEPTH.castles));
  }

  private drawCastle(
    view: RoundView,
    c: CastleView,
    time: number,
    dt: number,
  ): void {
    const t = view.tuning;
    const [ship, look] = [this.ships[c.id], this.looks[c.id]];
    if (!ship || !look) return;
    // A destroyed gunship's art starts its wreck on the frame its `castle-destroyed` event arrives (alive turns
    // false), plays it and hides itself.
    const { x: thrustX, y: thrustY } = thrustDirection(c.thrust);
    const [loaded, shield] = [c.alive && isLoaded(c), c.shieldHp / t.shieldMax];
    const reload = 1 - c.reloadTicks / Math.max(1, c.reloadTotalTicks);
    const state = { ...c, loaded, shield, reload, thrustX, thrustY };
    ship.update(look, state, dt);
    // Marks over the ship, in screen px: health bar and tag above the turret, rings around it, sized by `marks`.
    const k = this.marks;
    const pivot = launcherPivot(c, t);
    const at = this.to.point(pivot.x, pivot.y);
    const top = { x: at.x, y: at.y - ABOVE_PIVOT * k };
    const label = { x: top.x, y: top.y - 15 - 7 * textScale(k) };
    this.tags[c.id]
      ?.setVisible(c.alive)
      .setPosition(label.x, label.y)
      .setScale(textScale(k));
    this.drawPrompt(view, c, label, time);
    if (!c.alive) return;

    // Health bar above the turret; the shield shows as a cyan strip inside it.
    const hud = this.hud;
    const [w, x0, y0] = [44 * k, top.x - 22 * k, top.y - 10];
    hud.fillStyle(INK, 0.85).fillRoundedRect(x0 - 2, y0 - 2, w + 4, 10, 4);
    hud
      .fillStyle(look.color)
      .fillRect(x0, y0, (w * Math.max(0, c.hp)) / c.maxHp, 6);
    hud
      .fillStyle(0x9ff3ff)
      .fillRect(x0, y0 + 4, (w * c.shieldHp) / t.shieldMax, 2);

    const { prompt } = this.look(c.id);
    if (isLoaded(c) && !view.result) {
      const human = prompt !== undefined;
      const style = human ? aim.HUMAN_GUIDE : aim.BOT_GUIDE;
      // Humans predict the whole flight to find the gates and crates on it; only a prefix is drawn.
      const path = predictTrajectory(view, c.id, undefined, {
        maxTicks: human ? undefined : style.ticks,
      });
      if (human) aim.drawTargets(hud, view, path, look.color, time, this.to);
      const guide = path.points.slice(0, style.ticks + 1);
      aim.drawGuide(
        hud,
        guide.map((p) => this.to.point(p.x, p.y)),
        look.color,
        { ...style, radius: style.radius * k },
      );
      aim.drawReady(hud, at, look.color, time, human, k);
    } else if (c.reloadTicks > 0 && c.reloadTotalTicks > 0) {
      const done = 1 - c.reloadTicks / c.reloadTotalTicks;
      const start = -Math.PI / 2;
      hud.lineStyle(5, INK, 0.6).strokeCircle(at.x, at.y, 10 * k);
      hud.lineStyle(3, 0xffffff, 0.95).beginPath();
      hud.arc(at.x, at.y, 10 * k, start, start + done * Math.PI * 2);
      hud.strokePath();
    }
    if (c.megaReady)
      hud.lineStyle(3, 0xd35cff).strokeCircle(at.x, at.y, 16 * k);
  }

  /** The `PRESS Q` badge bobbing over a human's gunship (above its tag at `label`) for the first seconds of a round. */
  private drawPrompt(
    view: RoundView,
    c: CastleView,
    label: { x: number; y: number },
    time: number,
  ): void {
    const prompt = this.prompts[c.id];
    if (!prompt) return;
    const show = c.alive && !view.result && view.tick < PROMPT_TICKS;
    if (!prompt.setVisible(show).visible) return;
    const x = label.x;
    const y = label.y - 40 + 4 * Math.sin(time / 160);
    prompt.setPosition(x, y);
    const [w, h] = [prompt.width + 22, prompt.height + 16];
    const hud = this.hud;
    hud
      .fillStyle(INK)
      .fillRoundedRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6, 9);
    hud.fillTriangle(x - 13, y + h / 2, x + 13, y + h / 2, x, y + h / 2 + 16);
    hud.fillStyle(this.look(c.id).color);
    hud.fillRoundedRect(x - w / 2, y - h / 2, w, h, 7);
    hud.fillTriangle(
      x - 8,
      y + h / 2 - 1,
      x + 8,
      y + h / 2 - 1,
      x,
      y + h / 2 + 10,
    );
  }

  private createGhost(owner: number): GhostSprite {
    const { tag, prompt } = this.look(owner);
    const art = new GhostArt(this, DEPTH.castles + 1);
    // Humans get a badge with their key over the blimp, so everyone knows whose it is.
    const badge =
      prompt !== undefined && tag
        ? this.text(0, 0, tag, 12, DEPTH.hud + 1)
        : undefined;
    return {
      art,
      badge,
      destroy: () => {
        art.destroy();
        badge?.destroy();
      },
    };
  }

  /**
   * A translucent blimp in the player's colour. Loaded, a bomb hangs under it (and a human gets a short
   * drop guide and a pulsing ring); reloading, a ring fills around the empty hook.
   */
  private drawGhost(
    view: RoundView,
    g: GhostView,
    sprite: GhostSprite,
    time: number,
    dt: number,
  ): void {
    const { color, prompt } = this.look(g.owner);
    const human = prompt !== undefined;
    const loaded = isGhostLoaded(g, view.terrain) && !view.result;
    const { x: thrustX, y: thrustY } = thrustDirection(g.thrust);
    const look = { color, radius: GHOST_FLIGHT.shape.radius, seed: g.owner };
    sprite.art.update(look, { ...g, thrustX, thrustY, loaded }, dt);
    const [hud, k] = [this.hud, this.marks];
    if (sprite.badge) {
      // Over the envelope, which is smaller than the badge.
      const b = sprite.badge.setScale(textScale(k));
      const [w, h] = [b.displayWidth + 12, b.displayHeight + 8];
      const at = this.to.point(g.x, g.y - GHOST_FLIGHT.shape.radius);
      b.setPosition(at.x, at.y - h / 2 - 4);
      hud.fillStyle(INK).fillRoundedRect(b.x - w / 2, b.y - h / 2, w, h, 6);
      hud.lineStyle(2, 0xffffff, 0.9);
      hud.strokeRoundedRect(b.x - w / 2, b.y - h / 2, w, h, 6);
    }
    const hook = this.to.point(g.x, g.y + HANG_Y);
    if (loaded && human) {
      const path = predictGhostBomb(view, g.owner, 0, 90);
      // The guide starts below the blimp, where the bomb comes out, and shows only its first stretch.
      const below = path?.points.filter((p) => p.y > g.y + HANG_Y + 14) ?? [];
      const guide = below
        .slice(0, aim.GHOST_GUIDE.ticks + 1)
        .map((p) => this.to.point(p.x, p.y));
      const style = aim.GHOST_GUIDE;
      aim.drawGuide(hud, guide, color, { ...style, radius: style.radius * k });
      aim.drawReady(hud, hook, color, time, true, k);
    } else if (!loaded && g.reloadTotalTicks > 0 && !view.result) {
      const done = 1 - g.reloadTicks / g.reloadTotalTicks;
      const start = -Math.PI / 2;
      // A full, dimmed ring: reloaded, but the blimp is inside rock, where no bomb can be dropped.
      const blocked = g.reloadTicks === 0;
      hud.lineStyle(5, INK, 0.6).strokeCircle(hook.x, hook.y, 8 * k);
      hud
        .lineStyle(3, human ? 0xffffff : color, blocked ? 0.45 : 0.95)
        .beginPath();
      hud.arc(hook.x, hook.y, 8 * k, start, start + done * Math.PI * 2);
      hud.strokePath();
    }
  }

  /**
   * An arrow at the screen's edge pointing at a ship out of view, in its player's colour, smaller the farther the
   * ship is; a gunship's carries a tiny health bar, a ghost's is fainter.
   */
  private drawMarker(view: RoundView, m: ShipMarker): void {
    const hud = this.hud;
    const color = this.look(m.id).color;
    const [s, alpha] = m.ghost ? [m.scale * 0.8, 0.65] : [m.scale, 1];
    const [cos, sin] = [Math.cos(m.angle), Math.sin(m.angle)];
    const at = (u: number, v: number) => ({
      x: m.x + s * (u * cos - v * sin),
      y: m.y + s * (u * sin + v * cos),
    });
    const [tip, left, right] = [at(14, 0), at(-9, -11), at(-9, 11)];
    hud.lineStyle(6, INK, 0.85 * alpha);
    hud.strokeTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    hud.fillStyle(color, alpha);
    hud.fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    const c = view.castles[m.id];
    if (m.ghost || !c) return;
    const [w, x0, y0] = [26 * s, m.x - 13 * s, m.y + 17 * s];
    hud.fillStyle(INK, 0.85).fillRect(x0 - 2, y0 - 2, w + 4, 7);
    hud.fillStyle(color).fillRect(x0, y0, (w * Math.max(0, c.hp)) / c.maxHp, 3);
  }

  /** One pooled image per live rocket, the smoke streak baked into its texture. */
  private drawRockets(view: RoundView): void {
    const rockets = view.rockets;
    for (let i = 0; i < rockets.length; i++) {
      const r = rockets[i];
      if (!r) continue;
      const image = (this.rockets[i] ??= this.add
        .image(0, 0, "rocket-bomb")
        .setDepth(DEPTH.rockets));
      const key = r.bomb
        ? "rocket-bomb"
        : art.spriteKey(
            r.ghost ? "ghost-bomb" : "rocket",
            this.look(r.owner).color,
          );
      if (this.rocketKeys[i] !== key) {
        this.rocketKeys[i] = key;
        const round = r.bomb || r.ghost;
        image
          .setTexture(key)
          .setOrigin(round ? 0.5 : art.ROCKET.body / art.ROCKET.width, 0.5);
      }
      const scale =
        (r.bomb ? 1 : r.ghost ? 1.5 : 1.3) *
        (r.mega
          ? 1.7
          : 1 + Math.min(0.8, Math.log2(Math.max(1, r.power)) * 0.25));
      image.setVisible(true).setPosition(r.x, r.y).setScale(scale);
      image.setRotation(r.bomb ? 0 : Math.atan2(r.vy, r.vx));
    }
    for (let i = rockets.length; i < this.shownRockets; i++)
      this.rockets[i]?.setVisible(false);
    this.shownRockets = rockets.length;
  }

  /**
   * Tall translucent panels with end caps and a "×N" label, fading in and out with the gate's life. Zoomed out, the
   * outline and caps thicken (never the panel, which is the gate's hit area) so a gate still reads.
   */
  private drawGates(view: RoundView): void {
    const g = this.gateGfx.clear();
    const k = minScreenScale(1, this.frame.zoom, 0.8);
    const fade = (gate: RoundView["gates"][number]): number =>
      Phaser.Math.Clamp(
        Math.min(
          (view.tick - gate.spawnTick) / 30,
          (gate.expireTick - view.tick) / 60,
        ),
        0,
        1,
      );
    for (const gate of view.gates) {
      const [color, alpha, w, h] = [
        gateColor(gate.multiplier),
        fade(gate),
        gate.width,
        gate.height,
      ];
      const [x0, y0, cap] = [gate.x - w / 2, gate.y - h / 2, 7 * k];
      g.fillStyle(color, 0.38 * alpha).fillRect(x0, y0, w, h);
      g.fillStyle(0xffffff, 0.35 * alpha).fillRect(x0 + 4, y0 + 6, 4, h - 12);
      g.lineStyle(3 * k, color, alpha).strokeRect(x0, y0, w, h);
      g.fillStyle(color, alpha);
      g.fillRoundedRect(x0 - cap, y0 - 8 * k, w + 2 * cap, 9 * k, 4 * k);
      g.fillRoundedRect(x0 - cap, y0 + h - k, w + 2 * cap, 9 * k, 4 * k);
    }
    sync(
      this.gateLabels,
      view.gates,
      (gate) =>
        this.text(0, 0, `×${gate.multiplier}`, 14, DEPTH.gates).setColor(
          css(gateColor(gate.multiplier)),
        ),
      (label, gate) => {
        const at = this.to.point(gate.x, gate.y - gate.height / 2 - 8 * k);
        label.setPosition(at.x, at.y - 16).setAlpha(fade(gate));
      },
    );
  }

  /** A rope across the top burning toward a bomb; sudden death when it is gone. */
  private drawFuse(view: RoundView, time: number): void {
    const hud = this.hud;
    const p = fuseProgress(view);
    const burn = FUSE.x0 + (FUSE.x1 - FUSE.x0) * p;
    hud.lineStyle(4, 0x2b2226, 0.55).lineBetween(FUSE.x0, FUSE.y, burn, FUSE.y);
    if (p < 1) {
      hud
        .lineStyle(10, 0x4a2f1a)
        .lineBetween(burn, FUSE.y, FUSE.x1 + 14, FUSE.y);
      hud
        .lineStyle(6, 0xe0b878)
        .lineBetween(burn, FUSE.y, FUSE.x1 + 14, FUSE.y);
      hud.lineStyle(2, 0x8a5a30);
      for (let x = FUSE.x1; x > burn + 3; x -= 12)
        hud.lineBetween(x - 3, FUSE.y + 3, x + 3, FUSE.y - 3);
    }
    const flicker =
      0.8 + 0.1 * Math.sin(time / 45) + 0.05 * Math.sin(time / 17);
    this.flame
      .setVisible(p < 1)
      .setPosition(burn, FUSE.y - 10)
      .setScale(flicker);
    const sudden = view.phase === "sudden-death";
    this.bomb
      .setScale(sudden ? 1 + 0.12 * Math.sin(time / 80) : 1)
      .setTint(sudden ? 0xff8080 : 0xffffff);
    this.suddenDeath
      .setVisible(sudden)
      .setAlpha(0.65 + 0.35 * Math.sin(time / 120));
  }

  private drawBanner(view: RoundView): void {
    const result = view.result;
    if (!result) return void this.banner.setVisible(false);
    this.hud.fillStyle(INK, 0.45).fillRect(0, this.banner.y - 64, W, 128);
    if (this.banner.visible) return; // Text re-rasterises on every setText/setColor.
    const winner = result.winner === null ? null : this.look(result.winner);
    this.banner
      .setVisible(true)
      .setText(winner ? `${winner.name} WINS!` : "DRAW!")
      .setColor(winner ? css(winner.color) : "#ffffff");
  }
}
