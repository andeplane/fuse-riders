/**
 * The arena view: a canvas in the host that draws supplied views and plays their sounds. The picture is made at
 * 480 by 270, then put on the screen at the largest whole multiple that fits, with a glow added on top at screen
 * resolution so the pixels themselves stay sharp.
 *
 * Canvas 2D and not Phaser: the contract is "draw this pair of views at this alpha", which is immediate-mode
 * drawing; a retained scene graph would have to be reconciled with the view every frame, and the horizontal wrap
 * (everything near an edge shows on both sides) is one more draw call here but a second set of objects there.
 */
import type { RoundView } from "../engine/index.js";
import {
  bodyShape,
  diveEnds,
  FlapClock,
  landings,
  NO_FLIGHT,
  velocityFlaps,
  type FlightTrace,
} from "./animation.js";
import type { ArenaOptions, ArenaView, CreateArenaView } from "./api.js";
import {
  EventLedger,
  mergePlans,
  planEvent,
  planFlap,
  planLanding,
  type Plan,
} from "./effects.js";
import { Hud } from "./hud.js";
import {
  dangerOf,
  endingCamera,
  endingDelay,
  STILL,
  victoryFocus,
  type Camera,
} from "./hud-model.js";
import { continuous, interpolateView, viewTime } from "./interpolation.js";
import { fitView, VIEW_HEIGHT, VIEW_WIDTH, type Fit } from "./layout.js";
import { DIVE_STREAM, diveStream, EffectPool, Ghosts } from "./particles.js";
import { INK, Scene, type SceneFrame } from "./scene.js";
import { Shake, SHAKE_SECONDS } from "./shake.js";
import { Sound } from "./sound.js";
import { loadArt, makeCanvas, Sprites, type Ctx } from "./textures.js";

/** A running unit kicks up dust at most this often, in seconds. */
const RUN_DUST_SECONDS = 0.35;

/**
 * The page can switch the "X WINS" banner off when it shows its own result panel: either `banner: false` in the
 * options or `data-banner="off"` on the host element, read every frame. The sting and the effects still play.
 */
type Options = ArenaOptions & { readonly banner?: boolean };
export const BANNER_OFF = "off";

class Arena implements ArenaView {
  readonly ready: Promise<void>;
  private options: Options;
  private readonly wrapper: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: Ctx;
  private readonly world = makeCanvas(VIEW_WIDTH, VIEW_HEIGHT);
  private readonly low = makeCanvas(VIEW_WIDTH, VIEW_HEIGHT);
  private readonly glowSource = makeCanvas(VIEW_WIDTH, VIEW_HEIGHT);
  private readonly glowNear = makeCanvas(VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
  private readonly glowFar = makeCanvas(
    VIEW_WIDTH / 8,
    Math.ceil(VIEW_HEIGHT / 8),
  );
  private overlay: HTMLCanvasElement | null = null;
  private fit: Fit = fitView(VIEW_WIDTH, VIEW_HEIGHT, 1);
  private readonly observer: ResizeObserver | null;
  private sprites: Sprites | null = null;
  private scene: Scene | null = null;
  private hud: Hud | null = null;
  private readonly sound: Sound;
  private readonly ledger = new EventLedger();
  private readonly flaps = new FlapClock();
  private readonly shake = new Shake();
  private readonly pool = new EffectPool();
  private readonly ghosts = new Ghosts();
  private readonly holePops = new Map<string, number>();
  private gateUsers: number[] = [];
  /** Wall-clock second each gate last let its Warrior out, each slot last landed (and how hard) and last jumped. */
  private gateOpened: number[] = [];
  private landed: { at: number; strength: number }[] = [];
  private jumped: number[] = [];
  private runDust: number[] = [];
  private spray = 0;
  private wonAt: number | null = null;
  private lastNow = 0;
  private lastStep = -1;
  private fed: RoundView | null = null;
  private flight: FlightTrace = NO_FLIGHT;
  private sparkle = 0;
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    options: Options,
  ) {
    this.options = { ...options };
    this.wrapper = document.createElement("div");
    this.wrapper.style.cssText = `position:relative;width:100%;height:100%;overflow:hidden;background:${INK}`;
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:absolute;display:block;image-rendering:pixelated";
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d canvas");
    this.ctx = ctx;
    this.wrapper.append(this.canvas);
    host.append(this.wrapper);
    this.sound = new Sound(options.muted);
    this.observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => this.resize());
    this.observer?.observe(this.wrapper);
    this.resize();
    this.ready = loadArt(options.artUrl).then((art) => {
      if (this.destroyed) return;
      this.sprites = new Sprites(art);
      this.scene = new Scene(this.sprites);
      const { sprites, scene } = this;
      this.hud = new Hud({
        sizes: sprites.sizes,
        ramp: (team) => sprites.ramp(team),
        label: (...args) => scene.label(...args),
      });
    });
  }

  resize(): void {
    const fit = fitView(
      this.wrapper.clientWidth,
      this.wrapper.clientHeight,
      window.devicePixelRatio,
    );
    this.fit = fit;
    if (this.canvas.width !== fit.width || this.canvas.height !== fit.height) {
      this.canvas.width = fit.width;
      this.canvas.height = fit.height;
      this.overlay = null;
    }
    this.canvas.style.width = `${fit.cssWidth}px`;
    this.canvas.style.height = `${fit.cssHeight}px`;
    this.canvas.style.left = `${fit.left}px`;
    this.canvas.style.top = `${fit.top}px`;
    this.canvas.style.imageRendering = fit.smooth ? "auto" : "pixelated";
  }

  update(options: Partial<Options>): void {
    this.options = { ...this.options, ...options };
    if (options.muted !== undefined) this.sound.setMuted(options.muted);
  }

  advance(view: RoundView): void {
    const now = performance.now() / 1000;
    // A step far behind the last one, or the very first step again, is a new round: nothing of the old one may
    // linger. A rollback only ever goes back a few steps.
    if (
      view.step < this.lastStep - 120 ||
      (view.step === 0 && this.lastStep > 0)
    )
      this.reset();
    this.lastStep = view.step;
    this.flaps.rewind(view.step);
    const events = this.ledger.fresh(view);
    const flapped = this.ledger.freshFlaps(view);
    // The page feeds one view per network tick, so most flaps happen on steps never shown: read them from the fall.
    const moved = this.fed
      ? velocityFlaps(this.fed, view, this.flight)
      : { slots: [], trace: NO_FLIGHT };
    // A dive that ends snaps back to beating wings.
    if (this.fed)
      for (const slot of diveEnds(this.fed, view)) flapped.push(slot);
    const landed = this.fed ? landings(this.fed, view) : [];
    this.fed = view;
    this.flight = moved.trace;
    for (const slot of moved.slots)
      if (!flapped.includes(slot) && this.flaps.since(slot, view.step) > 2)
        flapped.push(slot);
    for (const slot of flapped) this.flaps.note(slot, view.step);
    const local = this.options.localSlot;
    const sizes = this.sprites?.sizes;
    const plans: Plan[] = sizes
      ? events.map((event) => planEvent(event, view, local, sizes))
      : [];
    for (const slot of flapped) {
      const unit = view.units[slot];
      if (!unit) continue;
      plans.push(planFlap(unit, local));
      if (unit.kind === "worker") this.jumped[slot] = now;
    }
    for (const { slot, strength } of landed) {
      const unit = view.units[slot];
      if (!unit) continue;
      this.landed[slot] = { at: now, strength };
      plans.push(planLanding(unit));
    }
    for (const event of events) {
      if (event.type === "gateUse") this.gateOpened[event.gate] = now;
      if (event.type === "berryDeposit" || event.type === "berryKickIn")
        this.holePops.set(`${event.team}:${event.hole}`, now);
    }
    view.gates.forEach((gate, index) => {
      const before = this.gateUsers[index] ?? -1;
      if (gate.user >= 0 && before < 0)
        plans.push({
          effects: [],
          sounds: [
            {
              name: "gateEnter",
              volume: gate.user === local ? 0.9 : 0.4,
              pan: (gate.x - VIEW_WIDTH / 2) / VIEW_WIDTH,
            },
          ],
          shake: 0,
        });
      this.gateUsers[index] = gate.user;
    });
    this.apply(mergePlans(plans));
  }

  private apply(plan: Plan): void {
    const { sprites, scene } = this;
    if (sprites && scene)
      for (const effect of plan.effects)
        this.pool.add(effect, (team) => sprites.ramp(team), scene.duration);
    for (const cue of plan.sounds) this.sound.play(cue);
    if (plan.shake > 0) this.shake.add(plan.shake);
  }

  private reset(): void {
    this.pool.clear();
    this.ghosts.clear();
    this.holePops.clear();
    this.gateUsers = [];
    this.gateOpened = [];
    this.landed = [];
    this.jumped = [];
    this.runDust = [];
    this.wonAt = null;
    this.ledger.clear();
    this.fed = null;
    this.flight = NO_FLIGHT;
  }

  /** Small things that happen for as long as something is going on, not once per event. */
  private ambient(view: RoundView, dt: number, now: number): void {
    const { sprites } = this;
    if (!sprites) return;
    this.spray += dt * DIVE_STREAM.rate;
    const specks = Math.floor(this.spray);
    this.spray -= specks;
    for (const unit of view.units) {
      if (unit.dead) continue;
      // A dive streams specks that drift up behind it.
      if (unit.diving && specks > 0)
        this.pool.push(
          diveStream(
            unit.x,
            unit.y,
            sprites.sizes[unit.kind],
            specks,
            Math.random,
          ),
        );
      // Feet on the ground and moving: a little dust now and then.
      if (
        unit.grounded &&
        unit.moving &&
        !unit.riding &&
        !unit.eaten &&
        now - (this.runDust[unit.slot] ?? -9) >= RUN_DUST_SECONDS
      ) {
        this.runDust[unit.slot] = now;
        this.pool.push([
          {
            x: unit.x - unit.facing * 3,
            y: unit.y - 1,
            vx: -unit.facing * 8,
            vy: -10,
            age: 0,
            life: 0.3,
            color: DUST,
            size: 1,
            gravity: 30,
          },
        ]);
      }
    }
    this.sparkle += dt * 40;
    const drops = Math.floor(this.sparkle);
    this.sparkle -= drops;
    if (drops === 0) return;
    for (const gate of view.gates) {
      const user = view.units[gate.user];
      if (!user) continue;
      const ramp = sprites.ramp(user.team);
      // Sparks climb the arch faster as the transformation nears its end.
      for (let i = 0; i < drops; i += 1)
        if (Math.random() < 0.35 + gate.progress * 0.6)
          this.pool.push([
            {
              x: gate.x + (Math.random() - 0.5) * sprites.sizes.worker,
              y: gate.y - 2 - Math.random() * (sprites.sizes.gate / 4),
              vx: (Math.random() - 0.5) * 8,
              vy: -30 - gate.progress * 50 - Math.random() * 20,
              age: 0,
              life: 0.45 + Math.random() * 0.3,
              color: Math.random() < 0.4 ? "#ffffff" : (ramp[3] ?? "#fff"),
              size: 1,
              gravity: -20,
            },
          ]);
    }
  }

  render(previous: RoundView, current: RoundView, alpha: number): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const { scene, hud, sprites } = this;
    if (!scene || !hud || !sprites) {
      this.ctx.fillStyle = INK;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.shake.tick(dt);
    this.pool.tick(dt, scene.duration);
    this.ghosts.tick(now);
    if (!current.winner) this.wonAt = null;
    else this.wonAt ??= now;
    this.sound.setPlaying(!current.winner);
    this.sound.tick();

    const steps = Math.max(1, current.step - previous.step);
    const view = interpolateView(previous, current, alpha);
    this.ambient(view, dt, now);
    const offset = this.shake.offset();
    const sceneFrame: SceneFrame = {
      view,
      time: viewTime(previous, current, alpha),
      now,
      dy: current.units.map((unit, slot) => {
        const before = previous.units[slot];
        return before && continuous(before, unit)
          ? (unit.y - before.y) / steps
          : 0;
      }),
      localSlot: this.options.localSlot,
      highlight: this.options.highlight === true,
      names: this.options.names,
      flaps: this.flaps,
      pool: this.pool,
      ghosts: this.ghosts,
      shapes: view.units.map((unit, slot) => {
        const landed = this.landed[slot];
        return bodyShape(
          unit.kind,
          landed ? now - landed.at : -1,
          landed?.strength ?? 0,
          now - (this.jumped[slot] ?? -9),
        );
      }),
      gateOpened: this.gateOpened,
      holePops: this.holePops,
      danger: dangerOf(view),
      shakeX: offset.x,
      shakeY: offset.y,
    };
    // The ending: unless the page shows its own, the camera closes in on what decided the round.
    const { winner } = view;
    const ending =
      winner &&
      this.wonAt !== null &&
      this.options.banner !== false &&
      this.host.dataset.banner !== BANNER_OFF
        ? now - this.wonAt - endingDelay(winner, view.timeUp, SHAKE_SECONDS)
        : null;
    const camera =
      ending === null
        ? STILL
        : endingCamera(ending, victoryFocus(view, sprites.sizes));
    scene.draw(this.world.ctx, sceneFrame);
    const low = this.low.ctx;
    const world = this.world.canvas;
    low.imageSmoothingEnabled = false;
    low.fillStyle = INK;
    low.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    look(low, camera);
    // The shaken picture: the arena wraps sideways, so the gap a sideways knock opens shows the other edge.
    for (const dx of [-VIEW_WIDTH, 0, VIEW_WIDTH])
      low.drawImage(world, offset.x + dx, offset.y);
    if (offset.y > 0)
      low.drawImage(world, 0, 0, VIEW_WIDTH, 1, 0, 0, VIEW_WIDTH, offset.y);
    if (offset.y < 0)
      low.drawImage(
        world,
        0,
        VIEW_HEIGHT - 1,
        VIEW_WIDTH,
        1,
        0,
        VIEW_HEIGHT + offset.y,
        VIEW_WIDTH,
        -offset.y,
      );
    low.setTransform(1, 0, 0, 1, 0, 0);
    hud.draw(low, { view, ending, camera });
    // What the glow is made from: the finished picture with the things that would bloom too much held down.
    const source = this.glowSource.ctx;
    source.drawImage(this.low.canvas, 0, 0);
    look(source, camera);
    scene.dimForGlow(source, sceneFrame);
    source.setTransform(1, 0, 0, 1, 0, 0);
    this.present();
  }

  /** The low-resolution picture onto the screen at a whole scale, then light: a glow, a vignette, faint scanlines. */
  private present(): void {
    const { ctx } = this;
    const { width, height } = this.fit;
    const low = this.low.canvas;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(low, 0, 0, width, height);

    // Glow: the picture halved, multiplied by itself so only bright colour survives, then shrunk again. Drawn
    // back enlarged and added, it puts a soft halo around team colours without touching the pixels under it.
    const near = this.glowNear,
      far = this.glowFar;
    near.ctx.globalCompositeOperation = "copy";
    near.ctx.imageSmoothingEnabled = true;
    const lit = this.glowSource.canvas;
    near.ctx.drawImage(lit, 0, 0, near.canvas.width, near.canvas.height);
    near.ctx.globalCompositeOperation = "multiply";
    near.ctx.drawImage(lit, 0, 0, near.canvas.width, near.canvas.height);
    far.ctx.globalCompositeOperation = "copy";
    far.ctx.imageSmoothingEnabled = true;
    far.ctx.drawImage(near.canvas, 0, 0, far.canvas.width, far.canvas.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = 0.42;
    ctx.drawImage(far.canvas, 0, 0, width, height);
    ctx.globalAlpha = 0.18;
    ctx.drawImage(near.canvas, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(this.overlayFor(width, height), 0, 0);
  }

  private overlayFor(width: number, height: number): HTMLCanvasElement {
    if (this.overlay) return this.overlay;
    const { canvas, ctx } = makeCanvas(width, height);
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      height * 0.45,
      width / 2,
      height / 2,
      width * 0.62,
    );
    vignette.addColorStop(0, "rgba(2,3,14,0)");
    vignette.addColorStop(1, "rgba(2,3,14,0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    const { scale } = this.fit;
    if (scale >= 3) {
      ctx.fillStyle = "rgba(2,3,14,0.09)";
      for (let y = scale - 1; y < height; y += scale)
        ctx.fillRect(0, y, width, 1);
    }
    this.overlay = canvas;
    return canvas;
  }

  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.sound.destroy();
    this.wrapper.remove();
  }
}

/** Dust is the colour of the stone it comes off. */
const DUST = "#b9a4ff";

/** Sets `ctx` to draw the arena through `camera`: the camera's point in the middle, enlarged about it. */
function look(ctx: Ctx, camera: Camera): void {
  ctx.setTransform(
    camera.zoom,
    0,
    0,
    camera.zoom,
    VIEW_WIDTH / 2 - camera.x * camera.zoom,
    VIEW_HEIGHT / 2 - camera.y * camera.zoom,
  );
}

export const createArenaView: CreateArenaView = (host, options) =>
  new Arena(host, options);

export type { ArenaOptions, ArenaView, CreateArenaView } from "./api.js";
