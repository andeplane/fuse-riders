/**
 * Starts a new game from the template: `npx tsx scripts/new-game.ts <id>` copies `games/dice` to `games/<id>` with
 * its ids and names renamed (`"dice"` → `"<id>"`, `dice-1` rules → `<id>-1`, `Dice…`/`dice…` identifiers and file
 * names → the id in PascalCase/camelCase). The copy is Pig under a new name, with its tests; change the rules from
 * there. Afterwards run `npm install` (the root workspaces include `games/*`) and add the new manifest to
 * Dockerfile.cloud beside `games/dice/package.json`, since `npm ci` in the service image needs every workspace.
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

/**
 * Copies `<gamesDir>/dice` to `<gamesDir>/<id>`. Refuses an id the platform would refuse, the template's own id, and
 * a game that already exists. Returns the files written, relative to the new game.
 */
export function newGame(id: string, gamesDir: string): string[] {
  if (!GAME_ID.test(id) || id.endsWith("-") || id.includes("--"))
    throw new Error(
      `"${id}" is not a game id: lowercase letters, digits and single hyphens, starting with a letter, at most 32 characters`,
    );
  if (id === TEMPLATE || id === "fuse-riders")
    throw new Error(`"${id}" is taken`);
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
    console.error("usage: npx tsx scripts/new-game.ts <id>");
    process.exit(1);
  }
  try {
    const gamesDir = fileURLToPath(new URL("../games/", import.meta.url));
    const written = newGame(id, gamesDir);
    console.log(`games/${id}: ${written.length} files`);
    console.log(
      `Next: npm install, then add games/${id}/package.json to Dockerfile.cloud beside games/dice/package.json.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
