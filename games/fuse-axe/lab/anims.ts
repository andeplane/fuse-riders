/**
 * Dev-only, below the sprite sheet: for each enemy and beast, every frame packed on one floor in each palette swap,
 * then its anims playing at the simulation's 60 steps a second in the swap picked above them. A one-shot anim holds its
 * last frame for a moment, then plays again. Then the Ogre twins, a ravager riding a clawbeak, the lancer captain on
 * his ember drake, the heroes riding clawbeaks and ember drakes and the bonewalkers at a grave in the real scene, and
 * last the floor items at 6×, 3× and 1×.
 */
import type {
  EnemyAnim,
  EnemyView,
  HeroView,
  MountAnim,
  MountKind,
  MountView,
  Tier,
  WorldView,
} from "../src/engine/view.js";
import {
  BONEWALKER_STEPS,
  CLAWBEAK,
  CLAWBEAK_STEPS,
  DRAKE_STEPS,
  ENEMY_KINDS,
  MOUNT_KINDS,
  OGRE_STEPS,
  VIEW_H,
  VIEW_W,
  gravesPx,
} from "../src/engine/view-kit.js";
import {
  ENEMY_ANIMS,
  MOUNT_ANIMS,
  type AnimStrip,
} from "../src/render/art/animate.js";
import { POT } from "../src/render/art/pot.js";
import type { Figure } from "../src/render/pixel/kit.js";
import type { Palette } from "../src/render/pixel/palette.js";
import {
  createSpriteBaker,
  type MakeSurface,
} from "../src/render/pixel/surface.js";
import { createScene, ENEMY_ART, MOUNT_ART } from "../src/render/scene.js";

interface Animated {
  readonly name: string;
  readonly figure: Figure;
  readonly anims: Readonly<Record<string, AnimStrip<string>>>;
}
const ANIMATED: readonly Animated[] = [
  ...ENEMY_KINDS.map((kind) => ({ ...ENEMY_ART[kind], anims: ENEMY_ANIMS[kind], name: kind })), // prettier-ignore
  // A tier with a figure of its own (the bonewalker's knight) plays its kind's anims.
  ...ENEMY_KINDS.flatMap((kind) => Object.entries(ENEMY_ART[kind].figures ?? {}).map(([tier, figure]) => ({ figure, anims: ENEMY_ANIMS[kind], name: `${kind} · tier ${tier}` }))), // prettier-ignore
  ...MOUNT_KINDS.map((kind) => ({ ...MOUNT_ART[kind], anims: MOUNT_ANIMS[kind], name: kind })), // prettier-ignore
];

const canvas = (width: number, height: number) => {
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  const paint = image.getContext("2d");
  if (!paint) throw new Error("This browser has no 2D canvas");
  paint.imageSmoothingEnabled = false;
  return { image, paint };
};
const makeSurface: MakeSurface<HTMLCanvasElement> = canvas;
const baker = createSpriteBaker(makeSurface);
const SCALE = 3;
const PAD = 3;
const STEP_MS = 1000 / 60;
/** Steps a one-shot anim rests on its last frame before it plays again. */
const REST = 30;

/** The frame an anim shows `step` steps in: a loop wraps, a one-shot holds its last frame, then starts over. */
function frameAt({ frames, loop }: AnimStrip<string>, step: number): string {
  const length = frames.reduce((sum, [, steps]) => sum + steps, 0);
  let t = step % (loop ? length : length + REST);
  for (const [frame, steps] of frames) {
    if (t < steps) return frame;
    t -= steps;
  }
  return frames.at(-1)![0];
}

const main = document.querySelector("main")!;
const players: (() => void)[] = [];
let start = 0;
let step = 0;

/** Every frame side by side on one floor, in each swap: a figure's whole set at a glance. */
function strips({ name, figure }: Animated, up: number, down: number) {
  const sprites = figure.frames.map((frame) => figure.sprite(frame));
  const width = sprites.reduce((sum, s) => sum + s.w + PAD * 2, 0);
  const height = up + down + 1 + PAD * 2;
  const section = document.createElement("section");
  section.append(document.createElement("h2"));
  section.firstElementChild!.textContent = `${name} · every frame in every swap`;
  for (const swap of ["", ...Object.keys(figure.swaps)]) {
    const strip = canvas(width * 2, (height + 6) * 2);
    const { paint } = strip;
    paint.fillStyle = "#281e34";
    paint.fillRect(0, 0, width * 2, (height + 6) * 2);
    paint.fillStyle = "#16e7ff55";
    paint.fillRect(0, (PAD + up + 1) * 2, width * 2, 1);
    paint.font = "9px ui-monospace, monospace";
    let x = 0;
    figure.frames.forEach((frame, i) => {
      const palette = figure.swaps[swap];
      const baked = baker.bake(sprites[i]!, palette ? { swap: palette } : {});
      const left = (x + PAD) * 2;
      const top = (PAD + up - baked.ay) * 2;
      paint.drawImage(baked.image, left, top, baked.w * 2, baked.h * 2);
      paint.fillStyle = "#d8c8e8";
      paint.fillText(frame, left, (height + 5) * 2);
      x += baked.w + PAD * 2;
    });
    const cell = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = swap || "base";
    cell.append(caption, strip.image);
    section.append(cell);
  }
  main.append(section);
}

for (const animated of ANIMATED) {
  const { name, figure, anims } = animated;
  const sprites = figure.frames.map((frame) => figure.sprite(frame));
  const side = Math.max(...sprites.map((s) => Math.max(s.ax, s.w - 1 - s.ax)));
  const up = Math.max(...sprites.map((s) => s.ay));
  const down = Math.max(...sprites.map((s) => s.h - 1 - s.ay));
  const [cw, ch] = [side * 2 + 1 + PAD * 2, up + down + 1 + PAD * 2];
  strips(animated, up, down);
  const section = document.createElement("section");
  const title = document.createElement("h2");
  title.textContent = `${name} · anims `;
  const pick = document.createElement("select");
  for (const swap of ["", ...Object.keys(figure.swaps)])
    pick.append(new Option(swap || "base", swap));
  title.append(pick);
  const row = document.createElement("div");
  row.className = "row";
  section.append(title, row);
  for (const [anim, strip] of Object.entries(anims)) {
    const view = canvas(cw * SCALE, ch * SCALE);
    const caption = document.createElement("figcaption");
    const cell = document.createElement("figure");
    cell.append(caption, view.image);
    row.append(cell);
    let shown = "";
    let swap: Palette | undefined;
    players.push(() => {
      const frame = frameAt(strip, step);
      const picked = figure.swaps[pick.value];
      if (frame === shown && picked === swap) return;
      [shown, swap] = [frame, picked];
      caption.textContent = `${anim} — ${frame}`;
      const baked = baker.bake(figure.sprite(frame), swap ? { swap } : {});
      const { paint } = view;
      paint.clearRect(0, 0, cw * SCALE, ch * SCALE);
      paint.fillStyle = "#16e7ff55";
      paint.fillRect(0, (PAD + up + 1) * SCALE, cw * SCALE, 1);
      paint.drawImage(
        baked.image,
        (PAD + side - baked.ax) * SCALE,
        (PAD + up - baked.ay) * SCALE,
        baked.w * SCALE,
        baked.h * SCALE,
      );
    });
  }
  main.append(section);
}

// The Ogre twins in the real scene at 2×: the green one idles, winds up, slams and stands open on a loop, its
// shockwave cracking the floor; the red one is enraged, burning and steaming as it stands.
{
  const section = document.createElement("section");
  section.append(document.createElement("h2"));
  section.firstElementChild!.textContent =
    "ogre twins · the scene's slam, shockwave and rage";
  const native = canvas(VIEW_W, VIEW_H);
  const shown = canvas(VIEW_W * 2, VIEW_H * 2);
  const scene = createScene<HTMLCanvasElement>((w, h) => {
    const surface = canvas(w, h);
    const putPixels = (rgba: Uint8ClampedArray<ArrayBuffer>) =>
      surface.paint.putImageData(new ImageData(rgba, w, h), 0, 0);
    return { ...surface, putPixels };
  });
  const loop: readonly (readonly [EnemyAnim, number])[] = [
    ["idle", 30],
    ["windup", OGRE_STEPS.windup],
    ["slam", OGRE_STEPS.slam],
    ["recover", OGRE_STEPS.recover],
  ];
  const total = loop.reduce((sum, [, steps]) => sum + steps, 0);
  const twin = (more: Partial<EnemyView>): EnemyView => ({
    ...{ id: 1, kind: "ogre", tier: 0, x: 70, y: 150, z: 0, facing: 1 },
    ...{ anim: "idle", animStep: 0, hp: 150, maxHp: 150, flash: false },
    ...{ boss: true, enraged: false, mounted: false },
    ...more,
  });
  players.push(() => {
    let [anim, animStep] = loop[0]!;
    let t = step % total;
    for (const [a, steps] of loop) {
      [anim, animStep] = [a, t];
      if (t < steps) break;
      t -= steps;
    }
    const view: WorldView = {
      ...{ step, stage: 1, camX: 0, heroes: [], fx: [], items: [], spells: [] },
      mounts: [],
      camp: false,
      enemies: [
        twin({ anim, animStep }),
        twin({ id: 2, tier: 1, x: 260, y: 128, facing: -1, enraged: true }),
      ],
      ...{ wave: 5, waves: 6, locked: true, go: false, cleared: false },
      ...{
        defeated: false,
        boss: { kind: "ogre", hp: 150, maxHp: 300 },
        sigils: [],
      },
    };
    scene.draw(native.paint, view, step);
    shown.paint.drawImage(native.image, 0, 0, VIEW_W * 2, VIEW_H * 2);
  });
  section.append(shown.image);
  main.append(section);

  // A rust ravager riding a clawbeak walks, stands, winds its tail up (blinking) and lashes on a loop; a riderless one
  // behind it bolts, wanders and walks off.
  const riding = document.createElement("section");
  riding.append(document.createElement("h2"));
  riding.firstElementChild!.textContent =
    "clawbeak · a rider astride, the wind-up's blink and the lash";
  const [still, big] = [canvas(VIEW_W, VIEW_H), canvas(VIEW_W * 2, VIEW_H * 2)];
  type Loop = readonly (readonly [MountAnim, number])[];
  const ridden: Loop = [["walk", 60], ["idle", 40], ["sweep", CLAWBEAK_STEPS.sweep], ["idle", 30]]; // prettier-ignore
  const loose: Loop = [["flee", CLAWBEAK_STEPS.panic], ["wander", 2 * CLAWBEAK_STEPS.turn], ["leave", 40]]; // prettier-ignore
  const playing = (loop: Loop, at = step) => {
    let t = at % loop.reduce((sum, [, steps]) => sum + steps, 0);
    for (const [anim, steps] of loop) {
      if (t < steps) return { anim, animStep: t };
      t -= steps;
    }
    return { anim: loop[0]![0], animStep: 0 };
  };
  const beast = (id: number, x: number, y: number, facing: 1 | -1) =>
    ({ id, kind: "clawbeak", x, y, z: 0, facing, rider: null }) as const;
  players.push(() => {
    const view: WorldView = {
      ...{ step, stage: 1, camX: 0, heroes: [], fx: [], items: [], spells: [] },
      mounts: [
        { ...beast(8, 90, 126, 1), ...playing(loose) },
        { ...beast(9, 200, 150, -1), ...playing(ridden), rider: { kind: "enemy", id: 2 } }, // prettier-ignore
      ],
      camp: false,
      enemies: [
        {
          ...{ id: 2, kind: "ravager", tier: 1, x: 200, y: 150, facing: -1 },
          ...{ z: CLAWBEAK.saddle, anim: "ride", animStep: step, hp: 8 },
          ...{ maxHp: 8, flash: false, boss: false, enraged: false },
          mounted: true,
        },
      ],
      ...{ wave: 2, waves: 5, locked: true, go: false, cleared: false },
      ...{ defeated: false, boss: null, sigils: [] },
    };
    scene.draw(still.paint, view, step);
    big.paint.drawImage(still.image, 0, 0, VIEW_W * 2, VIEW_H * 2);
  });
  riding.append(big.image);
  main.append(riding);

  // The lancer captain on his ember drake on Wyrmbone Pass: he sits it walking and standing, draws his spear back
  // through the saddle thrust's wind-up and drives it out from the step it lands, and sits through its breath.
  const boss = document.createElement("section");
  boss.append(document.createElement("h2"));
  boss.firstElementChild!.textContent =
    "drake · the captain astride: the saddle thrust's wind-up and thrust, the breath";
  const [bossStill, bossBig] = [canvas(VIEW_W, VIEW_H), canvas(VIEW_W * 2, VIEW_H * 2)]; // prettier-ignore
  const reign: Loop = [["walk", 60], ["idle", 30], ["lance", DRAKE_STEPS.lance], ["idle", 30], ["breathe", DRAKE_STEPS.breathe], ["idle", 30]]; // prettier-ignore
  players.push(() => {
    const view: WorldView = {
      ...{ step, stage: 2, camX: 0, heroes: [], fx: [], items: [], spells: [] },
      mounts: [{ ...beast(9, 190, 146, -1), kind: "drake", ...playing(reign), rider: { kind: "enemy", id: 2 } }], // prettier-ignore
      camp: false,
      enemies: [
        {
          ...{ id: 2, kind: "captain", tier: 2, x: 190, y: 146, facing: -1 },
          ...{ z: CLAWBEAK.saddle, anim: "ride", animStep: step, hp: 90 },
          ...{ maxHp: 90, flash: false, boss: true, enraged: false },
          mounted: true,
        },
      ],
      ...{ wave: 5, waves: 6, locked: true, go: false, cleared: false },
      ...{ defeated: false, boss: { kind: "captain", hp: 90, maxHp: 90 } },
      sigils: [],
    };
    scene.draw(bossStill.paint, view, step);
    bossBig.paint.drawImage(bossStill.image, 0, 0, VIEW_W * 2, VIEW_H * 2);
  });
  boss.append(bossBig.image);
  main.append(boss);

  // Brakka, Rhea and Gorm astride a clawbeak each, then astride an ember drake each, a third of a loop apart: each
  // beast stands, walks, strikes its blow (a tail's sweep, a drake's breath: its rider bracing through the wind-up,
  // then pointing) and hops (its rider crouched), the hop's arc a parabola to the engine's rise.
  const rise = CLAWBEAK_STEPS.hopRise;
  const rides: readonly (readonly [MountKind, string, Loop])[] = [
    ["clawbeak", "the heroes astride: sitting, the sweep's brace and strike, the hop", [["idle", 40], ["walk", 60], ["sweep", CLAWBEAK_STEPS.sweep], ["idle", 20], ["hop", 2 * rise], ["idle", 20]]], // prettier-ignore
    ["drake", "the heroes astride: sitting, the inhale's brace, the flame's point, the hop", [["idle", 40], ["walk", 60], ["breathe", DRAKE_STEPS.breathe], ["idle", 20], ["hop", 2 * rise], ["idle", 20]]], // prettier-ignore
  ];
  const kinds = ["brakka", "rhea", "gorm"] as const;
  for (const [mount, title, ride] of rides) {
    const heroes = document.createElement("section");
    heroes.append(document.createElement("h2"));
    heroes.firstElementChild!.textContent = `${mount} · ${title}`;
    const [native2, big2] = [canvas(VIEW_W, VIEW_H), canvas(VIEW_W * 2, VIEW_H * 2)]; // prettier-ignore
    const length = ride.reduce((sum, [, steps]) => sum + steps, 0);
    players.push(() => {
      const mounts: MountView[] = [];
      const riders: HeroView[] = [];
      kinds.forEach((kind, i) => {
        const t = step + Math.round((i * length) / kinds.length);
        const { anim, animStep } = playing(ride, t);
        const z = anim === "hop" ? Math.round(26 * (1 - ((animStep - rise) / rise) ** 2)) : 0; // prettier-ignore
        const [x, y, facing] = [70 + 90 * i, 128 + 14 * (i % 2), i === 1 ? -1 : 1] as const; // prettier-ignore
        mounts.push({ ...beast(10 + i, x, y, facing), kind: mount, z, anim, animStep, rider: { kind: "hero", id: i + 1 } }); // prettier-ignore
        riders.push({
          ...{ id: i + 1, seat: i, kind, x, y, z: z + CLAWBEAK.saddle, facing },
          ...{ anim: "ride", animStep: step, hp: 16, maxHp: 16, lives: 3 },
          ...{ invulnerable: false, pots: 1, maxPots: 4, charge: 0 },
          mounted: true,
        });
      });
      const view: WorldView = {
        ...{ step, stage: 1, camX: 0, heroes: riders, fx: [], items: [], spells: [] }, // prettier-ignore
        ...{ mounts, camp: false, enemies: [] },
        ...{ wave: 2, waves: 5, locked: false, go: false, cleared: false },
        ...{ defeated: false, boss: null, sigils: [] },
      };
      scene.draw(native2.paint, view, step);
      big2.paint.drawImage(native2.image, 0, 0, VIEW_W * 2, VIEW_H * 2);
    });
    heroes.append(big2.image);
    main.append(heroes);
  }

  // Bonewalkers on the Drowned Crypt: one claws up out of the first grave, stands, winds up and slashes; a rust one's
  // bone pile lies, twitches and pulls itself together; the violet knight lurches in, winds up and slashes.
  const crypt = document.createElement("section");
  crypt.append(document.createElement("h2"));
  crypt.firstElementChild!.textContent =
    "bonewalkers · the rise from a grave, the pile's twitch and reassembly, the knight's slash";
  const [native3, big3] = [canvas(VIEW_W, VIEW_H), canvas(VIEW_W * 2, VIEW_H * 2)]; // prettier-ignore
  const [gx, gy] = gravesPx(3)[0]!;
  const B = BONEWALKER_STEPS;
  type Plan = readonly (readonly [EnemyAnim, number])[];
  const swing = (tier: Tier): Plan => [["windup", B.windup[tier]], ["attack", B.attack], ["recover", B.recover]]; // prettier-ignore
  const bones: readonly (readonly [Tier, number, number, Plan])[] = [
    [0, gx, gy, [["rise", B.rise], ["idle", 30], ...swing(0), ["idle", 20]]],
    [1, gx - 70, gy + 22, [["pile", B.pile], ["reassemble", B.reassemble], ["idle", 30]]], // prettier-ignore
    [2, gx + 80, gy + 12, [["walk", 48], ...swing(2), ["idle", 30]]],
  ];
  const now = (plan: Plan) => {
    let t = step % plan.reduce((sum, [, steps]) => sum + steps, 0);
    for (const [anim, steps] of plan) {
      if (t < steps) return { anim, animStep: t };
      t -= steps;
    }
    return { anim: plan[0]![0], animStep: 0 };
  };
  players.push(() => {
    const enemies = bones.map(([tier, x, y, plan], i): EnemyView => ({
      ...{ id: i + 1, kind: "bonewalker", tier, x, y, z: 0 },
      ...{ facing: i === 2 ? -1 : 1, hp: 8, maxHp: 8, flash: false },
      ...{ boss: false, enraged: false, mounted: false, ...now(plan) },
    }));
    const view: WorldView = {
      ...{ step, stage: 3, camX: gx - 120, heroes: [], fx: [], items: [] },
      ...{ spells: [], mounts: [], camp: false, enemies },
      ...{ wave: 1, waves: 6, locked: true, go: false, cleared: false },
      ...{ defeated: false, boss: null, sigils: [] },
    };
    scene.draw(native3.paint, view, step);
    big3.paint.drawImage(native3.image, 0, 0, VIEW_W * 2, VIEW_H * 2);
  });
  crypt.append(big3.image);
  main.append(crypt);
}

{
  const section = document.createElement("section");
  section.append(document.createElement("h2"));
  section.firstElementChild!.textContent = `pot · ${POT.w}×${POT.h} at 6×, 3× and 1×`;
  const baked = baker.bake(POT);
  const [w, h] = [baked.w * 10 + PAD * 8, baked.h * 6 + PAD * 2];
  const items = canvas(w, h);
  let x = PAD;
  for (const scale of [6, 3, 1]) {
    const [bw, bh] = [baked.w * scale, baked.h * scale];
    items.paint.drawImage(baked.image, x, h - PAD - bh, bw, bh);
    x += bw + PAD * 3;
  }
  section.append(items.image);
  main.append(section);
}

const tick = (now: number) => {
  start ||= now;
  step = Math.floor((now - start) / STEP_MS);
  for (const play of players) play();
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
