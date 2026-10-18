/**
 * The three.js battlefield: a heightmapped desert built once per match, a sun with soft shadows, a tilted RTS camera
 * and instanced procedural models (`models.ts`). It reads a `WorldView` and interpolates
 * positions between two frames for display only; nothing here writes to the simulation.
 */
import * as THREE from "three";
import {
  SUB,
  TILE_PX,
  type BuildingKind,
  type UnitKind,
  type UnitView,
  type HeroView,
  type WorldView,
} from "../engine/view.js";
import { EventDedupe, type StampedEvent } from "../render/cues.js";
import {
  NO_OVERLAY,
  TARGET_HEX,
  TargetPulse,
  type Overlay,
  type Renderer,
} from "../render/renderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Batch } from "./instances.js";
import { FX_LAYER, FxLayer } from "./effects3d.js";
import {
  QualityGovernor,
  cuesOf,
  type Cue,
  type CueContext,
  type Quality,
} from "./fx.js";
import { Look, addRim, desertSky } from "./post.js";
import {
  HERO_KINDS,
  RING,
  approachAngle,
  bob,
  heroKindOf,
  buildingModel,
  paintMaterials,
  ruinModel,
  unitModel,
  waveCloth,
  type BuildingModel,
  type Model,
  type ModelKind,
  type Paint,
} from "./models.js";
import * as rig from "./rig.js";
import {
  WATER_Y,
  DECK_Y,
  hash,
  distanceTo,
  heightAt,
  heightField,
  wet,
  normalMap,
  standY,
  terrainBuffers,
  terrainChunks,
  resFor,
  BIG_MAP,
  tileNoise,
  type HeightField,
} from "./terrain.js";

const TILE = SUB * TILE_PX;
const TEAM_HEX = [0xd8402a, 0x3a6ae0];
const NEUTRAL_HEX = 0x9a948a,
  WRECK_HEX = 0x2e2824,
  SELF_HEX = 0xf8d030;
const rgb = (hex: number) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b] as const;
};
const TEAM_RGB = TEAM_HEX.map(rgb);
const NEUTRAL_RGB = rgb(NEUTRAL_HEX);
const teamRgb = (team: number) => TEAM_RGB[team] ?? NEUTRAL_RGB;
const TARGET_RGB = rgb(TARGET_HEX);
const SELF_RGB = rgb(SELF_HEX),
  BAR_BACK = rgb(0x101010),
  [GOOD, FAIR, POOR] = [0x6ad83a, 0xf8d030, 0xe8483c].map(rgb);
const UNIT_MODELS: readonly ModelKind[] = [
  "grunt",
  "torch",
  "lightTank",
  "sentry",
  "tankTurret",
  ...HERO_KINDS,
];
/** Turns per millisecond for a tank turret or a turret head swinging onto its aim. */
const SLEW = 0.004;
/** Steps a gun keeps its aim after its last shot. */
const AIM_HOLD = 80;
/** Effects waiting for the next frame at most; a burst past it (a long stall) drops the rest. */
const MAX_PENDING = 512;
/** Heroes draw a size up from their models so they stand over the line at the default zoom. */
const HERO_SCALE = 1.25;

/** One mesh of a slot: a part of its model; only team-painted parts take the per-instance colour. */
interface SlotPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  tinted: boolean;
  mesh?: THREE.InstancedMesh;
}

/** One batch of instances drawn by every part of a model, all sharing the batch's matrices and colours. */
interface Slot {
  batch: Batch;
  parts: SlotPart[];
  shadow: boolean;
  order: number;
  matrices?: THREE.InstancedBufferAttribute;
  colors?: THREE.InstancedBufferAttribute;
}

interface BuildingNode {
  alive: THREE.Group;
  ruin: THREE.Group;
  team: THREE.Mesh[];
  pivot?: THREE.Group;
  aims: boolean;
  puffs: THREE.Mesh[];
  height: number;
}

/** A tiling, mipmapped DataTexture of linear data (a normal map). */
function dataTexture(data: Uint8Array, size: number) {
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = tex.needsUpdate = true;
  tex.anisotropy = 4;
  return tex;
}

export class Field3D implements Renderer {
  follow = true;
  overlay: Overlay = NO_OVERLAY;
  private readonly pulse = new TargetPulse();
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(rig.FOV, 1, 0.5, 200);
  private readonly sun = new THREE.DirectionalLight(0xffe0b0, 3.2);
  private readonly rig: rig.Rig = { x: 0, z: 0, distance: rig.START };
  private readonly dedupe = new EventDedupe();
  private readonly fx = new FxLayer();
  private readonly look: Look;
  private readonly governor: QualityGovernor;
  /** The newest world drawn and its units by id, for placing effects. */
  private latest: WorldView | undefined;
  private readonly unitsNow = new Map<number, UnitView>();
  private readonly pending: Cue[] = [];
  /** Lives as long as the renderer: unit bodies, team materials, textures. */
  private readonly owned: { dispose(): void }[] = [];
  /** Lives for one match: the ground, water, rocks, bridges, buildings and flags. */
  private match: { dispose(): void }[] = [];
  private readonly matchGroup = new THREE.Group();
  private matchId = "";
  private field: HeightField | undefined;
  /** The ground's chunks (`terrainChunks`), culled one by one. */
  private ground: THREE.Mesh[] = [];
  private buildings: BuildingNode[] = [];
  private flags: THREE.Mesh[] = [];
  private readonly slots = new Map<string, Slot>();
  private readonly slotList: Slot[] = [];
  private readonly teamMat: THREE.MeshStandardMaterial[];
  private readonly neutralMat: THREE.MeshStandardMaterial;
  private readonly wreckMat: THREE.MeshStandardMaterial;
  private readonly paints: Record<Paint, THREE.MeshStandardMaterial>;
  private readonly buildingModels = new Map<
    BuildingKind,
    BuildingModel & { ruins: Model[] }
  >();
  private readonly cloth = new THREE.PlaneGeometry(0.7, 0.45, 10, 1).translate(
    0.35,
    1.35,
    0,
  );
  private readonly clothBase = Float32Array.from(
    this.cloth.getAttribute("position").array,
  );
  private readonly puffGeo = new THREE.IcosahedronGeometry(0.12, 1);
  private readonly puffMat = new THREE.MeshStandardMaterial({
    color: 0x4a4440,
    roughness: 1,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  /** Where each tank and turret head last fired (yaw), and where its gun points now. */
  private readonly aim = new Map<number, number>();
  private readonly aimStep = new Map<number, number>();
  private readonly gunYaw = new Map<number, number>();
  private lastNow = 0;
  private readonly waterNormal: THREE.DataTexture;
  private readonly sandNormal: THREE.DataTexture;
  // Reused every frame so the hot path allocates nothing once the batches have grown.
  private readonly before = new Map<number, UnitView>();
  private readonly heroBefore = new Map<number, HeroView>();
  private olderSeen: WorldView | undefined;
  private readonly facing = new Map<number, number>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hits: THREE.Intersection[] = [];
  private lastBox = { x: 0, y: 0, w: 1, h: 1 };
  private cssW = 1;
  private cssH = 1;

  /**
   * Throws when the canvas cannot give a WebGL2 context; the page then falls back to the pixel battlefield. Without a
   * forced `quality` it starts high and drops to low when frames run slow.
   */
  // prettier-ignore
  constructor(readonly canvas: HTMLCanvasElement, quality?: Quality) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.shadowMap.enabled = true;
    this.governor = new QualityGovernor(quality);
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.look = new Look(this.gl, this.scene, this.camera, this.governor.level);
    this.camera.layers.enable(FX_LAYER);
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    const haze = new THREE.Color(0xd6c3a0);
    this.scene.background = haze;
    this.scene.fog = new THREE.Fog(haze, 30, 80);
    this.scene.add(new THREE.HemisphereLight(0xc8dcf0, 0x9a7448, 0.55), this.fx.group);
    this.scene.environment = this.keep(desertSky(this.gl, new THREE.Vector3(-30, 28, 14)));
    this.scene.environmentIntensity = 0.55;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    Object.assign(this.sun.shadow, { bias: -0.0005, normalBias: 0.03 });
    this.scene.add(this.sun, this.sun.target, this.matchGroup);

    const std = (hex: number, roughness = 0.6, metalness = 0.35) =>
      this.keep(new THREE.MeshStandardMaterial({ color: hex, roughness, metalness, side: THREE.DoubleSide }));
    this.teamMat = TEAM_HEX.map((hex) => std(hex));
    this.neutralMat = std(NEUTRAL_HEX);
    this.wreckMat = std(WRECK_HEX, 0.9, 0.1);
    this.paints = paintMaterials();
    for (const m of Object.values(this.paints)) {
      addRim(m);
      this.owned.push(m, ...(m.map ? [m.map] : []));
    }
    this.owned.push(this.cloth, this.puffGeo, this.puffMat);
    const parts = (model: Model) => model.map((p) => this.keep(p.geometry) && p);
    for (const [i, kind] of (["fort", "robotFactory", "vehicleFactory", "turret"] as const).entries()) {
      const model = buildingModel(kind);
      const size = model.body.reduce((b, p) => b.union(p.geometry.boundingBox!), new THREE.Box3()).getSize(new THREE.Vector3());
      parts(model.body);
      if (model.pivot) parts(model.pivot.model);
      this.buildingModels.set(kind, { ...model, ruins: [0, 1].map((v) => parts(ruinModel(size.x, size.z, i * 2 + v + 1))) });
    }

    // Procedural detail, no image files: ripples for the water, fine grain for the sand.
    const size = 128;
    this.waterNormal = this.keep(dataTexture(normalMap(tileNoise(size, 8, 11), size, 6), size));
    // Wind ripples two to a tile, bent by a slow noise so they meander, over fine grain.
    const grain = tileNoise(size, 16, 5), bend = tileNoise(size, 3, 6);
    const ripples = grain.map((g, i) => g * 0.7 + 0.06 * Math.sin(((i % size) / size * 8 + bend[i]! * 4) * Math.PI * 2));
    this.sandNormal = this.keep(dataTexture(normalMap(ripples, size, 4), size));

    const flat = (order: number) => this.keep(new THREE.MeshBasicMaterial({
      depthTest: order === 0, toneMapped: false, fog: false, transparent: order > 0,
    }));
    const bar = new THREE.PlaneGeometry(1, 0.08).rotateX(-rig.PITCH);
    // Rings have radius 1 and scale per body; a hero's is doubled with a thin outer band so it reads apart.
    const ring = new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
    const band = new THREE.RingGeometry(1.12, 1.2, 40).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
    const heroRing = mergeGeometries([ring, band])!;
    band.dispose();
    const add = (key: string, model: { geometry: THREE.BufferGeometry; material: THREE.Material; tinted: boolean }[], shadow: boolean, order = 0) =>
      this.slotList.push(this.slots.set(key, { batch: new Batch(), parts: model.map((p) => ({ ...p, geometry: this.keep(p.geometry) })), shadow, order }).get(key)!);
    for (const kind of UNIT_MODELS)
      add(kind, unitModel(kind).map((p) => ({ geometry: p.geometry, material: this.paints[p.paint], tinted: p.paint === "team" })), true);
    const plain = (geometry: THREE.BufferGeometry, material: THREE.Material) => [{ geometry, material, tinted: true }];
    add("ring", plain(ring, flat(0)), false);
    add("heroRing", plain(heroRing, flat(0)), false);
    // Targeting: thin rings (radius 1, scaled) and a line one tile long down +z, drawn over everything.
    add("aimRing", plain(new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2).translate(0, 0.08, 0), flat(9)), false, 9);
    add("aimLine", plain(new THREE.PlaneGeometry(0.06, 1).rotateX(-Math.PI / 2).translate(0, 0.08, 0), flat(9)), false, 9);
    add("barBack", plain(bar, flat(10)), false, 10);
    add("barFill", plain(bar.clone().translate(0, 0, 0.01), flat(11)), false, 11);
  }

  private keep<T extends { dispose(): void }>(thing: T): T {
    this.owned.push(thing);
    return thing;
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.match.push(thing);
    return thing;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.look.setSize(this.cssW, this.cssH, dpr);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
  }

  pan(dx: number, dy: number, world: WorldView): void {
    this.follow = false;
    rig.panRig(this.rig, dx, dy, this.cssH);
    rig.clampRig(this.rig, world.width, world.height);
  }

  zoom(factor: number): void {
    rig.zoomRig(this.rig, factor);
  }

  lookAt(fx: number, fy: number, world: WorldView): void {
    this.follow = false;
    this.rig.x = fx * world.width;
    this.rig.z = fy * world.height;
    rig.clampRig(this.rig, world.width, world.height);
  }

  /** Where the four screen corners meet the ground, as a box in fractions of the map. */
  // prettier-ignore
  box(world: WorldView) {
    this.place();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let corner = 0; corner < 4; corner++) {
      this.ndc.set(corner & 1 ? 1 : -1, corner & 2 ? 1 : -1);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) continue;
      x0 = Math.min(x0, this.hit.x); x1 = Math.max(x1, this.hit.x);
      z0 = Math.min(z0, this.hit.z); z1 = Math.max(z1, this.hit.z);
    }
    const f = (v: number, size: number) => Math.min(1, Math.max(0, v / size));
    const x = f(x0, world.width), y = f(z0, world.height), w = f(x1, world.width) - x, h = f(z1, world.height) - y;
    const last = this.lastBox;
    if (last.x !== x || last.y !== y || last.w !== w || last.h !== h) this.lastBox = { x, y, w, h };
    return this.lastBox;
  }

  /** The tile under a CSS point: a ray from the camera against the ground mesh (or y = 0 off it). */
  tileAt(dx: number, dy: number, world: WorldView) {
    this.place();
    this.ndc.set((dx / this.cssW) * 2 - 1, 1 - (dy / this.cssH) * 2);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.ground, false, this.hits);
    const point =
      this.hits[0]?.point ??
      this.raycaster.ray.intersectPlane(this.plane, this.hit);
    if (!point) return undefined;
    const x = Math.floor(point.x),
      y = Math.floor(point.z);
    return x >= 0 && y >= 0 && x < world.width && y < world.height
      ? { x, y }
      : undefined;
  }

  /**
   * Queues an engine event's effects once per match, however often rollback delivers it. They start on the next
   * frame, on its clock, so even a flash shorter than a slow frame is seen once.
   */
  event(matchId: string, stamped: StampedEvent): void {
    if (!this.dedupe.accept(matchId, stamped) || matchId !== this.matchId)
      return;
    if (this.latest && this.pending.length < MAX_PENDING)
      this.pending.push(...cuesOf(stamped.event, this.cueContext(this.latest)));
  }

  // prettier-ignore
  private cueContext(world: WorldView): CueContext {
    return {
      kindOf: (id) => this.unitsNow.get(id)?.kind,
      teamOf: (mark) => mark.of === "unit" ? this.unitsNow.get(mark.id)?.team ?? -1
        : mark.of === "hero" ? world.heroes.find((h) => h.seat === mark.id)?.team ?? -1
        : world.buildings.find((b) => b.id === mark.id)?.team ?? -1,
      site: (id) => {
        const b = world.buildings.find((each) => each.id === id);
        return b && { x: b.x + 0.5, z: b.y + 0.5 };
      },
      heroAt: (seat) => {
        const h = world.heroes.find((each) => each.seat === seat);
        return h && { x: h.x / TILE, z: h.y / TILE, team: h.team };
      },
    };
  }

  /** Copies the rig onto the camera, the sun's shadow box and the fog. */
  private place(): void {
    const { distance } = this.rig;
    this.camera.position.set(
      this.rig.x,
      distance * Math.sin(rig.PITCH),
      this.rig.z + distance * Math.cos(rig.PITCH),
    );
    this.camera.lookAt(this.rig.x, 0, this.rig.z);
    this.camera.updateMatrixWorld();
    const reach = this.rig.distance * 0.9 + 6;
    const cam = this.sun.shadow.camera;
    if (cam.right !== reach) {
      cam.left = cam.bottom = -reach;
      cam.right = cam.top = reach;
      cam.far = 120;
      cam.updateProjectionMatrix();
    }
    // The sun moves in whole shadow texels, so shadow edges hold still while the camera glides.
    const texel = (2 * reach) / 2048,
      sx = Math.round(this.rig.x / texel) * texel,
      sz = Math.round(this.rig.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx - 30, 28, sz + 14);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.rig.distance * 1.1;
    fog.far = this.rig.distance * 3;
  }

  // prettier-ignore
  draw(matchId: string, world: WorldView, older: WorldView | undefined, t: number, self: number, now: number): void {
    this.adopt(matchId, world);
    const field = this.field!;
    if (older !== this.olderSeen) {
      this.olderSeen = older;
      this.before.clear();
      this.heroBefore.clear();
      for (const u of older?.units ?? []) this.before.set(u.id, u);
      for (const h of older?.heroes ?? []) this.heroBefore.set(h.seat, h);
      if (this.facing.size > world.units.length * 2 + 64) this.forget();
    }
    if (world !== this.latest) {
      this.latest = world;
      this.unitsNow.clear();
      for (const u of world.units) this.unitsNow.set(u.id, u);
    }
    if (this.governor.sample(now - this.lastNow)) this.look.setQuality(this.governor.level);
    const dt = Math.min(100, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    for (const e of world.events)
      if (e.type === "shot" && e.from.of !== "hero")
        this.aimAt((e.from.of === "unit" ? 1 : -1) * (e.from.id + 1), Math.atan2(e.to.x - e.from.x, e.to.y - e.from.y), world.step);
    for (const slot of this.slotList) slot.batch.begin();
    for (const u of world.units) {
      const p = this.before.get(u.id) ?? u;
      const x = this.lerp(t, p.x, u.x), z = this.lerp(t, p.y, u.y), y = standY(world, field, x, z);
      const moving = Math.abs(u.x - p.x) + Math.abs(u.y - p.y) >= 2;
      if (moving) this.facing.set(u.id, Math.atan2(u.x - p.x, u.y - p.y));
      const yaw = this.facing.get(u.id) ?? (u.team === 0 ? Math.PI / 2 : -Math.PI / 2);
      const s = u.stunned ? 0.85 : 1, tank = u.kind === "lightTank", lift = y + bob(moving, now, u.id, tank);
      const tint = teamRgb(u.team);
      this.slot(u.kind).batch.push(x, lift, z, yaw, s, s, s, tint);
      if (tank) {
        const gun = approachAngle(this.gunYaw.get(u.id + 1) ?? yaw, this.aimOf(u.id + 1, world.step) ?? yaw, SLEW * dt);
        this.gunYaw.set(u.id + 1, gun);
        this.slot("tankTurret").batch.push(x, lift, z, gun, s, s, s, tint);
      }
      const r = RING[u.kind];
      this.slot("ring").batch.push(x, y, z, 0, r, 1, r, tint);
      if (u.hp < u.maxHp) this.bar(x, y + (tank ? 0.6 : 0.75), z, u.hp / u.maxHp, 0.6);
    }
    for (const hero of world.heroes) {
      if (hero.hp <= 0) continue;
      const p = this.heroBefore.get(hero.seat) ?? hero;
      const x = this.lerp(t, p.x, hero.x), z = this.lerp(t, p.y, hero.y), y = standY(world, field, x, z);
      if (this.follow && hero.seat === self) {
        this.rig.x = x;
        this.rig.z = z;
      }
      const moving = Math.abs(hero.x - p.x) + Math.abs(hero.y - p.y) >= 2, key = -1000 - hero.seat;
      if (moving) this.facing.set(key, Math.atan2(hero.x - p.x, hero.y - p.y));
      const yaw = this.facing.get(key) ?? (hero.team === 0 ? Math.PI / 2 : -Math.PI / 2);
      this.slot(heroKindOf(hero)).batch.push(x, y + bob(moving, now, hero.seat, false), z, yaw, HERO_SCALE, HERO_SCALE, HERO_SCALE, teamRgb(hero.team));
      const r = RING.hero;
      this.slot("heroRing").batch.push(x, y, z, 0, r, 1, r, hero.seat === self ? SELF_RGB : teamRgb(hero.team));
      this.bar(x, y + 1.45, z, hero.hp / hero.maxHp, 1);
    }
    this.targeting(world, field, t, self, now);
    rig.clampRig(this.rig, world.width, world.height);
    for (let i = 0; i < world.buildings.length; i++) {
      const b = world.buildings[i]!, node = this.buildings[i];
      if (!node) continue;
      const dead = b.hp <= 0;
      node.alive.visible = !dead;
      node.ruin.visible = dead;
      if (dead) continue;
      const mat = this.teamMat[b.team] ?? this.neutralMat;
      for (const mesh of node.team) mesh.material = mat;
      if (node.pivot) {
        const key = -(b.id + 1), cur = node.pivot.rotation.y;
        node.pivot.rotation.y = node.aims
          ? approachAngle(cur, this.aimOf(key, world.step) ?? cur + 0.0004 * dt, SLEW * dt)
          : (now / 1400) % (Math.PI * 2);
      }
      node.puffs.forEach((puff, k) => {
        const f = ((now / 2600 + k / node.puffs.length + i * 0.37) % 1);
        puff.position.set(f * 0.25, f * 1.1, -f * 0.15);
        puff.scale.setScalar(0.5 + f * 1.6);
      });
      if (b.hp < b.maxHp) this.bar(node.alive.position.x, node.alive.position.y + node.height + 0.4, node.alive.position.z, b.hp / b.maxHp, 1.4);
    }
    if (this.flags.length) {
      waveCloth(this.clothBase, this.cloth.getAttribute("position") as THREE.BufferAttribute, now);
      this.cloth.getAttribute("position").needsUpdate = true;
      this.cloth.computeVertexNormals();
    }
    for (let i = 0; i < world.flags.length; i++) {
      const f = world.flags[i]!;
      const cloth = this.flags[i];
      if (!cloth) continue;
      cloth.material = this.teamMat[f.team] ?? this.neutralMat;
      cloth.rotation.y = Math.sin(now / 1300 + i) * 0.25;
    }
    for (const slot of this.slotList) this.sync(slot);
    this.waterNormal.offset.set((now / 60000) % 1, (now / 23000) % 1);
    const ground = (x: number, z: number) => standY(world, field, x, z);
    for (const cue of this.pending) this.fx.play(cue, now, ground);
    this.pending.length = 0;
    this.fx.update(now);
    this.place();
    this.look.render();
  }

  /** The aiming rings and marks (`overlay`), and a marker and line from this device's hero to its target. */
  // prettier-ignore
  private targeting(world: WorldView, field: HeightField, t: number, self: number, now: number): void {
    const hero = world.heroes.find((h) => h.seat === self && h.hp > 0);
    const target = hero?.target;
    const pulse = this.pulse.of(target, now);
    if (!hero) return;
    const at = (x: number, z: number) => [x / TILE, standY(world, field, x / TILE, z / TILE), z / TILE] as const;
    const ring = (x: number, z: number, r: number) => {
      const [px, py, pz] = at(x, z);
      this.slot("aimRing").batch.push(px, py, pz, 0, r / TILE, 1, r / TILE, TARGET_RGB);
    };
    const p = this.heroBefore.get(hero.seat) ?? hero;
    const hx = p.x + (hero.x - p.x) * t, hz = p.y + (hero.y - p.y) * t;
    const o = this.overlay;
    if (o.range > 0) ring(hx, hz, o.range);
    if (o.area > 0 && o.cursor) ring(o.cursor.x, o.cursor.y, o.area);
    for (const m of o.marks) ring(m.x, m.y, TILE * 0.55);
    if (!target) return;
    // A moving target is drawn where its body is drawn, between frames.
    const was = target.of === "unit" ? this.before.get(target.id) : target.of === "hero" ? this.heroBefore.get(target.id) : undefined;
    const tx = was ? was.x + (target.x - was.x) * t : target.x, tz = was ? was.y + (target.y - was.y) * t : target.y;
    ring(tx, tz, TILE * (target.chosen ? 0.7 : 0.55) * (1 + pulse * 0.8));
    if (target.chosen) ring(tx, tz, TILE * 0.85 * (1 + pulse * 0.8));
    const [ax, ay, az] = at(hx, hz), [bx, by, bz] = at(tx, tz);
    const length = Math.hypot(bx - ax, bz - az);
    if (length > 0.01)
      this.slot("aimLine").batch.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, Math.atan2(bx - ax, bz - az), 1, 1, length, TARGET_RGB);
  }

  private aimAt(key: number, yaw: number, step: number): void {
    this.aim.set(key, yaw);
    this.aimStep.set(key, step);
  }

  /** Where a gun fired within the last couple of seconds, or undefined so it settles back. */
  private aimOf(key: number, step: number): number | undefined {
    // A step before the shot (a rollback re-shows an earlier world) counts as expired too.
    const since = step - (this.aimStep.get(key) ?? -Infinity);
    return since >= 0 && since < AIM_HOLD ? this.aim.get(key) : undefined;
  }

  private lerp(t: number, a: number, b: number): number {
    return (a + (b - a) * t) / TILE;
  }

  /** A health bar: a dark back and a fill coloured by how much is left. */
  // prettier-ignore
  private bar(x: number, y: number, z: number, frac: number, width: number): void {
    const f = Math.max(0, Math.min(1, frac));
    this.slot("barBack").batch.push(x, y, z, 0, width + 0.06, 1.6, 1, BAR_BACK);
    this.slot("barFill").batch.push(x - ((1 - f) * width) / 2, y, z, 0, width * f, 1, 1, f > 0.5 ? GOOD! : f > 0.25 ? FAIR! : POOR!);
  }

  private slot(key: string): Slot {
    return this.slots.get(key)!;
  }

  /** Points the slot's instanced meshes at its batch, rebuilding them around new arrays when the batch outgrew them. */
  // prettier-ignore
  private sync(slot: Slot): void {
    const { batch } = slot;
    if (slot.matrices?.array !== batch.matrices) {
      // Every part of the model shares the slot's two attributes, so one upload serves them all.
      const matrices = (slot.matrices = new THREE.InstancedBufferAttribute(batch.matrices, 16).setUsage(THREE.DynamicDrawUsage));
      const colors = (slot.colors = new THREE.InstancedBufferAttribute(batch.colors, 3).setUsage(THREE.DynamicDrawUsage));
      for (const part of slot.parts) {
        if (part.mesh) { this.scene.remove(part.mesh); part.mesh.dispose(); }
        const mesh = (part.mesh = new THREE.InstancedMesh(part.geometry, part.material, batch.capacity));
        mesh.instanceMatrix = matrices;
        mesh.instanceColor = part.tinted ? colors : null;
        mesh.frustumCulled = false;
        mesh.castShadow = slot.shadow;
        mesh.renderOrder = slot.order;
        // Rings and bars are markings, not things: no ambient occlusion under them.
        if (!slot.shadow) mesh.layers.set(FX_LAYER);
        this.scene.add(mesh);
      }
    }
    for (const part of slot.parts) {
      part.mesh!.count = batch.count;
      // Hero models nobody wears this match cost no draw call.
      part.mesh!.visible = batch.count > 0;
    }
    // Upload only this frame's instances, not the whole (never-shrinking) capacity.
    for (const [attr, size] of [[slot.matrices, 16], [slot.colors!, 3]] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, batch.count * size);
      attr.needsUpdate = true;
    }
  }

  private forget(): void {
    for (const map of [this.facing, this.aim, this.aimStep, this.gunYaw])
      map.clear();
  }

  /** A new match: frees the old ground and builds this map's, with the camera back on the hero. */
  // prettier-ignore
  private adopt(matchId: string, world: WorldView): void {
    if (matchId === this.matchId && this.field) return;
    this.clearMatch();
    this.fx.clear();
    this.pending.length = 0;
    this.latest = undefined;
    this.matchId = matchId;
    this.follow = true;
    this.forget();
    this.before.clear();
    this.heroBefore.clear();
    this.olderSeen = undefined;
    this.rig.x = world.width / 2;
    this.rig.z = world.height / 2;
    const field = (this.field = heightField(world, resFor(world)));
    const buffers = terrainBuffers(field, 7, world);
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(buffers.colors, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(buffers.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geo.computeVertexNormals();
    const sand = this.own(new THREE.MeshStandardMaterial({
      vertexColors: true, normalMap: this.sandNormal,
      normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95, metalness: 0,
    }));
    // One mesh per chunk over the shared vertices and normals, each boxed by its own extent so it culls alone.
    this.ground = terrainChunks(field).map((chunk) => {
      const part = this.own(new THREE.BufferGeometry());
      for (const name of ["position", "color", "uv", "normal"]) part.setAttribute(name, geo.getAttribute(name));
      part.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      part.boundingBox = new THREE.Box3(new THREE.Vector3(chunk.x0, -3, chunk.z0), new THREE.Vector3(chunk.x1, 3, chunk.z1));
      part.boundingSphere = part.boundingBox.getBoundingSphere(new THREE.Sphere());
      const mesh = new THREE.Mesh(part, sand);
      mesh.receiveShadow = mesh.castShadow = true;
      return mesh;
    });
    const W = world.width, H = world.height;
    // The river reflects the sky; foam lightens and thickens it within half a tile of a bank.
    // Two water cells a tile on a small map, one on a big one (the foam is per vertex).
    const per = W * H > BIG_MAP ? 1 : 2;
    const waterGeo = this.own(new THREE.PlaneGeometry(W, H, W * per, H * per).rotateX(-Math.PI / 2).translate(W / 2, WATER_Y, H / 2));
    const wp = waterGeo.getAttribute("position"), foam = new Float32Array(wp.count * 4);
    for (let i = 0; i < wp.count; i++) {
      const f = Math.max(0, 1 - distanceTo(world, wp.getX(i), wp.getZ(i), (c) => !wet(c), 0.6) / 0.6) ** 2;
      foam.set([0.11 + 0.75 * f, 0.24 + 0.66 * f, 0.27 + 0.6 * f, 0.8 + 0.18 * f], i * 4);
    }
    waterGeo.setAttribute("color", new THREE.BufferAttribute(foam, 4));
    const water = new THREE.Mesh(waterGeo, this.own(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.06, metalness: 0.1, normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.4, 0.4), transparent: true, envMapIntensity: 1.6,
    })));
    water.receiveShadow = true;
    this.waterNormal.repeat.set(W / 4, H / 4);
    // An apron of plain desert around the map, so a camera at the edge sees ground rather than haze.
    const outer = new THREE.Shape([[-80, -80], [W + 80, -80], [W + 80, H + 80], [-80, H + 80]].map(([x, z]) => new THREE.Vector2(x, z)));
    outer.holes.push(new THREE.Path([[0, 0], [0, H], [W, H], [W, 0]].map(([x, z]) => new THREE.Vector2(x, z))));
    const apron = new THREE.Mesh(
      this.own(new THREE.ShapeGeometry(outer).rotateX(Math.PI / 2).translate(0, 0.1, 0)),
      this.own(new THREE.MeshStandardMaterial({ color: 0xb89466, roughness: 1, side: THREE.DoubleSide })),
    );
    apron.receiveShadow = true;
    this.matchGroup.add(...this.ground, water, apron);

    // Rocks and bridge planks: one instanced mesh each, filled once.
    // Pebbles strewn over a fifth of the open sand, a few to a tile, drawn with the rocks.
    const rocks: [number, number, number][] = [], planks: [number, number, boolean][] = [];
    world.terrain.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === "#") rocks.push([x + 0.5, y + 0.5, 0.8 + hash(x, y, 9) * 0.6]);
      if (c === "." && hash(x, y, 4) < 0.12)
        for (let k = 0; k < 2; k++) rocks.push([x + hash(x, y, 20 + k), y + hash(x, y, 30 + k), 0.08 + hash(x, y, 40 + k) * 0.14]);
      if (c === "=") planks.push([x, y, row[x - 1] !== "~" && row[x + 1] !== "~"]);
    }));
    const rockGeo = this.own(new THREE.IcosahedronGeometry(0.55, 1));
    const pos = rockGeo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const k = 0.75 + 0.5 * hash(Math.round(pos.getX(i) * 50), Math.round(pos.getY(i) * 50 + pos.getZ(i) * 7), 3);
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.8, pos.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
    const rockMesh = this.own(new THREE.InstancedMesh(rockGeo,
      this.own(new THREE.MeshStandardMaterial({ color: 0x8a7866, roughness: 0.9, flatShading: true })), rocks.length));
    const plankMesh = this.own(new THREE.InstancedMesh(this.own(new THREE.BoxGeometry(1, 0.06, 0.2)),
      this.own(new THREE.MeshStandardMaterial({ color: 0x7a5432, roughness: 0.85 })), planks.length * 4));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    rocks.forEach(([x, z, size], i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), size * 40);
      m.compose(v.set(x, size < 0.5 ? heightAt(field, x, z) : 0.1 + (size - 0.8) / 3, z), q, s.setScalar(size));
      rockMesh.setMatrixAt(i, m);
    });
    planks.forEach(([x, y, across], i) => {
      q.setFromAxisAngle(v.set(0, 1, 0), across ? Math.PI / 2 : 0);
      for (let k = 0; k < 4; k++) {
        const o = (k + 0.5) / 4;
        m.compose(v.set(across ? x + o : x + 0.5, DECK_Y - 0.03, across ? y + 0.5 : y + o), q, s.setScalar(1));
        plankMesh.setMatrixAt(i * 4 + k, m);
      }
    });
    rockMesh.castShadow = rockMesh.receiveShadow = plankMesh.castShadow = plankMesh.receiveShadow = true;
    this.matchGroup.add(rockMesh, plankMesh);

    this.buildings = world.buildings.map((b) => this.building(b.kind, b.id, b.x + 0.5, standY(world, field, b.x + 0.5, b.y + 0.5), b.y + 0.5));
    const poleGeo = this.own(new THREE.CylinderGeometry(0.035, 0.05, 1.6, 8).translate(0, 0.8, 0));
    const baseGeo = this.own(new THREE.CylinderGeometry(0.14, 0.18, 0.12, 10).translate(0, 0.06, 0));
    this.flags = world.flags.map((f) => {
      const x = f.x + 0.5, z = f.y + 0.5, y = standY(world, field, x, z);
      const pole = new THREE.Mesh(poleGeo, this.paints.steel);
      const base = new THREE.Mesh(baseGeo, this.paints.concrete);
      const cloth = new THREE.Mesh(this.cloth, this.neutralMat);
      for (const m of [pole, base, cloth]) {
        m.position.set(x, y, z);
        m.castShadow = true;
      }
      this.matchGroup.add(pole, base, cloth);
      return cloth;
    });
  }

  /** A building's live model (team parts swapped per frame, a spinning or aiming pivot, chimney smoke) and its ruin. */
  // prettier-ignore
  private building(kind: BuildingKind, id: number, x: number, y: number, z: number): BuildingNode {
    const model = this.buildingModels.get(kind)!;
    const team: THREE.Mesh[] = [];
    const meshes = (parts: Model) => parts.map((p) => {
      const mesh = new THREE.Mesh(p.geometry, p.paint === "team" ? this.neutralMat : this.paints[p.paint]);
      mesh.castShadow = mesh.receiveShadow = true;
      if (p.paint === "team") team.push(mesh);
      return mesh;
    });
    const alive = new THREE.Group().add(...meshes(model.body));
    let pivot: THREE.Group | undefined;
    if (model.pivot) {
      pivot = new THREE.Group().add(...meshes(model.pivot.model));
      pivot.position.set(model.pivot.x, model.pivot.y, model.pivot.z);
      alive.add(pivot);
    }
    const puffs: THREE.Mesh[] = [];
    if (model.smoke) {
      const stack = new THREE.Group();
      stack.position.set(...model.smoke);
      for (let k = 0; k < 4; k++) puffs.push(new THREE.Mesh(this.puffGeo, this.puffMat));
      alive.add(stack.add(...puffs));
    }
    const ruin = new THREE.Group().add(...meshes(model.ruins[id % model.ruins.length]!));
    ruin.visible = false;
    for (const g of [alive, ruin]) g.position.set(x, y, z);
    this.matchGroup.add(alive, ruin);
    return { alive, ruin, team, pivot, aims: model.pivot?.aims ?? false, puffs, height: model.height };
  }

  private clearMatch(): void {
    for (const thing of this.match) thing.dispose();
    this.match = [];
    this.matchGroup.clear();
    this.buildings = [];
    this.flags = [];
    this.ground = [];
    this.field = undefined;
  }

  dispose(): void {
    this.clearMatch();
    this.fx.dispose();
    this.look.dispose();
    for (const slot of this.slotList)
      for (const part of slot.parts) part.mesh?.dispose();
    for (const thing of this.owned) thing.dispose();
    this.gl.dispose();
    // Release the context now: every room makes a new canvas, and browsers cap live WebGL contexts.
    this.gl.forceContextLoss();
  }
}
