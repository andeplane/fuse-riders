import type { DiskDeps } from "./diskDepsContext";
import { driveOf } from "./diskPath";
import { HOMEWORK_LOCATION, HOMEWORK_TEXT } from "./floppy";

/** A file as Notepad++ opens it: the committed text, the browser's saved copy if any, and where the text came from. */
export type LoadedFile = {
  original: string;
  saved: string | undefined;
  fromFallback: boolean;
};

/**
 * Reads a file by its editor path: a repository path for C:, an "A:/..." location for the floppy.
 * The overlay's copy, when there is one, rides along so the caller can show it instead.
 */
export async function loadFile(
  deps: Pick<DiskDeps, "source" | "overlay">,
  path: string,
): Promise<LoadedFile> {
  const [original, saved] = await Promise.all([
    readOriginal(deps.source, path),
    deps.overlay.read(path),
  ]);
  return { ...original, saved };
}

async function readOriginal(
  source: DiskDeps["source"],
  path: string,
): Promise<{ original: string; fromFallback: boolean }> {
  if (driveOf(path) === "A") {
    if (path === HOMEWORK_LOCATION)
      return { original: HOMEWORK_TEXT, fromFallback: false };
    throw new Error(`There is no ${path} on the floppy.`);
  }
  if (driveOf(path)) throw new Error(`${path} is not a path on the C: drive.`);
  const text = await source.readText(path);
  return { original: text.text, fromFallback: text.fromFallback };
}
