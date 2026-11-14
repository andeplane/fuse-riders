import { chromium, type Page } from "playwright";

// Press to picture: how long after a key goes down the local rider is first drawn somewhere else. Solo match against
// a bot in headless Chromium, once drawing at the clock (the default) and once the old way (`?lead=off`). The probe
// (`?probe`) publishes where the rider was last drawn. Desktop browser figures: they include this machine's frame
// time, not a display's or a phone's.
const base = process.env.ONLINE_URL ?? "http://localhost:8787/",
  presses = Number(process.env.PRESSES ?? 30);

async function measure(page: Page, flags: string): Promise<number[]> {
  await page.goto(`${base}fuseball/?solo=1&map=gridlock&mute&probe${flags}`);
  await page.waitForFunction(
    () => document.querySelector("main")?.dataset.phase === "play",
    undefined,
    { timeout: 30_000 },
  );
  const latencies: number[] = [];
  for (let i = 0; i < presses; i++) {
    // Let the rider come to rest, at a different point of the 50 ms tick each time.
    await page.waitForTimeout(700 + ((i * 13) % 50));
    if ((await page.locator("main").getAttribute("data-phase")) !== "play") {
      await page.waitForFunction(
        () => document.querySelector("main")?.dataset.phase === "play",
        undefined,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(500);
    }
    const key = i % 2 ? "ArrowLeft" : "ArrowRight";
    // A plain string: the TypeScript loader would otherwise inject helpers into a serialized function that the page lacks.
    const waiting = page.evaluate<number>(`new Promise((resolve) => {
      const probe = () => window.__fuseballProbe;
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
  for (const [name, flags] of [
    ["draw at the clock", ""],
    ["a tick behind (lead=off)", "&lead=off"],
  ] as const) {
    const page = await (
      await browser.newContext({ viewport: { width: 1000, height: 700 } })
    ).newPage();
    const values = await measure(page, flags);
    console.log(
      `${name}: ${values.length}/${presses} presses, press to picture p50 ${percentile(values, 0.5)?.toFixed(0)} ms, p95 ${percentile(values, 0.95)?.toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
