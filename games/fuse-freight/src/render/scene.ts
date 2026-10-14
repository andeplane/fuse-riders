import type { CartView, FxView, TrainView, WorldView } from "../engine/view.js";
import {
  CUT_COOL,
  DOCKS_PX,
  FX_LIFE,
  VIEW_H,
  VIEW_W,
} from "../engine/view-kit.js";
import { createBackdrop, drawDocks, noise } from "./backdrop.js";
import { DEPOT, hexA, seatColor } from "./palette.js";
import {
  blit,
  createSprites,
  roundRect,
  type MakeSurface,
  type Paint,
  type Sprite,
  type Surface,
} from "./sprites.js";

/**
 * Draws one frame of a round onto a 960×540 logical canvas. Everything here is cosmetic: steam, sparks, pop-ups and
 * the wagons that fly into a dock live in this closure and are rebuilt from the frames; nothing feeds back into the
 * simulation. Effects are spawned once per effect, keyed by what happened, so a rollback that replays or renumbers
 * one does not draw it twice.
 */
export interface SceneInput {
  world: WorldView;
  /** This device's train id, if it drives one. */
  me: string;
  /** What to write over each locomotive, by id. */
  labels: ReadonlyMap<string, string>;
  /** Wall time in milliseconds, for animation. */
  now: number;
  reducedMotion?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  kind: "dot" | "ring" | "puff" | "shard" | "text" | "ghost";
  text?: string;
  spin?: number;
  angle?: number;
  sprite?: Sprite;
  /** Where a ghost wagon flies to. */
  tx?: number;
  ty?: number;
}

const MAX_PARTICLES = 900;

/**
 * What an effect is, for drawing and sounding it once: its kind, seat, moment and place, not its id. A rollback that
 * changes an earlier outcome renumbers every later effect, and the same cut must not spark twice for it.
 */
export const effectKey = (fx: {
  kind: string;
  slot: number;
  at: number;
  x: number;
  y: number;
}): string =>
  `${fx.kind}:${fx.slot}:${Math.floor(fx.at / 6)}:${Math.round(fx.x / 16)}:${Math.round(fx.y / 16)}`;

const angleOf = (x: number, y: number) => Math.atan2(y, x);
const PIXEL_FONT = "'Press Start 2P', monospace";

export function createScene(g: Paint, make: MakeSurface) {
  let backdrop: Surface | undefined;
  const sprites = createSprites(make);
  let particles: Particle[] = [];
  const seen = new Set<string>();
  let seed = -1,
    last = 0,
    shake = 0;
  const lastWagons = new Map<
    string,
    { x: number; y: number; hx: number; hy: number; kind: number }[]
  >();
  const puffAt = new Map<string, number>();
  const cartSeen = new Map<number, number>();

  const add = (p: Particle) => {
    if (particles.length < MAX_PARTICLES) particles.push(p);
  };
  const burst = (
    x: number,
    y: number,
    color: string,
    count: number,
    speed: number,
    kind: Particle["kind"] = "dot",
    life = 0.6,
  ) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2,
        s = speed * (0.35 + Math.random() * 0.65);
      add({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.4),
        max: life,
        size:
          kind === "shard" ? 2 + Math.random() * 2 : 1.5 + Math.random() * 2,
        grow: 0,
        color,
        kind,
        spin: (Math.random() - 0.5) * 12,
        angle: a,
      });
    }
  };
  const ring = (
    x: number,
    y: number,
    color: string,
    size: number,
    life = 0.45,
  ) =>
    add({
      x,
      y,
      vx: 0,
      vy: 0,
      life,
      max: life,
      size,
      grow: size * 4,
      color,
      kind: "ring",
    });
  const text = (
    x: number,
    y: number,
    value: string,
    color: string,
    size: number,
    life = 1.1,
  ) =>
    add({
      x,
      y,
      vx: 0,
      vy: -26,
      life,
      max: life,
      size,
      grow: 0,
      color,
      kind: "text",
      text: value,
    });

  function spawn(fx: FxView, world: WorldView, reduced: boolean): void {
    const color = fx.slot >= 0 ? seatColor(fx.slot) : DEPOT.lamp;
    switch (fx.kind) {
      case "collect":
        ring(fx.x, fx.y, color, 6);
        burst(fx.x, fx.y, DEPOT.brassLight, 8, 70);
        text(fx.x, fx.y - 12, "+1", color, 9, 0.8);
        break;
      case "cut": {
        burst(fx.x, fx.y, "#fff3b0", reduced ? 10 : 22, 190, "shard", 0.55);
        burst(fx.x, fx.y, "#ffb13b", 10, 120, "dot", 0.5);
        ring(fx.x, fx.y, color, 8, 0.5);
        text(
          fx.x,
          fx.y - 16,
          fx.data > 1 ? `CUT ×${fx.data}!` : "CUT!",
          color,
          11,
          1.2,
        );
        if (!reduced) shake = Math.max(shake, 5);
        break;
      }
      case "deliver": {
        const dock = DOCKS_PX[fx.other] ?? DOCKS_PX[0]!,
          tx = fx.other === 0 ? dock.left + 10 : dock.right - 10,
          ty = (dock.top + dock.bottom) / 2;
        const train = world.trains.find((t) => t.slot === fx.slot);
        const ghosts = train ? (lastWagons.get(train.id) ?? []) : [];
        ghosts.forEach((wagon, index) =>
          add({
            x: wagon.x,
            y: wagon.y,
            vx: 0,
            vy: 0,
            life: 0.45 + index * 0.06,
            max: 0.45 + index * 0.06,
            size: 1,
            grow: 0,
            color,
            kind: "ghost",
            sprite: sprites.wagon(fx.slot, wagon.kind),
            angle: angleOf(wagon.hx, wagon.hy),
            tx,
            ty,
          }),
        );
        ring(tx, ty, color, 14, 0.7);
        burst(tx, ty, DEPOT.brassLight, reduced ? 12 : 30, 160, "dot", 0.9);
        burst(tx, ty, color, 14, 110, "shard", 0.8);
        text(
          (dock.left + dock.right) / 2,
          dock.top - 34,
          `+${fx.data}`,
          color,
          fx.data >= 5 ? 20 : 15,
          1.6,
        );
        break;
      }
      case "bump":
        burst(fx.x, fx.y, "#e8ecff", 8, 90, "shard", 0.35);
        ring(fx.x, fx.y, "#e8ecff", 5, 0.3);
        if (!reduced) shake = Math.max(shake, 2.5);
        break;
      case "wall":
        for (let i = 0; i < 5; i++)
          add({
            x: fx.x,
            y: fx.y,
            vx: (Math.random() - 0.5) * 40,
            vy: (Math.random() - 0.5) * 40,
            life: 0.6,
            max: 0.6,
            size: 3,
            grow: 10,
            color: "rgba(180,170,160,0.35)",
            kind: "puff",
          });
        break;
      case "spawn":
        ring(fx.x, fx.y, DEPOT.brassLight, 5, 0.5);
        break;
      case "scrap":
        burst(fx.x, fx.y, "#8f96a8", 10, 90, "shard", 0.6);
        break;
    }
  }

  function steam(
    train: TrainView,
    now: number,
    reduced: boolean,
    moving: boolean,
  ): void {
    const next = puffAt.get(train.id) ?? 0;
    if (now < next) return;
    puffAt.set(train.id, now + (reduced ? 320 : moving ? 120 : 380));
    const cx = train.x + train.hx * 11.4,
      cy = train.y + train.hy * 11.4;
    add({
      x: cx,
      y: cy,
      vx: -train.hx * 14 + (Math.random() - 0.5) * 8,
      vy: -train.hy * 14 - 6 + (Math.random() - 0.5) * 8,
      life: 1.1,
      max: 1.1,
      size: 2.5,
      grow: 7,
      color: DEPOT.steam,
      kind: "puff",
    });
  }

  function drawCart(cart: CartView, time: number, now: number): void {
    const born = cartSeen.get(cart.id) ?? now;
    const age = Math.min(1, (now - born) / 350),
      drop = 1 + (1 - age) * 0.6,
      turn =
        (noise(cart.id, 17) - 0.5) * 1.4 +
        (cart.vx !== 0 || cart.vy !== 0 ? time / 200 : 0);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath();
    g.ellipse(cart.x + 2, cart.y + 4, 16 * drop, 11 * drop, 0, 0, Math.PI * 2);
    g.fill();
    if (cart.cool === 0) {
      const pulse = 0.5 + 0.5 * Math.sin(time / 260 + cart.id);
      g.save();
      g.globalCompositeOperation = "lighter";
      const glow = g.createRadialGradient(
        cart.x,
        cart.y,
        4,
        cart.x,
        cart.y,
        27,
      );
      glow.addColorStop(0, hexA(DEPOT.lamp, 0.22 + pulse * 0.16));
      glow.addColorStop(1, hexA(DEPOT.lamp, 0));
      g.fillStyle = glow;
      g.fillRect(cart.x - 27, cart.y - 27, 54, 54);
      g.restore();
    }
    const cooling = cart.cool > 0;
    blit(
      g,
      sprites.cart(cart.kind),
      cart.x,
      cart.y - (1 - age) * 14,
      turn,
      cooling ? 0.55 + 0.25 * Math.sin(time / 50) : 1,
      drop > 1 ? 1 + (1 - age) * 0.3 : 1,
    );
    if (cooling) {
      // The cooldown as a ring running out: nobody can couple it yet.
      g.strokeStyle = hexA("#ffffff", 0.7);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(
        cart.x,
        cart.y,
        19,
        -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * cart.cool) / CUT_COOL,
      );
      g.stroke();
    }
  }

  function drawWagons(train: TrainView, time: number): void {
    const guarded = train.guard > 0 && Math.floor(time / 70) % 2 === 0;
    for (let index = train.wagons.length - 1; index >= 0; index--) {
      const wagon = train.wagons[index]!;
      const angle = angleOf(wagon.hx, wagon.hy);
      g.fillStyle = "rgba(0,0,0,0.38)";
      g.save();
      g.translate(wagon.x + 2, wagon.y + 4);
      g.rotate(angle);
      roundRect(g, -16, -10.5, 32, 21, 5);
      g.fill();
      g.restore();
      blit(
        g,
        sprites.wagon(train.slot, wagon.kind),
        wagon.x,
        wagon.y,
        angle,
        guarded ? 0.55 : 1,
      );
    }
  }

  function drawLoco(train: TrainView, me: string): void {
    const angle = angleOf(train.hx, train.hy);
    g.save();
    g.translate(train.x + 2, train.y + 4);
    g.rotate(angle);
    g.fillStyle = "rgba(0,0,0,0.42)";
    roundRect(g, -23, -12, 48, 24, 6);
    g.fill();
    g.restore();
    if (train.id === me) {
      g.save();
      g.globalCompositeOperation = "lighter";
      const halo = g.createRadialGradient(
        train.x,
        train.y,
        8,
        train.x,
        train.y,
        30,
      );
      halo.addColorStop(0, hexA(seatColor(train.slot), 0.3));
      halo.addColorStop(1, hexA(seatColor(train.slot), 0));
      g.fillStyle = halo;
      g.fillRect(train.x - 30, train.y - 30, 60, 60);
      g.restore();
    }
    blit(g, sprites.loco(train.slot), train.x, train.y, angle);
  }

  function headlight(train: TrainView): void {
    const color = seatColor(train.slot),
      x = train.x + train.hx * 48,
      y = train.y + train.hy * 48;
    const cone = g.createRadialGradient(x, y, 2, x, y, 44);
    cone.addColorStop(0, hexA(color, 0.26));
    cone.addColorStop(0.5, hexA(color, 0.1));
    cone.addColorStop(1, hexA(color, 0));
    g.fillStyle = cone;
    g.fillRect(x - 44, y - 44, 88, 88);
  }

  function label(
    train: TrainView,
    value: string,
    me: string,
    time: number,
  ): void {
    const you = train.id === me,
      y = train.y - 29;
    g.font = `${you ? 9 : 8}px ${PIXEL_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const width = g.measureText(value).width + 8;
    g.fillStyle = "rgba(6,8,16,0.78)";
    roundRect(g, train.x - width / 2, y - 7, width, 14, 3);
    g.fill();
    g.strokeStyle = seatColor(train.slot);
    g.lineWidth = you ? 1.6 : 1;
    g.stroke();
    g.fillStyle = you ? "#ffffff" : seatColor(train.slot);
    g.fillText(value, train.x, y + 0.5);
    if (train.full) {
      const blink = Math.floor(time / 250) % 2 === 0;
      g.font = `7px ${PIXEL_FONT}`;
      g.fillStyle = blink ? DEPOT.lamp : "#fff3c4";
      g.fillText("FULL", train.x, y - 13);
    }
  }

  function tick(dt: number): void {
    for (const p of particles) {
      p.life -= dt;
      if (p.kind === "ghost" && p.tx !== undefined && p.ty !== undefined) {
        const k = Math.min(1, dt * 9);
        p.x += (p.tx - p.x) * k;
        p.y += (p.ty! - p.y) * k;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "dot" || p.kind === "shard") {
        p.vx *= 0.9;
        p.vy *= 0.9;
      }
      if (p.kind === "puff") {
        p.vx *= 0.97;
        p.vy *= 0.97;
      }
      p.size += p.grow * dt;
      if (p.spin) p.angle = (p.angle ?? 0) + p.spin * dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function drawParticles(): void {
    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.max);
      switch (p.kind) {
        case "dot":
          g.fillStyle = p.color;
          g.globalAlpha = alpha;
          g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case "shard":
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.angle ?? 0);
          g.globalAlpha = alpha;
          g.fillStyle = p.color;
          g.fillRect(-p.size, -0.8, p.size * 2, 1.6);
          g.restore();
          break;
        case "ring":
          g.globalAlpha = alpha;
          g.strokeStyle = p.color;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.stroke();
          break;
        case "puff":
          // Soft-edged: a solid core and a fainter rim, fading as it rises.
          g.fillStyle = p.color;
          g.globalAlpha = alpha * 0.16;
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = alpha * 0.22;
          g.beginPath();
          g.arc(
            p.x - p.size * 0.15,
            p.y - p.size * 0.15,
            p.size * 0.6,
            0,
            Math.PI * 2,
          );
          g.fill();
          break;
        case "ghost":
          if (p.sprite)
            blit(g, p.sprite, p.x, p.y, p.angle ?? 0, alpha, 0.6 + alpha * 0.4);
          break;
        case "text": {
          g.globalAlpha = Math.min(1, alpha * 2);
          g.font = `${p.size}px ${PIXEL_FONT}`;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.lineWidth = 3;
          g.strokeStyle = "#05060c";
          g.strokeText(p.text ?? "", p.x, p.y);
          g.fillStyle = p.color;
          g.fillText(p.text ?? "", p.x, p.y);
          break;
        }
      }
      g.globalAlpha = 1;
    }
  }

  return {
    draw(input: SceneInput): void {
      const { world, now, me } = input,
        reduced = input.reducedMotion === true,
        time = now;
      const dt = last ? Math.min(0.05, Math.max(0, (now - last) / 1000)) : 0;
      last = now;
      // A new round starts clean, and effects from before this page's first frame are history, not news.
      if (world.seed !== seed) {
        seed = world.seed;
        seen.clear();
        particles = [];
        lastWagons.clear();
        cartSeen.clear();
        for (const fx of world.fx) seen.add(effectKey(fx));
        for (const cart of world.carts) cartSeen.set(cart.id, now - 1000);
      }
      for (const fx of world.fx) {
        const key = effectKey(fx);
        if (seen.has(key) || world.step - fx.at > FX_LIFE) continue;
        seen.add(key);
        spawn(fx, world, reduced);
      }
      if (seen.size > 3000) seen.clear();
      for (const cart of world.carts)
        if (!cartSeen.has(cart.id)) cartSeen.set(cart.id, now);
      if (cartSeen.size > 400)
        for (const id of [...cartSeen.keys()])
          if (!world.carts.some((c) => c.id === id)) cartSeen.delete(id);
      tick(dt);
      const playing = world.phase === "play";
      if (playing)
        for (const train of world.trains) steam(train, now, reduced, true);
      else for (const train of world.trains) steam(train, now, reduced, false);

      g.save();
      if (shake > 0.2) {
        g.translate(
          (Math.random() - 0.5) * shake,
          (Math.random() - 0.5) * shake,
        );
        shake *= 0.86;
      } else shake = 0;
      backdrop ??= createBackdrop(make);
      g.drawImage(backdrop, 0, 0, VIEW_W, VIEW_H);
      const busy = DOCKS_PX.map((dock) =>
        world.trains.some(
          (t) =>
            t.wagons.length > 0 &&
            t.x > dock.left - 90 &&
            t.x < dock.right + 90 &&
            t.y > dock.top - 60 &&
            t.y < dock.bottom + 60,
        ),
      );
      drawDocks(g, time, world.final ? 1 : 0, busy);
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const train of world.trains) headlight(train);
      g.restore();
      for (const cart of world.carts) drawCart(cart, time, now);
      for (const train of world.trains) drawWagons(train, time);
      for (const train of world.trains) drawLoco(train, me);
      drawParticles();
      for (const train of world.trains)
        label(train, input.labels.get(train.id) ?? "", me, time);
      g.restore();
      for (const train of world.trains) lastWagons.set(train.id, train.wagons);
    },
  };
}

export { VIEW_W, VIEW_H };
