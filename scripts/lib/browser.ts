import { chromium, webkit, type Browser, type LaunchOptions } from "playwright";

/**
 * The one place a browser script chooses its engine.
 *
 * `chrome` is the installed Google Chrome channel (hardware GL, what the renderer smokes measure),
 * `chromium` is Playwright's bundled build and `webkit` is Playwright's WebKit. They are three different
 * `pnpm exec playwright install` targets, which is why `scripts/ci-manifest.json` names them per smoke and
 * `tests/ci-manifest.test.ts` compares that list with the calls below found in each script.
 */
export type BrowserKind = "chrome" | "chromium" | "webkit";

/** `BROWSER=webkit` selects WebKit; anything else keeps the script's own Chromium flavour. */
export function browserKind(
  fallback: "chrome" | "chromium",
  env: NodeJS.ProcessEnv = process.env,
): BrowserKind {
  return env.BROWSER === "webkit" ? "webkit" : fallback;
}

export function launchBrowser(
  kind: BrowserKind,
  options: LaunchOptions = {},
): Promise<Browser> {
  if (kind === "webkit") return webkit.launch(options);
  return chromium.launch({
    ...options,
    ...(kind === "chrome" ? { channel: "chrome" } : {}),
  });
}

/** Launch the engine `BROWSER` selects. */
export const launchSelected = (
  fallback: "chrome" | "chromium",
  options: LaunchOptions = {},
): Promise<Browser> => launchBrowser(browserKind(fallback), options);

/**
 * For a smoke that always covers both engines in one run. `name` is the label its reports and
 * screenshots have always used ("chrome" for the bundled Chromium); `kind` is what is launched.
 */
export const BOTH_ENGINES = [
  { name: "chrome", kind: "chromium" },
  { name: "webkit", kind: "webkit" },
] as const satisfies ReadonlyArray<{ name: string; kind: BrowserKind }>;
