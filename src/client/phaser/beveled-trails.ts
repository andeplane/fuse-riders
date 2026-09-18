import Phaser from "phaser";
import type { TrailStroke } from "./trails.js";
import { TrailRibbonCache, type TrailRibbon } from "./trail-ribbon.js";

type WebGLRenderer = Phaser.Renderer.WebGL.WebGLRenderer;
type DrawingContext = Phaser.Renderer.WebGL.DrawingContext;
type TransformMatrix = Phaser.GameObjects.Components.TransformMatrix;
type ProgramWrapper = Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;
type BufferWrapper = Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper;
type VAOWrapper = Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
type AttributeBufferLayout =
  Phaser.Types.Renderer.WebGL.WebGLAttributeBufferLayout;

// Screen-space position, ribbon-space normal, RGBA8 colour with the draw alpha.
const FLOATS_PER_VERTEX = 4;
const STRIDE = FLOATS_PER_VERTEX * 4 + 4;
const INITIAL_VERTICES = 4096;

const vertex = `
precision highp float;
attribute vec2 inPosition;
attribute vec2 inNormal;
attribute vec4 inColor;
uniform vec2 uResolution;
varying vec2 outTexCoord;
varying vec4 outTint;
void main () {
  // Positions arrive in top-left, Y-down drawing-context pixels.
  gl_Position = vec4(
    inPosition.x / uResolution.x * 2.0 - 1.0,
    1.0 - inPosition.y / uResolution.y * 2.0,
    0.0,
    1.0
  );
  outTexCoord = inNormal;
  outTint = inColor;
}`;

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
  vec3 base = outTint.rgb;
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
  // Premultiplied output for Phaser's NORMAL blend (ONE, ONE_MINUS_SRC_ALPHA).
  gl_FragColor = vec4(shade, alpha) * outTint.a;
}`;

interface Resources {
  renderer: WebGLRenderer;
  program: ProgramWrapper;
  buffer: BufferWrapper;
  vao: VAOWrapper;
}

/**
 * WebGL-only presentation, drawn inside Phaser 4's Extern yield/rebind bracket.
 * The program, buffer and VAO are the renderer's tracked wrappers, so Phaser
 * recreates them (and re-uploads the last vertex data) on context restore.
 */
export class BeveledTrails extends Phaser.GameObjects.Extern {
  private ribbons: readonly TrailRibbon[] = [];
  private cache: TrailRibbonCache;
  private readonly visualWidth: number;
  private resources: Resources | undefined;
  private failed = false;
  private capacity = 0;
  private uploaded = {
    ribbons: undefined as readonly TrailRibbon[] | undefined,
    matrix: [NaN, NaN, NaN, NaN, NaN, NaN],
    alpha: NaN,
    count: 0,
  };

  constructor(scene: Phaser.Scene, trailWidth: number) {
    super(scene);
    // Slightly fuller silhouette; the authoritative collision width is unchanged.
    this.visualWidth = trailWidth * 1.25;
    this.cache = new TrailRibbonCache(this.visualWidth);
  }

  updateTrails(strokes: readonly TrailStroke[]): void {
    this.ribbons = this.cache.update(strokes);
  }

  override render(
    renderer: WebGLRenderer,
    drawingContext: DrawingContext,
    calcMatrix: TransformMatrix,
  ): void {
    // The arena camera never renders through a framebuffer (no camera alpha,
    // filters or forceComposite); that path would need a different matrix.
    if (!this.ribbons.length || !drawingContext.useCanvas) return;
    if (this.failed || renderer.contextLost || !renderer.gl) return;
    let resources: Resources;
    try {
      resources = this.resources ??= this.createResources(renderer);
      if (resources.program.compiling) {
        resources.program.checkParallelCompile();
        if (resources.program.compiling) return;
      }
    } catch (error) {
      // A shader that will not build fails once, not on every frame; the rest of the arena keeps rendering.
      this.failed = true;
      this.releaseResources();
      console.error("Beveled trails disabled", error);
      return;
    }
    const { program, vao } = resources;
    // The framebuffer early return above means camera alpha is always 1 here.
    const count = this.upload(resources, calcMatrix, this.alpha);
    if (!count) return;
    const scale = Math.hypot(calcMatrix.a, calcMatrix.b);
    program.setUniform(
      "uFeather",
      Math.min(0.6, 0.65 / ((this.visualWidth / 2) * scale)),
    );
    program.setUniform("uResolution", [
      drawingContext.width,
      drawingContext.height,
    ]);
    // YieldContext reset blend and VAO; beginDraw binds this camera's
    // framebuffer, scissor, viewport and NORMAL blend.
    drawingContext.beginDraw();
    program.bind();
    vao.bind();
    renderer.gl.drawArrays(renderer.gl.TRIANGLES, 0, count);
  }

  override destroy(fromScene?: boolean): void {
    this.releaseResources();
    super.destroy(fromScene);
  }

  private createResources(renderer: WebGLRenderer): Resources {
    const gl = renderer.gl;
    let program: ProgramWrapper | undefined;
    let buffer: BufferWrapper | undefined;
    try {
      // A compile error surfaces here or later in checkParallelCompile; either way nothing stays registered.
      program = renderer.createProgram(vertex, fragment);
      buffer = renderer.createVertexBuffer(
        new ArrayBuffer(INITIAL_VERTICES * STRIDE),
        gl.DYNAMIC_DRAW,
      );
      return this.createVAO(renderer, program, buffer);
    } catch (error) {
      if (buffer) renderer.deleteBuffer(buffer);
      if (program) renderer.deleteProgram(program);
      throw error;
    }
  }

  private createVAO(
    renderer: WebGLRenderer,
    program: ProgramWrapper,
    buffer: BufferWrapper,
  ): Resources {
    const gl = renderer.gl;
    this.capacity = INITIAL_VERTICES;
    // The shape WebGLVAOWrapper reads at runtime (and again on restore). Phaser's
    // typings for WebGLVertexBufferLayoutWrapper/createVAO disagree with 4.2.1's
    // source, so the layout is built here instead of through that constructor.
    const attribute = (
      name: string,
      size: number,
      type: number,
      normalized: boolean,
      offset: number,
      bytes: number,
    ) => ({ name, size, type, normalized, offset, bytes, columns: 1 });
    const layout = {
      buffer,
      layout: {
        stride: STRIDE,
        count: INITIAL_VERTICES,
        usage: gl.DYNAMIC_DRAW,
        layout: [
          attribute("inPosition", 2, gl.FLOAT, false, 0, 4),
          attribute("inNormal", 2, gl.FLOAT, false, 8, 4),
          attribute("inColor", 4, gl.UNSIGNED_BYTE, true, 16, 1),
        ],
      },
    };
    const vao = renderer.createVAO(
      program,
      // No index buffer: the ribbons are drawn as plain TRIANGLES arrays.
      undefined as unknown as BufferWrapper,
      [layout] as unknown as AttributeBufferLayout[],
    );
    return { renderer, program, buffer, vao };
  }

  /** Writes screen-space vertices when ribbons, matrix or alpha changed; returns the vertex count. */
  private upload(
    resources: Resources,
    m: TransformMatrix,
    alpha: number,
  ): number {
    const last = this.uploaded;
    const matrix = [m.a, m.b, m.c, m.d, m.e, m.f];
    if (
      last.ribbons === this.ribbons &&
      last.alpha === alpha &&
      matrix.every((value, i) => value === last.matrix[i])
    )
      return last.count;
    let count = 0;
    for (const ribbon of this.ribbons) count += ribbon.vertices.length;
    const { buffer } = resources;
    if (count > this.capacity) {
      this.capacity = Math.max(count, this.capacity * 2);
      buffer.resize(this.capacity * STRIDE);
    }
    const f32 = buffer.viewF32!;
    const u8 = buffer.viewU8;
    // Matches Phaser 3's getTintAppendFloatAlpha truncation of the draw alpha.
    const a = ((alpha * 255) | 0) & 0xff;
    let v = 0;
    for (const ribbon of this.ribbons) {
      const r = (ribbon.color >> 16) & 0xff;
      const g = (ribbon.color >> 8) & 0xff;
      const b = ribbon.color & 0xff;
      for (const point of ribbon.vertices) {
        const f = v * (STRIDE / 4);
        f32[f] = m.getX(point.x, point.y);
        f32[f + 1] = m.getY(point.x, point.y);
        f32[f + 2] = point.nx;
        f32[f + 3] = point.ny;
        const c = v * STRIDE + 16;
        u8[c] = r;
        u8[c + 1] = g;
        u8[c + 2] = b;
        u8[c + 3] = a;
        v++;
      }
    }
    if (count) buffer.update(count * STRIDE);
    last.ribbons = this.ribbons;
    last.alpha = alpha;
    last.matrix = matrix;
    last.count = count;
    return count;
  }

  private releaseResources(): void {
    const resources = this.resources;
    this.resources = undefined;
    if (!resources?.renderer.gl) return;
    const { renderer } = resources;
    // Phaser has no deleteVAO; drop it from the restore list by hand so a
    // later context restore never rebuilds a destroyed VAO.
    Phaser.Utils.Array.Remove(renderer.glVAOWrappers, resources.vao);
    resources.vao.destroy();
    renderer.deleteBuffer(resources.buffer);
    renderer.deleteProgram(resources.program);
  }
}
