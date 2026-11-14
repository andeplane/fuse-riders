import { chromium, type Page } from "playwright";

// Press to picture in Fuse Volley: how long after a key goes down the local blob is first drawn somewhere else. Solo
// duel against a bot in headless Chromium, once drawing at the clock (the default) and once the old way
// (`?lead=off`); `MODES` adds others, such as `lead=logged` on a build that still drew its own blob as logged. The probe
// (`?probe`) publishes where the blob was last drawn. Desktop browser figures: they include this machine's frame
// time, not a display's or a phone's.
const base = process.env.ONLINE_URL ?? "http://localhost:8787/",
  presses = Number(process.env.PRESSES ?? 30),
  mode = process.env.MODE ?? "1v1";
// A plain string, as below: the TypeScript loader would otherwise inject helpers into a serialized function.
const live = `["serve", "rally"].includes(document.querySelector("main")?.dataset.phase ?? "")`;

async function measure(page: Page, flags: string): Promise<number[]> {
  // The bot wins a solo match in under a minute: start a new one when it is over.
  const start = async () => {
    await page.goto(
      `${base}fuse-volley/?solo=1&mode=${mode}&mute&probe${flags}`,
    );
    await page.waitForFunction(live, undefined, { timeout: 30_000 });
  };
  await start();
  const latencies: number[] = [];
  for (let i = 0; i < presses; i++) {
    // Let the blob come to rest, at a different point of the 50 ms tick each time.
    await page.waitForTimeout(700 + ((i * 13) % 50));
    if (!(await page.evaluate(live))) {
      const back = await page
        .waitForFunction(live, undefined, { timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!back) await start();
      await page.waitForTimeout(500);
    }
    const key = i % 2 ? "ArrowLeft" : "ArrowRight";
    // A plain string: the TypeScript loader would otherwise inject helpers into a serialized function that the page lacks.
    const waiting = page.evaluate<number>(`new Promise((resolve) => {
      const probe = () => window.__fuseVolleyProbe;
      let pressed = -1, from;
      window.addEventListener("keydown", (event) => {
        if (event.code !== ${JSON.stringify(key)} || pressed >= 0) return;
        pressed = performance.now();
        from = probe().x;
      }, { capture: true });
      const started = performance.now();
      const poll = () => {
        const now = probe();
        if (pressed >= 0 && from !== undefined && now.x !== from) return resolve(now.at - pressed);
        if (performance.now() - started > 3000) return resolve(-1);
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    })`);
    await page.keyboard.down(key);
    const latency = await waiting;
    await page.waitForTimeout(60);
    await page.keyboard.up(key);
    if (latency >= 0) latencies.push(latency);
  }
  return latencies;
}

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ];

const browser = await chromium.launch({ headless: true });
try {
  const runs = (process.env.MODES ?? "default,lead=off")
    .split(",")
    .map((flag) => [flag, flag === "default" ? "" : `&${flag}`] as const);
  for (const [name, flags] of runs) {
    const page = await (
      await browser.newContext({ viewport: { width: 1000, height: 700 } })
    ).newPage();
    const values = await measure(page, flags);
    console.log(
      `${mode} ${name}: ${values.length}/${presses} presses, press to picture p50 ${percentile(values, 0.5)?.toFixed(0)} ms, p95 ${percentile(values, 0.95)?.toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
