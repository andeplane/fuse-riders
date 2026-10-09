import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  castleCenter,
  fuseProgress,
  isGhostLoaded,
  isLoaded,
  launcherPivot,
  predictGhostBomb,
  predictTrajectory,
  type CastleView,
  type GhostView,
  type RoundView,
  type TickEvent,
} from "../engine/index.js";
import * as aim from "./aim.js";
import * as art from "./art.js";
import { Effects } from "./effects/effects.js";
import {
  css,
  gateColor,
  PLAYER_COLORS,
  playerColor,
  THEMES,
} from "./palette.js";
import { TerrainLayer } from "./terrain-layer.js";

/** How one player looks on screen. */
export interface PlayerLook {
  readonly name: string;
  /** Roof, launcher band, health bar, rockets and shield tint. */
  readonly color: number;
  /** A short label above the castle, e.g. the player's button (`Q`, `PAD 1`) or `BOT`. */
  readonly tag?: string;
  /**
   * Set for humans only: a badge such as `PRESS Q` shown over the castle at the start of each round. Humans also
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
  shields: 35,
  rockets: 40,
  hud: 50,
  fuse: 60,
  banner: 70,
} as const;

const [W, H] = [ARENA_WIDTH, ARENA_HEIGHT];
const INK = 0x1b1d26;
/** Ticks at the start of a round during which the `prompt` badges show (the countdown counts as tick 0). */
const PROMPT_TICKS = 240;
const FUSE = { y: 28, x0: 70, x1: 1510 } as const;

type Pool<O> = Map<number, O>;

/** One ghost on screen: the blimp, the bomb hanging under it while loaded, and a human's key badge. */
interface GhostSprite {
  readonly blimp: Phaser.GameObjects.Image;
  readonly bomb: Phaser.GameObjects.Image;
  readonly badge: Phaser.GameObjects.Text | undefined;
  destroy(): void;
}

/** Where the loaded bomb hangs, below the ghost's centre (under the gondola). */
const HANG_Y = 40;

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
 * Draws one round from its `RoundView`: backdrop, eroding terrain, castles with launchers, health, reload and
 * shields, pooled rockets, ghost blimps, gates, crates, the fuse and a winner banner. It owns no rules or timers.
 * Start it again with new `RoundSceneData` to draw another match.
 */
export class RoundScene extends Phaser.Scene {
  static readonly KEY = "round";

  private source!: RoundSource;
  private players: readonly PlayerLook[] = [];
  private current: RoundView | null = null;
  private backdrop!: Phaser.GameObjects.Image;
  private terrain!: TerrainLayer;
  private hud!: Phaser.GameObjects.Graphics;
  private gateGfx!: Phaser.GameObjects.Graphics;
  private flame!: Phaser.GameObjects.Image;
  private bomb!: Phaser.GameObjects.Image;
  private suddenDeath!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private castles: Phaser.GameObjects.Image[][] = [];
  private tags: Phaser.GameObjects.Text[] = [];
  private prompts: (Phaser.GameObjects.Text | undefined)[] = [];
  private rockets: Phaser.GameObjects.Image[] = [];
  private rocketKeys: string[] = [];
  private shownRockets = 0;
  private gateLabels: Pool<Phaser.GameObjects.Text> = new Map();
  private crates: Pool<Phaser.GameObjects.Container> = new Map();
  private ghosts: Pool<GhostSprite> = new Map();
  /** Explosions, trails, damage numbers and shake; exposed for browser checks. */
  effects!: Effects;

  constructor() {
    super(RoundScene.KEY);
  }

  init(data: RoundSceneData): void {
    this.source = data.source;
    this.players = data.players ?? [];
    this.current = null;
    this.castles = [];
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
    // Shared with Fuse Riders from the site root's public/: its prop pack's crate and its neon fuse sprites.
    this.load.image(
      "crate",
      `${base}props/desert-industrial-v1/crate-small-wood.png`,
    );
    for (const [key, size] of [
      ["flame", 48],
      ["bomb", 64],
    ] as const)
      this.load.svg(key, `${base}themes/clean-neon/${key}.svg`, {
        width: size,
        height: size,
      });
  }

  create(): void {
    art.paintBackdrops(this, W, H);
    this.backdrop = this.add.image(0, 0, "backdrop-0").setOrigin(0, 0);
    this.gateGfx = this.add.graphics().setDepth(DEPTH.gates);
    this.terrain = new TerrainLayer(this, W, H, DEPTH.terrain);
    this.hud = this.add.graphics().setDepth(DEPTH.hud);
    this.flame = this.add.image(0, 0, "flame").setDepth(DEPTH.fuse);
    this.bomb = this.add
      .image(FUSE.x1 + 34, FUSE.y + 4, "bomb")
      .setDepth(DEPTH.fuse);
    this.suddenDeath = this.text(W / 2, 72, "SUDDEN DEATH!", 26, DEPTH.fuse);
    this.suddenDeath.setColor("#ff4a3a");
    this.banner = this.text(W / 2, H * 0.32, "", 56, DEPTH.banner);
    this.banner.setVisible(false);
    this.effects = new Effects(this);
  }

  update(time: number): void {
    // Raw frame time: Phaser's smoothed delta is clamped to 1/60 s while the window is unfocused.
    const events = this.source.advance(this.game.loop.rawDelta);
    const view = this.source.view;
    const started = view !== this.current;
    if (started) this.startRound(view);
    this.terrain.update(view.terrain);
    this.hud.clear();
    this.drawGates(view);
    sync(
      this.crates,
      view.crates,
      (c) => this.createCrate(c.card),
      (crate, c) => {
        crate
          .setPosition(c.x, c.y)
          .setScale(Math.min(1, (view.tick - c.spawnTick) / 15));
      },
    );
    for (const c of view.castles) this.drawCastle(view, c, time);
    sync(
      this.ghosts,
      view.ghosts.map((g) => ({ id: g.owner, g })),
      ({ g }) => this.createGhost(g.owner),
      (sprite, { g }) => this.drawGhost(view, g, sprite, time),
    );
    this.drawRockets(view);
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
    return this.add.text(x, y, value, style).setOrigin(0.5).setDepth(depth);
  }

  /** A wooden crate with its card's badge pinned on it. */
  private createCrate(card: string): Phaser.GameObjects.Container {
    const box = this.add.image(0, 0, "crate").setDisplaySize(46, 46);
    const icon = this.add.image(0, 0, `card-${card}`).setScale(0.85);
    return this.add.container(0, 0, [box, icon]).setDepth(DEPTH.crates);
  }

  private startRound(view: RoundView): void {
    this.current = view;
    const theme = Math.abs(Math.trunc(view.config.seed)) % THEMES.length;
    this.backdrop.setTexture(`backdrop-${theme}`);
    this.terrain.reset(view.terrain, THEMES[theme] ?? THEMES[0]!);
    for (const object of [...this.castles.flat(), ...this.tags])
      object.destroy();
    for (const object of this.prompts) object?.destroy();
    for (const pool of [this.gateLabels, this.crates, this.ghosts]) {
      for (const object of pool.values()) object.destroy();
      pool.clear();
    }
    this.tags = view.castles.map((c) =>
      this.text(0, 0, this.look(c.id).tag ?? "", 14, DEPTH.hud).setColor(
        css(this.look(c.id).color),
      ),
    );
    this.prompts = view.castles.map((c) => {
      const prompt = this.look(c.id).prompt;
      return prompt === undefined
        ? undefined
        : this.text(0, 0, prompt, 18, DEPTH.hud + 1);
    });
    this.castles = view.castles.map((c) => {
      const color = this.look(c.id).color;
      const tint = Phaser.Display.Color.ValueToColor(color).lighten(25);
      return [
        this.add
          .image(0, 0, art.spriteKey("castle", color))
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.castles),
        this.add
          .image(0, 0, art.spriteKey("launcher", color))
          .setOrigin(art.LAUNCHER.pivot / art.LAUNCHER.width, 0.5)
          .setDepth(DEPTH.castles - 1),
        this.add
          .image(0, 0, "shield")
          .setTint(tint.color)
          .setDepth(DEPTH.shields),
      ];
    });
  }

  private drawCastle(view: RoundView, c: CastleView, time: number): void {
    const t = view.tuning;
    const hud = this.hud;
    const [body, launcher, shield] = this.castles[c.id] ?? [];
    if (!body || !launcher || !shield) return;
    body.setPosition(c.x, c.y + 1);
    launcher.setVisible(c.alive);
    this.tags[c.id]
      ?.setVisible(c.alive)
      .setPosition(c.x, c.y - art.CASTLE_SIZE.height - 34);
    shield.setVisible(c.alive && c.shieldHp > 0);
    this.drawPrompt(view, c, time);
    if (!c.alive) {
      body.setTint(0x4a4a55).setAngle(c.id % 2 === 0 ? -8 : 8);
      return;
    }
    const pivot = launcherPivot(c, t);
    launcher.setPosition(pivot.x, pivot.y).setRotation(-c.angle);
    const centre = castleCenter(c, t);
    shield
      .setPosition(centre.x, centre.y)
      .setScale((2 * t.shieldRadius) / art.SHIELD_SIZE)
      .setAlpha(0.45 + (0.55 * c.shieldHp) / t.shieldMax);

    // Health bar above the roofs; the shield shows as a cyan strip inside it.
    const [w, x0, y0] = [64, c.x - 32, c.y - art.CASTLE_SIZE.height - 16];
    hud.fillStyle(INK, 0.85).fillRoundedRect(x0 - 3, y0 - 3, w + 6, 14, 5);
    hud
      .fillStyle(this.look(c.id).color)
      .fillRect(x0, y0, (w * Math.max(0, c.hp)) / c.maxHp, 8);
    hud
      .fillStyle(0x9ff3ff)
      .fillRect(x0, y0 + 5, (w * c.shieldHp) / t.shieldMax, 3);

    const { color, prompt } = this.look(c.id);
    if (isLoaded(c) && !view.result) {
      const human = prompt !== undefined;
      const style = human ? aim.HUMAN_GUIDE : aim.BOT_GUIDE;
      // Humans predict the whole flight to find the gates and crates on it; only a prefix is drawn.
      const path = predictTrajectory(view, c.id, undefined, {
        maxTicks: human ? undefined : style.ticks,
      });
      if (human) aim.drawTargets(hud, view, path, color, time);
      aim.drawGuide(hud, path.points, color, style);
      aim.drawReady(hud, pivot, color, time, human);
    } else if (c.reloadTicks > 0 && c.reloadTotalTicks > 0) {
      const done = 1 - c.reloadTicks / c.reloadTotalTicks;
      const start = -Math.PI / 2;
      hud.lineStyle(7, INK, 0.6).strokeCircle(pivot.x, pivot.y, 17);
      hud.lineStyle(4, 0xffffff, 0.95).beginPath();
      hud
        .arc(pivot.x, pivot.y, 17, start, start + done * Math.PI * 2)
        .strokePath();
    }
    if (c.megaReady)
      hud.lineStyle(3, 0xd35cff).strokeCircle(pivot.x, pivot.y, 28);
  }

  /** The `PRESS Q` badge bobbing over a human's castle for the first seconds of a round. */
  private drawPrompt(view: RoundView, c: CastleView, time: number): void {
    const label = this.prompts[c.id];
    if (!label) return;
    const show = c.alive && !view.result && view.tick < PROMPT_TICKS;
    if (!label.setVisible(show).visible) return;
    const x = c.x;
    const y = c.y - art.CASTLE_SIZE.height - 84 + 5 * Math.sin(time / 160);
    label.setPosition(x, y);
    const [w, h] = [label.width + 22, label.height + 16];
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
    const { color, tag, prompt } = this.look(owner);
    const blimp = this.add
      .image(0, 0, art.spriteKey("blimp", color))
      .setOrigin(0.5, art.BLIMP.centerY / art.BLIMP.height)
      .setScale(1.2)
      .setDepth(DEPTH.castles + 1);
    const bomb = this.add
      .image(0, 0, art.spriteKey("ghost-bomb", color))
      .setRotation(Math.PI / 2)
      .setScale(1.4)
      .setDepth(DEPTH.castles);
    // Humans get their key painted on the envelope, so everyone knows whose blimp it is.
    const badge =
      prompt !== undefined && tag
        ? this.text(0, 0, tag, 16, DEPTH.hud + 1)
        : undefined;
    return {
      blimp,
      bomb,
      badge,
      destroy: () => {
        blimp.destroy();
        bomb.destroy();
        badge?.destroy();
      },
    };
  }

  /**
   * A drifting translucent blimp in the player's colour. Loaded, a bomb hangs under it (and a human gets a short
   * drop guide and a pulsing ring); reloading, a ring fills around the empty hook.
   */
  private drawGhost(
    view: RoundView,
    g: GhostView,
    sprite: GhostSprite,
    time: number,
  ): void {
    const { color, prompt } = this.look(g.owner);
    const human = prompt !== undefined;
    const bob = 3 * Math.sin(time / 380 + g.owner);
    const [x, y] = [g.x, g.y + bob];
    const left = g.vx < 0;
    sprite.blimp
      .setPosition(x, y)
      .setFlipX(left)
      .setAlpha(human ? 0.85 : 0.7);
    const hud = this.hud;
    if (sprite.badge) {
      const b = sprite.badge.setPosition(x + (left ? 8 : -8), y + 2);
      const [w, h] = [b.width + 12, b.height + 8];
      hud.fillStyle(INK).fillRoundedRect(b.x - w / 2, b.y - h / 2, w, h, 6);
      hud.lineStyle(2, 0xffffff, 0.9);
      hud.strokeRoundedRect(b.x - w / 2, b.y - h / 2, w, h, 6);
    }
    const loaded = isGhostLoaded(g) && !view.result;
    const hook = { x, y: y + HANG_Y };
    sprite.bomb.setVisible(loaded).setPosition(hook.x, hook.y);
    if (loaded && human) {
      const path = predictGhostBomb(view, g.owner, 0, 60);
      // The guide starts below the blimp, where the bomb comes out.
      const below = path?.points.filter((p) => p.y > g.y + HANG_Y + 14) ?? [];
      aim.drawGuide(hud, below, color, aim.GHOST_GUIDE);
      aim.drawReady(hud, hook, color, time, true);
    } else if (!loaded && g.reloadTotalTicks > 0 && !view.result) {
      const done = 1 - g.reloadTicks / g.reloadTotalTicks;
      const start = -Math.PI / 2;
      hud.lineStyle(6, INK, 0.6).strokeCircle(hook.x, hook.y, 11);
      hud.lineStyle(3, human ? 0xffffff : color, 0.95).beginPath();
      hud.arc(hook.x, hook.y, 11, start, start + done * Math.PI * 2);
      hud.strokePath();
    }
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

  /** Tall translucent panels with end caps and a "×N" label, fading in and out with the gate's life. */
  private drawGates(view: RoundView): void {
    const g = this.gateGfx.clear();
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
      const [x0, y0] = [gate.x - w / 2, gate.y - h / 2];
      g.fillStyle(color, 0.38 * alpha).fillRect(x0, y0, w, h);
      g.fillStyle(0xffffff, 0.35 * alpha).fillRect(x0 + 4, y0 + 6, 4, h - 12);
      g.lineStyle(3, color, alpha).strokeRect(x0, y0, w, h);
      g.fillStyle(color, alpha).fillRoundedRect(x0 - 7, y0 - 8, w + 14, 9, 4);
      g.fillRoundedRect(x0 - 7, y0 + h - 1, w + 14, 9, 4);
    }
    sync(
      this.gateLabels,
      view.gates,
      (gate) =>
        this.text(0, 0, `×${gate.multiplier}`, 20, DEPTH.gates).setColor(
          css(gateColor(gate.multiplier)),
        ),
      (label, gate) =>
        label
          .setPosition(gate.x, gate.y - gate.height / 2 - 26)
          .setAlpha(fade(gate)),
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
