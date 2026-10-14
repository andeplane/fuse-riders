import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Page } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
interface SourceMap {
  version: number;
  sources: string[];
  sourcesContent: string[];
  sourceRoot?: string;
  names: string[];
  mappings: string;
}
export interface GameCoverageOptions {
  directory?: string;
  gameId?: string;
}

/** Vite serves game pages through source paths and public game aliases. */
export function gameSourcePath(pathname: string): string | undefined {
  const match = /^\/(?:games\/)?([a-z][a-z0-9-]*)\/src\/(.+\.ts)$/.exec(
    pathname,
  );
  return match ? `/games/${match[1]}/src/${match[2]}` : undefined;
}

/** Native Chromium ranges, remapped only after checking the exact source Vite executed. */
export async function startGameCoverage(
  page: Page,
  options: GameCoverageOptions = {},
): Promise<() => Promise<void>> {
  const directory = options.directory ?? process.env.FUSE_GAME_COVERAGE_DIR;
  if (!directory) return async () => {};
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  return async () => {
    const entries = await page.coverage.stopJSCoverage();
    const result = [];
    const cache: Record<string, { data: SourceMap; lineLengths: number[] }> =
      {};
    for (const entry of entries) {
      const pathname = gameSourcePath(
        decodeURIComponent(new URL(entry.url || "about:blank").pathname),
      );
      if (
        !pathname ||
        (options.gameId &&
          !pathname.startsWith(`/games/${options.gameId}/src/`))
      )
        continue;
      if (!entry.source) throw new Error(`Missing browser source: ${pathname}`);
      const encoded = entry.source.match(
        /sourceMappingURL=data:application\/json;base64,([^\s]+)/,
      )?.[1];
      if (!encoded) throw new Error(`Missing Vite source map: ${pathname}`);
      const map = JSON.parse(
        Buffer.from(encoded, "base64").toString(),
      ) as SourceMap;
      if (
        map.version !== 3 ||
        map.sourceRoot ||
        map.sources.length !== map.sourcesContent.length
      )
        throw new Error(`Unsupported browser source map: ${pathname}`);
      const generated = resolve(root, `.${pathname}`);
      const gameRoot = resolve(root, pathname.split("/").slice(1, 4).join("/"));
      map.sources = await Promise.all(
        map.sources.map(async (source, index) => {
          const canonical = gameSourcePath(source);
          const path = canonical
            ? resolve(root, `.${canonical}`)
            : resolve(dirname(generated), source);
          if (!path.startsWith(`${gameRoot}${sep}`))
            throw new Error(`Source outside game: ${path}`);
          if ((await readFile(path, "utf8")) !== map.sourcesContent[index])
            throw new Error(
              `Browser source differs from current file: ${path}`,
            );
          return path;
        }),
      );
      // Node/tsx and Vite offsets differ; only identical browser text shares a URL.
      const digest = createHash("sha256").update(entry.source).digest("hex");
      const url = pathToFileURL(
        resolve(directory, `browser-${digest}.js`),
      ).href;
      result.push({
        scriptId: String(result.length),
        url,
        functions: entry.functions,
      });
      cache[url] = {
        data: map,
        lineLengths: entry.source.split("\n").map((line) => line.length),
      };
    }
    if (!result.length)
      throw new Error(
        "No mapped game browser coverage collected; use the Vite source harness",
      );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `coverage-browser-${randomUUID()}.json`),
      JSON.stringify({ result, "source-map-cache": cache }),
    );
  };
}
