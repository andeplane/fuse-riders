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
      exclude: ["src/__mocks__/**", "src/main.tsx", "src/**/*.d.ts"],
      // Phase A's skeleton; Phase C raises these to 95/95/95/85 once the Phase B packages land.
      thresholds: { lines: 60, statements: 60, functions: 60, branches: 60 },
    },
  },
});
