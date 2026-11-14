# Profiling toolkit

## Which tool answers which question

| Question | Tool | Notes |
|---|---|---|
| FPS, CPU ms and GPU ms, live | **stats-gl** (`npm i stats-gl`, MIT, v4.2) | `new Stats({ trackGPU: true })` → `stats.init(renderer)` → `stats.update()` per frame. WebGL uses `EXT_disjoint_timer_query_webgl2`. On WebGPU it enables `backend.trackTimestamp` itself (create the renderer with `trackTimestamp: true` and `await renderer.init()` first). `trackCPT: true` adds compute timing. Worker mode: `StatsProfiler`. Safari needs the "WebGL Timer Queries" feature flag |
| Draw calls, triangles, programs, memory | `renderer.info` | WebGL: `render.calls/triangles/points/lines`, `memory.geometries/textures`, `programs.length`. WebGPU: `render.drawCalls` (per frame), `render.frameCalls`, `render.triangles`, `memory.texturesSize/attributesSize/total` (bytes). **Set `info.autoReset = false` and `reset()` once per frame** when you render more than once (shadows, post, UI) |
| Built-in three.js panel (WebGPU) | `renderer.inspector = new Inspector()` from `three/addons/inspector/Inspector.js` | Used in the r18x WebGPU examples. Shows frame/GPU timings and node graphs (check docs) |
| GPU time per pass (WebGPU) | `new WebGPURenderer({ trackTimestamp: true })` → `await renderer.resolveTimestampsAsync('render')` (returns ms, also stored in `info.render.timestamp`); `'compute'` for compute | Needs the `timestamp-query` adapter feature (Chrome yes; check others). Resolve every ~10 frames, not every frame |
| What exactly is drawn, in what order, with which state (WebGL) | **Spector.js** (`spectorjs` npm or browser extension, MIT, ~1.6k★) | Capture a frame and look for redundant state changes, duplicate draws, wrong blending, oversized textures. WebGL only |
| Same for WebGPU | **WebGPU Inspector** (brendan-duncan/webgpu_inspector, MIT; Chrome/Firefox extension) | Live object list, CPU-vs-GPU-bound frame plot, frame capture, shader editing |
| JS hot spots, GC, long tasks | Chrome DevTools Performance panel (or the Chrome DevTools MCP below) | Look for `Minor GC`/`Major GC` slices, long `Animation Frame Fired`, and `Compile`/`Link` (shader programs) in the GPU/raster tracks |
| GPU process info / blocklist | `chrome://gpu` | Confirms hardware acceleration, ANGLE backend, WebGPU status |
| Asset weight | `npx @gltf-transform/cli inspect model.glb` | Per-mesh vertex counts, per-texture **GPU size**, extensions, animations |

## HUD + `window.__perf` (type-checked against three r187 / stats-gl 4.2)

```ts
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import Stats from 'stats-gl';

export type PerfSample = { calls: number; tris: number; geometries: number; textures: number; programs: number; cpuMs: number; frameMs: number; gpuMs: number | null };

/** HUD + window.__perf for agents/Playwright. Wrap ALL rendering of a frame between begin()/end(). */
export function installPerf(renderer: THREE.WebGLRenderer) {
  const stats = new Stats({ trackGPU: true, horizontal: false });
  document.body.appendChild(stats.dom);
  stats.init(renderer);
  renderer.info.autoReset = false;                       // otherwise every render() call (shadows/post) resets the counters
  const perf: PerfSample = { calls: 0, tris: 0, geometries: 0, textures: 0, programs: 0, cpuMs: 0, frameMs: 0, gpuMs: null };
  (window as unknown as { __perf: PerfSample }).__perf = perf;
  let t0 = 0, last = performance.now();
  return {
    begin() { renderer.info.reset(); t0 = performance.now(); },
    end() {
      const i = renderer.info, now = performance.now();
      perf.calls = i.render.calls; perf.tris = i.render.triangles;
      perf.geometries = i.memory.geometries; perf.textures = i.memory.textures;
      perf.programs = i.programs?.length ?? 0;
      perf.cpuMs = now - t0;                              // JS time to build + submit the frame
      perf.frameMs = now - last; last = now;
      stats.update();
    },
  };
}

/** WebGPU variant: GPU time via timestamp queries (needs the 'timestamp-query' feature, e.g. Chrome). */
export async function createProfiledWebGPU(canvas?: HTMLCanvasElement) {
  const renderer = new WebGPURenderer({ canvas, antialias: true, trackTimestamp: true });
  await renderer.init();
  const perf: PerfSample = { calls: 0, tris: 0, geometries: 0, textures: 0, programs: 0, cpuMs: 0, frameMs: 0, gpuMs: null };
  (window as unknown as { __perf: PerfSample }).__perf = perf;
  let frame = 0;
  function afterRender() {
    const r = renderer.info.render;
    perf.calls = r.drawCalls; perf.tris = r.triangles;
    perf.textures = renderer.info.memory.textures; perf.geometries = renderer.info.memory.geometries;
    if (++frame % 10 === 0) renderer.resolveTimestampsAsync('render').then((ms) => { if (ms !== undefined) perf.gpuMs = ms; });
  }
  return { renderer, afterRender };
}
```

Texture VRAM estimate for WebGL (WebGPU has `info.memory.texturesSize`):

```ts
import * as THREE from 'three';
/** Rough VRAM estimate for WebGLRenderer (WebGPU: use renderer.info.memory.texturesSize). */
export function estimateTextureMB(root: THREE.Object3D): number {
  const seen = new Set<THREE.Texture>(); let bytes = 0;
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material; if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) for (const v of Object.values(m)) {
      const t = v as THREE.Texture; if (!t?.isTexture || seen.has(t)) continue; seen.add(t);
      if ((t as THREE.CompressedTexture).isCompressedTexture) {   // KTX2: already the transcoded GPU size
        bytes += (t as THREE.CompressedTexture).mipmaps.reduce((a, mip) => a + (mip.data as ArrayBufferView).byteLength, 0);
      } else {
        const img = t.image as { width?: number; height?: number } | undefined;
        if (img?.width && img.height) bytes += img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1);
      }
    }
  });
  return bytes / 2 ** 20;
}
```

Add a **frame-time ring buffer** (`Float32Array(600)`) so the bench reads full distributions, not one sample: `window.__perfHistory = () => Array.from(ring)`.

## Playwright bench harness

```ts
// scripts/bench.ts: run against `vite build && vite preview` (port 4173), never the dev server
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4173/?bench=main&seed=1';
const BUDGET = { calls: 300, tris: 1_500_000, textureMB: 256 };
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const warnings: string[] = [];
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
await page.goto(url);
await page.waitForFunction(() => (window as any).__perf?.calls > 0, null, { timeout: 120_000 });
await page.waitForTimeout(3000);                                   // warm-up: shader compiles, uploads
const s = await page.evaluate(async () => {
  const out: any[] = []; for (let i = 0; i < 120; i++) { out.push({ ...(window as any).__perf }); await new Promise((r) => setTimeout(r, 50)); }
  return { out, hist: (window as any).__perfHistory?.() ?? [] };
});
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] ?? 0;
const ft = s.hist.length ? s.hist : s.out.map((x: any) => x.frameMs);
const report = {
  p50: pct(ft, 0.5).toFixed(2), p95: pct(ft, 0.95).toFixed(2), p99: pct(ft, 0.99).toFixed(2),
  calls: Math.max(...s.out.map((x: any) => x.calls)), tris: Math.max(...s.out.map((x: any) => x.tris)),
  gpuMs: pct(s.out.map((x: any) => x.gpuMs ?? 0), 0.5).toFixed(2), warnings: warnings.length,
};
console.table(report);
await page.screenshot({ path: 'bench.png' });
await browser.close();
if (report.calls > BUDGET.calls || report.tris > BUDGET.tris) { console.error('over budget'); process.exit(1); }
```

- **Headless CI:** Chrome falls back to software GL (SwiftShader). Draw calls, triangles and texture MB are deterministic and safe to assert. **Milliseconds are not.** Track ms on a real machine (headed) and on a real phone (USB remote debugging: `chrome://inspect`).
- **Phone-ish CPU** in Playwright: create a CDP session and call `Emulation.setCPUThrottlingRate { rate: 4 }`. GPU speed can't be emulated.

## Chrome DevTools MCP (Apache-2.0, ~53k★)

**Install:**
- `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest`;
- or `/plugin marketplace add ChromeDevTools/chrome-devtools-mcp` then `/plugin install chrome-devtools-mcp@chrome-devtools-plugins` (adds skills).

**Agent loop:**
1. `navigate_page` to the preview build with `?bench`.
2. `emulate` with `{ cpuThrottlingRate: 4, viewport: "390x844x3,mobile,touch" }` for a mid-phone CPU profile. Omit it for desktop.
3. `performance_start_trace` with `{ reload: true, autoStop: true, filePath: "trace.json.gz" }`, then `performance_stop_trace` if not autoStopped.
4. `performance_analyze_insight` for the insight sets it lists, then `evaluate_script` with `JSON.stringify(window.__perf)` to pair the trace with render counters.
5. For memory leaks, `take_heapsnapshot` → play 60 s → `take_heapsnapshot` → `compare_heapsnapshots`. Growing `Mesh`/`BufferGeometry`/`Texture` counts mean missing `dispose()`.

The insights are web-vitals oriented (LCP, layout). For games, read the main-thread breakdown (scripting vs GC vs rendering) and long frames in the raw trace.

## Reading results: rules of thumb

- **CPU ms ≈ frame ms and GPU ms is small:** you're CPU-bound. Check draw calls first (> budget?), then scripting.
- **GPU ms ≈ frame ms:** halve the resolution. If GPU ms halves, you're fill-bound. If not, you're vertex/shadow-bound.
- **p99 ≫ p50:** hitches. Look for GC, shader compiles (`programs` count rising mid-game is the smoking gun), texture uploads and asset decodes.
- **`info.programs.length` grows over time:** materials are being created per object or per frame (cloning materials in a loop), or lights or defines keep changing.
- **`info.memory.geometries/textures` grows over time:** a leak. You're missing `dispose()` on removed meshes, or on render targets reallocated on resize.
