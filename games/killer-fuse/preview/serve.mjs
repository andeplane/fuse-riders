// The arena sandbox, local only: bundles preview/sandbox.ts on every request and serves the art from public/.
// Port zero asks the OS for a free port; pass --port N to choose one.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { build } from "esbuild";

const game = fileURLToPath(new URL("../", import.meta.url));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
};

async function bundle() {
  const result = await build({
    entryPoints: [resolve(game, "preview/sandbox.ts")],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    sourcemap: "inline",
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

/** The file a URL path means, or null when it is outside what the sandbox serves. */
function fileFor(pathname) {
  if (pathname === "/") return resolve(game, "preview/index.html");
  if (!pathname.startsWith("/killer-fuse/art/")) return null;
  const root = resolve(game, "public");
  const path = resolve(root, `.${decodeURIComponent(pathname)}`);
  const child = relative(root, path);
  return child.startsWith("..") || isAbsolute(child) ? null : path;
}

const server = createServer(async (request, response) => {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { pathname } = new URL(request.url, "http://localhost");
    if (pathname === "/sandbox.js") {
      response
        .writeHead(200, { ...headers, "Content-Type": mime[".js"] })
        .end(await bundle());
      return;
    }
    const path = fileFor(pathname);
    if (!path) {
      response.writeHead(404).end("Not found");
      return;
    }
    response
      .writeHead(200, {
        ...headers,
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      })
      .end(await readFile(path));
  } catch (error) {
    response
      .writeHead(500, { "Content-Type": "text/plain" })
      .end(error instanceof Error ? error.message : String(error));
  }
});

const flag = process.argv.indexOf("--port");
const port = flag >= 0 ? Number(process.argv[flag + 1]) : 0;
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Killer Fuse sandbox: http://127.0.0.1:${server.address().port}/?mute`,
  ),
);
