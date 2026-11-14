# Textures, HDRIs and texture tools

## Build-time fetch (Poly Haven + ambientCG)
Assets are CC0. The Poly Haven **API** terms (free, commercial OK) require a unique `User-Agent`, and a visible "Powered by Poly Haven" credit only if your product surfaces content from the live API. Fetching once at build time and self-hosting avoids the live-API credit. Keep the `CREDITS.md` row anyway. The API response shapes below were verified on 2026-10-31 (`/files/{id}` → map key → resolution → format → `{url, md5, size}`; HDRIs under `hdri`; ambientCG v3 `downloads[].attributes` like `2K-JPG`).

```ts
// tools/fetch-textures.ts — run at build time: `npx tsx tools/fetch-textures.ts`
// Downloads CC0 maps once into public/, so the game never calls the live API (no credit required for assets).
import { mkdir, writeFile, appendFile } from 'node:fs/promises';

const UA = 'my-game-asset-fetch/1.0 (+https://example.com)';   // Poly Haven requires a unique User-Agent
type PHFile = { url: string; md5: string; size: number };
type PHFiles = Record<string, Record<string, Record<string, PHFile>>>;

async function get(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

export async function polyhavenTexture(id: string, res = '2k') {
  const files = (await (await get(`https://api.polyhaven.com/files/${id}`)).json()) as PHFiles;
  const maps: Record<string, string> = { Diffuse: 'diff', nor_gl: 'nor_gl', arm: 'arm' };   // arm = AO/Rough/Metal
  await mkdir(`public/tex/${id}`, { recursive: true });
  for (const [key, short] of Object.entries(maps)) {
    const f = files[key]?.[res]?.jpg;
    if (!f) { console.warn(`missing ${key} ${res} for ${id}`); continue; }
    await writeFile(`public/tex/${id}/${id}_${short}_${res}.jpg`, Buffer.from(await (await get(f.url)).arrayBuffer()));
  }
  await appendFile('CREDITS.md', `| ${id} | Poly Haven | CC0 | https://polyhaven.com/a/${id} |\n`);
}

export async function polyhavenHdri(id: string, res = '2k') {
  const files = (await (await get(`https://api.polyhaven.com/files/${id}`)).json()) as PHFiles;
  const f = files.hdri[res].hdr;
  await mkdir('public/hdri', { recursive: true });
  await writeFile(`public/hdri/${id}_${res}.hdr`, Buffer.from(await (await get(f.url)).arrayBuffer()));
  await appendFile('CREDITS.md', `| ${id} | Poly Haven | CC0 | https://polyhaven.com/a/${id} |\n`);
}

export async function ambientcgZip(id: string, attr = '2K-JPG') {
  const j = await (await get(`https://ambientCG.com/api/v3/assets?id=${id}&include=downloads`)).json() as
    { assets: { id: string; downloads: { attributes: string; url: string }[] }[] };
  const d = j.assets[0]?.downloads.find((x) => x.attributes === attr);
  if (!d) throw new Error(`no ${attr} for ${id}`);
  await mkdir('assets-src/ambientcg', { recursive: true });
  await writeFile(`assets-src/ambientcg/${id}_${attr}.zip`, Buffer.from(await (await get(d.url)).arrayBuffer()));
  // unzip; keep *_Color, *_NormalGL, *_Roughness, *_AmbientOcclusion (pack R=AO,G=Rough,B=Metal yourself for one ORM map)
  await appendFile('CREDITS.md', `| ${id} | ambientCG | CC0 | https://ambientcg.com/view?id=${id} |\n`);
}
```

Map naming → three.js slots:

| Poly Haven key | ambientCG file (typical) | three.js slot | colorSpace |
|---|---|---|---|
| `Diffuse` (`_diff_`) | `_Color` | `map` | `SRGBColorSpace` |
| `nor_gl` (not `nor_dx`) | `_NormalGL` | `normalMap` | `NoColorSpace` |
| `arm` (R AO, G rough, B metal) | pack yourself | `aoMap` + `roughnessMap` + `metalnessMap` (same texture) | `NoColorSpace` |
| `Rough` / `AO` / `Displacement` | `_Roughness` / `_AmbientOcclusion` / `_Displacement` | single-channel maps; displacement needs dense geometry, so prefer skipping it | `NoColorSpace` |
| `gltf` (per resolution) | n/a | load the whole material via GLTFLoader | auto |

HDRIs: use 2k for lighting (`scene.environment`) and 4k+ only when visible as the background. "Pure sky" HDRIs (no ground) suit open worlds with your own terrain. Use `GroundedSkybox` (`three/addons/objects/GroundedSkybox.js`, WebGL) or `tsl/utils/GroundedSkybox.js` (WebGPU) to put a ground under a full HDRI. For a smaller download, convert to UltraHDR JPEG (gain map) and load with `UltraHDRLoader` (example `webgl_loader_texture_ultrahdr`; check the converter tooling).

## Compression (summary, details in game-performance-optimization)
- KTX2/Basis: ETC1S for albedo (small), UASTC for normal maps and anything with sharp detail. `KTX2Loader.setTranscoderPath(...)`, `.detectSupport(renderer)` (after `await renderer.init()` on WebGPU). `gltf-transform optimize in.glb out.glb --texture-compress ktx2`.
- Texture arrays and atlases compress too (KTX2 arrays → `CompressedArrayTexture`).
- GPU memory for a 2k RGBA8 texture with mips is ≈ 22 MB uncompressed vs ≈ 5.6 MB as BC7/ASTC 4×4 (1 byte/px). A dozen uncompressed terrain layers kills mobile.

## Material Maker (RodZill4/material-maker; MIT; 6.0k★; v1.4 Oct 2025, built on Godot 4.4)
- Node graph like Substance Designer, plus a 3D painting mode (experimental in 1.4) and mesh-map baking (MeshMap node: curvature, AO, thickness).
- Export: Godot `.tres`, Unity `.mat` (URP), Unreal 4/5, or "Blender" (= PNG/EXR maps, OpenGL normals). **For three.js, use the Blender target** and take the PNGs. A command-line export exists (see the docs' "Command line arguments" page), so an agent can re-export after editing the `.ptex` graph, which is JSON. Diff-friendly.
- Good uses: tileable stylised materials (bricks, tiles, planks, hand-painted rock), trim sheets, masks for splatting.

## Other tools
| Tool | Licence | Note |
|---|---|---|
| ArmorPaint 1.0 (armory3d) | zlib source / $19 binaries | Painter replacement; local neural nodes (text-to-image, image-to-PBR); exports Unity/Unreal channel packs |
| Blender (bake + Node Wrangler "Principled Texture Setup") | GPL tool, outputs are yours | Bake high→low normals/AO; headless `blender -b -P bake.py` for agents |
| DeepBump (HugoTini) | GPL-3.0 | Photo → normal/height/curvature; Blender addon + CLI |
| Ubisoft CHORD (+ ComfyUI-Chord) | Research-only | Image → full PBR set; tileable SDXL workflow. Not for shipping |
| Adobe Substance 3D (Designer/Painter/Sampler) | Commercial subscription | Industry standard; `.sbsar` needs the Substance runtime (no web runtime) |
| InstaMAT | Commercial, free tier (unverified terms) | Graph + layer texturing |

## AI texture generation workflow (when CC0 has nothing)
1. Generate a **tileable** albedo: a diffusion model with seamless/circular padding (most ComfyUI/Automatic1111 setups have a "tiling" option), at 1024–2048. Prompt for "flat lighting, no shadows, top-down, albedo".
2. De-light it: remove baked shadows/highlights (Material Maker or ArmorPaint filters, or a high-pass in an image editor).
3. Derive normal/height with DeepBump or Material Maker; roughness from a curves-adjusted luminance.
4. Check tiling in-engine on a 20×20 plane with `repeat = 8` at a grazing angle. Add macro variation in the shader.
5. Record prompt/model/licence in `CREDITS.md`. Model licences differ: check the model card for commercial use.
