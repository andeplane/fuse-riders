import Phaser from "phaser";
import { ASSETS, crops, type Crop, type AssetKey } from "./assets.js";
import { showcasePose, PLATFORMS, ANCHOR } from "./showcase-timeline.js";
import type { WorldView } from "../engine/view.js";
import { Feedback, type Cue } from "./feedback.js";
import { KEEPER_COLORS, keeperColor } from "./identity.js";
import { paintCrest, paintTether, paintBurst, dressPlatform } from "./art.js";
import { dressShrine, shrineLedge } from "./shrine.js";

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
    private peers = new Map<
      string,
      {
        actor: Phaser.GameObjects.Image;
        crest: Phaser.GameObjects.Graphics;
        tether: Phaser.GameObjects.Graphics;
        label: Phaser.GameObjects.Text;
        feedback: Feedback;
      }
    >();
    private actor?: Phaser.GameObjects.Image;
    private crest?: Phaser.GameObjects.Graphics;
    private hook?: Phaser.GameObjects.Image;
    private tether?: Phaser.GameObjects.Graphics;
    private effects?: Phaser.GameObjects.Graphics;
    private combat?: Phaser.GameObjects.Graphics;
    private frames: Crop[] = [];
    private actorScale = 1;
    private fog: Phaser.GameObjects.Image[] = [];
    private glows: Phaser.GameObjects.Image[] = [];
    private terrain?: Phaser.GameObjects.Container;
    private terrainMap?: WorldView["map"];
    private lanternCrop?: Crop;
    private shrineFrames: Crop[] = [];
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
    private cut(
      key: AssetKey,
      cols = 1,
      rows = 1,
      divisions?: { x: readonly number[]; y: readonly number[] },
    ): Crop[] {
      const texture = this.textures.get(key),
        source = texture.getSourceImage();
      if (!(source instanceof HTMLImageElement))
        throw new Error(`Cannot read ${key} artwork.`);
      const rects = crops(source, cols, rows, divisions);
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
        .setTint(0x9da9c9);
      this.add.rectangle(800, 450, 1600, 900, 0x11172e, 0.19);
      this.glowTexture("mist", "rgba(149,157,196,0.32)");
      this.glowTexture("warm", "rgba(255,174,70,0.5)");
      this.add.image(370, 140, "mist").setDisplaySize(1000, 650).setAlpha(0.28);
      for (let i = 0; i < 5; i++)
        this.fog.push(
          this.add
            .image(i * 390, 680 + (i % 2) * 120, "mist")
            .setDisplaySize(850, 310),
        );
      this.cut("ledge");
      // The generated source uses unequal cells; preserve pixels and crop its actual packing.
      this.shrineFrames = this.cut("shrine", 2, 2, {
        x: [0, 0.484375, 1],
        y: [0, 0.35, 1],
      });
      this.cut("hook");
      this.lanternCrop = this.cut("lantern")[0]!;
      this.rebuildTerrain(options.view?.());
      this.frames = this.cut("actor", 3, 3);
      this.actorScale = 76 / Math.max(...this.frames.map((r) => r.height));
      this.tether = this.add.graphics().setDepth(10);
      this.combat = this.add.graphics().setDepth(9);
      this.crest = this.add.graphics().setDepth(11);
      this.actor = this.add.image(310, 810, "actor", "0").setDepth(12);
      this.hook = this.add
        .image(0, 0, "hook", "0")
        .setDisplaySize(30, 23)
        .setDepth(13)
        .setVisible(false);
      this.effects = this.add.graphics().setDepth(14);
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
    private rebuildTerrain(world?: WorldView): void {
      this.terrain?.destroy();
      this.terrain = this.add.container(0, 0).setName("terrain").setDepth(2);
      this.glows = [];
      this.terrainMap = world?.map ?? "belfry";
      const lantern = this.lanternCrop!;
      const lanternSlots =
        this.terrainMap === "crossroads" ? [5, 7, 8, 10, 13] : [0, 2, 4, 5, 6];
      for (const [index, [x, y, width, height]] of (
        world?.platforms ?? PLATFORMS
      ).entries()) {
        const shrine =
          this.terrainMap === "crossroads" && [2, 6, 9].includes(index);
        const variant = index === 6 ? 1 : 0;
        const stone = shrine
          ? shrineLedge(
              this,
              this.shrineFrames[variant]!,
              variant,
              width,
              height * 2.3,
            )
          : "ledge";
        this.terrain.add(
          this.add
            .image(x + 3, y + 7, stone, shrine ? undefined : "0")
            .setOrigin(0)
            .setDisplaySize(width, height * 2.3)
            .setTint(0x101421)
            .setAlpha(0.55),
        );
        this.terrain.add(
          this.add
            .image(x, y, stone, shrine ? undefined : "0")
            .setName("platform")
            .setOrigin(0)
            .setDisplaySize(width, height * 2.3)
            .setTint(shrine ? 0xffffff : 0xc6c5d7),
        );
        const dressing = this.add.graphics();
        this.terrain.add(dressing);
        if (shrine)
          dressShrine(
            this,
            this.terrain,
            this.shrineFrames,
            x,
            y,
            width,
            height * 2.3,
            index !== 2,
          );
        else dressPlatform(dressing, x, y, width, index);
        if (lanternSlots.includes(index)) {
          const lx = x + width - 42,
            ly = y + height * 2.3 + 8;
          this.terrain.add(
            this.add
              .line(0, 0, lx, y + 10, lx, ly, 0x4b3b30)
              .setOrigin(0)
              .setLineWidth(2),
          );
          this.glows.push(
            this.add
              .image(lx, ly + 16, "warm")
              .setDisplaySize(125, 155)
              .setAlpha(0.65),
          );
          this.terrain.add(this.glows[this.glows.length - 1]!);
          this.terrain.add(
            this.add
              .image(lx, ly, "lantern", "0")
              .setOrigin(0.5, 0)
              .setDisplaySize((38 * lantern.width) / lantern.height, 38),
          );
        }
      }
      host.dataset.map = this.terrainMap;
      host.dataset.shrineProps = String(
        this.terrain.list.filter((child) => child.name.startsWith("shrine-"))
          .length,
      );
      host.dataset.terrainGroups = String(
        this.children.list.filter((child) => child.name === "terrain").length,
      );
      host.dataset.terrain = JSON.stringify(
        this.terrain.list
          .filter(
            (child): child is Phaser.GameObjects.Image =>
              child instanceof Phaser.GameObjects.Image &&
              child.name === "platform",
          )
          .map((sprite) => [
            sprite.x,
            sprite.y,
            sprite.displayWidth,
            sprite.displayHeight,
          ]),
      );
      feedback.reset();
      this.resetPeerFeedback();
    }
    update(_time: number, delta: number): void {
      if (!paused && !document.hidden) elapsed += Math.min(delta, 50);
      this.paint();
    }
    resetPeerFeedback(): void {
      for (const peer of this.peers.values()) peer.feedback.reset();
    }
    private paint(): void {
      if (!this.actor || !this.hook || !this.tether || !this.effects) return;
      const world = options.view?.();
      if (world && world.map !== this.terrainMap) this.rebuildTerrain(world);
      if (world)
        for (const cue of feedback.update(world, elapsed))
          if (!document.hidden) options.cue?.(cue);
      const motion = world
        ? feedback.pose(world, elapsed, reduced.matches)
        : undefined;
      const focused = world?.localId ?? world?.keepers[0]?.id;
      const slot = world?.keepers.find((k) => k.id === focused)?.slot ?? 0;
      const color = KEEPER_COLORS[slot] ?? KEEPER_COLORS[0];
      const pose = world
          ? {
              x: world.x,
              feet: world.feet,
              frame: motion!.frame,
              scaleY: motion!.scaleY,
              alpha:
                world.respawn ||
                world.keepers.some(
                  (k) =>
                    k.id === (world.localId ?? world.keepers[0]?.id) &&
                    !k.playing,
                )
                  ? 0.25
                  : 1,
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
        .setTint(color)
        .setAlpha(pose.alpha);
      if (this.crest) {
        paintCrest(this.crest, slot, color);
        this.crest
          .setPosition(pose.x, pose.feet)
          .setScale((world?.facing ?? 1) * (motion?.scaleX ?? 1), pose.scaleY)
          .setRotation(motion?.rotation ?? 0)
          .setAlpha(pose.alpha);
      }
      this.tether.clear();
      this.hook.setVisible(!!pose.hook);
      if (pose.hook) {
        const sx = pose.x + 17 * (world?.facing ?? 1),
          sy = pose.feet - 40;
        paintTether(
          this.tether,
          sx,
          sy,
          pose.hook.x,
          pose.hook.y,
          color,
          world
            ? world.hook.phase === "attached"
            : "attached" in pose.hook && pose.hook.attached,
          pose.alpha,
        );
        this.hook
          .setPosition(pose.hook.x, pose.hook.y)
          .setRotation(Math.atan2(pose.hook.y - sy, pose.hook.x - sx))
          .setAlpha(pose.alpha);
      }
      this.effects.clear();
      if (world) {
        const colors = KEEPER_COLORS;
        for (const [id, peer] of this.peers)
          if (!world.keepers.some((k) => k.id === id)) {
            peer.actor.destroy();
            peer.crest.destroy();
            peer.tether.destroy();
            peer.label.destroy();
            this.peers.delete(id);
          }
        for (const keeper of world.keepers) {
          let peer = this.peers.get(keeper.id);
          if (!peer) {
            peer = {
              feedback: new Feedback(),
              actor: this.add.image(0, 0, "actor", "0").setDepth(12),
              crest: this.add.graphics().setDepth(11),
              tether: this.add.graphics().setDepth(10),
              label: this.add
                .text(0, 0, "", {
                  fontFamily: "sans-serif",
                  fontSize: "18px",
                  fontStyle: "bold",
                  backgroundColor: "#111520",
                  padding: { x: 7, y: 4 },
                  stroke: "#101420",
                  strokeThickness: 4,
                })
                .setOrigin(0.5, 1)
                .setDepth(15),
            };
            this.peers.set(keeper.id, peer);
          }
          const body = keeper.body,
            color = colors[keeper.slot]!;
          peer.feedback.update(body, elapsed);
          const remotePose = peer.feedback.pose(body, elapsed, reduced.matches);
          const remoteFrame = remotePose.frame;
          const crop = this.frames[remoteFrame]!;
          peer.actor
            .setVisible(keeper.id !== focused)
            .setFrame(String(remoteFrame))
            .setOrigin(crop.pivot, 1)
            .setPosition(body.x, body.feet)
            .setScale(
              this.actorScale * remotePose.scaleX,
              this.actorScale * remotePose.scaleY,
            )
            .setRotation(remotePose.rotation)
            .setFlipX(body.facing === -1)
            .setTint(color)
            .setAlpha(
              !keeper.connected || !keeper.playing || body.respawn ? 0.3 : 1,
            );
          paintCrest(peer.crest, keeper.slot, color);
          peer.crest
            .setVisible(keeper.id !== focused)
            .setPosition(body.x, body.feet)
            .setScale(body.facing * remotePose.scaleX, remotePose.scaleY)
            .setRotation(remotePose.rotation)
            .setAlpha(peer.actor.alpha);
          peer.label
            .setText(
              `P${keeper.slot + 1}${keeper.id === world.localId ? " · YOU" : ""}${!keeper.playing ? " · WATCHING" : keeper.connected ? "" : " · AWAY"}`,
            )
            .setColor(keeperColor(keeper.slot))
            .setPosition(
              Math.max(85, Math.min(1515, body.x)),
              Math.max(35, body.feet - 94),
            );
          peer.tether
            .clear()
            .lineStyle(
              keeper.shield ? 3 : 2,
              color,
              keeper.connected ? 0.9 : 0.3,
            )
            .strokeEllipse(body.x, body.feet + 2, 36, 9);
          if (keeper.id !== focused && body.hook.phase !== "ready") {
            paintTether(
              peer.tether,
              body.x + 17 * body.facing,
              body.feet - 40,
              body.hook.x,
              body.hook.y,
              color,
              body.hook.phase === "attached",
              peer.actor.alpha,
            );
            peer.tether
              .lineStyle(2, 0xffebbd, peer.actor.alpha)
              .strokeCircle(body.hook.x, body.hook.y, 4);
          }
          if (keeper.id !== focused)
            for (const burst of peer.feedback.active())
              if (burst.kind !== "impact" && burst.kind !== "pop")
                paintBurst(this.effects, burst, elapsed, reduced.matches);
        }
        host.dataset.keepers = JSON.stringify(
          world.keepers.map((k) => ({
            id: k.id,
            slot: k.slot,
            connected: k.connected,
            hits: k.hits,
            x: k.body.x,
            feet: k.body.feet,
            hook: k.body.hook.phase,
            deaths: k.body.deaths,
            costume: k.slot,
          })),
        );
      }
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
          paintBurst(this.effects, burst, elapsed, reduced.matches);
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
      scene.resetPeerFeedback();
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
