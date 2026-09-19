/**
 * Where a slow device spends its main thread: a real solo match (you and four AI riders, the bots-only endgame once
 * you crash) at a car-screen viewport, under Chrome's CPU throttling, with a sampled CPU profile per rate grouped by
 * source module through the build's source maps. Throttling slows JavaScript, not the GPU, so it is a proxy for a
 * weak CPU (an Atom-class in-car browser at 4–8×), not device evidence. Build readable first, then run:
 *
 *   npx vite build --minify false --sourcemap
 *   npx tsx scripts/throttled-profile.ts
 *
 * Env: RATES=1,4,6 SECONDS=10 WIDTH=1920 HEIGHT=1200 DPR=1 HEADED=1 RENDERER=phaser-canvas OUT=artifacts.
 * Writes `profile-x<rate>.cpuprofile` (opens in DevTools) and `throttled-profile.json` to OUT.
 */
import { chromium } from "playwright";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { SourceMapConsumer } from "source-map-js";
import { startRoomService } from "./lib/server.js";

const out = process.env.OUT ?? "artifacts";
const rates = (process.env.RATES ?? "1,4,6").split(",").map(Number);
const seconds = Number(process.env.SECONDS ?? 12);
const width = Number(process.env.WIDTH ?? 1920),
  height = Number(process.env.HEIGHT ?? 1200),
  dpr = Number(process.env.DPR ?? 1);
const extra = process.env.RENDERER ? `&renderer=${process.env.RENDERER}` : "";

const maps = new Map<string, SourceMapConsumer>();
for (const f of await readdir("dist/assets"))
  if (f.endsWith(".js.map"))
    maps.set(
      f.replace(/\.map$/, ""),
      new SourceMapConsumer(
        JSON.parse(await readFile(`dist/assets/${f}`, "utf8")),
      ),
    );
function origin(url: string, line: number, col: number): string {
  const file = url.split("/").pop()?.split("?")[0] ?? "";
  const map = maps.get(file);
  if (!map) return url ? file : "";
  const pos = map.originalPositionFor({ line: line + 1, column: col });
  if (!pos.source) return file;
  return pos.source.replace(/^(\.\.\/)+/, "").replace(/^node_modules\//, "nm/");
}
function bucket(src: string): string {
  if (src.startsWith("nm/phaser/"))
    return "phaser: " + src.split("/").slice(2, 4).join("/");
  if (src.startsWith("nm/")) return "dep: " + src.split("/")[1];
  return src;
}

await mkdir(out, { recursive: true });
const service = await startRoomService({
  logFile: `${out}/throttled-profile-service.log`,
});
const browser = await chromium.launch({
  channel: "chrome",
  headless: !process.env.HEADED,
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
  ],
});
const report: Record<string, unknown> = {};
try {
  for (const rate of rates) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: dpr,
    });
    page.on("pageerror", (e) => console.error("pageerror", e.message));
    await page.addInitScript(`
      window.__frames = []; window.__long = []; let prev = 0;
      const f = (t) => { if (prev) window.__frames.push(t - prev); prev = t; requestAnimationFrame(f); };
      requestAnimationFrame(f);
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask", buffered: true });
    `);
    const cdp = await page.context().newCDPSession(page);
    await page.goto(new URL(`?solo=1&mute${extra}`, service.url).href);
    await page.waitForFunction(
      () =>
        document
          .querySelector("canvas")
          ?.dataset.renderer?.startsWith("phaser-"),
      undefined,
      { timeout: 30000 },
    );
    // Wait for the countdown to finish and the round to be running.
    await page.waitForTimeout(6000);
    const gpu = await page.evaluate(() => {
      const c = document.querySelector("canvas")!;
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        renderer: c.dataset.renderer,
        backing: `${c.width}x${c.height}`,
        css: `${c.clientWidth}x${c.clientHeight}`,
        gpu: info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : "?",
      };
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __long: number[] };
      w.__frames = [];
      w.__long = [];
    });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
    // Hold a turn now and then so the local rider lives longer and input paths run.
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      await page.keyboard.down("ArrowLeft");
      await page.waitForTimeout(300);
      await page.keyboard.up("ArrowLeft");
      await page.waitForTimeout(700);
    }
    const { profile } = await cdp.send("Profiler.stop");
    const stats = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __long: number[] };
      return { frames: w.__frames, long: w.__long };
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await writeFile(
      `${out}/profile-x${rate}.cpuprofile`,
      JSON.stringify(profile),
    );

    // Self time per node.
    const self = new Map<number, number>();
    profile.samples!.forEach((id, i) =>
      self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas![i] ?? 0) / 1000),
    );
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    const byBucket = new Map<string, number>(),
      byFn = new Map<string, number>();
    for (const node of profile.nodes) {
      const ms = self.get(node.id) ?? 0;
      if (!ms) continue;
      const cf = node.callFrame;
      const src = cf.url
        ? origin(cf.url, cf.lineNumber, cf.columnNumber)
        : cf.functionName;
      const b = cf.url ? bucket(src) : cf.functionName || "(native)";
      byBucket.set(b, (byBucket.get(b) ?? 0) + ms);
      const fn = `${cf.functionName || "(anon)"} @ ${src}`;
      byFn.set(fn, (byFn.get(fn) ?? 0) + ms);
    }
    const top = (m: Map<string, number>, n: number) =>
      [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(
          ([k, v]) =>
            `${((100 * v) / total).toFixed(1).padStart(5)}%  ${v.toFixed(0).padStart(6)}ms  ${k}`,
        );
    const f = [...stats.frames].sort((a, b) => a - b);
    const pct = (p: number) =>
      f[Math.min(f.length - 1, Math.floor(f.length * p))]?.toFixed(1);
    const summary = {
      rate,
      ...gpu,
      fps: +(stats.frames.length / seconds).toFixed(1),
      frameMs: {
        p50: pct(0.5),
        p90: pct(0.9),
        p99: pct(0.99),
        max: f.at(-1)?.toFixed(0),
      },
      over33ms: stats.frames.filter((x) => x > 33.4).length,
      longTasks: stats.long.length,
      longTaskMs: +stats.long.reduce((a, b) => a + b, 0).toFixed(0),
      busyPct: +(
        (100 * (total - (byBucket.get("(idle)") ?? 0))) /
        total
      ).toFixed(1),
    };
    console.log(`\n===== CPU x${rate} =====`);
    console.log(JSON.stringify(summary));
    console.log("-- by module (self) --\n" + top(byBucket, 30).join("\n"));
    console.log("-- by function (self) --\n" + top(byFn, 35).join("\n"));
    report[`x${rate}`] = {
      summary,
      modules: top(byBucket, 40),
      functions: top(byFn, 60),
    };
    await page.close();
  }
  await writeFile(
    `${out}/throttled-profile.json`,
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
  await service.stop();
}
