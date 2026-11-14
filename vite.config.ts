import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import {
  publicFilePath,
  publicRequestPath,
} from "./scripts/lib/game-public.ts";
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

/** Every file under `dir`, as paths relative to it. */
const filesUnder = (dir: URL): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      `${entry.parentPath}/${entry.name}`
        .slice(fileURLToPath(dir).length)
        .replaceAll("\\", "/"),
    )
    .sort();

/**
 * A game may keep the files it serves as they are (art sheets, a manifest) in `games/<id>/public/`, laid out as the
 * site serves them: `games/killer-fuse/public/killer-fuse/art/x.png` is `<base>killer-fuse/art/x.png`. The build
 * copies them beside the root `public/`; the dev server answers the same URLs from the source folder.
 */
const gamePublic = (): Plugin => {
  const folder = (id: string) =>
    new URL(`games/${id}/public/`, import.meta.url);
  const owners = games.filter((id) => existsSync(folder(id)));
  return {
    name: "game-public",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        // A request path is attacker-controlled: a bad escape, an absolute path or a whole URL is not a file here.
        const asked = publicRequestPath(url.pathname, server.config.base);
        if (asked !== undefined) {
          const id = owners.find((game) => {
            const file = publicFilePath(fileURLToPath(folder(game)), asked);
            return (
              file !== undefined && existsSync(file) && statSync(file).isFile()
            );
          });
          if (id)
            request.url = `${server.config.base}games/${id}/public/${asked}${url.search}`;
        }
        next();
      });
    },
    generateBundle() {
      for (const id of owners)
        for (const file of filesUnder(folder(id)))
          this.emitFile({
            type: "asset",
            fileName: file,
            source: readFileSync(new URL(file, folder(id))),
          });
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
  // `gamePublic` first: its dev middleware must see a public URL before `gamePages` rewrites it.
  plugins: [gamePublic(), gamePages()],
  server: { host: "0.0.0.0" },
});
