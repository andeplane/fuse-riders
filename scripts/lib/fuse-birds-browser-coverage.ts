import type { Page } from "playwright";
import { startGameCoverage } from "./game-browser-coverage.js";

/** Preserve the Birds smoke interface while supporting public-alias Vite modules. */
export const startBirdsCoverage = (page: Page): Promise<() => Promise<void>> =>
  startGameCoverage(page, {
    directory: process.env.FUSE_BIRDS_COVERAGE_DIR,
    gameId: "fuse-birds",
  });
