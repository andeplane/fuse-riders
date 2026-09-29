// Local asset-review server only. Port zero asks the OS for a free port.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative, extname, isAbsolute } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const path = resolve(
      root,
      "." +
        decodeURIComponent(
          url.pathname === "/" ? "/art-preview.html" : url.pathname,
        ),
    );
    const child = relative(root, path);
    if (child.startsWith("..") || isAbsolute(child)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(path);
    response
      .writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      })
      .end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    `Hook Havok art lab: http://127.0.0.1:${server.address().port}/?mute`,
  ),
);
