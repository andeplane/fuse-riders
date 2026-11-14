import { chromium, type Page } from "playwright";

// Press to picture for Ball Bros and Hook Havok: how long after a key goes down this device's paddle or keeper is
// first drawn somewhere else. Solo play in headless Chromium, once drawing at the clock (the default) and once the
// old way (`?lead=off`). The probe (`?probe`) publishes where the body was last drawn. Desktop browser figures: they
// include this machine's frame time, not a display's or a phone's. Hook Havok's scene needs a GPU: without one
// (a cloud container renders it at about 5 frames a second) its figures are frame times, not latency, and
// games/hook-havok/tests/forward.test.ts measures the same press on the real runtime with a simulated display.
//
//   pnpm dev   (in another shell)
//   pnpm exec tsx scripts/ball-bros-hook-havok-input-latency.ts
const base = process.env.ONLINE_URL ?? "http://localhost:8787/",
  presses = Number(process.env.PRESSES ?? 30),
  /** `GAME=hook` measures only the games whose name contains it. */
  only = (process.env.GAME ?? "").toLowerCase();

interface Game {
  name: string;
  /** Opens a solo round and resolves once the probe reports a drawn body. */
  open(page: Page, flags: string): Promise<void>;
  /** Global the probe publishes, and the field of it a press changes. */
  probe: string;
  field: string;
  keys: readonly [string, string];
}

const GAMES: Game[] = [
  {
    name: "Ball Bros",
    probe: "__ballBrosProbe",
    field: "angle",
    keys: ["ArrowLeft", "ArrowRight"],
    async open(page, flags) {
      await page.goto(`${base}ball-bros/?solo&mute&probe${flags}`);
    },
  },
  {
    name: "Hook Havok",
    probe: "__hookHavokProbe",
    field: "x",
    keys: ["KeyD", "KeyA"],
    async open(page, flags) {
      await page.goto(`${base}hook-havok/?mute&play&probe${flags}`);
      await page.locator('#status[data-state="ready"]').waitFor();
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page
        .getByRole("button", { name: "Single player", exact: true })
        .click();
      // Take slot 1 under a name, then close the room menu so keys reach the arena.
      await page
        .locator("button:visible", { hasText: /^Join$/ })
        .first()
        .click();
      await page.keyboard.type("Probe");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
      await page.keyboard.press("Escape");
      await page.locator("#scene").focus();
    },
  },
];

async function ready(page: Page, game: Game, flags: string): Promise<void> {
  await game.open(page, flags);
  await page.waitForFunction(
    `typeof window.${game.probe}?.${game.field} === "number"`,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(1500);
}

async function measure(
  page: Page,
  game: Game,
  flags: string,
): Promise<number[]> {
  await ready(page, game, flags);
  const latencies: number[] = [];
  for (let i = 0; i < presses; i++) {
    // Let the body come to rest, at a different point of the 50 ms tick each time.
    await page.waitForTimeout(700 + ((i * 13) % 50));
    const key = game.keys[i % 2]!;
    // A plain string: the TypeScript loader would otherwise inject helpers into a serialized function that the page lacks.
    // Listen first, then press: the listener must be in place before the key goes down.
    await page.evaluate(`(() => { window.__press = new Promise((resolve) => {
      const probe = () => window.${game.probe};
      let pressed = -1, from;
      window.addEventListener("keydown", (event) => {
        if (event.code !== ${JSON.stringify(key)} || pressed >= 0) return;
        pressed = performance.now();
        from = probe().${game.field};
      }, { capture: true });
      const started = performance.now();
      const poll = () => {
        const now = probe();
        if (pressed >= 0 && from !== undefined && now.${game.field} !== from) return resolve(now.at - pressed);
        if (performance.now() - started > 3000) return resolve(-1);
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }); })()`);
    await page.keyboard.down(key);
    const latency = await page.evaluate<number>("window.__press");
    await page.waitForTimeout(60);
    await page.keyboard.up(key);
    if (latency >= 0) latencies.push(latency);
    // The round ended or the body is out of play: start another.
    else await ready(page, game, flags);
  }
  return latencies;
}

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ];

const browser = await chromium.launch({ headless: true });
try {
  for (const game of GAMES.filter((each) =>
    each.name.toLowerCase().includes(only),
  ))
    for (const [name, flags] of [
      ["draw at the clock", ""],
      ["a tick behind (lead=off)", "&lead=off"],
    ] as const) {
      const page = await (
        await browser.newContext({ viewport: { width: 1440, height: 1100 } })
      ).newPage();
      const values = await measure(page, game, flags);
      console.log(
        `${game.name}, ${name}: ${values.length}/${presses} presses, press to picture p50 ${percentile(values, 0.5)?.toFixed(0)} ms, p95 ${percentile(values, 0.95)?.toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`,
      );
      await page.close();
    }
} finally {
  await browser.close();
}
