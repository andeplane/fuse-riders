/**
 * Instance bookkeeping without three.js: one batch of matrices and colours per mesh kind, refilled every frame and
 * grown (doubling) when a frame holds more than it has room for. Nothing here allocates once a batch has grown.
 */

/** Writes a column-major 4×4 matrix at slot `i`: scale (sx, sy, sz), then a turn of `yaw` about y, then (x, y, z). */
// prettier-ignore
export function writeMatrix(out: Float32Array, i: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw), o = i * 16;
  out[o] = c * sx; out[o + 1] = 0; out[o + 2] = -s * sx; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = sy; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = s * sz; out[o + 9] = 0; out[o + 10] = c * sz; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

export class Batch {
  matrices: Float32Array;
  colors: Float32Array;
  count = 0;
  /** Set when the last frame outgrew the arrays, so the GPU side must be rebuilt around the new ones. */
  grown = false;

  constructor(public capacity = 64) {
    this.matrices = new Float32Array(capacity * 16);
    this.colors = new Float32Array(capacity * 3);
  }

  begin(): void {
    this.count = 0;
    this.grown = false;
  }

  // prettier-ignore
  push(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, rgb: readonly number[]): void {
    if (this.count === this.capacity) this.grow();
    writeMatrix(this.matrices, this.count, x, y, z, yaw, sx, sy, sz);
    this.colors[this.count * 3] = rgb[0]!;
    this.colors[this.count * 3 + 1] = rgb[1]!;
    this.colors[this.count * 3 + 2] = rgb[2]!;
    this.count++;
  }

  private grow(): void {
    this.capacity *= 2;
    const matrices = new Float32Array(this.capacity * 16),
      colors = new Float32Array(this.capacity * 3);
    matrices.set(this.matrices);
    colors.set(this.colors);
    this.matrices = matrices;
    this.colors = colors;
    this.grown = true;
  }
}
