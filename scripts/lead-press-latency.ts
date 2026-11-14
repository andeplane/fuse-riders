import { chromium, type Page } from "playwright";

// Press to picture for Fuse Front, Fuse Axe, Graveyard Shift and Fuse Drivers, whose bodies start from rest (the
// moving ones are `lead-input-latency.ts`): how long after a key goes down (a
// click, in Fuse Front) this device's own body is first drawn somewhere else. A solo match in headless Chromium,
// once drawing at the clock (the default) and once the old way (`?lead=off`). The probe (`?probe`) publishes where
// the body was last drawn as `window.__leadProbe` (`x` is the truck's heading in Fuse Drivers). Desktop browser
// figures: they include this machine's frame time, not a display's or a phone's.
//
//   pnpm exec tsx scripts/lead-press-latency.ts [game ...]     against `pnpm dev` (ONLINE_URL to point elsewhere)
const base = process.env.ONLINE_URL ?? "http://localhost:8787/",
  presses = Number(process.env.PRESSES ?? 30);

interface Game {
  /** Flags the page is opened with, besides `solo`, `mute` and `probe`. */
  flags?: string;
  /** Opens a new match for every press: for a body that does not come back to rest where it can be steered. */
  fresh?: boolean;
  /** Gets the solo match to the point where the body answers its controls. */
  ready(page: Page): Promise<void>;
  /** The event the press arrives as, and how to make the `index`th one. */
  event: "keydown" | "pointerup";
  press(page: Page, index: number): Promise<() => Promise<void>>;
}

const phase = (page: Page, key: string, value: string) =>
  page.waitForFunction(
    ([k, v]) => document.querySelector("main")?.dataset[k!] === v,
    [key, value],
    { timeout: 30_000 },
  );
const arrows = async (page: Page, index: number) => {
  const key = index % 2 ? "ArrowLeft" : "ArrowRight";
  await page.keyboard.down(key);
  return () => page.keyboard.up(key);
};

const GAMES: Record<string, Game> = {
  "graveyard-shift": {
    ready: async (page) => void (await phase(page, "phase", "running")),
    event: "keydown",
    press: arrows,
  },
  "fuse-axe": {
    async ready(page) {
      await page.getByRole("button", { name: "START", exact: true }).click();
      await phase(page, "stage", "running");
      await page.waitForTimeout(1500);
    },
    event: "keydown",
    press: arrows,
  },
  "fuse-drivers": {
    // A truck does not turn before the green light, and is soon against a wall with nobody driving it.
    fresh: true,
    async ready(page) {
      await phase(page, "race", "racing");
      await page.waitForTimeout(150);
    },
    event: "keydown",
    press: arrows,
  },
  "fuse-front": {
    // The pixel battlefield: headless Chromium draws the 3D one in software at a few frames a second.
    flags: "&2d",
    // The match's countdown, then the hero stands at its fort.
    ready: (page) => page.waitForTimeout(6000),
    event: "pointerup",
    async press(page, index) {
      const box = (await page.locator("canvas").first().boundingBox())!;
      await page.mouse.click(
        box.x + box.width / 2 + (index % 2 ? -70 : 70),
        box.y + box.height / 2 + (index % 4 < 2 ? -40 : 40),
      );
      return async () => {};
    },
  },
};

async function measure(
  page: Page,
  name: string,
  game: Game,
  flags: string,
): Promise<number[]> {
  const open = async () => {
    await page.goto(
      `${base}${name}/?solo=1&mute&probe${game.flags ?? ""}${flags}`,
    );
    await game.ready(page);
  };
  await open();
  const latencies: number[] = [];
  for (let i = 0; i < presses; i++) {
    if (game.fresh && i > 0) await open();
    // Let the body come to rest, then press at a different point of the 50 ms tick each time.
    await page.evaluate(`new Promise((resolve) => {
      const started = performance.now();
      let at = started, x, y;
      const poll = () => {
        const now = window.__leadProbe ?? {};
        if (now.x !== x || now.y !== y) { x = now.x; y = now.y; at = performance.now(); }
        if (performance.now() - at > 250 || performance.now() - started > 4000) return resolve();
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    })`);
    await page.waitForTimeout((i * 13) % 50);
    // Plain strings: the TypeScript loader would otherwise inject helpers into a serialized function that the page
    // lacks. The listener is in place before the press is made.
    await page.evaluate(`(() => {
      const armed = (window.__leadPress = { pressed: -1 });
      window.addEventListener(${JSON.stringify(game.event)}, () => {
        if (armed.pressed >= 0) return;
        armed.pressed = performance.now();
        ({ x: armed.x, y: armed.y } = window.__leadProbe ?? {});
      }, { capture: true, once: true });
    })()`);
    const release = await game.press(page, i);
    const latency = await page.evaluate<number>(`new Promise((resolve) => {
      const armed = window.__leadPress, started = performance.now();
      const poll = () => {
        const now = window.__leadProbe ?? {};
        if (armed.pressed >= 0 && armed.x !== undefined && (now.x !== armed.x || now.y !== armed.y))
          return resolve(now.at - armed.pressed);
        if (performance.now() - started > 3000) return resolve(-1);
        requestAnimationFrame(poll);
      };
      poll();
    })`);
    await page.waitForTimeout(60);
    await release();
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
    if (!game) throw new Error(`no game ${name}`);
    for (const [label, flags] of [
      ["draw at the clock", ""],
      ["the old way (lead=off)", "&lead=off"],
    ] as const) {
      const page = await (
        await browser.newContext({ viewport: { width: 1000, height: 700 } })
      ).newPage();
      const values = await measure(page, name, game, flags);
      console.log(
        `${name}, ${label}: ${values.length}/${presses} presses, press to picture p50 ${percentile(values, 0.5)?.toFixed(0)} ms, p95 ${percentile(values, 0.95)?.toFixed(0)} ms, max ${Math.max(...values).toFixed(0)} ms`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
