import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  publicFilePath,
  publicRequestPath,
} from "../scripts/lib/game-public.js";

/**
 * The dev middleware in `vite.config.ts` answers `<base><file>` from `games/<id>/public/`. The request path comes
 * from the network, so neither step may throw and neither may reach outside the game's folder: a 500 from a
 * malformed escape or a file served from `/etc` is the middleware's bug, not the request's.
 */

const BASE = "/";
const FOLDER = "/repo/games/killer-fuse/public";

test("a public request path is decoded and kept relative to the game's folder", () => {
  assert.equal(
    publicRequestPath("/killer-fuse/art/x.png", BASE),
    "killer-fuse/art/x.png",
  );
  assert.equal(
    publicRequestPath("/killer-fuse/art/a%20b.png", BASE),
    "killer-fuse/art/a b.png",
  );
  // A base of its own: only what sits under it is this middleware's.
  assert.equal(
    publicRequestPath("/fuse/killer-fuse/a.png", "/fuse/"),
    "killer-fuse/a.png",
  );
  assert.equal(publicRequestPath("/other/a.png", "/fuse/"), undefined);
  assert.equal(publicRequestPath("/", BASE), undefined);
});

test("a malformed percent escape is refused rather than thrown out of the middleware", () => {
  // `decodeURIComponent` throws URIError on a truncated escape; the middleware must answer the next handler.
  assert.throws(() => decodeURIComponent("/%E0%A4%A"), URIError);
  assert.equal(publicRequestPath("/%E0%A4%A", BASE), undefined);
  assert.equal(publicRequestPath("/art/%ZZ.png", BASE), undefined);
});

test("an absolute URL or an absolute path in the request is refused", () => {
  // `new URL("https://x", folder)` is not a file URL, so the old code threw inside `existsSync`.
  for (const pathname of [
    "/https://x",
    "/HTTPS://x",
    "/file:///etc/passwd",
    "/data:text/plain,x",
    "//evil.example/x.png",
    "/%2F%2Fevil.example/x.png",
    "/%68ttp://x",
  ])
    assert.equal(publicRequestPath(pathname, BASE), undefined, pathname);
  assert.equal(publicRequestPath("/art/x%00.png", BASE), undefined);
});

test("a path that resolves outside the game's folder has no file", () => {
  for (const request of ["../../../etc/passwd", "art/../../secret.txt", ".."])
    assert.equal(publicFilePath(FOLDER, request), undefined, request);
});

test("a path inside the folder resolves to its absolute file", () => {
  assert.equal(
    publicFilePath(FOLDER, "killer-fuse/art/x.png"),
    path.join(FOLDER, "killer-fuse", "art", "x.png"),
  );
  // A `..` that stays inside is still inside.
  assert.equal(
    publicFilePath(FOLDER, "killer-fuse/../killer-fuse/x.png"),
    path.join(FOLDER, "killer-fuse", "x.png"),
  );
  // A sibling folder with the same prefix is not inside it.
  assert.equal(publicFilePath(FOLDER, "../public-secrets/x"), undefined);
});

test("every request the middleware accepts lands inside the folder it was resolved against", () => {
  const root = path.resolve(FOLDER);
  for (const pathname of [
    "/killer-fuse/art/x.png",
    "/killer-fuse/%2e%2e/%2e%2e/etc/passwd",
    "/a%20b/c.png",
    "/..%2f..%2fetc/passwd",
  ]) {
    const asked = publicRequestPath(pathname, BASE);
    const file =
      asked === undefined ? undefined : publicFilePath(FOLDER, asked);
    if (file !== undefined)
      assert.ok(file.startsWith(root + path.sep), `${pathname} -> ${file}`);
  }
});
