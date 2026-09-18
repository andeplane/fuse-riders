import Phaser from "phaser";
import type { TrailStroke } from "./trails.js";
import { TrailRibbonCache, type TrailRibbon } from "./trail-ribbon.js";

const PIPELINE = "BeveledTrails";
const fragment = `
precision mediump float;
varying vec2 outTexCoord;
varying vec4 outTint;
uniform float uFeather;
void main () {
  vec2 planar = outTexCoord;
  float radius = length(planar);
  float coverage = 1.0 - smoothstep(1.0 - uFeather, 1.0 + uFeather, radius);
  // A shallow, softly rounded surface instead of a steep polished edge.
  vec3 normal = normalize(vec3(planar * 0.65, 0.45 + sqrt(max(0.0, 1.0 - radius * radius))));
  vec3 light = normalize(vec3(-0.45, -0.65, 0.85));
  float diffuse = max(0.0, dot(normal, light));
  vec3 halfLight = normalize(light + vec3(0.0, 0.0, 1.0));
  float specular = pow(max(0.0, dot(normal, halfLight)), 6.0);
  vec3 base = outTint.bgr;
  vec3 body = base * (0.62 + 0.42 * diffuse);
  body += mix(base, vec3(1.0), 0.25) * specular * 0.12;
  // A faint offset contact shadow supplies height without a bright/dark bevel rim.
  float shadowRadius = length(planar - vec2(0.10, 0.28));
  float shadow = 0.24 * (1.0 - smoothstep(0.75, 1.35, shadowRadius));
  float halo = 0.06 * pow(max(0.0, 1.0 - max(0.0, radius - 1.0) / 0.8), 2.0);
  float surroundAlpha = halo + shadow * (1.0 - halo);
  vec3 surround = base * 0.8 * halo + vec3(0.005, 0.008, 0.02) * shadow * (1.0 - halo);
  float alpha = coverage + surroundAlpha * (1.0 - coverage);
  vec3 shade = body * coverage + surround * (1.0 - coverage);
  gl_FragColor = vec4(shade, alpha) * outTint.a;
}`;

/** WebGL-only presentation. Phaser owns the program, buffers and context restoration. */
export class BeveledTrails extends Phaser.GameObjects.Extern {
  private readonly ribbonPipeline: Phaser.Renderer.WebGL.Pipelines.SinglePipeline;
  private ribbons: readonly TrailRibbon[] = [];
  private cache: TrailRibbonCache;
  private readonly visualWidth: number;

  constructor(scene: Phaser.Scene, trailWidth: number) {
    super(scene);
    // Slightly fuller silhouette; the authoritative collision width is unchanged.
    this.visualWidth = trailWidth * 1.25;
    this.cache = new TrailRibbonCache(this.visualWidth);
    const renderer = scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    this.ribbonPipeline = new Phaser.Renderer.WebGL.Pipelines.SinglePipeline({
      game: scene.game,
      fragShader: fragment,
    });
    renderer.pipelines.add(PIPELINE, this.ribbonPipeline);
  }

  updateTrails(strokes: readonly TrailStroke[]): void {
    this.ribbons = this.cache.update(strokes);
  }

  render(
    renderer?: Phaser.Renderer.WebGL.WebGLRenderer,
    camera?: Phaser.Cameras.Scene2D.Camera,
    matrix?: Phaser.GameObjects.Components.TransformMatrix,
  ): void {
    if (!renderer || !camera || !matrix || !this.ribbons.length) return;
    const pipeline = this.ribbonPipeline;
    renderer.pipelines.set(pipeline);
    const scale = Math.hypot(matrix.a, matrix.b);
    pipeline.set1f(
      "uFeather",
      Math.min(0.6, 0.65 / ((this.visualWidth / 2) * scale)),
    );
    let unit = pipeline.setTexture2D();
    for (const ribbon of this.ribbons) {
      const tint = Phaser.Renderer.WebGL.Utils.getTintAppendFloatAlpha(
        ribbon.color,
        ribbon.alpha * camera.alpha * this.alpha,
      );
      for (let i = 0; i < ribbon.vertices.length; i += 3) {
        if (pipeline.shouldFlush(3)) {
          pipeline.flush();
          unit = pipeline.setTexture2D();
        }
        for (let j = 0; j < 3; j++) {
          const v = ribbon.vertices[i + j];
          pipeline.batchVert(
            matrix.getX(v.x, v.y),
            matrix.getY(v.x, v.y),
            v.nx,
            v.ny,
            unit,
            0,
            tint,
          );
        }
      }
    }
    pipeline.flush();
  }
}
