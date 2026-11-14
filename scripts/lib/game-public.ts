import path from "node:path";

/**
 * Resolving a request against a game's `public/` folder, for the dev middleware in `vite.config.ts`. A request path
 * is attacker-controlled text, so the two steps are kept apart from the file system and tested on their own: what
 * the URL says (`publicRequestPath`), and where that lands on disk (`publicFilePath`).
 */

/** Anything a URL may put in front of a path that is not a relative file: `scheme:`, with no empty scheme allowed. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The path `pathname` asks for under `base`, decoded, or undefined when it does not name a file relative to a
 * game's folder. Refused: a pathname outside the base, a malformed percent escape (`/%E0%A4%A`, which makes
 * `decodeURIComponent` throw), an absolute or protocol-relative path (`//host/x`), an absolute URL (`https://x`,
 * which `new URL(path, folder)` would resolve to a non-file URL) and an embedded NUL.
 */
export function publicRequestPath(
  pathname: string,
  base: string,
): string | undefined {
  if (!pathname.startsWith(base)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.slice(base.length));
  } catch {
    return undefined;
  }
  if (decoded === "" || decoded.startsWith("/")) return undefined;
  if (SCHEME.test(decoded) || decoded.includes("\0")) return undefined;
  return decoded;
}

/**
 * The absolute file `request` names inside `folder`, or undefined when it resolves outside it (`../`, however it
 * is spelled). The caller still has to check that the file exists.
 */
export function publicFilePath(
  folder: string,
  request: string,
): string | undefined {
  const root = path.resolve(folder),
    file = path.resolve(root, request);
  return file === root || file.startsWith(root + path.sep) ? file : undefined;
}
