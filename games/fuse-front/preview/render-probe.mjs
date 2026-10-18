/**
 * Samples the 3D battlefield's cost over a long match against a running service (`pnpm build`, then `service/dev.ts`):
 *
 *   node games/fuse-front/preview/render-probe.mjs http://localhost:PORT/ solo|3v3 high|low [seconds] [every]
 *
 * `solo` plays `?solo=1` against a bot; `3v3` creates a room on Iron Delta against five bots. WebGL calls are counted
 * from an init script (no game code changes), so every row is the same measurement on any revision: frames a second,
 * the slowest frame, draw calls and triangles a frame, buffer bytes uploaded a frame, live GL buffers, textures,
 * framebuffers and programs, the JS heap and DOM nodes. Prints one tab-separated row per sample. Muted, one headless
 * Chromium. `gpuMs/f` is the CPU time the browser's GPU process spends a frame (Linux `/proc`): under SwiftShader that
 * is the rendering itself, and unlike frames a second it barely moves when other work shares the machine.
 */
import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";

const [base, size = "solo", quality = "high", secs = "180", every = "10"] =
  process.argv.slice(2);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base ?? ""))
  throw new Error("Pass the local service URL");

/** Runs in the page before any script: wraps the WebGL2 calls worth counting. */
function instrument() {
  const stats = {
    frames: 0,
    worst: 0,
    draws: 0,
    tris: 0,
    upload: 0,
    live: {
      Buffer: 0,
      Texture: 0,
      Framebuffer: 0,
      Renderbuffer: 0,
      Program: 0,
    },
  };
  window.__probe = stats;
  let last = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((now) => {
      if (last) stats.worst = Math.max(stats.worst, now - last);
      last = now;
      stats.frames++;
      cb(now);
    });
  const proto = WebGL2RenderingContext.prototype;
  const wrap = (name, count) => {
    const original = proto[name];
    proto[name] = function (...args) {
      count(args, this);
      return original.apply(this, args);
    };
  };
  const tri = (mode, n) => (mode === 4 ? n / 3 : 0);
  wrap("drawArrays", ([mode, , n]) => {
    stats.draws++;
    stats.tris += tri(mode, n);
  });
  wrap("drawElements", ([mode, n]) => {
    stats.draws++;
    stats.tris += tri(mode, n);
  });
  wrap("drawArraysInstanced", ([mode, , n, k]) => {
    stats.draws++;
    stats.tris += tri(mode, n) * k;
  });
  wrap("drawElementsInstanced", ([mode, n, , , k]) => {
    stats.draws++;
    stats.tris += tri(mode, n) * k;
  });
  wrap("bufferData", ([, data]) => {
    stats.upload += typeof data === "number" ? data : (data?.byteLength ?? 0);
  });
  wrap("bufferSubData", ([, , data, , length]) => {
    stats.upload += length
      ? length * (data.BYTES_PER_ELEMENT ?? 1)
      : (data?.byteLength ?? 0);
  });
  for (const kind of Object.keys(stats.live)) {
    wrap(`create${kind}`, () => stats.live[kind]++);
    wrap(`delete${kind}`, ([thing]) => thing && stats.live[kind]--);
  }
}

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  headless: true,
});
/** CPU milliseconds the GPU process under this script has used, from `/proc` (0 off Linux). */
function gpuCpuMs() {
  try {
    const procs = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    const parent = new Map(),
      gpu = [];
    for (const pid of procs) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        parent.set(pid, f[1]);
        if (readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("--type=gpu-process")) gpu.push([pid, (Number(f[11]) + Number(f[12])) * 10]);
      } catch {} // prettier-ignore
    }
    const mine = (pid) => { for (let p = pid, n = 0; p && n < 10; p = parent.get(p), n++) if (p === String(process.pid)) return true; return false; }; // prettier-ignore
    return gpu
      .filter(([pid]) => mine(pid))
      .reduce((sum, [, ms]) => sum + ms, 0);
  } catch {
    return 0;
  }
}

const timeout = (ms) => new Promise((_, no) => setTimeout(() => no(new Error("stalled")), ms)); // prettier-ignore
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 860 },
  });
  page.on("pageerror", (error) => console.log("pageerror", error.message));
  await page.addInitScript(instrument);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const q = `mute&quality=${quality}`;
  if (size === "solo") await page.goto(`${base}fuse-front/?solo=1&${q}`);
  else {
    await page.goto(`${base}fuse-front/?${q}`);
    await page.getByRole("button", { name: "CREATE ROOM" }).click();
    await page.getByRole("button", { name: "3V3" }).click();
    await page.locator(".ff-maps button", { hasText: "Iron Delta" }).click();
    await page.locator(".ff-maps .ff-on", { hasText: "Iron Delta" }).waitFor();
    await page.getByRole("button", { name: "START" }).click();
  }
  await page.locator("canvas.ff-board").waitFor({ timeout: 60_000 });
  console.log(["s", "fps", "worstMs", "draws/f", "ktris/f", "kB up/f", "gpuMs/f", "buffers", "textures", "fbos", "programs", "heapMB", "nodes"].join("\t")); // prettier-ignore
  let before = { frames: 0, draws: 0, tris: 0, upload: 0, gpu: gpuCpuMs() };
  const start = Date.now();
  for (let s = 0; s <= Number(secs); s += Number(every)) {
    await page.waitForTimeout(Math.max(0, start + s * 1000 - Date.now()));
    let now;
    try {
      now = await Promise.race([
        page.evaluate(() => {
          const p = window.__probe;
          const copy = { ...p, live: { ...p.live } };
          p.worst = 0;
          return copy;
        }),
        timeout(15_000),
      ]);
    } catch {
      console.log(`${s}\tpage stalled (no answer in 15 s)`);
      continue;
    }
    now.gpu = gpuCpuMs();
    const { metrics } = await cdp.send("Performance.getMetrics");
    const metric = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
    const frames = Math.max(1, now.frames - before.frames);
    if (s === 0)
      console.log(
        `# ${await page.evaluate(() => {
          const gl = document
            .querySelector("canvas.ff-board")
            ?.getContext("webgl2");
          const info = gl?.getExtension("WEBGL_debug_renderer_info");
          return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "?";
        })}`,
      );
    const per = (key, scale = 1) => ((now[key] - before[key]) / frames / scale).toFixed(1); // prettier-ignore
    console.log([s, ((now.frames - before.frames) / Number(every)).toFixed(1), now.worst.toFixed(0), per("draws"), per("tris", 1000), per("upload", 1024), per("gpu"), now.live.Buffer, now.live.Texture, now.live.Framebuffer, now.live.Program, (metric("JSHeapUsedSize") / 1048576).toFixed(1), metric("Nodes")].join("\t")); // prettier-ignore
    before = now;
  }
} finally {
  await browser.close();
}
