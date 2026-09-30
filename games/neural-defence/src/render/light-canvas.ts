import {
  LIGHT_STRIDE,
  type LightRenderer,
  type LightTransform,
} from "./light-field.js";

const lightVertex = `#version 300 es
in vec2 corner;
in vec2 center;
in float size;
in vec4 color;
in float sharpness;
uniform mat3 board;
uniform vec2 viewport;
out vec2 local;
out vec4 tint;
out float falloff;
void main() {
  vec2 world = center + corner * size;
  vec2 pixel = (board * vec3(world, 1.0)).xy;
  gl_Position = vec4(pixel / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  local = corner;
  tint = color;
  falloff = sharpness;
}`;
const lightFragment = `#version 300 es
precision mediump float;
in vec2 local;
in vec4 tint;
in float falloff;
out vec4 outColor;
void main() {
  float d2 = dot(local, local);
  if (d2 > 1.0) discard;
  float light = exp(-d2 * falloff) * (1.0 - d2);
  float a = tint.a * light;
  outColor = vec4(tint.rgb * a, a);
}`;
/** A full-screen pass: texture coordinates from the quad's corners. */
const screenVertex = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;
/** One direction of a 9-tap Gaussian; run horizontally, then vertically. */
const blurFragment = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D source;
uniform vec2 texel;
out vec4 outColor;
void main() {
  vec4 sum = texture(source, uv) * 0.2270270270;
  sum += texture(source, uv + texel * 1.3846153846) * 0.3162162162;
  sum += texture(source, uv - texel * 1.3846153846) * 0.3162162162;
  sum += texture(source, uv + texel * 3.2307692308) * 0.0702702703;
  sum += texture(source, uv - texel * 3.2307692308) * 0.0702702703;
  outColor = sum;
}`;
const compositeFragment = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D source;
uniform float strength;
out vec4 outColor;
void main() {
  outColor = texture(source, uv) * strength;
}`;

/** Bloom works at a quarter of the canvas resolution; blur is cheap there. */
const BLOOM_SCALE = 0.25;
const BLOOM_STRENGTH = 0.7;

/**
 * Draws a LightField additively on a canvas laid over the board, with a bloom
 * pass: the lights are rendered small, blurred twice (the second wider), and
 * added back over the sharp lights. Returns null where WebGL2 is unavailable;
 * the game then simply renders without light.
 */
export function createWebGlLightRenderer(
  canvas: HTMLCanvasElement,
  pixelRatio: () => number,
): LightRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
  });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "light shader failed");
    return shader;
  };
  const link = (vertex: string, fragment: string) => {
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "light program failed");
    return program;
  };
  const lights = link(lightVertex, lightFragment);
  const blur = link(screenVertex, blurFragment);
  const composite = link(screenVertex, compositeFragment);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  // Instanced light quads.
  const lightVao = gl.createVertexArray();
  gl.bindVertexArray(lightVao);
  const cornerAt = gl.getAttribLocation(lights, "corner");
  gl.enableVertexAttribArray(cornerAt);
  gl.vertexAttribPointer(cornerAt, 2, gl.FLOAT, false, 0, 0);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const bytes = LIGHT_STRIDE * 4;
  const attribute = (name: string, components: number, offset: number) => {
    const at = gl.getAttribLocation(lights, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, components, gl.FLOAT, false, bytes, offset * 4);
    gl.vertexAttribDivisor(at, 1);
  };
  attribute("center", 2, 0);
  attribute("size", 1, 2);
  attribute("color", 4, 3);
  attribute("sharpness", 1, 7);
  // Full-screen passes share one quad.
  const screenVao = gl.createVertexArray();
  gl.bindVertexArray(screenVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  for (const program of [blur, composite]) {
    const at = gl.getAttribLocation(program, "corner");
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  }
  gl.bindVertexArray(null);

  const board = gl.getUniformLocation(lights, "board");
  const viewport = gl.getUniformLocation(lights, "viewport");
  const blurSource = gl.getUniformLocation(blur, "source");
  const blurTexel = gl.getUniformLocation(blur, "texel");
  const compositeSource = gl.getUniformLocation(composite, "source");
  const compositeStrength = gl.getUniformLocation(composite, "strength");

  // Half-float targets keep overlapping lights from clipping before the blur.
  const float = !!gl.getExtension("EXT_color_buffer_float");
  const targets = [0, 1].map(() => ({
    texture: gl.createTexture()!,
    framebuffer: gl.createFramebuffer()!,
  }));
  let bloomWidth = 0,
    bloomHeight = 0;
  const sizeTargets = (width: number, height: number) => {
    if (width === bloomWidth && height === bloomHeight) return;
    bloomWidth = width;
    bloomHeight = height;
    for (const target of targets) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        float ? gl.RGBA16F : gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        target.texture,
        0,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const drawLights = (
    count: number,
    t: LightTransform,
    scale: number,
    width: number,
    height: number,
  ) => {
    gl.useProgram(lights);
    gl.bindVertexArray(lightVao);
    // Column-major 3×3 from the CTM, scaled to the target's pixels.
    gl.uniformMatrix3fv(board, false, [
      t.a * scale,
      t.b * scale,
      0,
      t.c * scale,
      t.d * scale,
      0,
      t.e * scale,
      t.f * scale,
      1,
    ]);
    gl.uniform2f(viewport, width, height);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  };
  const blurPass = (
    from: WebGLTexture,
    to: WebGLFramebuffer,
    dx: number,
    dy: number,
  ) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, to);
    gl.useProgram(blur);
    gl.bindVertexArray(screenVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform1i(blurSource, 0);
    gl.uniform2f(blurTexel, dx / bloomWidth, dy / bloomHeight);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  let drawn = true;
  return {
    draw(data, count, t: LightTransform) {
      const ratio = pixelRatio();
      const width = Math.round(t.width * ratio),
        height = Math.round(t.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (!count && !drawn) return;
      drawn = count > 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!count) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        data.subarray(0, count * LIGHT_STRIDE),
        gl.STREAM_DRAW,
      );
      // 1. The lights, small, into the first bloom target.
      const bw = Math.max(1, Math.round(width * BLOOM_SCALE)),
        bh = Math.max(1, Math.round(height * BLOOM_SCALE));
      sizeTargets(bw, bh);
      const a = targets[0]!,
        b = targets[1]!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
      gl.viewport(0, 0, bw, bh);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      drawLights(count, t, ratio * BLOOM_SCALE, bw, bh);
      // 2. Blur twice, the second pass twice as wide.
      gl.disable(gl.BLEND);
      blurPass(a.texture, b.framebuffer, 1, 0);
      blurPass(b.texture, a.framebuffer, 0, 1);
      blurPass(a.texture, b.framebuffer, 2, 0);
      blurPass(b.texture, a.framebuffer, 0, 2);
      // 3. The sharp lights and the bloom, added onto the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      drawLights(count, t, ratio, width, height);
      gl.useProgram(composite);
      gl.bindVertexArray(screenVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.texture);
      gl.uniform1i(compositeSource, 0);
      gl.uniform1f(compositeStrength, BLOOM_STRENGTH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
