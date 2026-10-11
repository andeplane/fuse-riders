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
import type { HeroKind, MountAnim } from "../src/engine/view.js";
import { CLAWBEAK, HERO_KINDS, MOUNT_STATES } from "../src/engine/view-kit.js";
import {
  heroFrame,
  mountFrame,
  riderFrame,
  type HeroFrame,
} from "../src/render/art/animate.js";
import { BRAKKA_POSES } from "../src/render/art/brakka.js";
import {
  CLAWBEAK_ANIMS,
  CLAWBEAK_DIPS,
  CLAWBEAK_FIGURE,
  type ClawbeakFrame,
} from "../src/render/art/clawbeak.js";
import { GORM_POSES } from "../src/render/art/gorm.js";
import { HEROES } from "../src/render/art/index.js";
import { RHEA_POSES } from "../src/render/art/rhea.js";
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
/** The frames a beast shows with a hero on it: it stands, walks, sweeps its tail and hops. */
const RIDDEN = new Set(
  (["idle", "walk", "sweep", "hop"] as const).flatMap((anim) =>
    CLAWBEAK_ANIMS[anim].frames.map(([frame]) => frame),
  ),
);
const pixel = (s: Sprite, dx: number, dy: number) =>
  s.rows[s.ay + dy]?.[s.ax + dx] ?? CLEAR;
/** The runs of painted pixels along a sprite's anchor row, outline aside: one per foot on it. */
const feet = (s: Sprite) =>
  s.rows[s.ay]!.replaceAll("k", CLEAR).split(CLEAR).filter(Boolean).length;

test("every hero sits astride a beast: hips on the seat, the far leg out of sight, the near boot in the stirrup, on every frame a ridden beast shows", () => {
  for (const kind of HERO_KINDS) {
    const figure = HEROES[kind].figure;
    assert.equal(feet(figure.sprite("idle0")), 2, `${kind} stands on two`);
    for (const ride of RIDES) {
      const pose = POSES[kind][ride];
      const rider = figure.sprite(ride);
      const label = `${kind} ${ride}`;
      assert.equal(pose.astride, true, label);
      assert.equal(feet(rider), 1, `${label}: astride, one boot shows`);
      // Where the hips sit over the anchor, which the scene sets on the saddle point.
      const hips = [
        (pose.far.hip[0] + pose.near.hip[0]) / 2 - pose.anchor[0],
        (pose.far.hip[1] + pose.near.hip[1]) / 2 - pose.anchor[1],
      ];
      for (const frame of RIDDEN) {
        const beast = CLAWBEAK_FIGURE.sprite(frame);
        const dip = CLAWBEAK_DIPS[frame as ClawbeakFrame];
        // The beast's pixel (dx, dy) from the saddle point, as the scene lays a rider's anchor on it.
        const at = (dx: number, dy: number) =>
          pixel(beast, dx, dy - CLAWBEAK.saddle + dip);
        // The seat's top: the highest leather over the saddle point; the seat, the leather along that row.
        const top = Math.min(
          ...Array.from({ length: 30 }, (_, i) => -i - 1).filter((dy) =>
            /[Ll9]/.test(at(0, dy)),
          ),
        );
        const seat = Array.from({ length: 21 }, (_, i) => i - 10).filter((dx) =>
          /[Ll9]/.test(at(dx, top)),
        );
        const where = `${label} on ${frame}: hips ${hips} over seat ${top}`;
        assert.ok(hips[1]! >= top - 2 && hips[1]! <= top + 1, where);
        assert.ok(
          hips[0]! >= Math.min(...seat) && hips[0]! <= Math.max(...seat),
          where,
        );
        // The stirrup's brass hangs where the near boot goes, which hides it.
        const brass = [-1, 0].flatMap((dy) =>
          [3, 4, 5].filter((dx) => /[Nn8]/.test(at(dx, dy))),
        );
        assert.ok(brass.length > 0, `${frame} has no stirrup`);
        assert.match(pixel(rider, 4, -1), FOOT[kind], where);
      }
    }
  }
});

test("a rider braces while its beast's tail coils, strikes from the lash to the sweep's end, crouches through a hop and otherwise sits", () => {
  const beastSays: Readonly<Record<string, HeroFrame>> = {
    coil1: "ridewindup",
    coil2: "ridewindup",
    lash: "rideattack",
    recover: "rideattack",
    leap: "ridehop",
    drop: "ridehop",
  };
  for (const anim of MOUNT_STATES)
    for (let animStep = 0; animStep < 80; animStep++) {
      const frame = mountFrame("clawbeak", anim, animStep);
      assert.equal(
        riderFrame(anim, animStep),
        beastSays[frame] ?? "ride",
        `${anim} ${animStep} ${frame}`,
      );
    }
  // It never throws: an odd step rounds down to a whole one from 0, and an anim with no case sits.
  for (const odd of [-3, -0.5, Number.NaN, Infinity])
    assert.equal(riderFrame("sweep", odd), "ridewindup");
  assert.equal(riderFrame("sweep", 20.9), "rideattack");
  const gallop: string = "gallop";
  assert.equal(riderFrame(gallop as MountAnim, 9), "ride");
  // A rider whose beast is not in the view sits too.
  for (const kind of HERO_KINDS)
    for (const animStep of [0, 31, 1e6, Number.NaN])
      assert.equal(heroFrame(kind, "ride", animStep), "ride");
});

/** A hero who has climbed on a clawbeak beside it, the view's frames for it from then on. */
const boarded = (kind: HeroKind): World => {
  const start = createWorld({ seed: 3, heroes: [{ seat: 0, kind }] });
  const { x, y } = start.heroes[0]!;
  const world = step(spawnMount(start, x + px(10), y), [JUMP]);
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
