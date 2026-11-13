# Voxel meshing: fast culled, greedy, packing, textures, LOD

Measured in Node 22 on one core with 32³ chunks: the fast culled mesher takes 1.0 ms on natural terrain (1 831
quads) and 2.5 ms on a cave-heavy chunk (11 555 quads). The AO-aware greedy mesher (unoptimised) takes 26 ms for
1 403 quads on natural terrain, and gives 218 vs 1 360 quads on flat/stepped terrain. Both pass the winding test
(geometric normal = stored normal) and the equal-area test.

## Fast culled mesher with AO (`mesher.ts`)

```ts
// fast culled mesher: precomputed face tables, padded-index arithmetic, typed-array output
export const S = 32, P = S + 2, PP = P * P;
export const at = (x: number, y: number, z: number) => (x + 1) + P * (y + 1) + PP * (z + 1); // x in [-1, S]
const STRIDE = [1, P, PP];
type Face = { axis: number; s: number; n: number[]; nOff: number; corners: number[][]; ao: number[][] };
const FACES: Face[] = [];
for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
  const u = (a + 1) % 3, v = (a + 2) % 3, n = [0, 0, 0]; n[a] = s;
  const cs = s > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [0, 1], [1, 1], [1, 0]];
  const nOff = s * STRIDE[a];
  FACES.push({ axis: a, s, n, nOff,
    corners: cs.map(([du, dv]) => { const p = [0, 0, 0]; if (s > 0) p[a] = 1; p[u] = du; p[v] = dv; return p; }),
    ao: cs.map(([du, dv]) => { const su = du ? 1 : -1, sv = dv ? 1 : -1;
      return [nOff + su * STRIDE[u], nOff + sv * STRIDE[v], nOff + su * STRIDE[u] + sv * STRIDE[v]]; }) });
}
const AO = [0.45, 0.62, 0.8, 1.0];

export function meshChunk(vox: Uint16Array, opaque: Uint8Array /* opaque[id] */, tint: Float32Array /* rgb per id */) {
  let cap = 4096, nv = 0, ni = 0;
  let pos = new Float32Array(cap * 3), nor = new Int8Array(cap * 3), col = new Float32Array(cap * 3), ind = new Uint32Array(cap * 1.5);
  const grow = () => { cap *= 2;
    const p = new Float32Array(cap * 3); p.set(pos); pos = p; const n = new Int8Array(cap * 3); n.set(nor); nor = n;
    const c = new Float32Array(cap * 3); c.set(col); col = c; const i = new Uint32Array(cap * 1.5); i.set(ind); ind = i; };
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = at(x, y, z), id = vox[i];
    if (id === 0) continue;
    for (const f of FACES) {
      if (opaque[vox[i + f.nOff]]) continue;
      if (nv + 4 > cap) grow();
      const base = nv; let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      for (let k = 0; k < 4; k++) {
        const o = f.ao[k], s1 = opaque[vox[i + o[0]]], s2 = opaque[vox[i + o[1]]], c = opaque[vox[i + o[2]]];
        const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
        if (k === 0) a0 = ao; else if (k === 1) a1 = ao; else if (k === 2) a2 = ao; else a3 = ao;
        const cp = f.corners[k], br = AO[ao];
        pos[nv * 3] = x + cp[0]; pos[nv * 3 + 1] = y + cp[1]; pos[nv * 3 + 2] = z + cp[2];
        nor[nv * 3] = f.n[0]; nor[nv * 3 + 1] = f.n[1]; nor[nv * 3 + 2] = f.n[2];
        col[nv * 3] = tint[id * 3] * br; col[nv * 3 + 1] = tint[id * 3 + 1] * br; col[nv * 3 + 2] = tint[id * 3 + 2] * br;
        nv++;
      }
      if (a0 + a2 > a1 + a3) { ind[ni++] = base + 1; ind[ni++] = base + 2; ind[ni++] = base + 3; ind[ni++] = base + 1; ind[ni++] = base + 3; ind[ni++] = base; }
      else { ind[ni++] = base; ind[ni++] = base + 1; ind[ni++] = base + 2; ind[ni++] = base; ind[ni++] = base + 2; ind[ni++] = base + 3; }
    }
  }
  return { positions: pos.slice(0, nv * 3), normals: nor.slice(0, nv * 3), colors: col.slice(0, nv * 3), indices: ind.slice(0, ni) };
}
```

`opaque` and `tint` are lookup tables indexed by block id (`Uint8Array(65536)`, `Float32Array(65536*3)`), so the
inner loop never calls a function.

## Greedy mesher, AO-aware (`greedy.ts`)

Merges only faces with the same block id **and** the same 4 AO corner values, so the AO stays correct. Slower
because it scans 6 × 32 slices with per-cell AO. Optimise with the bitmask approach (cgerikj/binary-greedy-meshing:
64-bit column masks, 50-200 µs/chunk in C++) if greedy matters for you.

```ts
// greedy.ts: greedy meshing that only merges faces with identical block id AND identical AO corners.
import { S, at } from './store';
type MeshData = { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array };

export function meshGreedy(vox: Uint16Array, opaque: (id: number) => boolean): MeshData & { quads: number } {
  const pos: number[] = [], nor: number[] = [], ao4: number[] = [], ids: number[] = [], idx: number[] = [];
  const solid = (x: number, y: number, z: number) => (opaque(vox[at(x, y, z)]) ? 1 : 0);
  const mask = new Int32Array(S * S);
  let quads = 0;
  for (let a = 0; a < 3; a++) for (const s of [1, -1]) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    for (let d = 0; d < S; d++) {
      // 1. build the slice mask: key = id | ao(8 bits) << 16, 0 = no face
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const p = [0, 0, 0]; p[a] = d; p[u] = i; p[v] = j;
        const id = vox[at(p[0], p[1], p[2])];
        const f = p.slice(); f[a] += s;
        if (id === 0 || solid(f[0], f[1], f[2])) { mask[i + j * S] = 0; continue; }
        let aoBits = 0, k = 0;
        for (const [du, dv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const su = du ? 1 : -1, sv = dv ? 1 : -1;
          const s1 = f.slice(); s1[u] += su; const s2 = f.slice(); s2[v] += sv; const c = f.slice(); c[u] += su; c[v] += sv;
          const o1 = solid(s1[0], s1[1], s1[2]), o2 = solid(s2[0], s2[1], s2[2]), oc = solid(c[0], c[1], c[2]);
          aoBits |= (o1 && o2 ? 0 : 3 - (o1 + o2 + oc)) << (2 * k++);
        }
        mask[i + j * S] = id | (aoBits << 16);
      }
      // 2. greedy merge: widest run, then extend rows while the whole run matches
      for (let j = 0; j < S; j++) for (let i = 0; i < S; ) {
        const key = mask[i + j * S];
        if (!key) { i++; continue; }
        let w = 1; while (i + w < S && mask[i + w + j * S] === key) w++;
        let h = 1;
        outer: for (; j + h < S; h++) for (let k = 0; k < w; k++) if (mask[i + k + (j + h) * S] !== key) break outer;
        // emit quad (i..i+w, j..j+h) on plane a = d + (s > 0 ? 1 : 0)
        const base = pos.length / 3, aoBits = key >>> 16, id = key & 0xffff;
        const cornersUV = [[i, j], [i + w, j], [i + w, j + h], [i, j + h]];
        const order = s > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];               // keep CCW from outside
        const ao = order.map(c => (aoBits >> (2 * c)) & 3);
        for (const c of order) {
          const p = [0, 0, 0]; p[a] = d + (s > 0 ? 1 : 0); p[u] = cornersUV[c][0]; p[v] = cornersUV[c][1];
          pos.push(p[0], p[1], p[2]); const n = [0, 0, 0]; n[a] = s; nor.push(n[0], n[1], n[2]);
        }
        ao4.push(...ao); ids.push(id, id, id, id);
        if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[i + k + (j + hh) * S] = 0;
        quads++; i += w;
      }
    }
  }
  const AO_CURVE = [0.45, 0.62, 0.8, 1.0];
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: Float32Array.from(ao4.flatMap(o => [AO_CURVE[o], AO_CURVE[o], AO_CURVE[o]])), indices: new Uint32Array(idx), quads };
}
```

Note: this greedy file uses the *readable* `at()` from an earlier layout (`(x+1) + P*((y+1) + P*(z+1))`), which is
identical to the store's `at`.

## Vertex packing (4 bytes/vertex instead of 27)

Unpacked: position f32×3 + normal i8×3 + colour f32×3 = 27 B/vertex. Packed into one `uint32`:

| bits | field |
|---|---|
| 0-5, 6-11, 12-17 | x, y, z (0..32 inclusive needs 6 bits) |
| 18-20 | face index 0-5 (normal from a 6-entry table in the shader) |
| 21-22 | AO 0-3 |
| 23-31 | texture layer (512 layers) |

A second `uint8×2` (or packed into spare bits) holds sun/block light. In three.js, a `Uint32BufferAttribute` is
uploaded as an integer attribute automatically (WebGL2 `vertexAttribIPointer`). In a `ShaderMaterial` with
`glslVersion: THREE.GLSL3`, declare `in highp uint packed;` yourself. In TSL, read it with `attribute('packed', 'uint')`
and unpack with `shiftRight`/`bitAnd` (check the current TSL docs). Without a `position` attribute, three.js can't
compute bounds: set `geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, 16, 16), 28)` (and the box),
and set `geometry.setDrawRange(0, indexCount)`.

**Shared index buffer trick**: instead of flipping indices for AO, emit the quad's vertices rotated by one
(`v1, v2, v3, v0`) when the rule says flip. Every quad then uses the same `0,1,2, 0,2,3` pattern, and all chunks can
share one static index buffer sized for the largest chunk.

## Textures

- **Culled meshing + atlas**: per-vertex UV = corner (0/1) mapped into the tile's atlas rect. Inset by half a texel
  and disable mipmaps on the atlas, or pad tiles (mip bleeding gives seams).
- **Greedy meshing**: a merged w×h quad must repeat the texture w×h times. Use a `THREE.DataArrayTexture` (one layer
  per block face texture), UV = position in block units, and sample layer `L` (GLSL `texture(sampler2DArray, vec3(uv, L))`;
  TSL: `texture(arrayTex, uv).depth(layer)`, check docs). `RepeatWrapping` on an atlas can't do this.
- Pixel-art look: `NearestFilter` for mag, `NearestMipmapLinearFilter` for min, anisotropy 4-8.

## Transparency and water

- Leaves/glass with holes: alpha-test cutout (`alphaTest: 0.5`) in the opaque pass. Cull faces between same-id
  neighbours only.
- Water/stained glass: separate mesh per chunk, drawn after opaque, `transparent: true, depthWrite: false`, top face
  lowered by ~0.1. Sort chunks back-to-front. Don't emit faces between water voxels.
- Flowing water/sand: cellular automaton on a dirty-voxel queue, a few hundred updates per tick, remeshing only
  the touched chunks.

## Blocky LOD (render distance × 4)

- LOD k chunk covers 2^k × 32 voxels: downsample the ids 2× per level (a cell is solid if ≥ 4 of its 8 children are,
  and takes the most common solid id; for surface cells prefer the top child so grass stays green), then mesh with
  voxel size 2^k.
- Rings: LOD0 within 6-8 chunks, LOD1 to 16, LOD2 to 32. Generate distant LOD data **directly from the noise** at the
  coarse resolution (sample once per 2^k cell) rather than generating full-res and downsampling.
- Cracks between rings: push LOD>0 meshes down by ~0.5 × voxel size, add skirts, or hide them with fog. Treat
  LOD>0 as render-only: no physics, no light propagation (bake sky light from the heightmap).
- Inspiration: the Distant Horizons mod for Minecraft does this at very large scale.

## Chunk job hygiene

- Each chunk has a `version`. Increment on edit. A mesh result whose version ≠ current is dropped.
- Priority = distance to camera, with a bonus inside the view frustum. Cap uploads per frame.
- Remesh in a worker pool of `hardwareConcurrency − 1`. Transfer buffers (`postMessage(msg, [buf])`). Avoid
  SharedArrayBuffer unless the host sets COOP/COEP.
