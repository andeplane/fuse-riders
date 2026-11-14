/**
 * Where an Explorer window is, as one string that survives serialization:
 * "" is My Computer, "C:" a drive root, "C:/packages/fuseos" a folder, "A:/porn/homework.txt" a file.
 * Separators are "/" inside (repository paths are "/"-separated); the address bar shows "\".
 */

export type DriveLetter = "C" | "A";

export const MY_COMPUTER = "";
export const DRIVE_C = "C:";
export const DRIVE_A = "A:";

export const DRIVE_LABELS: Record<DriveLetter, string> = {
  C: "Fuse Riders (C:)",
  A: "3½ Floppy (A:)",
};

export function isDriveLetter(value: string): value is DriveLetter {
  return value === "C" || value === "A";
}

/** The drive a location is on; undefined for My Computer. */
export function driveOf(location: string): DriveLetter | undefined {
  const letter = location.charAt(0);
  return location.charAt(1) === ":" && isDriveLetter(letter)
    ? letter
    : undefined;
}

/** The path inside the drive ("packages/fuseos"); "" at the drive root or for My Computer. */
export function pathWithin(location: string): string {
  return driveOf(location) ? location.slice(3) : "";
}

export function joinLocation(location: string, name: string): string {
  return location === MY_COMPUTER ? `${name}:` : `${location}/${name}`;
}

/** The containing folder, the drive root, or My Computer; undefined above My Computer. */
export function parentOf(location: string): string | undefined {
  if (location === MY_COMPUTER) return undefined;
  const within = pathWithin(location);
  if (within === "") return MY_COMPUTER;
  const drive = location.slice(0, 2);
  const cut = within.lastIndexOf("/");
  return cut < 0 ? drive : `${drive}/${within.slice(0, cut)}`;
}

/** The last segment: a file or folder name, the drive label at a root, "My Computer" at the top. */
export function nameOf(location: string): string {
  const drive = driveOf(location);
  if (!drive) return "My Computer";
  const within = pathWithin(location);
  if (within === "") return DRIVE_LABELS[drive];
  return within.slice(within.lastIndexOf("/") + 1);
}

/** What the address bar shows: "My Computer", "C:\", "C:\packages\fuseos". */
export function formatAddress(location: string): string {
  const drive = driveOf(location);
  if (!drive) return "My Computer";
  return `${drive}:\\${pathWithin(location).replaceAll("/", "\\")}`;
}

/**
 * Parses what was typed in the address bar. Accepts either separator, a trailing separator and
 * "My Computer" (any case); undefined for an unknown drive or an empty string.
 */
export function parseAddress(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "my computer")
    return MY_COMPUTER;
  const match = /^([A-Za-z]):?(?:[\\/](.*))?$/.exec(trimmed);
  if (!match) return undefined;
  const letter = (match[1] ?? "").toUpperCase();
  if (!isDriveLetter(letter)) return undefined;
  const rest = (match[2] ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (rest.includes("..")) return undefined;
  return rest.length === 0 ? `${letter}:` : `${letter}:/${rest.join("/")}`;
}

/** Every location from My Computer down to `location`, inclusive. */
export function ancestorsOf(location: string): string[] {
  const chain: string[] = [];
  let current: string | undefined = location;
  while (current !== undefined) {
    chain.unshift(current);
    current = parentOf(current);
  }
  return chain;
}
