/**
 * Draws the particle pool (`fx.ts`): three instanced quads — scorch decals, blended smoke and dust, additive fire,
 * sparks, tracers and rings — plus a small pool of point lights for muzzle flashes and blasts. Every buffer has a fixed
 * size made up front, so a frame only rewrites the live part of it.
 */
import * as THREE from "three";
import { Frame, Particles, emit, type Cue, type GroundAt } from "./fx.js";

/** The camera layer effects, rings and bars draw on; the ambient occlusion pass looks past it. */
export const FX_LAYER = 1;
const POOL = 3072,
  DECALS = 192,
  LIGHTS = 4;

const VERTEX = /* glsl */ `
attribute vec3 iPos; attribute vec3 iDir; attribute vec4 iData; attribute vec3 iRgb;
varying vec2 vUv; varying vec4 vCol; varying float vMode;
void main() {
  vUv = uv; vCol = vec4(iRgb, iData.y); vMode = iData.z;
  float s = iData.x, mode = iData.z;
  vec4 v;
  if (mode > 2.5) v = viewMatrix * vec4(iPos + vec3(position.x, 0.0, -position.y) * 2.0 * s, 1.0);
  else if (mode > 1.5) {
    vec4 a = viewMatrix * vec4(iPos, 1.0), b = viewMatrix * vec4(iPos + iDir, 1.0);
    vec2 d = normalize(b.xy - a.xy + 1e-5);
    v = mix(a, b, position.x + 0.5);
    v.xy += vec2(-d.y, d.x) * position.y * 2.0 * s;
  } else {
    v = viewMatrix * vec4(iPos, 1.0);
    v.xy += position.xy * 2.0 * s;
  }
  gl_Position = projectionMatrix * v;
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv; varying vec4 vCol; varying float vMode;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c), a;
  if (vMode < 0.5) a = pow(max(0.0, 1.0 - r), 2.0);
  else if (vMode < 1.5) a = smoothstep(1.0, 0.25, r) * (0.8 + 0.2 * sin(c.x * 7.0 + c.y * 5.0));
  else if (vMode < 2.5) a = (1.0 - abs(c.y)) * smoothstep(0.0, 0.6, vUv.x);
  else if (vMode < 3.5) a = smoothstep(0.62, 0.9, r) * smoothstep(1.0, 0.92, r);
  else a = smoothstep(1.0, 0.1, r) * (0.75 + 0.25 * sin(c.x * 9.0 + sin(c.y * 7.0) * 2.0) * sin(c.y * 8.0 + c.x * 3.0));
  a *= vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Marks the first `count` instances of an attribute for upload, and nothing when there are none: three.js sends an
 * update range as `bufferSubData(..., start, count)`, and WebGL2 reads a length of 0 as "to the end of the array",
 * so an empty range would upload the whole buffer every frame.
 */
export function uploadLive(attr: THREE.BufferAttribute, count: number): void {
  attr.clearUpdateRanges();
  if (count <= 0) return;
  attr.addUpdateRange(0, count * attr.itemSize);
  attr.needsUpdate = true;
}

interface Layer {
  frame: Frame;
  geometry: THREE.InstancedBufferGeometry;
  attrs: THREE.InstancedBufferAttribute[];
  material: THREE.ShaderMaterial;
}

export class FxLayer {
  readonly group = new THREE.Group();
  private readonly pool = new Particles(POOL);
  private readonly scorch = new Particles(DECALS);
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  /** Decals, then blended smoke, then additive light, each drawn over the last. */
  private readonly layers = ([[DECALS, THREE.NormalBlending], [POOL, THREE.NormalBlending], [POOL, THREE.AdditiveBlending]] as const)
    .map(([size, blending], order) => this.layer(size, blending, order + 1)); // prettier-ignore
  private readonly lights = Array.from({ length: LIGHTS }, () => this.group.add(new THREE.PointLight(0xffa850, 0, 7, 2)).children.at(-1) as THREE.PointLight); // prettier-ignore
  private readonly flashes = this.lights.map(() => ({
    x: 0,
    y: 0,
    z: 0,
    power: 0,
    life: 1,
    born: -1e9,
  }));
  private nextLight = 0;

  // prettier-ignore
  private layer(size: number, blending: THREE.Blending, order: number): Layer {
    const frame = new Frame(size), geometry = new THREE.InstancedBufferGeometry();
    geometry.index = this.quad.index;
    for (const name of ["position", "uv"]) geometry.setAttribute(name, this.quad.getAttribute(name));
    const attrs = ([["iPos", frame.pos, 3], ["iDir", frame.dir, 3], ["iData", frame.data, 4], ["iRgb", frame.rgb, 3]] as const)
      .map(([name, array, n]) => {
        const attr = new THREE.InstancedBufferAttribute(array, n).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute(name, attr);
        return attr;
      });
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, blending, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.layers.set(FX_LAYER);
    this.group.add(mesh);
    return { frame, geometry, attrs, material };
  }

  /** Starts a cue's particles and takes a light for each flash it asks for, the oldest light first. */
  play(cue: Cue, now: number, ground: GroundAt): void {
    for (const flash of emit(
      cue,
      now,
      ground,
      this.pool,
      this.scorch,
      Math.random,
    )) {
      Object.assign(this.flashes[this.nextLight]!, flash, { born: now });
      this.nextLight = (this.nextLight + 1) % LIGHTS;
    }
  }

  /** Writes this frame's particles and dims the lights. */
  update(now: number): void {
    const [decal, blend, glow] = this.layers as [Layer, Layer, Layer];
    for (const layer of this.layers) layer.frame.count = 0;
    this.scorch.render(now, glow.frame, decal.frame);
    this.pool.render(now, glow.frame, blend.frame);
    for (const { frame, geometry, attrs } of this.layers) {
      geometry.instanceCount = frame.count;
      for (const attr of attrs) uploadLive(attr, frame.count);
    }
    this.flashes.forEach((flash, i) => {
      const k = Math.max(0, 1 - (now - flash.born) / flash.life);
      this.lights[i]!.position.set(flash.x, flash.y, flash.z);
      this.lights[i]!.intensity = flash.power * k * k;
    });
  }

  clear(): void {
    this.pool.clear();
    this.scorch.clear();
    for (const flash of this.flashes) flash.born = -1e9;
  }

  dispose(): void {
    this.quad.dispose();
    for (const { geometry, material } of this.layers) {
      geometry.dispose();
      material.dispose();
    }
    for (const light of this.lights) light.dispose();
  }
}
