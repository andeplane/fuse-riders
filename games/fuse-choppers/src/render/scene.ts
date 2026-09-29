import type { ChopperView, WorldView } from "../engine/view.js";
import {
  EXIT_X,
  PICKUP_KINDS,
  ROCK_WARNING_STEPS,
  VIEW_H,
  VIEW_W,
  sawY,
  segmentsNear,
  terrain,
  COL,
  COLUMNS,
  type PickupKind,
} from "../engine/view-kit.js";
import { createBackdrop, drawCave, noise } from "./backdrop.js";
import {
  PICKUP_COLORS,
  PICKUP_LABELS,
  seatColor,
  seatShade,
} from "./palette.js";
import {
  chopperSprite,
  droneSprite,
  pickupSprite,
  roundRect,
  sawSprite,
  type MakeSurface,
  type Paint,
  type Sprite,
} from "./sprites.js";

/**
 * Draws one frame of a round onto a 960×540 logical canvas. Everything here is cosmetic: particles, trails,
 * wrecks and shake live in this closure and are rebuilt from the frames; nothing feeds back into the simulation.
 * Effects are spawned once per effect id, so a rollback that replays one does not draw it twice.
 */
export interface SceneInput {
  world: WorldView;
  /** This device's chopper id, if it flies one. */
  me: string;
  /** What to write over each chopper, by id. */
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
  gravity: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  kind: "dot" | "ring" | "smoke" | "shard" | "text";
  text?: string;
  spin?: number;
}

const MAX_PARTICLES = 700;
const STEP_S = 1 / 60;

export function createScene(g: Paint, make: MakeSurface) {
  const backdrop = createBackdrop(make);
  const choppers = new Map<number, Sprite>(),
    saws = new Map<number, Sprite>(),
    pickups = new Map<PickupKind, Sprite>();
  let drone: Sprite | undefined;
  const chopperFor = (slot: number) => {
    let s = choppers.get(slot);
    if (!s)
      choppers.set(
        slot,
        (s = chopperSprite(make, seatColor(slot), seatShade(slot))),
      );
    return s;
  };
  const sawFor = (r: number) => {
    let s = saws.get(r);
    if (!s) saws.set(r, (s = sawSprite(make, r)));
    return s;
  };
  const pickupFor = (kind: PickupKind) => {
    let s = pickups.get(kind);
    if (!s) pickups.set(kind, (s = pickupSprite(make, kind)));
    return s;
  };

  let particles: Particle[] = [];
  let seen = new Set<number>();
  let trails = new Map<string, { x: number; y: number }[]>();
  let seed = -1,
    last = 0,
    shake = 0,
    trailClock = 0,
    emberClock = 0;

  const add = (p: Partial<Particle> & Pick<Particle, "x" | "y">) => {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push({
      vx: 0,
      vy: 0,
      gravity: 0,
      life: 0.6,
      size: 3,
      grow: 0,
      color: "#fff",
      kind: "dot",
      ...p,
      max: p.max ?? p.life ?? 0.6,
    });
  };
  const burst = (
    x: number,
    y: number,
    count: number,
    colors: readonly string[],
    speed: number,
    options: Partial<Particle> = {},
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2,
        v = speed * (0.35 + Math.random() * 0.65);
      add({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        color: colors[i % colors.length]!,
        size: 1.5 + Math.random() * 2.5,
        life: 0.35 + Math.random() * 0.45,
        ...options,
      });
    }
  };
  const ring = (
    x: number,
    y: number,
    color: string,
    radius: number,
    life = 0.45,
    size = 3,
  ) => add({ x, y, kind: "ring", color, size, grow: radius / life, life });
  const text = (x: number, y: number, label: string, color: string) =>
    add({ x, y, vy: -38, kind: "text", text: label, color, life: 1.1 });

  function spawn(world: WorldView, me: string): void {
    for (const fx of world.fx) {
      if (seen.has(fx.id)) continue;
      seen.add(fx.id);
      // An effect far older than this frame was already on screen before a reload or rejoin: skip it.
      if (world.step - fx.at > 20) continue;
      const color = fx.slot >= 0 ? seatColor(fx.slot) : "#ffffff",
        mine = world.choppers.find((c) => c.slot === fx.slot)?.id === me;
      switch (fx.kind) {
        case "explode":
          burst(fx.x, fx.y, 40, ["#fff3b0", "#ffb13b", "#ff5a2a", color], 280, {
            gravity: 320,
          });
          burst(fx.x, fx.y, 10, ["#39405e", "#24283d"], 60, {
            kind: "smoke",
            grow: 26,
            life: 1.2,
            vy: -30,
          });
          ring(fx.x, fx.y, "#fff1c8", 70, 0.4, 4);
          ring(fx.x, fx.y, color, 110, 0.6, 2);
          text(fx.x, fx.y - 30, "CRASH!", color);
          shake = Math.max(shake, mine ? 14 : 8);
          break;
        case "hit":
          burst(fx.x, fx.y, 12, [color, "#ffffff"], 170);
          ring(fx.x, fx.y, color, 28, 0.25, 2);
          if (mine) shake = Math.max(shake, 4);
          break;
        case "shieldPop":
          ring(fx.x, fx.y, "#6cc4ff", 60, 0.45, 4);
          burst(fx.x, fx.y, 16, ["#6cc4ff", "#d6f0ff"], 200, { kind: "shard" });
          text(fx.x, fx.y - 30, "SHIELD SAVED YOU", "#8fd4ff");
          break;
        case "pickup": {
          const kind = PICKUP_KINDS[fx.data] ?? "shield",
            tint = PICKUP_COLORS[kind];
          ring(fx.x, fx.y, tint, 46, 0.4, 3);
          burst(fx.x, fx.y, 14, [tint, "#ffffff"], 120);
          text(fx.x, fx.y - 24, `+${PICKUP_LABELS[kind]}`, tint);
          break;
        }
        case "shock":
          ring(fx.x, fx.y, "#c06bff", 300, 0.55, 6);
          ring(fx.x, fx.y, "#f0d0ff", 200, 0.4, 3);
          burst(fx.x, fx.y, 24, ["#c06bff", "#ffffff"], 340);
          shake = Math.max(shake, 7);
          break;
        case "scramble":
          text(fx.x, fx.y - 30, "SCRAMBLED!", "#ff7ad2");
          ring(fx.x, fx.y, "#ff5fc8", 36, 0.4, 2);
          break;
        case "shatter":
          burst(fx.x, fx.y, 12, ["#3a1a14", "#6a2a18"], 180, {
            kind: "shard",
            gravity: 380,
          });
          burst(fx.x, fx.y, 8, ["#ff8a3a", "#ffd07a"], 140);
          break;
        case "droneDown":
          burst(fx.x, fx.y, 30, ["#fff0b0", "#ff7a3a", "#ff2a3c"], 240, {
            gravity: 260,
          });
          ring(fx.x, fx.y, "#ff5a4a", 70, 0.45, 3);
          if (fx.slot >= 0) text(fx.x, fx.y - 28, "DRONE DOWN", color);
          shake = Math.max(shake, 5);
          break;
        case "exit":
          ring(fx.x, fx.y, color, 90, 0.6, 4);
          burst(fx.x, fx.y, 30, [color, "#ffffff", "#7fe0ff"], 220);
          text(fx.x, fx.y - 34, "ESCAPED!", color);
          break;
        case "bolt":
          burst(fx.x, fx.y, 6, ["#ff4a5a", "#ffd0d0"], 90);
          break;
        case "droneHit":
          burst(fx.x, fx.y, 8, ["#ffffff", "#ff6a6a"], 140);
          break;
        case "bump":
          burst(fx.x, fx.y, 10, ["#ffffff", "#fff4a0"], 160);
          text(fx.x, fx.y - 22, "BUMP!", "#fff4a0");
          break;
        case "spark":
          burst(fx.x, fx.y, 5, [color, "#ffffff"], 90);
          break;
      }
    }
    if (seen.size > 600) seen = new Set([...seen].slice(-300));
  }

  function tick(dt: number): void {
    particles = particles.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size += p.grow * dt;
      if (p.kind !== "ring") {
        p.vx *= 0.985;
        p.vy *= p.gravity ? 1 : 0.985;
      }
      return true;
    });
    shake *= Math.pow(0.02, dt);
    if (shake < 0.2) shake = 0;
  }

  function draw(input: SceneInput): void {
    const { world, now } = input,
      time = now / 1000,
      dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (world.seed !== seed) {
      seed = world.seed;
      particles = [];
      trails = new Map();
      seen = new Set(world.fx.map((fx) => fx.id));
    }
    spawn(world, input.me);
    tick(dt);
    const camX = world.camX;
    g.save();
    if (shake && !input.reducedMotion)
      g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    backdrop.draw(g, camX, time);
    drawCave(g, world.seed, camX);
    drawExit(g, camX, time);
    drawPlatforms(g, world, time);
    drawSaws(g, world, time);
    drawPickups(g, world, time);
    trailClock += dt;
    const sample = trailClock >= 1 / 24;
    if (sample) trailClock = 0;
    for (const chopper of world.choppers)
      drawChopper(g, world, chopper, input, time, sample);
    drawDrones(g, world, time);
    drawShots(g, world);
    drawRocks(g, world, time);
    drawParticles(g, camX);
    emberClock += dt;
    drawCrush(g, world, time, emberClock > 0.03);
    if (emberClock > 0.03) emberClock = 0;
    g.restore();
    danger(g, world, input.me, time);
  }

  function drawPlatforms(g: Paint, world: WorldView, time: number): void {
    for (const part of segmentsNear(
      world.seed,
      world.camX - 60,
      world.camX + VIEW_W + 60,
    ))
      for (const p of part.platforms) {
        const x = p.x - world.camX;
        if (x > VIEW_W + 10 || x + p.w < -10) continue;
        g.beginPath();
        g.moveTo(x, p.y + 5);
        g.lineTo(x + 5, p.y);
        g.lineTo(x + p.w - 5, p.y);
        g.lineTo(x + p.w, p.y + 5);
        g.lineTo(x + p.w - 2, p.y + p.h * 0.6);
        const teeth = Math.max(3, Math.round(p.w / 16));
        for (let i = 1; i < teeth; i++) {
          const tx = x + p.w - (i / teeth) * p.w,
            drop = noise(p.x, i) * 9;
          g.lineTo(tx, p.y + p.h + drop - 2);
        }
        g.lineTo(x + 2, p.y + p.h * 0.6);
        g.closePath();
        const rock = g.createLinearGradient(0, p.y, 0, p.y + p.h + 8);
        rock.addColorStop(0, "#2a3368");
        rock.addColorStop(0.4, "#161b44");
        rock.addColorStop(1, "#080a22");
        g.fillStyle = rock;
        g.fill();
        g.strokeStyle = "#0a0c20";
        g.lineWidth = 2;
        g.stroke();
        // The landing pad: a lit steel plate says you can set down here.
        g.fillStyle = "#34478f";
        g.fillRect(x + 6, p.y - 3, p.w - 12, 5);
        g.save();
        g.shadowColor = "#7fb2ff";
        g.shadowBlur = 8;
        g.fillStyle = "#b8d2ff";
        g.fillRect(x + 6, p.y - 3, p.w - 12, 1.5);
        g.restore();
        for (let lx = x + 10; lx < x + p.w - 6; lx += 28) {
          const on = (Math.floor(time * 2 + lx * 0.05) & 1) === 0;
          g.fillStyle = on ? "#ffc46a" : "#8a5a22";
          g.beginPath();
          g.arc(lx, p.y + 6, 2, 0, Math.PI * 2);
          g.fill();
        }
      }
  }

  function drawSaws(g: Paint, world: WorldView, time: number): void {
    const { top, bottom } = terrain(world.seed);
    const edgeAt = (edge: Int16Array, x: number) => {
      const c = Math.max(0, Math.min(COLUMNS - 2, Math.floor(x / COL))),
        f = (x - c * COL) / COL;
      return edge[c]! + (edge[c + 1]! - edge[c]!) * f;
    };
    for (const part of segmentsNear(
      world.seed,
      world.camX - 60,
      world.camX + VIEW_W + 60,
    ))
      for (const saw of part.saws) {
        const x = saw.x - world.camX;
        if (x < -60 || x > VIEW_W + 60) continue;
        const y = sawY(saw, Math.floor(world.step)),
          ceiling = edgeAt(top, saw.x),
          floor = edgeAt(bottom, saw.x);
        g.strokeStyle = "#1c2552";
        g.lineWidth = 4;
        g.beginPath();
        if (saw.amp) {
          g.moveTo(x, saw.y - saw.amp - saw.r);
          g.lineTo(x, saw.y + saw.amp + saw.r);
        } else if (y - ceiling < floor - y) {
          g.moveTo(x, ceiling);
          g.lineTo(x, y);
        } else {
          g.moveTo(x, floor);
          g.lineTo(x, y);
        }
        g.stroke();
        const s = sawFor(saw.r);
        g.save();
        g.translate(x, y);
        g.rotate(world.step * 0.3);
        g.drawImage(s.surface, -s.ox, -s.oy, s.width, s.height);
        g.restore();
        const pulse = 0.7 + 0.3 * Math.sin(time * 6 + saw.x);
        const eye = g.createRadialGradient(x, y, 0, x, y, saw.r * 0.55);
        eye.addColorStop(0, `rgba(255,220,220,${pulse})`);
        eye.addColorStop(0.3, `rgba(255,40,60,${pulse})`);
        eye.addColorStop(1, "rgba(255,40,60,0)");
        g.fillStyle = eye;
        g.beginPath();
        g.arc(x, y, saw.r * 0.55, 0, Math.PI * 2);
        g.fill();
      }
  }

  function drawPickups(g: Paint, world: WorldView, time: number): void {
    for (const p of world.pickups) {
      const x = p.x - world.camX;
      if (x < -30 || x > VIEW_W + 30) continue;
      const bob = Math.sin(time * 3 + p.id) * 3,
        s = pickupFor(p.kind);
      const halo = g.createRadialGradient(x, p.y + bob, 4, x, p.y + bob, 30);
      halo.addColorStop(0, hexA(PICKUP_COLORS[p.kind], 0.35));
      halo.addColorStop(1, hexA(PICKUP_COLORS[p.kind], 0));
      g.fillStyle = halo;
      g.fillRect(x - 30, p.y + bob - 30, 60, 60);
      g.drawImage(s.surface, x - s.ox, p.y + bob - s.oy, s.width, s.height);
    }
  }

  function drawChopper(
    g: Paint,
    world: WorldView,
    c: ChopperView,
    input: SceneInput,
    time: number,
    sample: boolean,
  ): void {
    const color = seatColor(c.slot),
      x = c.x - world.camX;
    let trail = trails.get(c.id);
    if (!trail) trails.set(c.id, (trail = []));
    if (c.state === "flying" && sample) {
      trail.push({ x: c.x - 22 * c.face, y: c.y + 2 });
      if (trail.length > 24) trail.shift();
    } else if (c.state !== "flying" && sample && trail.length) trail.shift();
    // The dotted neon trail streaming behind.
    g.save();
    g.globalCompositeOperation = "lighter";
    trail.forEach((point, i) => {
      const k = (i + 1) / trail!.length;
      g.fillStyle = hexA(color, 0.08 + k * 0.55);
      g.beginPath();
      g.arc(point.x - world.camX, point.y, 1 + k * 2.2, 0, Math.PI * 2);
      g.fill();
    });
    g.restore();

    if (c.state === "escaped") return;
    const sprite = chopperFor(c.slot);
    if (c.state === "crashed") {
      const since = Math.max(0, world.step - c.endedAt) * STEP_S;
      if (since > 4) return;
      const { bottom } = terrain(world.seed),
        column = Math.max(0, Math.min(COLUMNS - 1, Math.round(c.x / COL))),
        floor = bottom[column]! - 8,
        y = Math.min(floor, c.y + 0.5 * 700 * since * since),
        landed = y >= floor;
      if (Math.random() < 0.5)
        add({
          x: c.x + (Math.random() - 0.5) * 16,
          y,
          vy: -40,
          kind: "smoke",
          color: "#2c3048",
          size: 4,
          grow: 20,
          life: 0.9,
        });
      if (!landed && Math.random() < 0.6)
        add({
          x: c.x,
          y,
          vx: (Math.random() - 0.5) * 60,
          vy: -20,
          color: "#ff8a3a",
          size: 2.5,
          life: 0.4,
        });
      g.save();
      g.translate(x, y);
      g.rotate(landed ? 0.5 * c.face : since * 7 * c.face);
      g.scale(c.face, 1);
      g.globalAlpha = Math.max(0, 1 - Math.max(0, since - 2.5) / 1.5);
      g.filter = "grayscale(0.7) brightness(0.55)";
      g.drawImage(
        sprite.surface,
        -sprite.ox,
        -sprite.oy,
        sprite.width,
        sprite.height,
      );
      g.restore();
      return;
    }

    const wobble =
        c.stun > 0 ? Math.sin(time * 28) * 0.22 * Math.min(1, c.stun / 20) : 0,
      tilt =
        Math.max(-0.35, Math.min(0.35, c.vx * c.face * 0.09 + c.vy * 0.025)) +
        wobble;
    const flicker = c.grace > 0 && Math.floor(time * 20) % 2 === 0;
    g.save();
    g.translate(x, c.y);
    // Turbo flames from the tail.
    if (c.turbo > 0) {
      g.save();
      g.scale(c.face, 1);
      g.globalCompositeOperation = "lighter";
      const length = 16 + Math.random() * 10;
      const flame = g.createLinearGradient(-34, 0, -34 - length, 0);
      flame.addColorStop(0, "rgba(140,255,170,0.9)");
      flame.addColorStop(1, "rgba(60,255,120,0)");
      g.fillStyle = flame;
      g.beginPath();
      g.moveTo(-32, -4);
      g.lineTo(-34 - length, 0);
      g.lineTo(-32, 3);
      g.fill();
      g.restore();
    }
    if (c.shield) {
      const pulse = 0.55 + 0.25 * Math.sin(time * 5);
      const bubble = g.createRadialGradient(0, 0, 18, 0, 0, 34);
      bubble.addColorStop(0, "rgba(80,170,255,0)");
      bubble.addColorStop(0.8, `rgba(80,170,255,${pulse * 0.35})`);
      bubble.addColorStop(1, `rgba(160,220,255,${pulse})`);
      g.fillStyle = bubble;
      g.beginPath();
      g.arc(0, 0, 34, 0, Math.PI * 2);
      g.fill();
    }
    g.save();
    g.scale(c.face, 1);
    g.rotate(tilt);
    if (flicker) g.globalAlpha = 0.35;
    g.drawImage(
      sprite.surface,
      -sprite.ox,
      -sprite.oy,
      sprite.width,
      sprite.height,
    );
    // Main rotor: a blur disc and two blade pairs, spinning harder under lift.
    const spin = time * (c.lifting ? 46 : 32) + c.slot;
    g.fillStyle = "rgba(220,235,255,0.2)";
    g.beginPath();
    g.ellipse(1, -16, 32, 2.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(232,240,255,0.9)";
    g.lineWidth = 2;
    g.lineCap = "round";
    for (const phase of [0, Math.PI / 2]) {
      const reach = 32 * Math.cos(spin + phase);
      g.beginPath();
      g.moveTo(1 - reach, -16);
      g.lineTo(1 + reach, -16);
      g.stroke();
    }
    // Tail rotor.
    g.fillStyle = "rgba(220,235,255,0.25)";
    g.beginPath();
    g.arc(-33, -4, 5.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(232,240,255,0.85)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-33 + Math.cos(spin * 1.4) * 5.5, -4 + Math.sin(spin * 1.4) * 5.5);
    g.lineTo(-33 - Math.cos(spin * 1.4) * 5.5, -4 - Math.sin(spin * 1.4) * 5.5);
    g.stroke();
    // Triple shot: the gun crackles.
    if (c.triple > 0) {
      g.fillStyle = Math.random() < 0.5 ? "#ffe56b" : "#ffffff";
      g.beginPath();
      g.arc(22 + Math.random() * 3, 5, 1.5 + Math.random() * 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // Stunned: stars circling the rotor mast.
    if (c.stun > 0)
      for (let i = 0; i < 3; i++) {
        const angle = time * 7 + (i * Math.PI * 2) / 3;
        star(g, Math.cos(angle) * 16, -22 + Math.sin(angle) * 5, 3, "#fff27a");
      }
    if (c.scramble > 0) {
      g.fillStyle = "#ff6fcf";
      g.font = "bold 14px 'Press Start 2P', monospace";
      g.textAlign = "center";
      g.fillText("?", Math.sin(time * 6) * 6, -30);
    }
    // The label, like the concept's "P1 ▼".
    const label = input.labels.get(c.id) ?? `P${c.slot + 1}`,
      mine = c.id === input.me;
    g.font = "10px 'Press Start 2P', monospace";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.lineWidth = 3;
    g.strokeStyle = "#05060f";
    g.strokeText(label, 0, -34);
    g.fillStyle = mine ? "#ffffff" : color;
    g.fillText(label, 0, -34);
    // At GO: a chopper whose pilot has not touched lift yet hovers, and says what to do.
    if (c.hovering && mine) {
      g.globalAlpha = 0.6 + 0.4 * Math.sin(time * 9);
      g.fillStyle = "#ffe34a";
      g.strokeText(
        world.lift === "classic" ? "HOLD TO FLY!" : "W TO FLY UP",
        0,
        -48,
      );
      g.fillText(
        world.lift === "classic" ? "HOLD TO FLY!" : "W TO FLY UP",
        0,
        -48,
      );
      g.globalAlpha = 1;
    }
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-4, -30);
    g.lineTo(4, -30);
    g.lineTo(0, -25);
    g.closePath();
    g.fill();
    g.restore();
  }

  function drawDrones(g: Paint, world: WorldView, time: number): void {
    drone ??= droneSprite(make);
    for (const d of world.drones) {
      const x = d.x - world.camX;
      if (x < -50 || x > VIEW_W + 50) continue;
      g.save();
      g.translate(x, d.y);
      g.rotate(Math.sin(time * 2 + d.id) * 0.06);
      g.drawImage(
        drone.surface,
        -drone.ox,
        -drone.oy,
        drone.width,
        drone.height,
      );
      const spin = time * 40 + d.id;
      g.strokeStyle = "rgba(255,200,200,0.8)";
      g.lineWidth = 2;
      for (const phase of [0, Math.PI / 2]) {
        const reach = 26 * Math.cos(spin + phase);
        g.beginPath();
        g.moveTo(-reach, -16);
        g.lineTo(reach, -16);
        g.stroke();
      }
      // The eye: brighter, then blazing while it charges a shot.
      const charge = d.charge > 0 ? 1 - d.charge / 36 : 0,
        radius = 4 + charge * 7;
      const eye = g.createRadialGradient(-10, -2, 0, -10, -2, radius * 2.4);
      eye.addColorStop(0, "#ffffff");
      eye.addColorStop(0.25, "#ff3040");
      eye.addColorStop(1, "rgba(255,30,50,0)");
      g.fillStyle = eye;
      g.beginPath();
      g.arc(-10, -2, radius * 2.4, 0, Math.PI * 2);
      g.fill();
      for (let hp = 0; hp < d.hp; hp++) {
        g.fillStyle = "#ff5a6a";
        g.fillRect(-9 + hp * 7, 16, 5, 2);
      }
      g.restore();
    }
  }

  function drawShots(g: Paint, world: WorldView): void {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const b of world.bullets) {
      const x = b.x - world.camX,
        angle = Math.atan2(b.vy, b.vx - world.scroll),
        color = seatColor(b.slot);
      g.save();
      g.translate(x, b.y);
      g.rotate(angle);
      const tail = g.createLinearGradient(-28, 0, 0, 0);
      tail.addColorStop(0, hexA(color, 0));
      tail.addColorStop(1, hexA(color, 0.9));
      g.strokeStyle = tail;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-28, 0);
      g.lineTo(0, 0);
      g.stroke();
      g.fillStyle = "#ffffff";
      roundRect(g, -6, -2.2, 12, 4.4, 2);
      g.fill();
      g.fillStyle = "#ff4a3a";
      g.fillRect(4, -1.5, 3, 3);
      g.restore();
    }
    for (const b of world.bolts) {
      const x = b.x - world.camX,
        angle = Math.atan2(b.vy, b.vx - world.scroll);
      g.save();
      g.translate(x, b.y);
      g.rotate(angle);
      g.strokeStyle = "rgba(255,40,60,0.8)";
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(-14, 0);
      g.lineTo(6, 0);
      g.stroke();
      g.strokeStyle = "#ffe0e0";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-10, 0);
      g.lineTo(6, 0);
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  function drawRocks(g: Paint, world: WorldView, time: number): void {
    const edge = world.crushX - world.camX;
    // Warnings: the crush zone glows and draws the line the rock will take.
    for (const w of world.warnings) {
      const left = Math.max(0, w.at - world.step),
        k = 1 - left / ROCK_WARNING_STEPS,
        pulse = 0.5 + 0.5 * Math.sin(time * 18);
      g.save();
      g.globalAlpha = 0.35 + 0.65 * pulse;
      g.strokeStyle = "#ff3b4e";
      g.setLineDash([8, 8]);
      g.lineDashOffset = -time * 60;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(edge + 34, w.y);
      g.lineTo(edge + 34 + 90 + k * 110, w.y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#ff3b4e";
      g.beginPath();
      g.moveTo(edge + 22, w.y - 13);
      g.lineTo(edge + 36, w.y + 11);
      g.lineTo(edge + 8, w.y + 11);
      g.closePath();
      g.fill();
      g.fillStyle = "#1a0208";
      g.font = "bold 13px 'Press Start 2P', monospace";
      g.textAlign = "center";
      g.fillText("!", edge + 22, w.y + 9);
      g.restore();
    }
    for (const r of world.rocks) {
      const x = r.x - world.camX;
      if (x < -40 || x > VIEW_W + 40) continue;
      const rvx = r.vx - world.scroll;
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 1; i <= 5; i++) {
        g.fillStyle = `rgba(255,${110 - i * 12},40,${0.24 - i * 0.04})`;
        g.beginPath();
        g.arc(
          x - rvx * i * 3,
          r.y - r.vy * i * 3,
          r.r * (1 - i * 0.12),
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      g.restore();
      g.save();
      g.translate(x, r.y);
      g.rotate(world.step * 0.08 + r.id);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2,
          reach = r.r * (0.8 + noise(r.id, i) * 0.35);
        g.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
      }
      g.closePath();
      const molten = g.createRadialGradient(
        -r.r * 0.3,
        -r.r * 0.3,
        1,
        0,
        0,
        r.r * 1.1,
      );
      molten.addColorStop(0, "#ffd77a");
      molten.addColorStop(0.35, "#ff6a2a");
      molten.addColorStop(0.7, "#7a1c10");
      molten.addColorStop(1, "#2a0906");
      g.fillStyle = molten;
      g.shadowColor = "#ff5a2a";
      g.shadowBlur = 14;
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "#1a0503";
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }
  }

  function drawParticles(g: Paint, camX: number): void {
    g.save();
    for (const p of particles) {
      const x = p.x - camX,
        k = Math.max(0, p.life / p.max);
      if (x < -120 || x > VIEW_W + 120) continue;
      switch (p.kind) {
        case "ring":
          g.globalCompositeOperation = "lighter";
          g.strokeStyle = hexA(p.color, k);
          g.lineWidth = 3 * k + 0.5;
          g.beginPath();
          g.arc(x, p.y, p.size, 0, Math.PI * 2);
          g.stroke();
          break;
        case "smoke":
          g.globalCompositeOperation = "source-over";
          g.fillStyle = hexA(p.color, 0.5 * k);
          g.beginPath();
          g.arc(x, p.y, p.size, 0, Math.PI * 2);
          g.fill();
          break;
        case "text":
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = Math.min(1, k * 2);
          g.font = "11px 'Press Start 2P', monospace";
          g.textAlign = "center";
          g.lineWidth = 3;
          g.strokeStyle = "#05060f";
          g.strokeText(p.text ?? "", x, p.y);
          g.fillStyle = p.color;
          g.fillText(p.text ?? "", x, p.y);
          g.globalAlpha = 1;
          break;
        case "shard":
          g.globalCompositeOperation = "source-over";
          g.fillStyle = hexA(p.color, k);
          g.fillRect(x - p.size, p.y - p.size / 2, p.size * 2, p.size);
          break;
        default:
          g.globalCompositeOperation = "lighter";
          g.fillStyle = hexA(p.color, k);
          g.beginPath();
          g.arc(x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
          g.fill();
      }
    }
    g.restore();
  }

  function drawCrush(
    g: Paint,
    world: WorldView,
    time: number,
    emit: boolean,
  ): void {
    const edge = world.crushX - world.camX;
    if (edge < -60) return;
    const jag = (y: number) =>
      Math.sin(y * 0.045 + time * 3.1) * 7 +
      Math.sin(y * 0.13 - time * 5.3) * 4 +
      (noise(Math.floor(y / 18), 91) - 0.5) * 10;
    // The glowing haze in front of the wall.
    const haze = g.createLinearGradient(edge, 0, edge + 110, 0);
    haze.addColorStop(0, "rgba(255,30,90,0.34)");
    haze.addColorStop(1, "rgba(255,30,90,0)");
    g.fillStyle = haze;
    g.fillRect(edge, 0, 110, VIEW_H);
    // The wall.
    g.beginPath();
    g.moveTo(-20, -20);
    for (let y = -20; y <= VIEW_H + 20; y += 18) g.lineTo(edge + jag(y), y);
    g.lineTo(-20, VIEW_H + 20);
    g.closePath();
    const body = g.createLinearGradient(edge - 320, 0, edge, 0);
    body.addColorStop(0, "#14020b");
    body.addColorStop(0.65, "#4a0620");
    body.addColorStop(1, "#8e0c38");
    g.fillStyle = body;
    g.fill();
    // Tumbling molten boulders inside it.
    g.save();
    g.clip();
    const count = Math.min(60, Math.max(8, Math.ceil(edge / 26) * 6));
    for (let i = 0; i < count; i++) {
      const column = i % 6,
        x = edge - 18 - column * 32 - noise(i, 92) * 14,
        speed = 16 + (i % 3) * 9,
        y =
          ((((i * 71 + time * speed * (column % 2 ? -1 : 1)) % 640) + 640) %
            640) -
          50,
        size = 10 + noise(i, 93) * 17;
      if (x < -30) continue;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * Math.PI * 2 + time * 0.4 * (i % 2 ? 1 : -1),
          reach = size * (0.75 + noise(i, k) * 0.4);
        g.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
      }
      g.closePath();
      g.fillStyle = "#1f030d";
      g.fill();
      g.strokeStyle = `rgba(255,${60 + (i % 4) * 30},90,${0.55 + 0.4 * Math.sin(time * 4 + i)})`;
      g.lineWidth = 1.6;
      g.stroke();
    }
    // Chevrons pointing the way the wall moves.
    for (let row = 0; row < 3; row++) {
      const cy = 120 + row * 160,
        cx = edge - 58;
      if (cx < 10) break;
      for (let k = 0; k < 2; k++) {
        const phase = (time * 2.2 - k * 0.3 - row * 0.15) % 1,
          alpha = 0.35 + 0.65 * Math.max(0, Math.sin(phase * Math.PI));
        g.strokeStyle = `rgba(255,90,130,${alpha})`;
        g.lineWidth = 6;
        g.lineJoin = "miter";
        g.beginPath();
        g.moveTo(cx + k * 18 - 8, cy - 16);
        g.lineTo(cx + k * 18 + 6, cy);
        g.lineTo(cx + k * 18 - 8, cy + 16);
        g.stroke();
      }
    }
    // The warning sign, once the wall is wide enough to carry it.
    if (edge > 170) {
      const sx = edge - 150,
        sy = 212;
      g.shadowColor = "#ff2050";
      g.shadowBlur = 16;
      g.fillStyle = "rgba(38,2,14,0.88)";
      g.strokeStyle = "#ff4466";
      g.lineWidth = 2.5;
      roundRect(g, sx, sy, 112, 104, 8);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = "#ff4466";
      g.beginPath();
      g.moveTo(sx + 56, sy + 10);
      g.lineTo(sx + 70, sy + 34);
      g.lineTo(sx + 42, sy + 34);
      g.closePath();
      g.fill();
      g.fillStyle = "#26020e";
      g.font = "bold 12px 'Press Start 2P', monospace";
      g.textAlign = "center";
      g.fillText("!", sx + 56, sy + 32);
      g.fillStyle = "#ffe0e6";
      g.font = "bold italic 17px 'Arial Black', Impact, sans-serif";
      g.fillText("CRUSH", sx + 56, sy + 56);
      g.fillText("ZONE", sx + 56, sy + 74);
      g.fillStyle = "#ff8aa0";
      g.font = "7px 'Press Start 2P', monospace";
      g.fillText("MOVING RIGHT!", sx + 56, sy + 92);
    }
    g.restore();
    // The burning edge.
    g.beginPath();
    for (let y = -20; y <= VIEW_H + 20; y += 18) g.lineTo(edge + jag(y), y);
    g.save();
    g.shadowColor = "#ff1450";
    g.shadowBlur = 22;
    g.strokeStyle = "#ff3b5c";
    g.lineWidth = 6;
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = "#ffd9b0";
    g.lineWidth = 2;
    g.stroke();
    g.restore();
    if (emit)
      add({
        x: world.crushX + jag(0) + Math.random() * 6,
        y: Math.random() * VIEW_H,
        vx: 40 + Math.random() * 80 + world.scroll * 60,
        vy: -20 - Math.random() * 40,
        color: Math.random() < 0.5 ? "#ff7a3a" : "#ff3b8a",
        size: 1.2 + Math.random() * 1.8,
        life: 0.5 + Math.random() * 0.6,
      });
  }

  /** A red pulse at the left of the screen when this device's chopper nears the crush zone. */
  function danger(g: Paint, world: WorldView, me: string, time: number): void {
    const mine = world.choppers.find(
      (c) => c.id === me && c.state === "flying",
    );
    if (!mine) return;
    const gap = mine.x - world.crushX;
    if (gap > 160) return;
    const k = (1 - Math.max(0, gap) / 160) * (0.6 + 0.4 * Math.sin(time * 10));
    const vignette = g.createLinearGradient(0, 0, 260, 0);
    vignette.addColorStop(0, `rgba(255,20,60,${0.45 * k})`);
    vignette.addColorStop(1, "rgba(255,20,60,0)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, 260, VIEW_H);
  }

  return { draw };
}

function drawExit(g: Paint, camX: number, time: number): void {
  const x = EXIT_X - camX;
  if (x > VIEW_W + 220 || x < -200) return;
  // The finish curtain.
  g.save();
  g.globalCompositeOperation = "lighter";
  const beam = g.createLinearGradient(x - 26, 0, x + 26, 0);
  beam.addColorStop(0, "rgba(40,200,255,0)");
  beam.addColorStop(
    0.5,
    `rgba(90,220,255,${0.45 + 0.15 * Math.sin(time * 6)})`,
  );
  beam.addColorStop(1, "rgba(40,200,255,0)");
  g.fillStyle = beam;
  g.fillRect(x - 26, 0, 52, VIEW_H);
  g.strokeStyle = "rgba(200,245,255,0.7)";
  g.lineWidth = 1;
  for (let y = (time * 90) % 24; y < VIEW_H; y += 24) {
    g.beginPath();
    g.moveTo(x - 10, y);
    g.lineTo(x + 10, y);
    g.stroke();
  }
  g.restore();
  // Beyond the gate: open daylight blue.
  const out = g.createLinearGradient(x, 0, x + 260, 0);
  out.addColorStop(0, "rgba(60,160,255,0.15)");
  out.addColorStop(1, "rgba(120,210,255,0.3)");
  g.fillStyle = out;
  g.fillRect(x, 0, 400, VIEW_H);
  // The sign, as in the concept: EXIT with running chevrons, on a steel mast.
  const sx = x + 22,
    sy = 360;
  g.fillStyle = "#16204d";
  g.fillRect(sx + 60, sy + 70, 10, VIEW_H - sy);
  g.save();
  g.shadowColor = "#34c8ff";
  g.shadowBlur = 18;
  g.fillStyle = "rgba(6,20,52,0.9)";
  g.strokeStyle = "#5fd8ff";
  g.lineWidth = 3;
  roundRect(g, sx, sy, 130, 72, 8);
  g.fill();
  g.stroke();
  g.fillStyle = "#9ff0ff";
  g.font = "bold italic 30px 'Arial Black', Impact, sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText("EXIT", sx + 12, sy + 37);
  g.restore();
  for (let k = 0; k < 3; k++) {
    const alpha =
      0.3 + 0.7 * Math.max(0, Math.sin((time * 3 - k * 0.35) * Math.PI));
    g.strokeStyle = `rgba(120,230,255,${alpha})`;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(sx + 92 + k * 11, sy + 24);
    g.lineTo(sx + 102 + k * 11, sy + 36);
    g.lineTo(sx + 92 + k * 11, sy + 48);
    g.stroke();
  }
}

function star(g: Paint, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2,
      reach = i % 2 === 0 ? r : r * 0.4;
    g.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
  }
  g.closePath();
  g.fill();
}

/** `#rrggbb` with an alpha, as an rgba() string. */
export function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

export { VIEW_W, VIEW_H };
