import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACK,
  JUMP,
  createWorld,
  spawnEnemy,
  spawnMount,
  step,
  toView,
  type World,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import type { HeroKind, MountAnim, MountKind } from "../src/engine/view.js";
import {
  CLAWBEAK,
  DRAKE_STEPS,
  HERO_KINDS,
  MOUNT_KINDS,
  flamePx,
} from "../src/engine/view-kit.js";
import {
  MOUNT_ANIMS,
  heroFrame,
  mountFrame,
  riderFrame,
  type HeroFrame,
} from "../src/render/art/animate.js";
import { BRAKKA_POSES } from "../src/render/art/brakka.js";
import { GORM_POSES } from "../src/render/art/gorm.js";
import { HEROES } from "../src/render/art/index.js";
import { RHEA_POSES } from "../src/render/art/rhea.js";
import { MOUNT_ART } from "../src/render/scene.js";
import type { HeroPose } from "../src/render/pixel/head.js";
import { CLEAR, type Sprite } from "../src/render/pixel/sprite.js";

const { px } = T;
const RIDES = ["ride", "ridewindup", "rideattack", "ridehop"] as const;
const POSES: Readonly<Record<HeroKind, Readonly<Record<HeroFrame, HeroPose>>>> =
  { brakka: BRAKKA_POSES, rhea: RHEA_POSES, gorm: GORM_POSES };
/** The keys of each hero's near foot, which goes in the stirrup: Brakka's and Rhea's leather, Gorm's iron. */
const FOOT: Readonly<Record<HeroKind, RegExp>> = {
  brakka: /[Ll9]/,
  rhea: /[Ll9]/,
  gorm: /[Ii#]/,
};
/**
 * What a hero's beast of each kind does with it on its back (the engine's: a clawbeak sweeps its tail, a drake
 * breathes, neither the other's), and the frame of its rider for each frame of the beast's that is not a plain sit.
 */
const RIDDEN: Readonly<
  Record<
    MountKind,
    {
      anims: readonly MountAnim[];
      says: Readonly<Record<string, HeroFrame>>;
    }
  >
> = {
  clawbeak: {
    anims: ["idle", "walk", "sweep", "hop"],
    says: {
      coil1: "ridewindup",
      coil2: "ridewindup",
      lash: "rideattack",
      recover: "rideattack",
      leap: "ridehop",
      drop: "ridehop",
    },
  },
  drake: {
    anims: ["idle", "walk", "breathe", "hop"],
    says: {
      ...{ inhale1: "ridewindup", inhale2: "ridewindup" },
      ...{ blast0: "rideattack", blast1: "rideattack" },
      ...{ leap: "ridehop", drop: "ridehop" },
    },
  },
};
/** The frames a beast of `kind` shows with a hero on it. */
const ridden = (kind: MountKind) =>
  new Set(
    RIDDEN[kind].anims.flatMap((anim) =>
      MOUNT_ANIMS[kind][anim]!.frames.map(([frame]) => frame),
    ),
  );
const pixel = (s: Sprite, dx: number, dy: number) =>
  s.rows[s.ay + dy]?.[s.ax + dx] ?? CLEAR;
/** The runs of painted pixels along a sprite's anchor row, outline aside: one per foot on it. */
const feet = (s: Sprite) =>
  s.rows[s.ay]!.replaceAll("k", CLEAR).split(CLEAR).filter(Boolean).length;

test("every hero sits astride a beast: hips on the seat, the far leg out of sight, the near boot in the stirrup, on every frame a ridden beast of either kind shows", () => {
  for (const hero of HERO_KINDS) {
    const figure = HEROES[hero].figure;
    assert.equal(feet(figure.sprite("idle0")), 2, `${hero} stands on two`);
    for (const ride of RIDES) {
      const pose = POSES[hero][ride];
      const rider = figure.sprite(ride);
      const label = `${hero} ${ride}`;
      assert.equal(pose.astride, true, label);
      assert.equal(feet(rider), 1, `${label}: astride, one boot shows`);
      // Where the hips sit over the anchor, which the scene sets on the saddle point.
      const hips = [
        (pose.far.hip[0] + pose.near.hip[0]) / 2 - pose.anchor[0],
        (pose.far.hip[1] + pose.near.hip[1]) / 2 - pose.anchor[1],
      ];
      for (const kind of MOUNT_KINDS)
        for (const frame of ridden(kind)) {
          const art = MOUNT_ART[kind];
          const beast = art.figure.sprite(frame);
          const dip = art.dips[frame] ?? 0;
          // The beast's pixel (dx, dy) from the saddle point, as the scene lays a rider's anchor on it.
          const at = (dx: number, dy: number) =>
            pixel(beast, dx, dy - CLAWBEAK.saddle + dip);
          // The seat's top: the highest leather over the saddle point; the seat, the leather along that row.
          const top = Math.min(
            ...Array.from({ length: 30 }, (_, i) => -i - 1).filter((dy) =>
              /[Ll9]/.test(at(0, dy)),
            ),
          );
          const seat = Array.from({ length: 21 }, (_, i) => i - 10).filter(
            (dx) => /[Ll9]/.test(at(dx, top)),
          );
          const where = `${label} on a ${kind}'s ${frame}: hips ${hips} over seat ${top}`;
          assert.ok(hips[1]! >= top - 2 && hips[1]! <= top + 1, where);
          assert.ok(
            hips[0]! >= Math.min(...seat) && hips[0]! <= Math.max(...seat),
            where,
          );
          // The stirrup's brass hangs where the near boot goes, which hides it.
          const brass = [-1, 0].flatMap((dy) =>
            [3, 4, 5].filter((dx) => /[Nn8]/.test(at(dx, dy))),
          );
          assert.ok(brass.length > 0, `${where}: no stirrup`);
          assert.match(pixel(rider, 4, -1), FOOT[hero], where);
        }
    }
  }
});

test("a rider braces while its beast winds up its blow (a tail coiling, a drake inhaling), strikes from the step it lands to the blow's end, crouches through a hop and otherwise sits", () => {
  for (const kind of MOUNT_KINDS) {
    const { anims, says } = RIDDEN[kind];
    for (const anim of anims)
      for (let animStep = 0; animStep < 100; animStep++) {
        const frame = mountFrame(kind, anim, animStep);
        assert.equal(
          riderFrame(anim, animStep),
          says[frame] ?? "ride",
          `${kind} ${anim} ${animStep} ${frame}`,
        );
      }
  }
  // A drake's breath: braced through the inhale, pointing from the step the flame is out to the breath's end.
  const flames = Array.from({ length: DRAKE_STEPS.breathe }, (_, i) => riderFrame("breathe", i)); // prettier-ignore
  assert.deepEqual(flames, [
    ...Array<HeroFrame>(DRAKE_STEPS.inhale).fill("ridewindup"),
    ...Array<HeroFrame>(DRAKE_STEPS.breathe - DRAKE_STEPS.inhale).fill("rideattack"), // prettier-ignore
  ]);
  // No hero thrusts a lance (the captain's, an enemy's, is `enemyRiderFrame`'s), and a riderless beast's anims have no
  // rider: each sits, at any step.
  for (const anim of ["lance", "enter", "flee", "wander", "leave"] as const)
    for (const animStep of [0, 1, 23, 24, 35, 36, 80, 1e6])
      assert.equal(riderFrame(anim, animStep), "ride", `${anim} ${animStep}`);
  // It never throws: an odd step rounds down to a whole one from 0, and an anim with no case sits.
  for (const odd of [-3, -0.5, Number.NaN, Infinity])
    for (const anim of ["sweep", "breathe"] as const)
      assert.equal(riderFrame(anim, odd), "ridewindup", `${anim} ${odd}`);
  assert.equal(riderFrame("sweep", 20.9), "rideattack");
  assert.equal(riderFrame("sweep", 19.9), "ridewindup");
  assert.equal(riderFrame("breathe", DRAKE_STEPS.inhale + 0.9), "rideattack");
  assert.equal(riderFrame("breathe", DRAKE_STEPS.inhale - 0.1), "ridewindup");
  const gallop: string = "gallop";
  assert.equal(riderFrame(gallop as MountAnim, 9), "ride");
  assert.equal(riderFrame("constructor" as MountAnim, 9), "ride");
  assert.equal(riderFrame("__proto__" as MountAnim, 9), "ride");
  // A rider whose beast is not in the view sits too.
  for (const kind of HERO_KINDS)
    for (const animStep of [0, 31, 1e6, Number.NaN])
      assert.equal(heroFrame(kind, "ride", animStep), "ride");
});

/** A hero who has climbed on a beast (a clawbeak, or a `drake`) beside it, the view's frames for it from then on. */
const boarded = (kind: HeroKind, beast: MountKind = "clawbeak"): World => {
  const start = createWorld({ seed: 3, heroes: [{ seat: 0, kind }] });
  const { x, y } = start.heroes[0]!;
  const world = step(spawnMount(start, x + px(10), y, 0, beast), [JUMP]);
  assert.equal(world.heroes[0]!.state, "ride");
  return world;
};
const riding = (world: World) => {
  const view = toView(world);
  const mount = view.mounts.find((each) => each.rider?.kind === "hero")!;
  return riderFrame(mount.anim, mount.animStep);
};

test("in the engine a rider braces until its beast's tail lands, strikes from that very step, and crouches while the beast is in the air", () => {
  for (const kind of HERO_KINDS) {
    let world = boarded(kind);
    const { x, y } = world.heroes[0]!;
    world = spawnEnemy(world, "ravager", x + px(24), y);
    const full = world.enemies[0]!.hp;
    world = step(world, [ATTACK]);
    const shown: HeroFrame[] = [];
    let landed = -1;
    for (let i = 0; i < 60 && world.mounts[0]!.state === "sweep"; i++) {
      shown.push(riding(world));
      if (landed < 0 && world.enemies[0]!.hp < full) landed = i;
      world = step(world, []);
    }
    assert.ok(landed > 0, `${kind}: the tail landed`);
    assert.deepEqual(
      shown,
      [
        ...Array<HeroFrame>(landed).fill("ridewindup"),
        ...Array<HeroFrame>(shown.length - landed).fill("rideattack"),
      ],
      kind,
    );
    assert.equal(riding(world), "ride", `${kind} sits once the sweep is over`);
    // A hop: crouched on every step the beast is off the floor, sitting again once it lands.
    world = boarded(kind);
    world = step(step(world, []), [JUMP]);
    let aloft = 0;
    for (; world.mounts[0]!.state === "hop"; world = step(world, [])) {
      assert.equal(riding(world), "ridehop", kind);
      aloft += world.mounts[0]!.z > 0 ? 1 : 0;
    }
    assert.ok(aloft > 10, `${kind} hopped`);
    assert.equal(riding(world), "ride", kind);
  }
});

test("in the engine a rider on a drake braces through the inhale, points from the step the flame is out to the breath's end, and sits again after", () => {
  for (const kind of HERO_KINDS) {
    let world = boarded(kind, "drake");
    assert.equal(world.mounts[0]!.kind, "drake");
    assert.equal(riding(world), "ride", `${kind} sits before the breath`);
    world = step(world, [ATTACK]);
    const shown: HeroFrame[] = [];
    for (let i = 0; i < 200 && world.mounts[0]!.state === "breathe"; i++) {
      // The rider points exactly while the view has the flame out in front of the drake.
      const { animStep } = toView(world).mounts[0]!;
      assert.equal(riding(world) === "rideattack", flamePx(animStep) > 0, `${kind} ${animStep}`); // prettier-ignore
      shown.push(riding(world));
      world = step(world, []);
    }
    assert.deepEqual(
      shown,
      [
        ...Array<HeroFrame>(DRAKE_STEPS.inhale).fill("ridewindup"),
        ...Array<HeroFrame>(DRAKE_STEPS.breathe - DRAKE_STEPS.inhale).fill("rideattack"), // prettier-ignore
      ],
      kind,
    );
    assert.equal(riding(world), "ride", `${kind} sits once the breath is over`);
    // A hop on a drake crouches the rider as on a clawbeak.
    world = step(step(boarded(kind, "drake"), []), [JUMP]);
    for (; world.mounts[0]!.state === "hop"; world = step(world, []))
      assert.equal(riding(world), "ridehop", kind);
    assert.equal(riding(world), "ride", kind);
  }
});
