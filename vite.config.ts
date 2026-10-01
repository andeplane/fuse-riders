import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import {
  parsePortalEntry,
  type PortalGame,
} from "./packages/fuse-ui/src/portal.ts";

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
 * The app portal's games: every `games/<id>/portal.json`, ordered by `order` then name. A game without one (the
 * dice demo) stays off the portal; AGENTS.md says which games belong on it.
 */
const ROOT_GAME = "fuse-riders";
const portalGames = (): PortalGame[] =>
  readdirSync(new URL("games/", import.meta.url), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(new URL(`games/${entry.name}/portal.json`, import.meta.url)),
    )
    .map((entry) => {
      const id = entry.name;
      const parsed = parsePortalEntry(
        JSON.parse(
          readFileSync(
            new URL(`games/${id}/portal.json`, import.meta.url),
            "utf8",
          ),
        ),
      );
      if (!parsed) throw new Error(`games/${id}/portal.json is invalid`);
      // Fuse Riders is the root page; every other game is served at `<base><id>/` and must have that page.
      if (id === ROOT_GAME) return { ...parsed, id, path: "" };
      if (!games.includes(id))
        throw new Error(
          `games/${id}/portal.json lists a game with no index.html`,
        );
      return { ...parsed, id, path: `${id}/` };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

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
  define: { __FUSE_PORTAL_GAMES__: JSON.stringify(portalGames()) },
  plugins: [gamePages()],
  server: { host: "0.0.0.0" },
});
