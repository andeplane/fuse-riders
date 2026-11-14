# Engine pipelines: Godot, Unity, and offline terrain tools

## Offline terrain tools → game

| Tool | Price / licence (checked Oct 2026) | Best export | Notes |
|---|---|---|---|
| **Gaea** (QuadSpinner) | Community free (1024² builds), Indie $99 (8192²), Pro $199 (16k², tiled builds), Enterprise $299. Perpetual. Terrains usable commercially on all editions per the compare page | 16-bit PNG/R16 or 32-bit EXR heightmap + masks (flow, erosion, wear) | Its masks make excellent splat/biome inputs |
| **World Machine** | Basic edition free; Indie/Pro paid (check the current EULA for commercial use of Basic) | RAW16/R16, PNG16, EXR | Tiled builds for huge worlds |
| **World Creator** | Commercial (check site) | R16 / EXR / PNG16 + splat maps | Real-time GPU editing |
| **Blender** (via `blender-mcp`, now `ahujasid/mcp-for-blender`) | Free | EXR displacement or mesh | Good for hand-sculpted hero areas |

Always export a **sidecar JSON** next to the heightmap and load it in code, never hard-code it:
`{ "resolution": 2049, "sizeMeters": 4096, "minHeight": -120, "maxHeight": 1480, "format": "r16" }`.

Rules: 16 or 32 bits only (8-bit terraces). Unity needs 2ⁿ+1 square (1025, 2049, 4097). Terrain3D wants
1 px = 1 m by default (else scale via `vertex_spacing`). Know whether values are normalised 0..1 or real metres.
Clamp NaN/-inf (GeoTIFF oceans) before import.

## three.js: loading 16/32-bit heights

```ts
// R16 raw: square, little-endian uint16 (verify byte order in your exporter)
async function loadR16(url: string, min: number, max: number) {
  const dv = new DataView(await (await fetch(url)).arrayBuffer());
  const count = dv.byteLength / 2, res = Math.round(Math.sqrt(count));
  const h = new Float32Array(count);
  for (let i = 0; i < count; i++) h[i] = min + (dv.getUint16(i * 2, true) / 65535) * (max - min);
  return { res, h };                       // row 0 = image top; decide once whether that is −z or +z and test it
}
```

```ts
// 16-bit PNG: browsers' image decoders give 8 bits, so decode in JS
import { decode } from 'fast-png';         // npm i fast-png (MIT)
const png = decode(new Uint8Array(await (await fetch('/terrain/height.png')).arrayBuffer()));
// png.depth === 16, png.channels (1 = grey), png.data is a Uint16Array
```

```ts
// EXR (float)
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
const tex = await new EXRLoader().setDataType(THREE.FloatType).loadAsync('/terrain/height.exr');
const { width, height, data } = tex.image as { width: number; height: number; data: Float32Array };
const channels = data.length / (width * height);   // usually 4 (RGBA); height is in channel 0
```

## Godot 4.4+

### Noise → float image → Terrain3D

```gdscript
# terrain_gen.gd  (Godot 4.4+, Terrain3D 1.0.x)
extends Node3D
@export var terrain: Terrain3D
@export var size := 1024
@export var max_height := 300.0
@export var world_seed := 1337

func _ready() -> void:
	var n := FastNoiseLite.new()
	n.seed = world_seed
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	n.frequency = 0.0015
	n.fractal_type = FastNoiseLite.FRACTAL_FBM
	n.fractal_octaves = 6
	n.domain_warp_enabled = true
	n.domain_warp_amplitude = 60.0
	# Do NOT use n.get_image(): it returns 8-bit FORMAT_L8 and terraces.
	var px := PackedFloat32Array()
	px.resize(size * size)
	for z in size:
		for x in size:
			px[x + z * size] = n.get_noise_2d(x, z) * 0.5 + 0.5
	var img := Image.create_from_data(size, size, false, Image.FORMAT_RF, px.to_byte_array())
	# images = [height, control, color]; offset then scale; does NOT normalise for you
	terrain.data.import_images([img, null, null], Vector3(-size / 2.0, 0, -size / 2.0), 0.0, max_height)

func ground_y(p: Vector3) -> float:
	return terrain.data.get_height(p)   # use for spawning props/NPCs
```

- Importing from World Machine/Gaea/World Creator: convert to EXR or R16 and use the Terrain3D Importer
  (see Terrain3D docs, "Importing & Exporting Data", and "Heightmaps"). Only heightmaps import from those
  tools; control/splat maps don't (repaint, or write a script that converts masks with `set_pixel`).
- Terrain3D 1.0.2 supports Godot 4.4-4.6; use 1.0.0 for 4.3. It is a GDExtension (no engine rebuild).
- Collision: Terrain3D `collision_mode` Dynamic builds shapes within `collision_radius` (default 64 m) of the
  camera/target. For NPCs far from the player, use `get_height` instead of physics rays.
- Foliage: Terrain3D's instancer (up to 10 LODs, shadow impostor) before rolling `MultiMeshInstance3D`.
- Without Terrain3D: `HeightMapShape3D` (`map_width`, `map_depth`, `map_data`, or
  `update_map_data_from_image(image, height_min, height_max)`) on a `CollisionShape3D`. It is centred with 1 m
  spacing, so scale the node for other spacings.

### Gaea (Godot addon)

`gaea-godot/gaea` (MIT, ~1.6k★): node-graph procedural generation, 2D and 3D, grid/tile-oriented. Gaea 2.0 targets
Godot 4.4 and its README says it is early development. Use v1.x for ≤4.3. Good for tile/grid worlds (2D maps,
GridMap-style 3D). For heightfield terrain use Terrain3D. Don't confuse it with QuadSpinner's Gaea.

## Unity 6

```csharp
var td = terrain.terrainData;
td.heightmapResolution = 1025;                 // 2^n + 1; set before size
td.size = new Vector3(2048f, 600f, 2048f);     // x, MAX HEIGHT, z (metres)
int res = td.heightmapResolution;
var h = new float[res, res];                   // indexed [z, x], not [x, z]
for (int z = 0; z < res; z++)
  for (int x = 0; x < res; x++)
    h[z, x] = Mathf.Clamp01(HeightMetres(x, z) / td.size.y);   // 0..1 of size.y
td.SetHeights(0, 0, h);
// runtime edits: td.SetHeightsDelayLOD(...) per brush stroke, then td.SyncHeightmap() once
```

Generate in a Burst job (`Unity.Mathematics.noise.snoise`), then `SetHeights` on the main thread. Use Terrain
details/trees or GPU instancing for scatter. GPU erosion reference: bshishov/UnityTerrainErosionGPU (MIT,
pipe model, compute shaders). Droplet reference: SebLague/Hydraulic-Erosion (MIT).
