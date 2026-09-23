import Phaser from "phaser";
import { ASSETS, crops, type Crop, type AssetKey } from "./assets.js";
import { showcasePose, PLATFORMS, ANCHOR } from "./showcase-timeline.js";
import type { WorldView } from "../engine/view.js";
import { Feedback, type Cue } from "./feedback.js";

export interface ShowcaseHandle {
  resetFeedback(): void;
  destroy(): void;
  setPaused(value: boolean): void;
  replay(): void;
  setIdle(value: boolean): void;
  setAtmosphere(value: boolean): void;
  seek(time: number): void;
}
interface Options {
  cue?(cue: Cue): void;
  view?(): WorldView;
  debug?(): boolean;
  paused: boolean;
  idleOnly: boolean;
  atmosphere: boolean;
  ready(): void;
  failed(message: string): void;
  phase(label: string): void;
  time(ms: number): void;
}

/** Phaser owns the only presentation loop. No physics plugin or simulation clock. */
export function createShowcase(
  host: HTMLElement,
  options: Options,
): ShowcaseHandle {
  let paused = options.paused,
    idleOnly = options.idleOnly,
    atmosphere = options.atmosphere;
  let elapsed = 800,
    destroyed = false;
  const feedback = new Feedback();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  class Belfry extends Phaser.Scene {
    private actor?: Phaser.GameObjects.Image;
    private hook?: Phaser.GameObjects.Image;
    private tether?: Phaser.GameObjects.Graphics;
    private effects?: Phaser.GameObjects.Graphics;
    private combat?: Phaser.GameObjects.Graphics;
    private frames: Crop[] = [];
    private actorScale = 1;
    private fog: Phaser.GameObjects.Image[] = [];
    private glows: Phaser.GameObjects.Image[] = [];
    constructor() {
      super("belfry");
    }
    preload(): void {
      this.load.on("loaderror", () =>
        options.failed("One of the belfry images could not load."),
      );
      for (const [key, url] of Object.entries(ASSETS))
        this.load.image(key, url);
    }
    create(): void {
      try {
        this.build();
        options.ready();
      } catch (error) {
        options.failed(
          error instanceof Error
            ? error.message
            : "The belfry could not be drawn.",
        );
      }
    }
    private cut(key: AssetKey, cols = 1, rows = 1): Crop[] {
      const texture = this.textures.get(key),
        source = texture.getSourceImage();
      if (!(source instanceof HTMLImageElement))
        throw new Error(`Cannot read ${key} artwork.`);
      const rects = crops(source, cols, rows);
      rects.forEach((r, index) =>
        texture.add(String(index), 0, r.x, r.y, r.width, r.height),
      );
      return rects;
    }
    private glowTexture(key: string, color: string): void {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot prepare atmospheric textures.");
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      this.textures.addCanvas(key, canvas);
    }
    private build(): void {
      this.add
        .image(800, 450, "background")
        .setDisplaySize(1600, 900)
        .setTint(0xb8bdd3);
      this.add.rectangle(800, 450, 1600, 900, 0x11172e, 0.12);
      this.glowTexture("mist", "rgba(149,157,196,0.32)");
      this.glowTexture("warm", "rgba(255,174,70,0.5)");
      for (let i = 0; i < 5; i++)
        this.fog.push(
          this.add
            .image(i * 390, 680 + (i % 2) * 120, "mist")
            .setDisplaySize(850, 310),
        );
      this.cut("ledge");
      this.cut("hook");
      const lantern = this.cut("lantern")[0]!;
      for (const [index, [x, y, width, height]] of (
        options.view?.().platforms ?? PLATFORMS
      ).entries()) {
        this.add
          .image(x, y, "ledge", "0")
          .setOrigin(0)
          .setDisplaySize(width, height * 2.3);
        if ([0, 2, 4, 5, 6].includes(index)) {
          const lx = x + width - 42,
            ly = y + height * 2.3 + 8;
          this.add
            .line(0, 0, lx, y + 10, lx, ly, 0x4b3b30)
            .setOrigin(0)
            .setLineWidth(2);
          this.glows.push(
            this.add
              .image(lx, ly + 16, "warm")
              .setDisplaySize(125, 155)
              .setAlpha(0.65),
          );
          this.add
            .image(lx, ly, "lantern", "0")
            .setOrigin(0.5, 0)
            .setDisplaySize((38 * lantern.width) / lantern.height, 38);
        }
      }
      this.frames = this.cut("actor", 3, 2);
      this.actorScale = 76 / Math.max(...this.frames.map((r) => r.height));
      this.tether = this.add.graphics();
      this.combat = this.add.graphics();
      this.actor = this.add.image(310, 810, "actor", "0");
      this.hook = this.add
        .image(0, 0, "hook", "0")
        .setDisplaySize(30, 23)
        .setVisible(false);
      this.effects = this.add.graphics();
      // Restrained edge framing, never a playable surface.
      const edge = this.add.graphics().fillStyle(0x101420, 0.72);
      edge
        .beginPath()
        .moveTo(0, 0)
        .lineTo(85, 0)
        .lineTo(36, 140)
        .lineTo(17, 480)
        .lineTo(0, 680)
        .closePath()
        .fillPath();
      edge
        .beginPath()
        .moveTo(1600, 0)
        .lineTo(1520, 0)
        .lineTo(1570, 190)
        .lineTo(1580, 600)
        .lineTo(1600, 740)
        .closePath()
        .fillPath();
      this.paint();
    }
    update(_time: number, delta: number): void {
      if (!paused && !document.hidden) elapsed += Math.min(delta, 50);
      this.paint();
    }
    private paint(): void {
      if (!this.actor || !this.hook || !this.tether || !this.effects) return;
      const world = options.view?.();
      if (world)
        for (const cue of feedback.update(world, elapsed))
          if (!document.hidden) options.cue?.(cue);
      const motion = world
        ? feedback.pose(world, elapsed, reduced.matches)
        : undefined;
      const pose = world
          ? {
              x: world.x,
              feet: world.feet,
              frame: motion!.frame,
              scaleY: motion!.scaleY,
              alpha: world.respawn ? 0.25 : 1,
              hook: world.hook.phase !== "ready" ? world.hook : undefined,
              landing: 0,
              spark: 0,
              label: world.respawn
                ? "Returning to the belfry…"
                : world.hook.phase === "attached"
                  ? "Release to keep your momentum"
                  : world.grounded
                    ? "Find your next foothold"
                    : "In the air",
            }
          : showcasePose(elapsed, idleOnly),
        frame = this.frames[pose.frame]!;
      this.actor
        .setFrame(String(pose.frame))
        .setOrigin(frame.pivot, 1)
        .setPosition(pose.x, pose.feet)
        .setScale(
          this.actorScale * (motion?.scaleX ?? 1),
          this.actorScale * pose.scaleY,
        )
        .setRotation(motion?.rotation ?? 0)
        .setFlipX(world?.facing === -1)
        .setAlpha(pose.alpha);
      this.tether.clear();
      this.hook.setVisible(!!pose.hook);
      if (pose.hook) {
        const sx = pose.x + 17 * (world?.facing ?? 1),
          sy = pose.feet - 40;
        this.tether
          .lineStyle(
            world?.hook.phase === "attached" ? 3 : 2,
            world?.hook.phase === "attached" ? 0xf4d69a : 0xd2b580,
            pose.alpha,
          )
          .beginPath()
          .moveTo(sx, sy)
          .lineTo(pose.hook.x, pose.hook.y)
          .strokePath();
        this.hook
          .setPosition(pose.hook.x, pose.hook.y)
          .setRotation(Math.atan2(pose.hook.y - sy, pose.hook.x - sx))
          .setAlpha(pose.alpha);
      }
      this.effects.clear();
      this.combat?.clear();
      if (world && this.combat) {
        const g = this.combat,
          target = world.combat.target;
        if (world.experiment === "ball") {
          const [x, y, width, height] = world.combat.field;
          g.fillStyle(0x171d31, 0.25).fillRect(x, y, width, height);
          g.lineStyle(1, 0xd8b879, 0.38).strokeRect(x, y, width, height);
          for (const [cx, cy] of [
            [x, y],
            [x + width, y],
            [x, y + height],
            [x + width, y + height],
          ])
            g.lineStyle(2, 0xffd899, 0.8).strokeCircle(cx!, cy!, 5);
        }
        if (target && !target.respawn) {
          const { x, feet } = target;
          g.lineStyle(6, 0x101420).lineBetween(x, feet - 14, x, feet - 2);
          g.lineStyle(3, 0xb99a69).lineBetween(x, feet - 14, x, feet - 2);
          g.fillStyle(0x121827).fillCircle(x, feet - 28, 19);
          g.fillStyle(0x8c6742).fillCircle(x, feet - 28, 16);
          g.lineStyle(2, 0xf0d6a0).strokeCircle(x, feet - 28, 13);
          g.fillStyle(0xffd58b).fillCircle(x, feet - 28, 4);
          g.lineStyle(3, 0xb99a69).lineBetween(
            x - 11,
            feet - 1,
            x + 11,
            feet - 1,
          );
          if (options.debug?.())
            g.lineStyle(1, 0x72edd1).strokeRect(x - 16, feet - 52, 32, 52);
        }
        for (const b of world.combat.balls) {
          g.fillStyle(0xffb54f, 0.08).fillCircle(b.x, b.y, b.radius + 9);
          g.fillStyle(0x101420).fillCircle(b.x, b.y, b.radius + 3);
          g.fillStyle(0x9a562c, 0.95).fillCircle(b.x, b.y, b.radius);
          g.lineStyle(2, 0xffd08a).strokeCircle(b.x, b.y, b.radius - 1);
          g.lineStyle(1, 0xffedc0, 0.7).strokeEllipse(
            b.x,
            b.y,
            b.radius * 0.85,
            b.radius * 1.8,
          );
          g.fillStyle(0xffedc0, 0.8).fillCircle(
            b.x - b.radius * 0.3,
            b.y - b.radius * 0.35,
            b.radius * 0.13,
          );
        }
        host.dataset.experiment = world.experiment;
        host.dataset.hits = String(world.combat.hits);
        host.dataset.targetX = String(target?.x ?? "");
        host.dataset.targetFeet = String(target?.feet ?? "");
        host.dataset.targetRespawn = String(target?.respawn ?? "");
        host.dataset.balls = JSON.stringify(world.combat.balls);
      }
      if (world) {
        for (const burst of feedback.active()) {
          const age = (elapsed - burst.at) / 400,
            alpha = 1 - age;
          if (reduced.matches) {
            this.effects
              .lineStyle(2, 0xe6c893, alpha * 0.6)
              .strokeCircle(burst.x, burst.y - 5, 8);
            continue;
          }
          const count = burst.kind === "land" ? 10 : 6;
          for (let i = 0; i < count; i++) {
            const angle = (i * Math.PI * 2) / count;
            const ground = burst.kind === "land" || burst.kind === "jump";
            this.effects
              .fillStyle(ground ? 0xc4b59c : 0xffda8b, alpha * 0.7)
              .fillCircle(
                burst.x +
                  (ground
                    ? (i - count / 2) * (3 + age * 8)
                    : Math.cos(angle) * (5 + age * 35)),
                burst.y -
                  (ground
                    ? Math.sin(i + 1) ** 2 * age * 26
                    : Math.sin(angle) * (5 + age * 35)),
                ground ? 1 + alpha * 2 : 1 + alpha,
              );
          }
          if (burst.kind === "release" || burst.kind === "respawn")
            this.effects
              .lineStyle(2, 0x99dfca, alpha * 0.5)
              .strokeCircle(burst.x, burst.y - 32, 12 + age * 28);
        }
      }
      if (world && options.debug?.()) {
        this.effects.lineStyle(2, 0x72edd1, 0.8);
        for (const [x, y, w, h] of world.platforms)
          this.effects.strokeRect(x, y, w, h);
        this.effects.strokeRect(
          world.x - world.body.half,
          world.feet - world.body.height,
          world.body.half * 2,
          world.body.height,
        );
        this.effects
          .lineStyle(1, 0xffffff, 0.6)
          .strokeCircle(world.aim.x, world.aim.y, 8);
      }
      if (atmosphere) {
        for (let i = 0; i < 26; i++) {
          const x = (i * 137 + elapsed * (0.006 + (i % 3) * 0.003)) % 1600;
          const y = (i * 83 + elapsed * 0.008) % 900;
          this.effects
            .fillStyle(i % 4 === 0 ? 0xe9c184 : 0xabb5d1, 0.15 + (i % 3) * 0.08)
            .fillCircle(x, y, 1 + (i % 2));
        }
      }
      for (let i = 0; i < 10; i++) {
        if (pose.landing > 0) {
          const p = 1 - pose.landing;
          this.effects
            .fillStyle(0xd7c3a7, pose.landing * 0.5)
            .fillCircle(
              pose.x + (i - 4.5) * (2 + p * 7),
              pose.feet - Math.sin(i + 1) ** 2 * p * 22,
              1.5 + p * 2,
            );
        }
        if (pose.spark > 0) {
          const angle = i * Math.PI * 0.2,
            radius = 5 + (1 - pose.spark) * 28;
          this.effects
            .fillStyle(0xffdfa0, pose.spark)
            .fillCircle(
              ANCHOR.x + Math.cos(angle) * radius,
              ANCHOR.y + Math.sin(angle) * radius,
              2,
            );
        }
      }
      this.fog.forEach((fog, i) =>
        fog
          .setVisible(atmosphere)
          .setX(i * 390 + Math.sin(elapsed / 7000 + i) * 75),
      );
      this.glows.forEach((light, i) =>
        light.setAlpha(
          atmosphere ? 0.56 + Math.sin(elapsed / 700 + i * 2) * 0.08 : 0.5,
        ),
      );
      options.phase(pose.label);
      options.time(elapsed);
      host.dataset.time = String(Math.floor(elapsed));
      host.dataset.frame = String(pose.frame);
      host.dataset.actorX = pose.x.toFixed(3);
      host.dataset.feet = pose.feet.toFixed(3);
      host.dataset.scaleY = pose.scaleY.toFixed(5);
      if (world) {
        host.dataset.motion = motion!.state;
        host.dataset.feedback = feedback
          .active()
          .map((b) => b.kind)
          .join(",");
        host.dataset.hook = world.hook.phase;
        host.dataset.tick = String(world.tick);
        host.dataset.deaths = String(world.deaths);
        host.dataset.grounded = String(world.grounded);
      }
    }
  }
  const scene = new Belfry();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 1600,
    height: 900,
    transparent: false,
    backgroundColor: "#222941",
    banner: false,
    scene,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    render: { antialias: true, pixelArt: false, roundPixels: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  });
  const lost = (event: Event) => {
    event.preventDefault();
    options.failed("The graphics context was lost.");
  };
  game.canvas.addEventListener("webglcontextlost", lost);
  return {
    resetFeedback() {
      feedback.reset();
    },
    setPaused(value) {
      paused = value;
    },
    replay() {
      elapsed = 0;
    },
    setIdle(value) {
      idleOnly = value;
      elapsed = 800;
    },
    setAtmosphere(value) {
      atmosphere = value;
    },
    seek(time) {
      if (Number.isFinite(time)) elapsed = Math.max(0, Math.min(11999, time));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      game.canvas.removeEventListener("webglcontextlost", lost);
      game.destroy(true);
      host.replaceChildren();
    },
  };
}
