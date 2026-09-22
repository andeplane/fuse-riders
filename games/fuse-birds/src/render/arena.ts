import Phaser from "phaser";
import {
  CHUNK,
  UNIT,
  type WorldView,
  type Vector,
  type Fact,
} from "../engine/view.js";
import { projectShot } from "../engine/view-kit.js";
import {
  constrainCamera,
  edgeMarker,
  fitScale,
  type Camera,
} from "./camera.js";
import {
  GUTTER,
  TEXELS,
  TILE_SIZE,
  paintTerrain,
  terrainKey,
} from "./terrain-art.js";

const COLORS = ["#6df4ed", "#ff6ec7", "#bded76", "#ffb75e", "#b797ff"];
interface Tile {
  image: Phaser.GameObjects.Image;
  texture: Phaser.Textures.CanvasTexture;
  key: number | null;
}
export interface ArenaFrame {
  world: WorldView;
  camera: Camera;
  aim?: Vector;
  shared?: boolean;
}
export interface Arena {
  ready: Promise<void>;
  paint(frame: ArenaFrame, now: number): boolean;
  emit(fact: Fact, scope: string, now: number): void;
  destroy(): void;
}

/** Phaser only presents externally supplied views. No physics or game clock lives here. */
export function createArena(
  canvas: HTMLCanvasElement,
  assetRoot: string,
  reducedMotion = false,
): Arena {
  let resolve!: () => void, reject!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let booted = false,
    destroyed = false,
    lost = false,
    previousTime = 0;
  const scene = new BirdsScene(
    assetRoot,
    () => {
      game.loop.stop();
      booted = true;
      resolve();
    },
    reject,
    reducedMotion,
  );
  const game = new Phaser.Game({
    type: canvas.getContext("webgl", { alpha: false, antialias: true })
      ? Phaser.WEBGL
      : Phaser.CANVAS,
    canvas,
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
    backgroundColor: "#030b1d",
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    render: {
      antialias: true,
      roundPixels: false,
      powerPreference: "high-performance",
    },
    scene,
  });
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
    scene.invalidate();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  return {
    ready,
    emit(fact, scope, now) {
      if (booted && !destroyed && !lost) scene.emit(fact, scope, now);
    },
    paint(frame, now) {
      if (!booted || destroyed || lost) return false;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio)),
        height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (game.scale.width !== width || game.scale.height !== height)
        game.scale.resize(width, height);
      if (!scene.paint(frame, now)) return false;
      game.step(now, Math.max(0, Math.min(50, now - previousTime)));
      previousTime = now;
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      game.destroy(false);
    },
  };
}

class BirdsScene extends Phaser.Scene {
  private tiles: Tile[] = [];
  private entities = new Map<string, Phaser.GameObjects.Image>();
  private names = new Map<string, Phaser.GameObjects.Text>();
  private sky!: Phaser.GameObjects.Image;
  private effects!: Phaser.GameObjects.Graphics;
  private mask!: CanvasRenderingContext2D;
  private worldId = "";
  private bursts: { fact: Fact; scope: string; at: number }[] = [];
  private floating: Phaser.GameObjects.Text[] = [];
  constructor(
    private root: string,
    private started: () => void,
    private failed: (error: Error) => void,
    private reducedMotion: boolean,
  ) {
    super("fuse-birds");
  }
  preload(): void {
    this.load.image("birds-rock", `${this.root}/neon-rock.png`);
    this.load.image("birds-sky", `${this.root}/neon-sky.png`);
    this.load.on("loaderror", () =>
      this.failed(
        new Error(
          "Neon burrow artwork failed to load. Retry to load the game.",
        ),
      ),
    );
  }
  create(): void {
    this.sky = this.add
      .image(768, 384, "birds-sky")
      .setDisplaySize(1536, 864)
      .setDepth(-2);
    const mask = document.createElement("canvas");
    mask.width = mask.height = TILE_SIZE;
    this.mask = mask.getContext("2d")!;
    this.effects = this.add.graphics().setDepth(10);
    for (let slot = 0; slot < COLORS.length; slot++) this.birdTexture(slot);
    this.crateTexture();
    this.started();
  }
  invalidate(): void {
    for (const tile of this.tiles) tile.key = null;
  }
  emit(fact: Fact, scope: string, at: number): void {
    if (
      fact.x === undefined ||
      fact.y === undefined ||
      !["blast", "damage", "pickup", "split"].includes(fact.type)
    )
      return;
    this.bursts.push({ fact: { ...fact }, scope, at });
    if (this.bursts.length > 48) this.bursts.shift();
  }
  private birdTexture(slot: number): void {
    const tex = this.textures.createCanvas(`bird-${slot}`, 96, 96)!;
    const c = tex.context,
      color = COLORS[slot]!;
    c.translate(48, 51);
    // Original painted sprite: plumage, shaded wing, crest, cream face and gold beak.
    const body = c.createRadialGradient(-10, -15, 1, 0, 1, 37);
    body.addColorStop(0, "#e1ffff");
    body.addColorStop(0.3, color);
    body.addColorStop(1, "#163954");
    c.fillStyle = "#fcac5c";
    c.fillRect(-17, 28, 13, 7);
    c.fillRect(6, 28, 13, 7);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(-24, 13);
    c.lineTo(-44, -4);
    c.lineTo(-36, 22);
    c.closePath();
    c.fill();
    c.fillStyle = body;
    c.beginPath();
    c.ellipse(0, 0, 31, 32, -0.1, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(187,255,248,.85)";
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(-12, -27);
    c.lineTo(-18, -44);
    c.lineTo(-2, -33);
    c.lineTo(7, -42);
    c.lineTo(11, -26);
    c.fill();
    c.fillStyle = "rgba(2,31,60,.4)";
    c.beginPath();
    c.ellipse(-12, 11, 15, 18, -0.65, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(198,255,250,.35)";
    c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(-24 + i * 6, 2);
      c.quadraticCurveTo(-21 + i * 6, 15, -7 + i * 3, 20);
      c.stroke();
    }
    c.fillStyle = "#fff1ce";
    c.beginPath();
    c.ellipse(14, -3, 15, 19, 0.1, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#091629";
    c.beginPath();
    c.ellipse(19, -9, 4, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#ffffff";
    c.fillRect(18, -12, 2, 2);
    c.fillStyle = "#ffce70";
    c.beginPath();
    c.moveTo(24, -1);
    c.lineTo(42, 4);
    c.lineTo(25, 10);
    c.closePath();
    c.fill();
    c.fillStyle = "#b96c4b";
    c.beginPath();
    c.moveTo(25, 5);
    c.lineTo(42, 4);
    c.lineTo(25, 10);
    c.fill();
    tex.refresh();
  }
  private crateTexture(): void {
    const tex = this.textures.createCanvas("bird-crate", 64, 64)!,
      c = tex.context;
    c.fillStyle = "#152d46";
    c.fillRect(6, 8, 52, 48);
    const fill = c.createLinearGradient(0, 10, 0, 56);
    fill.addColorStop(0, "#e4b980");
    fill.addColorStop(1, "#75504f");
    c.fillStyle = fill;
    c.fillRect(9, 11, 46, 42);
    c.strokeStyle = "#402c40";
    c.lineWidth = 2;
    for (let y = 20; y < 52; y += 10) {
      c.beginPath();
      c.moveTo(10, y);
      c.lineTo(54, y);
      c.stroke();
    }
    c.fillStyle = "#397c87";
    c.fillRect(12, 9, 7, 46);
    c.fillRect(45, 9, 7, 46);
    c.fillStyle = "#87fff2";
    // Three pellets identify the actual Scatter refill, rather than a medical cross.
    for (const [x, y] of [
      [25, 37],
      [32, 27],
      [40, 37],
    ]) {
      c.beginPath();
      c.arc(x!, y!, 4, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = "#78d9d7";
    c.strokeRect(7, 9, 50, 46);
    tex.refresh();
  }
  paint(frame: ArenaFrame, now: number): boolean {
    const { world: view } = frame,
      viewport = { width: this.scale.width, height: this.scale.height };
    const camera = constrainCamera(frame.camera, view, viewport, frame.shared);
    this.cameras.main
      .setZoom(fitScale(view, viewport) * camera.zoom)
      .centerOn(camera.x, camera.y);
    const worldId = `${view.id}:${view.round}`;
    if (this.worldId !== worldId) {
      this.invalidate();
      this.worldId = worldId;
    }
    const cols = Math.ceil(view.width / CHUNK),
      rows = Math.ceil(view.height / CHUNK);
    const rock = this.textures
      .get("birds-rock")
      .getSourceImage() as HTMLImageElement;
    let uploads = 0,
      complete = true;
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const index = cy * cols + cx;
        let tile = this.tiles[index];
        if (!tile) {
          const texture = this.textures.createCanvas(
            `birds-terrain-${index}`,
            TILE_SIZE,
            TILE_SIZE,
          )!;
          const image = this.add
            .image(cx * CHUNK - GUTTER, cy * CHUNK - GUTTER, texture.key)
            .setOrigin(0)
            .setScale(1 / TEXELS)
            .setCrop(
              GUTTER * TEXELS,
              GUTTER * TEXELS,
              CHUNK * TEXELS,
              CHUNK * TEXELS,
            );
          this.tiles[index] = tile = { texture, image, key: null };
        }
        const key = terrainKey(view, cx, cy);
        if (tile.key !== key) {
          if (uploads >= 4) {
            complete = false;
            continue;
          }
          paintTerrain(tile.texture.context, this.mask, rock, view, cx, cy);
          tile.texture.refresh();
          tile.key = key;
          uploads++;
        }
      }
    // Retain the last complete frame until its replacement terrain is ready. Yielding
    // between bounded batches lets room clocks and snapshot delivery keep progressing.
    if (!complete) return false;
    const g = this.effects,
      waterTime = this.reducedMotion ? 0 : now;
    g.clear();
    g.fillStyle(0x071e39, 0.93).fillRect(
      0,
      view.water,
      view.width,
      view.height - view.water,
    );
    const glowDepth = Math.min(120, view.height - view.water);
    for (let depth = 0; depth < glowDepth; depth += 4)
      g.fillStyle(0x096ce3, 0.34 * (1 - depth / glowDepth) ** 2).fillRect(
        0,
        view.water + depth,
        view.width,
        Math.min(4, glowDepth - depth),
      );
    g.lineStyle(1.2, 0x48e4f5, 0.8).beginPath();
    for (let x = 0; x <= view.width; x += 4) {
      const y = view.water + Math.sin(x / 32 + waterTime / 1000) * 0.7;
      if (!x) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
    for (let i = 0; i < 25; i++) {
      const x = (i * 71 + waterTime / 100) % view.width;
      g.lineStyle(0.7, 0x44a8e5, 0.32).lineBetween(
        x,
        view.water + 8 + (i % 4) * 11,
        x + 25,
        view.water + 8 + (i % 4) * 11,
      );
    }
    const live = new Set<string>();
    for (const bird of view.players) {
      if (bird.hp <= 0) continue;
      const key = `bird:${bird.id}`;
      live.add(key);
      let image = this.entities.get(key);
      if (!image) {
        image = this.add
          .image(0, 0, `bird-${bird.slot}`)
          .setDepth(8)
          .setDisplaySize(16, 16);
        this.entities.set(key, image);
      }
      const x = bird.x / UNIT,
        y = bird.y / UNIT;
      image
        .setTexture(`bird-${bird.slot}`)
        .setPosition(x, y - 1)
        .setFlipX(bird.vx < 0);
      if (bird.id === view.players[view.active]?.id) {
        g.lineStyle(0.8, 0xaffff4, 0.7).strokeEllipse(x, y + 7, 20, 4);
      }
      let name = this.names.get(key);
      if (!name) {
        name = this.add
          .text(0, 0, "", {
            fontFamily: "monospace",
            fontSize: "10px",
            color: COLORS[bird.slot],
            backgroundColor: "#061427cc",
            padding: { x: 3, y: 2 },
          })
          .setOrigin(0.5, 1)
          .setDepth(12);
        this.names.set(key, name);
      }
      const marker = frame.shared
        ? undefined
        : edgeMarker({ x, y }, camera, view, viewport);
      name
        .setColor(COLORS[bird.slot]!)
        .setText(
          `${marker ? `${marker.arrow} ${bird.name.slice(0, 12)}` : bird.name} · ${bird.hp}`,
        )
        .setPosition(marker?.x ?? x, marker?.y ?? y - 13)
        .setScale(
          marker ? 1 / this.cameras.main.zoom : Math.max(0.5, 1 / camera.zoom),
        );
      g.fillStyle(0x061224).fillRect(x - 7, y - 11, 14, 1.5);
      g.fillStyle(
        Phaser.Display.Color.HexStringToColor(COLORS[bird.slot]!).color,
      ).fillRect(x - 7, y - 11, (14 * bird.hp) / 100, 1.5);
    }
    for (const crate of view.crates) {
      const key = `crate:${crate.id}`;
      live.add(key);
      let image = this.entities.get(key);
      if (!image) {
        image = this.add
          .image(0, 0, "bird-crate")
          .setDepth(8)
          .setDisplaySize(15, 15);
        this.entities.set(key, image);
      }
      const x = crate.x / UNIT,
        y = crate.y / UNIT;
      image.setPosition(x, y);
      const marker = frame.shared
        ? undefined
        : edgeMarker({ x, y }, camera, view, viewport);
      let label = this.names.get(key);
      if (marker && !label) {
        label = this.add
          .text(0, 0, "", {
            fontFamily: "monospace",
            fontSize: "10px",
            color: "#a7fff8",
            backgroundColor: "#061427cc",
            padding: { x: 3, y: 2 },
          })
          .setOrigin(0.5, 1)
          .setDepth(12);
        this.names.set(key, label);
      }
      label?.setVisible(!!marker);
      if (marker)
        label!
          .setText(`${marker.arrow} AMMO`)
          .setPosition(marker.x, marker.y)
          .setScale(1 / this.cameras.main.zoom);
      if (!crate.grounded) {
        g.lineStyle(0.5, 0xb1e9e5, 0.8)
          .lineBetween(x - 10, y - 23, x - 5, y - 6)
          .lineBetween(x + 10, y - 23, x + 5, y - 6);
        g.fillStyle(0x78e8dd, 0.9)
          .slice(x, y - 23, 11, Math.PI, Math.PI * 2, false)
          .fillPath();
      }
    }
    for (const [key, image] of this.entities)
      if (!live.has(key)) {
        image.destroy();
        this.entities.delete(key);
        this.names.get(key)?.destroy();
        this.names.delete(key);
      }
    for (const p of view.projectiles) {
      const x = p.x / UNIT,
        y = p.y / UNIT;
      g.fillStyle(p.kind === "pebble" ? 0xd4f5f4 : 0xffb472, 0.12).fillCircle(
        x,
        y,
        6,
      );
      g.fillStyle(p.kind === "pebble" ? 0xecffef : 0xffca80).fillCircle(
        x,
        y,
        p.kind === "scatter" ? 2.6 : 1.6,
      );
    }
    if (frame.aim && view.phase === "aiming") {
      const bird = view.players[view.active]!,
        x = bird.x / UNIT,
        y = bird.y / UNIT;
      const direction = frame.aim.vx >= 0 ? 1 : -1,
        sx = x + direction * 11;
      g.lineStyle(2, 0xbc855d)
        .lineBetween(sx, y + 6, sx, y - 8)
        .lineBetween(sx, y - 4, sx - 4, y - 11)
        .lineBetween(sx, y - 4, sx + 4, y - 11);
      const pullX = sx - frame.aim.vx / 170,
        pullY = y - 10 - frame.aim.vy / 170;
      g.lineStyle(0.8, 0xffafd0)
        .lineBetween(sx - 4, y - 11, pullX, pullY)
        .lineBetween(sx + 4, y - 11, pullX, pullY);
      g.fillStyle(0xe7eeee).fillCircle(pullX, pullY, 2);
      const points = projectShot(view, frame.aim);
      points.forEach((p, i) =>
        g
          .fillStyle(0xc5fff4, 0.8 * (1 - i / (points.length + 1)))
          .fillCircle(p.x, p.y, 1.2),
      );
    }
    this.bursts = this.bursts.filter(
      (b) => b.scope === worldId && now - b.at < 850,
    );
    let labels = 0;
    for (const { fact, at } of this.bursts) {
      const age = Math.max(0, (now - at) / 850),
        x = fact.x!,
        y = fact.y!,
        fade = 1 - age;
      if (fact.type === "damage" || fact.type === "pickup") {
        let text = this.floating[labels];
        if (!text) {
          text = this.add
            .text(0, 0, "", {
              fontFamily: "monospace",
              fontSize: "11px",
              color: "#fff7cd",
              stroke: "#071126",
              strokeThickness: 3,
            })
            .setDepth(14)
            .setOrigin(0.5);
          this.floating[labels] = text;
        }
        text
          .setVisible(true)
          .setText(
            fact.type === "damage"
              ? `−${fact.amount}`
              : fact.amount
                ? "+1 SCATTER"
                : "AMMO FULL",
          )
          .setPosition(x, y - 18 - (this.reducedMotion ? 0 : age * 22))
          .setAlpha(fade);
        labels++;
      } else {
        const radius = fact.radius ?? 10,
          size = this.reducedMotion ? radius : radius * (0.2 + age * 1.3);
        g.fillStyle(0xffbe76, fade * 0.16).fillCircle(x, y, size);
        g.lineStyle(1.5, 0xffe3a7, fade).strokeCircle(x, y, size);
        if (!this.reducedMotion)
          for (let i = 0; i < 9; i++) {
            const angle = (i * Math.PI * 2) / 9,
              reach = radius * age * 1.9;
            g.fillStyle(i % 2 ? 0x75fff1 : 0xffb475, fade).fillCircle(
              x + Math.cos(angle) * reach,
              y + Math.sin(angle) * reach + age * age * 14,
              1.8 * fade,
            );
          }
      }
    }
    for (let i = labels; i < this.floating.length; i++)
      this.floating[i]!.setVisible(false);
    return true;
  }
}
