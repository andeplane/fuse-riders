import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// The OS's unit tests: vitest with happy-dom and Testing Library, next to their sources. The repo's
// `pnpm test` (tsx --test over tests/*.test.ts) never sees them; `pnpm test:os` runs this file.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "happy-dom",
    // Game windows embed same-origin pages; never fetch them in tests.
    environmentOptions: {
      happyDOM: { settings: { disableIframePageLoading: true } },
    },
    setupFiles: ["vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**"],
      // Only the entry point (browser wiring), the LLM worker (runs in a Worker) and the test fakes are out.
      exclude: ["src/__mocks__/**", "src/main.tsx", "src/llm/llmWorker.ts"],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 85 },
    },
  },
});
