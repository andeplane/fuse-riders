import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
/** Every game with a page of its own (`games/<id>/index.html`); Fuse Riders is the root page. */
const games = readdirSync(new URL("games/", import.meta.url), {
  withFileTypes: true,
})
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(new URL(`games/${entry.name}/index.html`, import.meta.url)),
  )
  .map((entry) => entry.name)
  .sort();

/**
 * Emits `games/<id>/index.html` as `<id>/index.html`, so a game is served at `<base><id>/` beside Fuse Riders (the
 * dev room service, GitHub Pages). Its script and style URLs are absolute from the base, so the move keeps them.
 */
const gamePages = (): Plugin => ({
  name: "game-pages",
  enforce: "post",
  generateBundle(_options, bundle) {
    for (const id of games) {
      const page = bundle[`games/${id}/index.html`];
      if (page) page.fileName = `${id}/index.html`;
    }
  },
});

export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        ...Object.fromEntries(
          games.map((id) => [id, `${root}games/${id}/index.html`]),
        ),
      },
    },
  },
  plugins: [gamePages()],
  server: { host: "0.0.0.0" },
});
