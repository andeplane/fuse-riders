import { chromium, type Page } from "playwright";

// Press to picture for Fuse Choppers and Fuse Freight: how long after a key goes down the local chopper or train is
// first drawn off the steady line it was on. Solo round against bots in headless Chromium, once drawing at the clock (the
// default) and once the old way (`?lead=off`). The probe (`?probe`) publishes what was last drawn: the chopper's
// height (the thrust trial, where a chopper holding nothing hovers), the train's heading (a train holding nothing
// drives straight). Desktop browser figures: they include this machine's frame time, not a display's or a phone's.
//
//   ONLINE_URL=http://localhost:8787/ PRESSES=40 pnpm exec tsx scripts/lead-input-latency.ts [fuse-choppers|fuse-freight]
const base = process.env.ONLINE_URL ?? "http://localhost:8787/",
  presses = Number(process.env.PRESSES ?? 40);

interface Game {
  id: string;
  query: string;
  /** Page expression for the drawn value a press changes. */
  value: string;
  keys: [string, string];
  /** How far off its steady line the drawn value must be to count as answering the press. */
  threshold: number;
  /** The local player is in play and able to answer a press. */
  ready: string;
}
const GAMES: Game[] = [
  {
    id: "fuse-choppers",
    query: "solo=1&mute&probe&lift=thrust&combat=off",
    value: "window.__fuseChoppersProbe?.y",
    keys: ["KeyW", "KeyS"],
    threshold: 0.15,
    ready: `document.querySelector("main")?.dataset.phase === "play" && document.querySelector("main")?.dataset.flying === "true"`,
  },
  {
    id: "fuse-freight",
    query: "solo=1&mute&probe",
    value:
      "window.__fuseFreightProbe && Math.atan2(window.__fuseFreightProbe.hy, window.__fuseFreightProbe.hx) * 100",
    keys: ["ArrowLeft", "ArrowRight"],
    threshold: 0.02,
    ready: `document.querySelector("main")?.dataset.phase === "play"`,
  },
];

async function measure(
  page: Page,
  game: Game,
  flags: string,
): Promise<number[]> {
  await page.goto(`${base}${game.id}/?${game.query}${flags}`);
  const latencies: number[] = [];
  for (let i = 0; i < presses * 3 && latencies.length < presses; i++) {
    await page.waitForFunction(game.ready, undefined, { timeout: 90_000 });
    // Let the body come to rest, at a different point of the 50 ms tick each time.
    await page.waitForTimeout(500 + ((i * 13) % 50));
    const key = game.keys[i % 2]!;
    // A plain string: the TypeScript loader would otherwise inject helpers into a serialized function that the page lacks.
    const waiting = page.evaluate<number>(`new Promise((resolve) => {
      const probe = () => window.__fuseChoppersProbe ?? window.__fuseFreightProbe;
      const sample = () => [probe().at, ${game.value}];
      // Where the body would be drawn at time \`at\` had nothing been pressed: on the line it was already drawing.
      let pressed = -1, from, speed = 0, before = [];
      const expected = (at) => from[1] + speed * (at - from[0]);
      window.addEventListener("keydown", (event) => {
        if (event.code !== ${JSON.stringify(key)} || pressed >= 0) return;
        pressed = performance.now();
        if (before.length < 6) return resolve(-2);
        const first = before[0];
        from = before[before.length - 1];
        speed = from[0] > first[0] ? (from[1] - first[1]) / (from[0] - first[0]) : 0;
        // Only a body moving steadily tells a press from what it was already doing.
        if (before.some((each) => Math.abs(each[1] - expected(each[0])) > ${game.threshold} / 3)) resolve(-2);
      }, { capture: true, once: true });
      const started = performance.now();
      const poll = () => {
        const now = sample();
        if (pressed < 0) { before.push(now); if (before.length > 6) before.shift(); }
        else if (!(${game.ready})) return resolve(-1);
        else if (Math.abs(now[1] - expected(now[0])) > ${game.threshold}) return resolve(now[0] - pressed);
        if (performance.now() - started > 3000) return resolve(-1);
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    })`);
    await page.waitForTimeout(120);
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

const only = process.argv[2];
const browser = await chromium.launch({ headless: true });
try {
  for (const game of GAMES.filter((each) => !only || each.id === only))
    for (const [name, flags] of [
      ["draw at the clock", ""],
      ["a tick behind (lead=off)", "&lead=off"],
    ] as const) {
      const page = await (
        await browser.newContext({ viewport: { width: 1000, height: 700 } })
      ).newPage();
      const values = await measure(page, game, flags);
      console.log(
        `${game.id}, ${name}: ${values.length}/${presses} presses, press to picture p50 ${percentile(values, 0.5)?.toFixed(0)} ms, p95 ${percentile(values, 0.95)?.toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`,
      );
      await page.close();
    }
} finally {
  await browser.close();
}
