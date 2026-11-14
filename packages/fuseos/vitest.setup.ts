import "@testing-library/jest-dom/vitest";

// Game windows embed same-origin pages in iframes. happy-dom is told not to load them
// (vitest.config.ts) but still reports each skipped load as an error; that is expected.
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (
    args.some(
      (arg) =>
        arg instanceof Error &&
        arg.message.includes("Iframe page loading is disabled"),
    )
  )
    return;
  consoleError(...args);
};
