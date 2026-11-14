import { chromium, type Page } from "playwright";

// Press to picture for Killer Fuse and Fuse Bombers: how long after a key goes down this device's unit is first
// drawn somewhere else. A solo room against bots in headless Chromium, once drawing at the clock (the default) and
// once the old way (`?lead=off`). Killer Fuse's probe (`?probe`) publishes where the unit was last drawn; Fuse
// Bombers' is sampled between frames for where it would be drawn, because its WebGL scene takes about 65 ms a frame
// on a machine without a GPU. That also starves the page's fold there, so the Bombers figures from such a machine say
// little: run it where the game holds its frame rate. Desktop browser figures: they include this machine's frame
// time, not a display's or a phone's.
//   pnpm build && pnpm exec tsx service/dev.ts --port 8787 &
//   pnpm exec tsx scripts/contact-input-latency.ts [killer-fuse|fuse-bombers]
const base = process.env.ONLINE_URL ?? "http://localhost:8787/",
  presses = Number(process.env.PRESSES ?? 30);

interface Game {
  path: string;
  /** The page's probe, and the field of it that counts engine steps: play has begun once it is above `from`. */
  probe: string;
  clock: string;
  keys: readonly [string, string];
  /** The button that starts the solo game, where the room does not start by itself. */
  start?: string;
}
const GAMES: Record<string, Game> = {
  "killer-fuse": {
    path: "killer-fuse/?solo=1&mute&probe",
    probe: "__killerFuseProbe",
    clock: "step",
    keys: ["ArrowRight", "ArrowLeft"],
    start: "START",
  },
  "fuse-bombers": {
    path: "fuse-bombers/?solo=1&mute&probe",
    probe: "fuseBombersProbe()",
    clock: "tick",
    keys: ["KeyD", "KeyA"],
  },
};

async function measure(
  page: Page,
  game: Game,
  flags: string,
): Promise<number[]> {
  await page.goto(`${base}${game.path}${flags}`);
  if (game.start)
    await page.getByRole("button", { name: game.start, exact: true }).click();
  await page.waitForFunction(
    `(() => { try { const p = window.${game.probe}; return (p?.${game.clock} ?? 0) > 30 && p.x !== undefined; } catch { return false; } })()`,
    undefined,
    { timeout: 60_000 },
  );
  const latencies: number[] = [];
  for (let i = 0; i < presses; i++) {
    const key = game.keys[i % 2]!;
    // A different point of the 50 ms tick each time; the page then waits for the unit to stand still (six frames in
    // the same place), so that the first time it is drawn elsewhere is the press and not a drift. A plain string:
    // the TypeScript loader would otherwise inject helpers into a serialized function that the page lacks.
    await page.waitForTimeout(300 + ((i * 13) % 50));
    await page.evaluate(`(() => {
      const probe = () => ({ at: performance.now(), ...window.${game.probe} });
      const again = ${game.probe.endsWith(")")} ? (f) => setTimeout(f, 2) : requestAnimationFrame;
      const state = (window.__latency = { ready: false, result: undefined });
      let pressed = -1, from, still = 0, last;
      window.addEventListener("keydown", function down(event) {
        if (event.code !== ${JSON.stringify(key)} || pressed >= 0) return;
        window.removeEventListener("keydown", down, { capture: true });
        pressed = performance.now();
        from = probe().x;
      }, { capture: true });
      const started = performance.now();
      const poll = () => {
        const now = probe();
        if (pressed >= 0) {
          if (now.x !== undefined && now.x !== from) return (state.result = now.at - pressed);
          if (performance.now() - pressed > 2000) return (state.result = -1);
        } else if (!state.ready) {
          still = now.x !== undefined && now.x === last ? still + 1 : 0;
          last = now.x;
          if (still >= (${game.probe.endsWith(")")} ? 40 : 6)) state.ready = true;
          else if (performance.now() - started > 8000) return (state.result = -1);
        }
        again(poll);
      };
      again(poll);
    })()`);
    await page.waitForFunction(
      "window.__latency.ready || window.__latency.result !== undefined",
      undefined,
      { timeout: 15_000 },
    );
    await page.keyboard.down(key);
    await page.waitForFunction(
      "window.__latency.result !== undefined",
      undefined,
      { timeout: 15_000 },
    );
    const latency = await page.evaluate<number>("window.__latency.result");
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

const wanted = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
try {
  for (const name of wanted.length ? wanted : Object.keys(GAMES)) {
    const game = GAMES[name];
    if (!game) throw new Error(`no such game: ${name}`);
    for (const [label, flags] of [
      ["draw at the clock", ""],
      ["a tick behind (lead=off)", "&lead=off"],
    ] as const) {
      const page = await (
        await browser.newContext({ viewport: { width: 1000, height: 700 } })
      ).newPage();
      const values = await measure(page, game, flags);
      console.log(
        `${name}, ${label}: ${values.length}/${presses} presses, press to picture p50 ${percentile(values, 0.5)?.toFixed(0)} ms, p95 ${percentile(values, 0.95)?.toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
