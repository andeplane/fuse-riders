import {
  LIGHT_STRIDE,
  type LightRenderer,
  type LightTransform,
} from "./light-field.js";

const vertex = `#version 300 es
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
const fragment = `#version 300 es
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

/**
 * Draws a LightField additively on a canvas laid over the board. Returns null
 * where WebGL2 is unavailable; the game then simply renders without light.
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
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "light program failed");
  gl.useProgram(program);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const cornerAt = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(cornerAt);
  gl.vertexAttribPointer(cornerAt, 2, gl.FLOAT, false, 0, 0);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const bytes = LIGHT_STRIDE * 4;
  const attribute = (name: string, components: number, offset: number) => {
    const at = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, components, gl.FLOAT, false, bytes, offset * 4);
    gl.vertexAttribDivisor(at, 1);
  };
  attribute("center", 2, 0);
  attribute("size", 1, 2);
  attribute("color", 4, 3);
  attribute("sharpness", 1, 7);
  const board = gl.getUniformLocation(program, "board");
  const viewport = gl.getUniformLocation(program, "viewport");
  gl.enable(gl.BLEND);
  // Additive light, premultiplied: glows brighten whatever lies beneath.
  gl.blendFunc(gl.ONE, gl.ONE);
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
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawn = count > 0;
      if (!count) return;
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      // Column-major 3×3 from the CTM, scaled to device pixels.
      gl.uniformMatrix3fv(board, false, [
        t.a * ratio,
        t.b * ratio,
        0,
        t.c * ratio,
        t.d * ratio,
        0,
        t.e * ratio,
        t.f * ratio,
        1,
      ]);
      gl.uniform2f(viewport, width, height);
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        data.subarray(0, count * LIGHT_STRIDE),
        gl.STREAM_DRAW,
      );
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    },
  };
}
