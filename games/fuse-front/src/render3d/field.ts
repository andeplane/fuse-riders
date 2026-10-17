/**
 * The three.js battlefield: a heightmapped desert built once per match, a sun with soft shadows, a tilted RTS camera
 * and instanced placeholder meshes (G2 replaces them with real models). It reads a `WorldView` and interpolates
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
import type { Renderer } from "../render/renderer.js";
import { Batch } from "./instances.js";
import * as rig from "./rig.js";
import {
  WATER_Y,
  DECK_Y,
  hash,
  heightField,
  normalMap,
  standY,
  terrainBuffers,
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
const SELF_RGB = rgb(SELF_HEX),
  BAR_BACK = rgb(0x101010),
  [GOOD, FAIR, POOR] = [0x6ad83a, 0xf8d030, 0xe8483c].map(rgb);
const BUILDING_SIZE: Record<BuildingKind, [number, number, number]> = {
  fort: [2, 1.4, 2],
  robotFactory: [1.8, 1, 1.5],
  vehicleFactory: [2, 0.9, 1.7],
  turret: [0.7, 0.8, 0.7],
};

/** Placeholder bodies, forward along +z, standing on y = 0. */
function unitGeometry(kind: UnitKind | "hero"): THREE.BufferGeometry {
  if (kind === "grunt")
    return new THREE.CapsuleGeometry(0.16, 0.22, 4, 8).translate(0, 0.3, 0);
  if (kind === "torch")
    return new THREE.ConeGeometry(0.22, 0.5, 8).translate(0, 0.25, 0);
  if (kind === "lightTank")
    return new THREE.BoxGeometry(0.44, 0.3, 0.62).translate(0, 0.17, 0);
  return new THREE.CapsuleGeometry(0.26, 0.5, 4, 12).translate(0, 0.52, 0);
}

interface Slot {
  batch: Batch;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh?: THREE.InstancedMesh;
  shadow: boolean;
  order: number;
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
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(rig.FOV, 1, 0.5, 200);
  private readonly sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  private readonly rig: rig.Rig = { x: 0, z: 0, distance: rig.START };
  private readonly dedupe = new EventDedupe();
  /** Lives as long as the renderer: unit bodies, team materials, textures. */
  private readonly owned: { dispose(): void }[] = [];
  /** Lives for one match: the ground, water, rocks, bridges, buildings and flags. */
  private match: { dispose(): void }[] = [];
  private readonly matchGroup = new THREE.Group();
  private matchId = "";
  private field: HeightField | undefined;
  private ground: THREE.Mesh | undefined;
  private buildings: THREE.Mesh[] = [];
  private flags: THREE.Mesh[] = [];
  private readonly slots = new Map<string, Slot>();
  private readonly slotList: Slot[] = [];
  private readonly teamMat: THREE.MeshStandardMaterial[];
  private readonly neutralMat: THREE.MeshStandardMaterial;
  private readonly wreckMat: THREE.MeshStandardMaterial;
  private readonly buildingGeo = new Map<BuildingKind, THREE.BufferGeometry>();
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

  /** Throws when the canvas cannot give a WebGL2 context; the page then falls back to the pixel battlefield. */
  // prettier-ignore
  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    const haze = new THREE.Color(0xd6c3a0);
    this.scene.background = haze;
    this.scene.fog = new THREE.Fog(haze, 30, 80);
    this.scene.add(new THREE.HemisphereLight(0xc8dcf0, 0x9a7448, 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow, { bias: -0.0005, normalBias: 0.03 });
    this.scene.add(this.sun, this.sun.target, this.matchGroup);

    const std = (hex: number, roughness = 0.6, metalness = 0.35) =>
      this.keep(new THREE.MeshStandardMaterial({ color: hex, roughness, metalness, side: THREE.DoubleSide }));
    this.teamMat = TEAM_HEX.map((hex) => std(hex));
    this.neutralMat = std(NEUTRAL_HEX);
    this.wreckMat = std(WRECK_HEX, 0.9, 0.1);
    for (const [kind, [w, h, d]] of Object.entries(BUILDING_SIZE))
      this.buildingGeo.set(kind as BuildingKind, this.keep(kind === "turret"
        ? new THREE.CylinderGeometry(w / 2, w / 2 + 0.08, h, 12)
        : new THREE.BoxGeometry(w, h, d)).translate(0, h / 2, 0));

    // Procedural detail, no image files: ripples for the water, fine grain for the sand.
    const size = 128;
    this.waterNormal = this.keep(dataTexture(normalMap(tileNoise(size, 8, 11), size, 6), size));
    this.sandNormal = this.keep(dataTexture(normalMap(tileNoise(size, 16, 5), size, 3), size));

    const unitMat = this.keep(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }));
    const flat = (order: number) => this.keep(new THREE.MeshBasicMaterial({
      depthTest: order === 0, toneMapped: false, fog: false, transparent: order > 0,
    }));
    const bar = new THREE.PlaneGeometry(1, 0.08).rotateX(-rig.PITCH);
    const ring = new THREE.RingGeometry(0.42, 0.52, 32).rotateX(-Math.PI / 2).translate(0, 0.05, 0);
    const add = (key: string, geometry: THREE.BufferGeometry, material: THREE.Material, shadow: boolean, order = 0) =>
      this.slotList.push(this.slots.set(key, { batch: new Batch(), geometry: this.keep(geometry), material, shadow, order }).get(key)!);
    for (const kind of ["grunt", "torch", "lightTank", "hero"] as const)
      add(kind, unitGeometry(kind), unitMat, true);
    add("ring", ring, flat(0), false);
    add("barBack", bar, flat(10), false, 10);
    add("barFill", bar.clone().translate(0, 0, 0.01), flat(11), false, 11);
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
    this.gl.setPixelRatio(Math.min(2, dpr));
    this.gl.setSize(this.cssW, this.cssH);
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
    if (this.ground)
      this.raycaster.intersectObject(this.ground, false, this.hits);
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

  /** Effects arrive in G3; until then an event is only deduped. */
  event(matchId: string, stamped: StampedEvent): void {
    this.dedupe.accept(matchId, stamped);
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
    this.sun.position.set(sx - 24, 40, sz + 18);
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
      if (this.facing.size > world.units.length * 2 + 64) this.facing.clear();
    }
    for (const slot of this.slotList) slot.batch.begin();
    for (const u of world.units) {
      const p = this.before.get(u.id) ?? u;
      const x = this.lerp(t, p.x, u.x), z = this.lerp(t, p.y, u.y), y = standY(world, field, x, z);
      if (Math.abs(u.x - p.x) + Math.abs(u.y - p.y) >= 2) this.facing.set(u.id, Math.atan2(u.x - p.x, u.y - p.y));
      const yaw = this.facing.get(u.id) ?? (u.team === 0 ? Math.PI / 2 : -Math.PI / 2);
      const s = u.stunned ? 0.85 : 1;
      this.slot(u.kind).batch.push(x, y, z, yaw, s, s, s, teamRgb(u.team));
      if (u.hp < u.maxHp) this.bar(x, y + 0.85, z, u.hp / u.maxHp, 0.6);
    }
    for (const hero of world.heroes) {
      if (hero.hp <= 0) continue;
      const p = this.heroBefore.get(hero.seat) ?? hero;
      const x = this.lerp(t, p.x, hero.x), z = this.lerp(t, p.y, hero.y), y = standY(world, field, x, z);
      if (this.follow && hero.seat === self) {
        this.rig.x = x;
        this.rig.z = z;
      }
      this.slot("hero").batch.push(x, y, z, 0, 1, 1, 1, teamRgb(hero.team));
      this.slot("ring").batch.push(x, y, z, 0, 1, 1, 1, hero.seat === self ? SELF_RGB : teamRgb(hero.team));
      this.bar(x, y + 1.45, z, hero.hp / hero.maxHp, 1);
    }
    rig.clampRig(this.rig, world.width, world.height);
    for (let i = 0; i < world.buildings.length; i++) {
      const b = world.buildings[i]!;
      const mesh = this.buildings[i];
      if (!mesh) continue;
      const dead = b.hp <= 0;
      mesh.material = dead ? this.wreckMat : this.teamMat[b.team] ?? this.neutralMat;
      mesh.scale.y = dead ? 0.35 : 1;
      if (!dead && b.hp < b.maxHp)
        this.bar(mesh.position.x, mesh.position.y + BUILDING_SIZE[b.kind][1] + 0.4, mesh.position.z, b.hp / b.maxHp, 1.4);
    }
    for (let i = 0; i < world.flags.length; i++) {
      const f = world.flags[i]!;
      const cloth = this.flags[i];
      if (!cloth) continue;
      cloth.material = this.teamMat[f.team] ?? this.neutralMat;
      cloth.rotation.y = Math.sin(now / 400 + i) * 0.35;
    }
    for (const slot of this.slotList) this.sync(slot);
    this.waterNormal.offset.set((now / 60000) % 1, (now / 23000) % 1);
    this.place();
    this.gl.render(this.scene, this.camera);
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

  /** Points the slot's instanced mesh at its batch, rebuilding it when the batch outgrew it. */
  // prettier-ignore
  private sync(slot: Slot): void {
    const { batch } = slot;
    let mesh = slot.mesh;
    if (!mesh || mesh.instanceMatrix.array !== batch.matrices) {
      if (mesh) { this.scene.remove(mesh); mesh.dispose(); }
      mesh = new THREE.InstancedMesh(slot.geometry, slot.material, batch.capacity);
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(batch.matrices, 16).setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(batch.colors, 3).setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = slot.shadow;
      mesh.renderOrder = slot.order;
      this.scene.add((slot.mesh = mesh));
    }
    mesh.count = batch.count;
    // Upload only this frame's instances, not the whole (never-shrinking) capacity.
    const matrices = mesh.instanceMatrix, colors = mesh.instanceColor!;
    matrices.clearUpdateRanges();
    matrices.addUpdateRange(0, batch.count * 16);
    colors.clearUpdateRanges();
    colors.addUpdateRange(0, batch.count * 3);
    matrices.needsUpdate = colors.needsUpdate = true;
  }

  /** A new match: frees the old ground and builds this map's, with the camera back on the hero. */
  // prettier-ignore
  private adopt(matchId: string, world: WorldView): void {
    if (matchId === this.matchId && this.field) return;
    this.clearMatch();
    this.matchId = matchId;
    this.follow = true;
    this.facing.clear();
    this.before.clear();
    this.heroBefore.clear();
    this.olderSeen = undefined;
    this.rig.x = world.width / 2;
    this.rig.z = world.height / 2;
    const field = (this.field = heightField(world));
    const buffers = terrainBuffers(field);
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
    this.ground = new THREE.Mesh(geo, sand);
    this.ground.receiveShadow = this.ground.castShadow = true;
    const W = world.width, H = world.height;
    const water = new THREE.Mesh(
      this.own(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2).translate(W / 2, WATER_Y, H / 2)),
      this.own(new THREE.MeshStandardMaterial({
        color: 0x2a5560, roughness: 0.08, metalness: 0.2, normalMap: this.waterNormal,
        normalScale: new THREE.Vector2(0.5, 0.5), transparent: true, opacity: 0.82,
      })),
    );
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
    this.matchGroup.add(this.ground, water, apron);

    // Rocks and bridge planks: one instanced mesh each, filled once.
    const rocks: [number, number][] = [], planks: [number, number, boolean][] = [];
    world.terrain.forEach((row, y) => [...row].forEach((c, x) => {
      if (c === "#") rocks.push([x, y]);
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
    rocks.forEach(([x, y], i) => {
      const r = hash(x, y, 9);
      q.setFromAxisAngle(v.set(0, 1, 0), r * 6.28);
      m.compose(v.set(x + 0.5, 0.1 + r * 0.2, y + 0.5), q, s.setScalar(0.8 + r * 0.6));
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

    this.buildings = world.buildings.map((b) => {
      const mesh = new THREE.Mesh(this.buildingGeo.get(b.kind)!, this.neutralMat);
      mesh.position.set(b.x + 0.5, standY(world, field, b.x + 0.5, b.y + 0.5), b.y + 0.5);
      mesh.castShadow = mesh.receiveShadow = true;
      this.matchGroup.add(mesh);
      return mesh;
    });
    const poleGeo = this.own(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 6).translate(0, 0.8, 0));
    const clothGeo = this.own(new THREE.PlaneGeometry(0.7, 0.45).translate(0.35, 1.35, 0));
    this.flags = world.flags.map((f) => {
      const x = f.x + 0.5, z = f.y + 0.5, y = standY(world, field, x, z);
      const pole = new THREE.Mesh(poleGeo, this.wreckMat);
      const cloth = new THREE.Mesh(clothGeo, this.neutralMat);
      pole.position.set(x, y, z);
      cloth.position.set(x, y, z);
      pole.castShadow = cloth.castShadow = true;
      this.matchGroup.add(pole, cloth);
      return cloth;
    });
  }

  private clearMatch(): void {
    for (const thing of this.match) thing.dispose();
    this.match = [];
    this.matchGroup.clear();
    this.buildings = [];
    this.flags = [];
    this.ground = undefined;
    this.field = undefined;
  }

  dispose(): void {
    this.clearMatch();
    for (const slot of this.slotList) slot.mesh?.dispose();
    for (const thing of this.owned) thing.dispose();
    this.gl.dispose();
    // Release the context now: every room makes a new canvas, and browsers cap live WebGL contexts.
    this.gl.forceContextLoss();
  }
}
