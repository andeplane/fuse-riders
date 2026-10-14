import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import {
  parsePortalEntry,
  type PortalGame,
} from "./packages/fuse-ui/src/portal.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
/** Every game with a page of its own (`games/<id>/index.html`); the root is the gallery. */
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
      // All games are served at `<base><id>/`; the root belongs to the gallery.
      if (!games.includes(id))
        throw new Error(
          `games/${id}/portal.json lists a game with no index.html`,
        );
      return { ...parsed, id, path: `${id}/` };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

/**
 * Emits `games/<id>/index.html` as `<id>/index.html`, so a game is served at `<base><id>/` beside the gallery (the
 * dev room service, GitHub Pages). Its script and style URLs are absolute from the base, so the move keeps them;
 * under a relative base (`--base ./`, a static preview) they are relative to the page and lose one `../`.
 */
const gamePages = (): Plugin => {
  let relative = false;
  return {
    name: "game-pages",
    enforce: "post",
    configureServer(server) {
      // Source previews use the same public game URLs as the emitted site.
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const id = games.find((game) =>
          url.pathname.startsWith(`${server.config.base}${game}/`),
        );
        if (id)
          request.url = `${server.config.base}games/${id}/${url.pathname.slice(`${server.config.base}${id}/`.length) || "index.html"}${url.search}`;
        next();
      });
    },
    configResolved(config) {
      relative = !config.base.startsWith("/") && !/^[a-z]+:/i.test(config.base);
    },
    generateBundle(_options, bundle) {
      for (const id of games) {
        const page = bundle[`games/${id}/index.html`];
        if (!page) continue;
        page.fileName = `${id}/index.html`;
        if (
          relative &&
          page.type === "asset" &&
          typeof page.source === "string"
        )
          page.source = page.source.replaceAll('"../../', '"../');
      }
    },
  };
};

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
