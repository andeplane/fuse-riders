# Asset compression & offline optimisation

Tools verified Oct 2026: `@gltf-transform/cli` 4.5.1, `gltfpack` 1.3 / `meshoptimizer` 1.3 (zeux, MIT, ~8.3k★). Both commands below were run on a real 9.5 MB GLB (LittlestTokyo, animated).

## glTF-Transform CLI (`npx @gltf-transform/cli <cmd>`)

| Command | Use | Notes |
|---|---|---|
| `inspect in.glb` | **Always first.** Shows the scene vertex counts, per-mesh primitives (≈ draw calls), and per-texture size **and GPU size** | Paste the summary into your notes as the baseline |
| `optimize in.glb out.glb --compress meshopt --texture-compress ktx2 --texture-size 2048` | One-shot: dedup, instance (≥5 copies → `EXT_mesh_gpu_instancing`), palette, flatten, join, weld, simplify (error 1e-4), resample, prune, sparse, meshopt | **Defaults flatten + join** named nodes. For gameplay rigs/levels add `--join-named false --flatten false`, or `--join false` |
| `weld` → `simplify --ratio 0.5 --error 0.001 [--lock-border true]` | Decimation (meshoptimizer) | Weld first. The ratio is the share of **vertices** kept; the error is a fraction of mesh radius |
| `meshopt --level high` / `draco` / `quantize` | Geometry (+ animation for meshopt) compression | Meshopt is the default for games: fast decode, compresses morphs and animation, gzips well. Draco only for static geometry-heavy downloads |
| `etc1s --slots "{baseColorTexture,emissiveTexture}" --quality 128` | KTX2 ETC1S (small, lower quality) | Needs **KTX-Software** (`toktx`/`ktx`) on PATH, from KhronosGroup/KTX-Software releases |
| `uastc --slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}" --level 2 --rdo --zstd 18` | KTX2 UASTC (high quality) for normals/ORM | Bigger files. Use `--zstd` for supercompression |
| `resize --width 1024 --height 1024` | Cap texture size | Run before KTX encoding |
| `webp` / `avif` | Smaller **downloads** | VRAM is still w×h×4: they decode to RGBA |
| `instance --min 5`, `join`, `flatten`, `palette` | Draw-call reduction | `palette` merges flat-colour materials into one palette texture (great for low-poly kits) |
| `resample`, `sparse` | Animation size | Lossless keyframe dedup |

Recommended per asset class:

```bash
# static environment kit (props, buildings): draw calls + size
gltf-transform optimize kit.glb kit.opt.glb --compress meshopt --texture-compress ktx2 --texture-size 2048 --palette true
# characters (skinned, named bones/sockets, animations): keep hierarchy, gentle simplify
gltf-transform optimize hero.glb hero.opt.glb --compress meshopt --texture-compress ktx2 --texture-size 2048 \
  --flatten false --join false --simplify-error 0.0005
# finer KTX control: colour ETC1S, data UASTC
gltf-transform etc1s in.glb tmp.glb --slots "{baseColorTexture,emissiveTexture}" && \
gltf-transform uastc tmp.glb out.glb --slots "{normalTexture,metallicRoughnessTexture,occlusionTexture}" --level 2 --zstd 18
```

## gltfpack (`npx gltfpack` or native binary from meshoptimizer releases)

| Flag | Meaning |
|---|---|
| `-c` / `-cc` / `-cz` | Meshopt compression (`-cc` higher ratio; `-cz` max, uses KHR_meshopt_compression). `-ce khr\|ext` picks the extension |
| `-cf` | Compressed with an uncompressed fallback buffer |
| `-tc` / `-tu` | KTX2 BasisU ETC1S / UASTC (class-scoped: `-tu normal,attrib -tc color`). Needs a gltfpack **built with BasisU**; prefer the native release binary |
| `-tq N`, `-ts R`, `-tl N`, `-tp` | Texture quality 1–10, scale ratio, size limit, power-of-two |
| `-si R`, `-se E`, `-sa`, `-sp`, `-slb`, `-sv` | Simplify to ratio R, error limit (default 1 %), aggressive, permissive (across seams), lock borders, attribute-aware update |
| `-vp N`, `-vt N`, `-vn N`, `-vpf`, `-vtf` | Quantization bits. Use `-vtf` or more bits for tiling UVs outside [0,1] (gltfpack warns: "texture coordinate data has significant error") |
| `-kn`, `-km`, `-ke` | Keep named nodes/materials/extras. **Use `-kn` for anything gameplay code looks up by name** |
| `-mm`, `-mi` | Merge instances / emit `EXT_mesh_gpu_instancing` |
| `-af N`, `-ar N`, `-ac` | Animation resample rate (default 30 Hz), rotation bits, keep constant tracks |
| `-noq` | No quantization (bigger, maximally compatible) |
| `-r report.json` | JSON report for CI |

Measured run: `optimize --compress false` decoded the Draco input (9.47 MB raw, 5.0 MB gzipped). Then `gltfpack -cc -si 0.5 -kn` gave 3.16 MB (2.78 MB gzipped), with 423k → 213k rendered vertices.

**Gotchas:**
- **gltfpack can't read Draco-compressed input** ("file requires Draco mesh compression support"). Decode first with `gltf-transform optimize in.glb raw.glb --compress false --texture-compress false --simplify false`.
- Re-encoding Draco to meshopt can make the raw file *larger*. Compare **gzipped/brotli** sizes, since that's what the server sends. Make sure the server or CDN actually compresses `.glb` (`Content-Encoding`).
- Quantized meshes (`KHR_mesh_quantization`) store positions as int16 with a node scale. Runtime code that reads `geometry.attributes.position.array` as metres (physics colliders, runtime simplification) must dequantize or use the unquantized source.

## Loading in three.js

```ts
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);  // WebGPU: after await renderer.init()
const draco = new DRACOLoader().setDecoderPath('/draco/');                           // only if you have Draco assets
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2).setDRACOLoader(draco);
```

- Copy `node_modules/three/examples/jsm/libs/basis/` → `public/basis/` (and `draco/gltf/` → `public/draco/`), e.g. with `vite-plugin-static-copy`.
- Reuse **one** KTX2Loader per renderer; each spins up transcoder workers.
- GLTFLoader r187 supports `EXT_meshopt_compression`, `KHR_meshopt_compression`, `KHR_texture_basisu`, `EXT_texture_webp/avif` and `EXT_mesh_gpu_instancing` (→ `InstancedMesh`).

## Texture memory maths (2D, with mips ≈ ×1.33)

| Size | PNG/JPEG/WebP/AVIF → RGBA8 | KTX2 ETC1S → BC1/ETC1 (4 bpp, opaque) | KTX2 UASTC → BC7/ASTC 4×4 (8 bpp) |
|---|---|---|---|
| 1024² | 4 MiB (5.3) | 0.5 MiB (0.67) | 1 MiB (1.33) |
| 2048² | 16 MiB (21.3) | 2 MiB (2.7) | 4 MiB (5.3) |
| 4096² | 64 MiB (85) | 8 MiB (10.7) | 16 MiB (21.3) |

ETC1S with alpha transcodes to 8 bpp formats on most GPUs. A PBR material with 4 maps at 2048² as PNG costs about 85 MiB of VRAM. Ten such materials already blow a mobile budget, which is why KTX2 is mandatory on mobile.

**Atlasing / arrays:**
- Pack small props into one atlas (Blender bake, or `gltf-transform palette` for flat colours) so they can share one material, then BatchedMesh them.
- For terrain/voxel materials use `DataArrayTexture` / KTX2 array textures (`webgl_texture2darray_compressed`) indexed per vertex. That's one material for N surface types.
- Channel-pack grey maps: occlusion/roughness/metalness live in one ORM texture, as glTF already does for roughness+metalness.

## LOD chains offline

- **Authoring convention:** Blender exports nodes `Rock_LOD0`, `Rock_LOD1`, `Rock_LOD2` in one GLB. At runtime, group by prefix and `lod.addLevel(node, [0, 25, 60][i], 0.1)`.
- **Generated:** `gltf-transform simplify rock.glb rock_lod1.glb --ratio 0.35 --error 0.01` (and 0.1 for LOD2). At runtime, take only the geometry from those files and reuse LOD0's material. Separate files duplicate textures, so it's better to have blender-mcp add Decimate-generated `_LOD1/_LOD2` nodes into the same GLB.
- **Runtime instead:** see `buildLODs` in `runtime-techniques.md` (works on unquantized geometry).
- **Unity 6.2 Mesh LOD** and **Godot auto-LOD** generate these on import. See `engines.md`.

## Download budget tactics

- Ship a tiny first scene: proxy LODs plus low-res textures. Stream the rest by zone. Progressive: `@needle-tools/gltf-progressive`.
- Use a HTTP cache with content-hashed filenames (Vite does this for imported assets). For big binaries outside `src/`, add a manifest with hashes.
- Audio is often the biggest download. Use Opus/AAC at 96–128 kbps and stream music (see `game-audio`).
