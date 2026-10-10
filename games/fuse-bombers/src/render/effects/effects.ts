import Phaser from "phaser";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  castleCenter,
  launcherPivot,
  type RoundView,
  type TickEvent,
} from "../../engine/index.js";
import * as art from "../art.js";
import { css, gateColor, playerColor, THEMES } from "../palette.js";
import { DEPTH, ROUND_EVENTS, ROUND_START } from "../round-scene.js";
import { addHit, driftY, TALLY_RISE, type TallyState } from "./tally.js";
import { addFxTextures } from "./textures.js";

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;
type Particle = Phaser.GameObjects.Particles.Particle;
/** A debris particle that has come to rest on the ground. */
type Chunk = Particle & { landed?: boolean };
type Visual = Phaser.GameObjects.Image | Phaser.GameObjects.Text;

/** Particle budgets: the most alive at once per emitter, whatever the rocket count. */
const BUDGET = { smoke: 2000, fire: 700, debris: 500 } as const;
/** Mean smoke puff life (ms); with the budget it sets how many puffs a frame may add. */
const SMOKE_LIFE = 1300;
/** Most crater bursts drawn per frame; the rest are dropped (nearby craters already merge into one burst). */
const MAX_BURSTS = 16;
/** Largest shake offset in px, reached at full trauma. */
const SHAKE_PX = 12;
/** Smoke grid cell size (px) and columns: one trail puff per cell and frame. */
const CELL = 20;
const COLS = Math.ceil(ARENA_WIDTH / CELL);
const INK = 0x1b1d26;
const DIRT = [0x8a5a37, 0x6b4428, 0xb07a4c, 0x5d3b24];
const STONE = [0xdfe2e8, 0xaeb4c2, 0xc8ccd6, 0x3a2a22];
const WOOD = [0xb5773a, 0x8a5424, 0xd9a05b];
const SHIELD = [0x9ff3ff, 0xffffff, 0x5fd8ff];

/** A pooled image or text animated by hand: scale eases from s0 to s1, then it fades, drifts or flies. */
interface Fx {
  obj: Visual;
  age: number;
  life: number;
  s0: number;
  s1: number;
  /** ms the scale takes to go from s0 to s1. */
  grow: number;
  a0: number;
  /** Fraction of the life before the fade starts. */
  hold: number;
  vy: number;
  /** Where the drift starts: the object sits at `y0 + vy * age`, so resetting `age` puts it back. */
  y0: number;
  fly?: { x0: number; y0: number; x1: number; y1: number };
}

interface Burst {
  x: number;
  y: number;
  size: number;
  count: number;
  bomb: boolean;
}

interface Hits {
  x: number;
  y: number;
  n: number;
  hull: number;
  shield: number;
}

/** A castle's running damage number: hits within a short while add up on one label, like the ad's "-44". */
interface Tally extends TallyState {
  fx: Fx;
}

const rand = (min: number, max: number): number =>
  min + Math.random() * (max - min);
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)] ?? (items[0] as T);

/** Scale op that grows each particle from its emitted size to `(1 + growth)` times it. */
const growing = (size: () => number, growth: number) => ({
  onEmit: (p?: Particle) => {
    const s = size();
    if (p) (p as Particle & { base: number }).base = s;
    return s;
  },
  onUpdate: (p: Particle, _key: string, t: number) =>
    (p as Particle & { base: number }).base * (1 + growth * t),
});

/**
 * Juice on top of the round: smoke trails behind rockets, crater and castle-hit explosions with dirt and brick
 * debris, floating damage numbers, shield ripples, gate flashes with "×N" pops, crate bursts with the card flying
 * home, a mega explosion for a destroyed castle, and screen shake (off with `?calm` or reduced motion). It only
 * listens to the scene's `ROUND_START` / `ROUND_EVENTS` and cleans up on shutdown.
 */
export class Effects {
  private readonly smoke: Emitter;
  private readonly fire: Emitter;
  private readonly debris: Emitter;
  private readonly active: Fx[] = [];
  private readonly freeImages: Phaser.GameObjects.Image[] = [];
  private readonly freeTexts: Phaser.GameObjects.Text[] = [];
  private readonly tallies = new Map<number, Tally>();
  private readonly gateTimes = new Map<number, number>();
  private readonly shieldTimes = new Map<number, number>();
  private readonly calm: boolean;
  private trauma = 0;
  private cursor = 0;
  private stamp = 0;
  private readonly cells = new Int32Array(
    COLS * Math.ceil(ARENA_HEIGHT / CELL),
  );
  private now = 0;
  // Read by the emitters' callbacks, set just before each emit.
  private puffSize = 0.4;
  private fireSize = 1;
  private fireSpeed = 100;
  private debrisSpeed = 300;
  private debrisTints: readonly number[] = DIRT;
  private dirt: readonly number[] = DIRT;

  constructor(
    private readonly scene: Phaser.Scene,
    options: { calm?: boolean } = {},
  ) {
    const query = new URLSearchParams(window.location.search);
    this.calm =
      options.calm ??
      (query.has("calm") ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    addFxTextures(scene);
    const add = scene.add;
    this.smoke = add
      .particles(0, 0, "fx-puff", {
        emitting: false,
        lifespan: { min: SMOKE_LIFE * 0.7, max: SMOKE_LIFE * 1.3 },
        speed: { min: 0, max: 16 },
        gravityY: -14,
        alpha: { start: 0.5, end: 0 },
        scale: growing(() => this.puffSize * rand(0.8, 1.2), 1.8),
        tint: [0x3e3e48, 0x4d4d57, 0x5d5d67, 0x6d6d77],
        maxAliveParticles: BUDGET.smoke,
      })
      .setDepth(DEPTH.rockets - 1);
    this.fire = add
      .particles(0, 0, "fx-puff", {
        emitting: false,
        lifespan: { min: 380, max: 700 },
        speed: { onEmit: () => this.fireSpeed * rand(0.2, 1) },
        scale: growing(() => this.fireSize * rand(0.6, 1.2), 0.7),
        alpha: { start: 1, end: 0, ease: "Quad.easeIn" },
        color: [0xffffff, 0xfff0a0, 0xffb52e, 0xff5a1f, 0x3a2a2a],
        colorEase: "Quad.easeOut",
        maxAliveParticles: BUDGET.fire,
      })
      .setDepth(DEPTH.rockets + 1);
    this.debris = add
      .particles(0, 0, "fx-chunk", {
        emitting: false,
        lifespan: { min: 700, max: 1300 },
        angle: { min: -165, max: -15 },
        speed: { onEmit: () => this.debrisSpeed * rand(0.35, 1) },
        gravityY: 1200,
        rotate: {
          onEmit: (p?: Particle) => {
            if (p) (p as Chunk).landed = false;
            return rand(0, 360);
          },
          onUpdate: (p: Particle, _k: string, _t: number, v: number) =>
            (p as Chunk).landed ? v : v + 9,
        },
        scale: { onEmit: () => rand(0.5, 1.2) },
        alpha: { start: 1, end: 0, ease: "Cubic.easeIn" },
        tint: { onEmit: () => pick(this.debrisTints) },
        maxAliveParticles: BUDGET.debris,
      })
      .setDepth(DEPTH.rockets + 2);

    const events = scene.events;
    events.on(ROUND_START, this.reset, this);
    events.on(ROUND_EVENTS, this.frame, this);
    events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      events.off(ROUND_START, this.reset, this);
      events.off(ROUND_EVENTS, this.frame, this);
      this.reset();
    });
  }

  /** Live particles per emitter, for budget checks in the browser. */
  get counts(): Record<keyof typeof BUDGET, number> {
    return {
      smoke: this.smoke.getAliveParticleCount(),
      fire: this.fire.getAliveParticleCount(),
      debris: this.debris.getAliveParticleCount(),
    };
  }

  /** Drops everything left over from the previous round; clods take the new round's ground colours. */
  private reset(view?: RoundView): void {
    const theme =
      view && THEMES[Math.abs(Math.trunc(view.config.seed)) % THEMES.length];
    if (theme)
      this.dirt = [...theme.ground, theme.top].map(
        (c) => Phaser.Display.Color.HexStringToColor(c).color,
      );
    for (const e of [this.smoke, this.fire, this.debris]) e.killAll();
    while (this.active.length) this.release(this.active.pop()!);
    this.tallies.clear();
    this.gateTimes.clear();
    this.shieldTimes.clear();
    this.trauma = 0;
    this.scene.cameras.main?.setScroll(0, 0).setZoom(1);
  }

  private frame(events: readonly TickEvent[], view: RoundView): void {
    const dt = Math.min(this.scene.game.loop.delta, 100);
    this.now += dt;
    this.trails(view, dt);
    const craters = new Map<string, Burst>();
    const hits = new Map<number, Hits>();
    for (const e of events) {
      switch (e.type) {
        case "crater":
        case "rocket-exploded": {
          const key = `${Math.round(e.x / 40)},${Math.round(e.y / 40)}`;
          const b = craters.get(key);
          const size = e.type === "crater" ? e.radius : 8;
          if (b) {
            b.count++;
            b.size = Math.max(b.size, size);
          } else
            craters.set(key, {
              x: e.x,
              y: e.y,
              size,
              count: 1,
              bomb: e.owner < 0,
            });
          break;
        }
        case "hit": {
          const h = hits.get(e.castleId) ?? {
            x: 0,
            y: 0,
            n: 0,
            hull: 0,
            shield: 0,
          };
          h.x += e.x;
          h.y += e.y;
          h.n++;
          if (e.shielded) h.shield += e.damage;
          else h.hull += e.damage;
          hits.set(e.castleId, h);
          break;
        }
        case "fired":
          this.muzzle(view, e.castleId, e.angle, e.mega);
          break;
        case "gate-split":
          this.gateSplit(view, e.gateId, e.multiplier, e.x, e.y);
          break;
        case "shield-popped":
          this.shieldPop(view, e.castleId);
          break;
        case "crate-taken":
          this.crateTaken(view, e.castleId, e.card, e.x, e.y);
          break;
        case "crate-spawned":
          this.ring(e.x, e.y, 0xffffff, 0.3, 1.1, 260, 0.8);
          break;
        case "castle-destroyed":
          this.castleDestroyed(e.castleId, e.x, e.y);
          break;
        case "ghost-spawned":
          this.ghostSpawned(e.owner, e.x, e.y);
          break;
        case "ghost-bomb-dropped":
          this.puffSize = 0.5;
          this.smoke.emitParticleAt(e.x, e.y + 30, 3);
          this.ring(e.x, e.y + 30, playerColor(e.owner), 0.2, 0.9, 260, 0.9);
          break;
        case "ghost-bomb-hit":
          this.ring(e.x, e.y, playerColor(e.owner), 0.4, 2.2, 380, 0.9);
          break;
        case "sudden-death-started":
          this.flash(0xff4a3a, 0.3);
          this.shake(0.5);
          break;
        default:
          break;
      }
    }
    let bursts = 0;
    for (const b of craters.values()) if (bursts++ < MAX_BURSTS) this.crater(b);
    for (const [id, h] of hits) this.hit(view, id, h);
    this.land(view);
    this.animate(dt);
    this.applyShake();
  }

  /** Bricks and clods come to rest on the ground instead of sinking into it. */
  private land(view: RoundView): void {
    const surface = view.terrain.surface;
    this.debris.forEachAlive((p: Chunk) => {
      const ground = surface[Math.round(p.x)];
      if (ground === undefined || p.velocityY < 0 || p.y < ground - 3) return;
      p.y = ground - 3;
      p.velocityX = p.velocityY = 0;
      p.landed = true;
    }, this);
  }

  /**
   * Smoke puffs behind the rockets. A frame may add only as many puffs as the budget refills, handed out
   * round-robin: a lone volley gets a dense trail, a thousand rockets get sparser puffs that still read as one
   * thick ribbon because the rockets fly in streams.
   */
  private trails(view: RoundView, dt: number): void {
    const rockets = view.rockets;
    const n = rockets.length;
    if (n === 0) return;
    let budget = Math.max(1, Math.round((BUDGET.smoke / SMOKE_LIFE) * dt));
    const each = Math.min(3, Math.max(1, Math.floor(budget / n)));
    // Sparse puffs are drawn larger so the ribbon stays solid.
    const thin = Math.min(1.6, Math.max(1, n / budget) ** 0.25);
    const stamp = ++this.stamp;
    let k = 0;
    for (; k < n && budget > 0; k++) {
      const r = rockets[(this.cursor + k) % n];
      if (!r) continue;
      const speed = Math.hypot(r.vx, r.vy) || 1;
      const big = r.mega || r.power > 1 ? 1.5 : 1;
      const round = r.bomb || r.ghost;
      const tail = round ? 10 : 26 * big;
      const [x, y] = [r.x - (r.vx / speed) * tail, r.y - (r.vy / speed) * tail];
      // At most one puff per grid cell and frame: a dense stream gets an even ribbon, not random clumps.
      const cell = Math.floor(x / CELL) + Math.floor(y / CELL) * COLS;
      if (cell >= 0 && cell < this.cells.length) {
        if (this.cells[cell] === stamp) continue;
        this.cells[cell] = stamp;
      }
      this.puffSize = (round ? 0.35 : 0.42) * big * thin;
      for (let j = 0; j < each; j++) {
        const back = (speed * dt * j) / each / 1000;
        this.smoke.emitParticleAt(
          x - (r.vx / speed) * back,
          y - (r.vy / speed) * back,
        );
      }
      budget -= each;
    }
    this.cursor = (this.cursor + k) % n;
  }

  private muzzle(view: RoundView, id: number, angle: number, mega: boolean) {
    const c = view.castles[id];
    if (!c) return;
    const p = launcherPivot(c, view.tuning);
    const [x, y] = [p.x + Math.cos(angle) * 34, p.y - Math.sin(angle) * 34];
    this.puffSize = mega ? 0.9 : 0.6;
    this.smoke.emitParticleAt(x, y, mega ? 8 : 4);
    this.boom(x, y, mega ? 0.8 : 0.5, 60, mega ? 8 : 4);
  }

  /** Fireball puffs flying out from (x, y). */
  private boom(x: number, y: number, size: number, speed: number, n: number) {
    this.fireSize = size;
    this.fireSpeed = speed;
    this.fire.emitParticleAt(x, y, n);
  }

  private chunks(
    x: number,
    y: number,
    tints: readonly number[],
    speed: number,
    n: number,
  ): void {
    this.debrisTints = tints;
    this.debrisSpeed = speed;
    this.debris.emitParticleAt(x, y, n);
  }

  private crater(b: Burst): void {
    const k = Math.min(2.2, (b.size / 11) * (1 + 0.12 * (b.count - 1)));
    this.boom(b.x, b.y - 4, 0.9 * k, 120 * k, Math.min(8, 3 + b.count));
    this.chunks(b.x, b.y, this.dirt, 260 + 60 * k, Math.min(6, 2 + b.count));
    this.puffSize = 0.8 * k;
    this.smoke.emitParticleAt(b.x, b.y - 6, 2);
    this.shake(Math.min(0.12, 0.02 * b.count * k) + (b.bomb ? 0.1 : 0));
  }

  /** All of one castle's hits this frame as one blast, plus its running damage number. */
  private hit(view: RoundView, id: number, h: Hits): void {
    const c = view.castles[id];
    const [x, y] = [h.x / h.n, h.y / h.n];
    const k = Math.min(1.8, 1 + 0.1 * h.n);
    if (h.hull > 0) {
      this.boom(x, y, 1.2 * k, 170 * k, Math.min(10, 4 + h.n));
      const roof = playerColor(id);
      this.chunks(x, y, [...STONE, roof, roof], 380, Math.min(10, 4 + h.n));
    }
    if (h.shield > 0 && c) {
      const last = this.shieldTimes.get(id) ?? -1e9;
      if (this.now - last > 120) {
        this.shieldTimes.set(id, this.now);
        const o = castleCenter(c, view.tuning);
        const s = (2 * view.tuning.shieldRadius) / 64;
        this.ring(o.x, o.y, 0x9ff3ff, s * 0.92, s * 1.12, 260, 0.9);
      }
      this.chunks(x, y, SHIELD, 200, Math.min(8, 2 + h.n));
    }
    this.shake(Math.min(0.35, (h.hull + h.shield * 0.5) / 80));
    if (c) this.tally(id, c.x, c.y, h.hull + h.shield, h.hull === 0);
  }

  private tally(
    id: number,
    x: number,
    y: number,
    damage: number,
    shield: boolean,
  ) {
    const prev = this.tallies.get(id);
    const hit = addHit(prev, this.now, damage);
    let t = prev;
    if (!t || hit.fresh) {
      const top = y - art.CASTLE_SIZE.height - 40;
      const left = Phaser.Math.Clamp(x + rand(-18, 18), 110, ARENA_WIDTH - 110);
      const fx = this.show(this.text(), left, top, {
        life: 1100,
        grow: 140,
        hold: 0.55,
        vy: -TALLY_RISE,
      });
      (fx.obj as Phaser.GameObjects.Text).setColor("#9ff3ff");
      this.tallies.set(id, (t = Object.assign(hit.tally, { fx })));
    }
    const text = t.fx.obj as Phaser.GameObjects.Text;
    // Hull damage turns a shield-only tally red.
    if (!shield) text.setColor("#ff5a4a");
    if (hit.changed) text.setText(`-${hit.shown}`);
    // A hit pops the number again and keeps it on screen. Resetting the age also puts it back on its anchor above
    // the castle (see `driftY`), so it only rises away once the hits stop.
    Object.assign(t.fx, { age: 0, s0: hit.s0, s1: hit.s1 });
  }

  private gateSplit(
    view: RoundView,
    id: number,
    mult: number,
    x: number,
    y: number,
  ) {
    const last = this.gateTimes.get(id) ?? -1e9;
    const gate = view.gates.find((g) => g.id === id);
    const color = gateColor(mult);
    this.boom(x, y, 0.5, 60, 1);
    if (!gate || this.now - last < 140) return;
    this.gateTimes.set(id, this.now);
    const panel = this.show(this.image("fx-px"), gate.x, gate.y, {
      life: 220,
      a0: 0.75,
      hold: 0,
    });
    (panel.obj as Phaser.GameObjects.Image)
      .setDisplaySize(gate.width + 14, gate.height + 16)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD);
    if (this.now - last < 420) return;
    // The gate's "×N" label pulses outwards.
    const top = gate.y - gate.height / 2 - 26;
    const pop = this.show(this.text(), gate.x, top, {
      life: 450,
      s0: 0.9,
      s1: 2,
      grow: 450,
      hold: 0,
      vy: -40,
    });
    (pop.obj as Phaser.GameObjects.Text)
      .setText(`×${mult}`)
      .setColor(css(color));
  }

  private shieldPop(view: RoundView, id: number): void {
    const c = view.castles[id];
    if (!c) return;
    const o = castleCenter(c, view.tuning);
    const s = (2 * view.tuning.shieldRadius) / 64;
    this.ring(o.x, o.y, 0x9ff3ff, s, s * 2.2, 380, 1);
    this.chunks(o.x, o.y - 20, SHIELD, 420, 20);
    this.shake(0.3);
  }

  private crateTaken(
    view: RoundView,
    id: number,
    card: string,
    x: number,
    y: number,
  ) {
    this.chunks(x, y, WOOD, 320, 14);
    this.boom(x, y, 0.8, 90, 6);
    const c = view.castles[id];
    if (!c) return;
    const key = this.scene.textures.exists(`card-${card}`)
      ? `card-${card}`
      : "crate";
    const home = launcherPivot(c, view.tuning);
    const fx = this.show(this.image(key), x, y, { life: 750, hold: 0.85 });
    fx.fly = { x0: x, y0: y, x1: home.x, y1: home.y - 30 };
    fx.obj.setScale(36 / fx.obj.width);
  }

  private castleDestroyed(id: number, x: number, y: number): void {
    const cy = y - art.CASTLE_SIZE.height / 2;
    this.boom(x, cy, 2.4, 380, 45);
    const roof = playerColor(id);
    this.chunks(x, cy, [...STONE, roof, roof, INK], 650, 40);
    this.puffSize = 2;
    this.smoke.emitParticleAt(x, cy, 14);
    this.ring(x, cy, 0xfff0a0, 0.5, 7, 450, 1);
    this.flash(0xffffff, 0.3);
    this.shake(1);
  }

  /** The ghost blimp puffs into view in its owner's colour above the wreck. */
  private ghostSpawned(owner: number, x: number, y: number): void {
    this.puffSize = 1.2;
    this.smoke.emitParticleAt(x, y, 8);
    this.ring(x, y, playerColor(owner), 0.4, 3, 520, 1);
    this.ring(x, y, 0xffffff, 0.3, 1.8, 380, 0.7);
  }

  private ring(
    x: number,
    y: number,
    tint: number,
    s0: number,
    s1: number,
    life: number,
    a0: number,
  ): void {
    const fx = this.show(this.image("fx-ring"), x, y, {
      life,
      s0,
      s1,
      grow: life,
      a0,
      hold: 0,
    });
    (fx.obj as Phaser.GameObjects.Image).setTint(tint);
  }

  private flash(tint: number, alpha: number): void {
    // Full-screen flashes count as motion: `?calm` and reduced motion skip them.
    if (this.calm) return;
    const fx = this.show(
      this.image("fx-px"),
      ARENA_WIDTH / 2,
      ARENA_HEIGHT / 2,
      {
        life: 320,
        a0: alpha,
        hold: 0,
      },
    );
    const img = fx.obj as Phaser.GameObjects.Image;
    img.setDisplaySize(ARENA_WIDTH + 80, ARENA_HEIGHT + 80).setTint(tint);
    img.setDepth(DEPTH.banner - 1);
  }

  private image(key: string): Phaser.GameObjects.Image {
    const img = this.freeImages.pop() ?? this.scene.add.image(0, 0, key);
    return img
      .setTexture(key)
      .setTint(0xffffff)
      .setBlendMode(Phaser.BlendModes.NORMAL)
      .setDepth(DEPTH.rockets + 3);
  }

  private text(): Phaser.GameObjects.Text {
    return (
      this.freeTexts.pop() ??
      this.scene.add
        .text(0, 0, "", {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: "22px",
          stroke: css(INK),
          strokeThickness: 6,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.hud + 5)
    );
  }

  private show(obj: Visual, x: number, y: number, o: Partial<Fx>): Fx {
    const fx: Fx = {
      obj,
      age: 0,
      life: 500,
      s0: 1,
      s1: 1,
      grow: 1,
      a0: 1,
      hold: 0.5,
      vy: 0,
      y0: y,
      ...o,
    };
    obj.setPosition(x, y).setVisible(true).setAlpha(fx.a0).setScale(fx.s0);
    this.active.push(fx);
    return fx;
  }

  private release(fx: Fx): void {
    fx.obj.setVisible(false);
    if (fx.obj instanceof Phaser.GameObjects.Text) this.freeTexts.push(fx.obj);
    else this.freeImages.push(fx.obj);
  }

  private animate(dt: number): void {
    const list = this.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const fx = list[i]!;
      fx.age += dt;
      if (fx.age >= fx.life) {
        list[i] = list[list.length - 1]!;
        list.pop();
        this.release(fx);
        continue;
      }
      const t = fx.age / fx.life;
      const g = Math.min(1, fx.age / fx.grow);
      const fade = t < fx.hold ? 1 : 1 - (t - fx.hold) / (1 - fx.hold);
      const obj = fx.obj;
      obj.setAlpha(fx.a0 * fade);
      if (fx.s0 !== fx.s1)
        obj.setScale(fx.s0 + (fx.s1 - fx.s0) * (1 - (1 - g) ** 2));
      if (fx.fly) {
        const { x0, y0, x1, y1 } = fx.fly;
        const e = Math.min(1, t / fx.hold) ** 2;
        obj.setPosition(
          x0 + (x1 - x0) * e,
          y0 + (y1 - y0) * e - Math.sin(Math.PI * e) * 140,
        );
      } else if (fx.vy) obj.y = driftY(fx.y0, fx.vy, fx.age);
    }
  }

  private shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Trauma-style shake: offsets grow with trauma², with a matching zoom so the edges never show. */
  private applyShake(): void {
    const cam = this.scene.cameras.main;
    this.trauma = Math.max(0, this.trauma - this.scene.game.loop.delta / 700);
    if (this.calm || !cam) return;
    const k = this.trauma * this.trauma;
    const t = this.now / 1000;
    cam.setZoom(1 + k * 0.03);
    cam.setScroll(
      SHAKE_PX * k * (Math.sin(t * 67) * 0.7 + Math.sin(t * 131) * 0.3),
      SHAKE_PX * k * (Math.sin(t * 59 + 1) * 0.7 + Math.sin(t * 113) * 0.3),
    );
  }
}
