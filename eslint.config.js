// A deliberately small, type-aware rule set: it turns conventions this codebase already follows
// into checks and is not a style guide. Prettier owns formatting, so no stylistic rule and no
// `recommended` preset belongs here. Add a rule only when it catches a class of bug this codebase
// has actually had.
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// An empty block hides a decision. A `catch` that swallows on purpose says why in a comment, which
// is the form this rule accepts.
const noEmpty = ["error", { allowEmptyCatch: false }];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/artifacts/**",
      "docs/**",
      "public/**",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  {
    // Everything tsconfig.json includes, so the type-aware rules see the same program as `tsc`.
    files: [
      "src/**/*.ts",
      "tests/**/*.ts",
      "scripts/**/*.ts",
      "packages/*/src/**/*.ts",
      "packages/*/tests/**/*.ts",
      "vite.config.ts",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // A promise nobody awaits loses its rejection: await it, give it a `.catch` that reports,
      // or mark it `void` where dropping the result is correct.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          // node:test registers the test and returns a promise the runner owns; the documented
          // usage never awaits a top-level `test()`.
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: ["test", "it", "describe", "suite"],
            },
          ],
        },
      ],
      // The same loss through a callback: an async function handed to an API that expects `void`
      // (an event listener, `createServer`) has its rejection dropped by the caller.
      "@typescript-eslint/no-misused-promises": "error",
      "no-empty": noEmpty,
    },
  },
  {
    // Plain JavaScript is outside the TypeScript program, so only the syntactic rule applies.
    files: ["**/*.js", "**/*.mjs"],
    rules: { "no-empty": noEmpty },
  },
);
