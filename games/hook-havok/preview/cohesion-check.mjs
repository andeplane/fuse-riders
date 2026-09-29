import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
const [base, output, mode = "full"] = process.argv.slice(2);
if (
  !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(base) ||
  !output ||
  !["full", "reduced", "phone"].includes(mode)
)
  throw new Error("Pass local URL, output JSON path, and full/reduced/phone");
const revision = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
    "rev-parse",
    "HEAD",
  ],
  { encoding: "utf8" },
).trim();
const sourceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(path.join(dir, entry.name))
      : [path.join(dir, entry.name)],
  );
// Normalize line endings so a Windows checkout and Git's source tree fingerprint agree.
const sourceHash = createHash("sha256")
  .update(
    sourceFiles("games/hook-havok/src")
      .sort()
      .map(
        (file) =>
          `${file.replaceAll("\\", "/")}\n${readFileSync(file, "utf8").replaceAll("\r\n", "\n")}`,
      )
      .join("\n"),
  )
  .digest("hex");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const errors = [],
    pages = [];
  const make = async (url) => {
    const p = await browser.newPage({
      viewport:
        mode === "phone"
          ? { width: 844, height: 390 }
          : { width: 1440, height: 1000 },
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
    });
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    pages.push(p);
    return p;
  };
  const host = await make(base + "hook-havok/?mute");
  await host.locator('#status[data-state="ready"]').waitFor();
  await host.locator("#keeper-name").fill("Ember");
  await host.locator("#start").click();
  await host.locator('#status[data-state="playing"]').waitFor();
  const invite = await host.locator("#invite-url").inputValue();
  for (let i = 1; i < 5; i++) {
    const p = await make(invite);
    await p.locator('#status[data-state="playing"]').waitFor();
  }
  await host.locator("#map").selectOption("crossroads");
  await host.locator("#experiment").selectOption("surge");
  await host.locator("#development-workshop > summary").click();
  await host.locator("#jump-mode").selectOption("double");
  await host.locator("#wire-mode").selectOption("spiked");
  for (const p of pages) {
    await p.waitForFunction(
      () =>
        document.querySelector("#wire-mode").value === "spiked" &&
        JSON.parse(document.querySelector("#scene").dataset.keepers || "[]")
          .length === 5,
    );
    await p.locator("#keyboard-mode").selectOption("keyboard");
    if (mode === "reduced") await p.locator("#atmosphere").check();
    if (mode === "phone") await p.locator("#touch-toggle").check();
    await p.locator("#arena-focus").click();
    await p.locator("#scene").focus();
  }
  const ticks = async (n) => {
    const tick = Number(await host.locator("#scene").getAttribute("data-tick"));
    await host.waitForFunction(
      (t) => Number(document.querySelector("#scene").dataset.tick) >= t,
      tick + n,
    );
  };
  await ticks(60);
  const cdp = await host.context().newCDPSession(host);
  await cdp.send("Performance.enable");
  const before = await cdp.send("Performance.getMetrics");
  await host.evaluate(() => {
    const samples = {
      intervals: [],
      longTasks: [],
      mutations: 0,
      maxBalls: 0,
      maxHooks: 0,
      start: performance.now(),
      stop: false,
    };
    window.__cohesion = samples;
    const observer = new MutationObserver((records) => {
      samples.mutations += records.length;
    });
    observer.observe(document.querySelector("#phase"), {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        samples.longTasks.push(entry.duration);
    });
    tasks.observe({ type: "longtask", buffered: false });
    let last = performance.now();
    const frame = (now) => {
      if (samples.stop) {
        observer.disconnect();
        tasks.disconnect();
        return;
      }
      samples.intervals.push(now - last);
      last = now;
      const data = document.querySelector("#scene").dataset;
      samples.maxBalls = Math.max(
        samples.maxBalls,
        JSON.parse(data.balls || "[]").length,
      );
      samples.maxHooks = Math.max(
        samples.maxHooks,
        JSON.parse(data.keepers || "[]").filter((k) => k.hook !== "ready")
          .length,
      );
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  // Seeded ordinary keyboard input. No state injection, custom simulation or extra game loop.
  let seed = 1707;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const held = pages.map(() => []),
    schedule = [];
  for (let step = 0; step < 24; step++) {
    const next = pages.map(() => [
      random() % 2 ? "a" : "d",
      "w",
      ...(random() % 3 ? ["j"] : []),
      ...(step % 2 === 0 ? ["k"] : []),
    ]);
    schedule.push(next);
    await Promise.all(
      pages.map(async (p, i) => {
        for (const key of held[i]) await p.keyboard.up(key);
        for (const key of next[i]) await p.keyboard.down(key);
        held[i] = next[i];
      }),
    );
    await ticks(30);
  }
  const samples = await host.evaluate(() => {
    window.__cohesion.stop = true;
    return { ...window.__cohesion, end: performance.now() };
  });
  const after = await cdp.send("Performance.getMetrics");
  for (let i = 0; i < pages.length; i++)
    for (const key of held[i]) await pages[i].keyboard.up(key);
  const quantile = (values, q) =>
    [...values].sort((a, b) => a - b)[
      Math.min(values.length - 1, Math.floor(values.length * q))
    ] ?? 0;
  const metric = (snapshot, name) =>
    snapshot.metrics.find((m) => m.name === name)?.value ?? 0;
  const report = {
    revision,
    sourceHash,
    sourceHashContract:
      "SHA256 of sorted games/hook-havok/src path + LF-normalized content, joined with LF",
    mode,
    recordedAt: new Date().toISOString(),
    browser: browser.version(),
    platform: os.platform(),
    cpu: os.cpus()[0]?.model,
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    viewport: host.viewportSize(),
    limits:
      "Desktop headless Chrome; rAF callback cadence, not GPU or Phaser frame time. Host CDP task/script time includes instrumentation. Seeded keys do not fix network or wall-clock timing. Phone mode changes viewport and enables touch layout; inputs remain keyboard-driven.",
    workload: {
      seed: 1707,
      steps: 24,
      ticksPerStep: 30,
      players: 5,
      map: "crossroads",
      experiment: "surge",
      jump: "double",
      wire: "spiked",
      schedule,
    },
    measurement: {
      elapsedMs: samples.end - samples.start,
      frames: samples.intervals.length,
      frameMs: {
        p50: quantile(samples.intervals, 0.5),
        p95: quantile(samples.intervals, 0.95),
        p99: quantile(samples.intervals, 0.99),
      },
      over33ms: samples.intervals.filter((n) => n > 33.4).length,
      longTasks: samples.longTasks,
      phaseMutations: samples.mutations,
      maxBalls: samples.maxBalls,
      maxHooks: samples.maxHooks,
      taskSeconds:
        metric(after, "TaskDuration") - metric(before, "TaskDuration"),
      scriptSeconds:
        metric(after, "ScriptDuration") - metric(before, "ScriptDuration"),
    },
    rawFrameIntervals: samples.intervals,
    errors,
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  assert.deepEqual(errors, []);
  assert.ok(
    report.measurement.maxHooks >= 3,
    "busy scene had at least three simultaneous hooks",
  );
  if (mode === "reduced") {
    const env = await host.locator("#scene").getAttribute("data-environment");
    await ticks(15);
    assert.equal(
      await host.locator("#scene").getAttribute("data-environment"),
      env,
    );
    assert.equal(await host.locator("#scene").getAttribute("data-echoes"), "0");
    await host.locator("#arena-focus").click();
    await host.locator("#experiment").selectOption("movement");
    await ticks(40);
    // Isolate the high shrine's candles/banner from moving keepers. Reduced motion
    // freezes decoration, never the replicated physics or interpolation.
    const shrinePixels = async () => {
      await host.locator("#scene").scrollIntoViewIfNeeded();
      const box = await host.locator("#scene canvas").boundingBox();
      return host.screenshot({
        clip: {
          x: box.x + (600 / 1600) * box.width,
          y: box.y + (160 / 900) * box.height,
          width: (400 / 1600) * box.width,
          height: (165 / 900) * box.height,
        },
      });
    };
    const frozen = await shrinePixels();
    await ticks(20);
    assert.ok(
      frozen.equals(await shrinePixels()),
      "reduced motion freezes actual shrine pixels, not just diagnostics",
    );
    await host.locator("#atmosphere").uncheck();
    await ticks(5);
    assert.ok(
      !JSON.parse(await host.locator("#scene").getAttribute("data-environment"))
        .moving,
      "atmosphere off remains still",
    );
    await host.locator("#atmosphere").check();
    await host.locator("#map").selectOption("belfry");
    await ticks(40);
    const belfry = await shrinePixels();
    await ticks(20);
    assert.ok(
      belfry.equals(await shrinePixels()),
      "map rebuild stays still in reduced motion",
    );
    await host.locator("#map").selectOption("crossroads");
    await ticks(40);
    await host.emulateMedia({ reducedMotion: "no-preference" });
    await ticks(5);
    const moving = await shrinePixels();
    await ticks(20);
    assert.ok(
      !moving.equals(await shrinePixels()),
      "live preference restores visual motion",
    );
    await host.emulateMedia({ reducedMotion: "reduce" });
    await host.locator("#arena-focus").click();
    console.log(
      "PASS actual canvas freeze, atmosphere toggle, map rebuild and live reduced-motion preference",
    );
  }
  assert.ok(
    await host.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await host.screenshot({
    path: output.replace(/\.json$/, ".png"),
    animations: "disabled",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      mode,
      ...report.measurement,
      longTasks: report.measurement.longTasks.length,
    }),
  );
} finally {
  await browser.close();
}
