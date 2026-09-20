/**
 * Starts a new game from the template: `pnpm exec tsx scripts/new-game.ts <id>` copies `games/dice` to `games/<id>` with
 * its ids and names renamed (`"dice"` → `"<id>"`, `dice-1` rules → `<id>-1`, `Dice…`/`dice…` identifiers and file
 * names → the id in PascalCase/camelCase). The copy is Pig under a new name, with its tests; change the rules from
 * there. Afterwards run `pnpm install` (the root workspaces include `games/*`) and add the new manifest to
 * Dockerfile.cloud beside `games/dice/package.json`, since `pnpm install --frozen-lockfile` in the service image needs every workspace.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE = "dice";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** A game id as the room service and the platform accept it: lowercase, starting with a letter, at most 32 characters. */
export const GAME_ID = /^[a-z][a-z0-9-]{0,31}$/;

const words = (id: string) => id.split("-").filter(Boolean);
export const camelCase = (id: string): string =>
  words(id)
    .map((word, index) =>
      index === 0 ? word : word[0]!.toUpperCase() + word.slice(1),
    )
    .join("");
export const pascalCase = (id: string): string =>
  words(id)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");

/** The template's text with every id and name of the template replaced by the new game's. */
export function rename(text: string, id: string): string {
  return text
    .replaceAll(`"${TEMPLATE}-1"`, `"${id}-1"`)
    .replaceAll(`"${TEMPLATE}"`, `"${id}"`)
    .replaceAll(`games/${TEMPLATE}`, `games/${id}`)
    .replaceAll("Dice", pascalCase(id))
    .replaceAll("dice", camelCase(id));
}

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

interface Manifest {
  name?: string;
  workspaces?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
const manifest = (path: string): Manifest =>
  JSON.parse(readFileSync(path, "utf8")) as Manifest;

/**
 * Names a new workspace must not take in the repo at `root`: the root package's name, every dependency it declares
 * (a workspace named `vite` would shadow the real one), and each workspace's directory and package name.
 */
export function takenNames(root: string): Set<string> {
  const top = manifest(join(root, "package.json"));
  const taken = new Set<string>([
    ...(top.name ? [top.name] : []),
    ...Object.keys(top.dependencies ?? {}),
    ...Object.keys(top.devDependencies ?? {}),
    ...Object.keys(top.peerDependencies ?? {}),
    ...Object.keys(top.optionalDependencies ?? {}),
  ]);
  for (const pattern of top.workspaces ?? []) {
    const dirs = pattern.endsWith("/*")
      ? readdirSync(join(root, pattern.slice(0, -2)))
          .map((name) => join(root, pattern.slice(0, -2), name))
          .filter((path) => statSync(path).isDirectory())
      : [join(root, pattern)];
    for (const dir of dirs) {
      taken.add(relative(dirname(dir), dir));
      const file = join(dir, "package.json");
      const name = existsSync(file) ? manifest(file).name : undefined;
      if (name) taken.add(name);
    }
  }
  return taken;
}

/**
 * Copies `<gamesDir>/dice` to `<gamesDir>/<id>`. Refuses an id the platform would refuse, a name the repo at `root`
 * already uses (`takenNames`), and a game that already exists. Returns the files written, relative to the new game.
 */
export function newGame(
  id: string,
  gamesDir: string,
  root: string = ROOT,
): string[] {
  if (!GAME_ID.test(id) || id.endsWith("-") || id.includes("--"))
    throw new Error(
      `"${id}" is not a game id: lowercase letters, digits and single hyphens, starting with a letter, at most 32 characters`,
    );
  if (id === TEMPLATE || takenNames(root).has(id))
    throw new Error(
      `"${id}" is taken: a workspace or a dependency of the root package.json already has that name`,
    );
  const from = join(gamesDir, TEMPLATE),
    to = join(gamesDir, id);
  if (!existsSync(from)) throw new Error(`no template at ${from}`);
  if (existsSync(to)) throw new Error(`${to} already exists`);
  const written: string[] = [];
  for (const source of files(from)) {
    const path = rename(relative(from, source), id),
      target = join(to, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, rename(readFileSync(source, "utf8"), id));
    written.push(path);
  }
  return written.sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: pnpm exec tsx scripts/new-game.ts <id>");
    process.exit(1);
  }
  try {
    const gamesDir = fileURLToPath(new URL("../games/", import.meta.url));
    const written = newGame(id, gamesDir);
    console.log(`games/${id}: ${written.length} files`);
    console.log(
      `Next: pnpm install, then add games/${id}/package.json to Dockerfile.cloud beside games/dice/package.json.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
