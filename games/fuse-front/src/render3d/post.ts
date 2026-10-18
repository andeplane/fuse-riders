/**
 * The finish on the frame: a procedural desert sky for reflections, a rim light that lifts models off the sand, and
 * at `high` quality a post chain — ground-truth ambient occlusion, bloom on what glows past white, a warm grade with a
 * vignette, and FXAA. At `low` the scene draws straight to the canvas.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/addons/postprocessing/FXAAPass.js";
import type { Quality } from "./fx.js";

const GRADE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `uniform sampler2D tDiffuse; varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 col = mix(vec3(dot(c.rgb, vec3(0.299, 0.587, 0.114))), c.rgb, 1.1);
  col = (col - 0.5) * 1.06 + 0.5;
  col *= vec3(1.03, 1.0, 0.94);
  vec2 d = vUv - 0.5;
  gl_FragColor = vec4(col * (1.0 - dot(d, d) * 0.6), c.a);
}`,
};

/** An environment map from a sky gradient (blue above, haze at the horizon, warm sand below) with a sun spot. */
// prettier-ignore
export function desertSky(gl: THREE.WebGLRenderer, sun: THREE.Vector3): THREE.Texture {
  const sky = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sun: { value: sun.clone().normalize() } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 sun; varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 up = mix(vec3(0.95, 0.85, 0.68), vec3(0.42, 0.6, 0.85), smoothstep(0.0, 0.5, d.y));
  vec3 col = d.y > 0.0 ? up : mix(vec3(0.95, 0.85, 0.68), vec3(0.55, 0.42, 0.28), smoothstep(0.0, -0.3, d.y));
  gl_FragColor = vec4(col + vec3(1.0, 0.9, 0.7) * pow(max(dot(d, sun), 0.0), 400.0) * 40.0, 1.0);
}`,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  sky.add(ball);
  const pmrem = new THREE.PMREMGenerator(gl);
  const texture = pmrem.fromScene(sky, 0.02).texture;
  pmrem.dispose();
  ball.geometry.dispose();
  material.dispose();
  return texture;
}

/** Adds a fresnel rim to a standard material, tinted by its own (team) colour so silhouettes pop from the ground. */
export function addRim(
  material: THREE.MeshStandardMaterial,
  strength = 0.7,
): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += (diffuseColor.rgb * 0.7 + 0.1) * ${strength.toFixed(2)} *
        pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);`,
    );
  };
  material.customProgramCacheKey = () => "rim";
}

/** Draws the scene at a quality; dropping to `low` frees the post chain. */
export class Look {
  private composer: EffectComposer | undefined;
  /** Sees everything but the effects layer, so smoke and sparks cast no ambient occlusion. */
  private readonly aoCamera = new THREE.PerspectiveCamera();
  private size = { w: 1, h: 1, dpr: 1 };
  private ao: GTAOPass | undefined;
  private far = false;

  constructor(
    private readonly gl: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private quality: Quality,
  ) {
    // The render copies its matrices from the main camera; three must not recompute them.
    this.aoCamera.matrixAutoUpdate =
      this.aoCamera.matrixWorldAutoUpdate = false;
    // three draws the shadow map on every `render` call, and the post chain renders the scene twice (the colour pass
    // and ambient occlusion's normals): `render` asks for the shadows once a frame instead.
    gl.shadowMap.autoUpdate = false;
  }

  /** A strategic (far) view skips ambient occlusion: at that range it only greys the map and costs a full pass. */
  setFar(far: boolean): void {
    this.far = far;
    if (this.ao) this.ao.enabled = !far;
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    if (quality === "low") this.dispose();
    this.setSize(this.size.w, this.size.h, this.size.dpr);
  }

  /** Resizes the canvas and the post chain, building the chain once at `high`. */
  // prettier-ignore
  setSize(w: number, h: number, dpr: number): void {
    this.size = { w, h, dpr };
    const high = this.quality === "high", ratio = high ? Math.min(2, dpr) : 1;
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(w, h);
    if (high && !this.composer) {
      const composer = (this.composer = new EffectComposer(this.gl));
      composer.addPass(new RenderPass(this.scene, this.camera));
      const ao = new GTAOPass(this.scene, this.aoCamera, w, h);
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1 });
      ao.blendIntensity = 0.9;
      ao.enabled = !this.far;
      composer.addPass((this.ao = ao));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.45, 1.6));
      composer.addPass(new OutputPass());
      composer.addPass(new ShaderPass(GRADE));
      composer.addPass(new FXAAPass());
    }
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(w, h);
  }

  render(): void {
    this.gl.shadowMap.needsUpdate = true;
    if (!this.composer) return this.gl.render(this.scene, this.camera);
    // Only the pose and lens: `copy` would also clone userData every frame.
    const ao = this.aoCamera,
      cam = this.camera;
    ao.near = cam.near;
    ao.far = cam.far;
    ao.matrixWorld.copy(cam.matrixWorld);
    ao.matrixWorldInverse.copy(cam.matrixWorldInverse);
    ao.projectionMatrix.copy(cam.projectionMatrix);
    ao.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    this.composer.render();
  }

  dispose(): void {
    for (const pass of this.composer?.passes ?? []) pass.dispose();
    this.composer?.dispose();
    this.composer = this.ao = undefined;
  }
}
