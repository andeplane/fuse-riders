import type { DiskEntry } from "../disk/diskEntries";
import { editorPathOf } from "../disk/diskEntries";
import { formatSize, MAX_TEXT_FILE_BYTES } from "../disk/fileTypes";
import {
  FLOPPY_JOKE_LOCATION,
  FLOPPY_ZIP_LOCATION,
  RICKROLL_LOCATION,
} from "../disk/floppy";

/** What double clicking an entry does; the view model carries it out (and asks the joke folder's password). */
export type OpenDecision =
  | { type: "navigate"; location: string }
  | { type: "jokeFolder"; location: string }
  | { type: "winzip" }
  /** The video behind the password: the Media Player, under its real title. */
  | { type: "rickroll" }
  | { type: "notepad"; path: string }
  | { type: "image"; path: string }
  | { type: "error"; title: string; message: string };

export const TOO_LARGE_TITLE = "Notepad++";
export const CANNOT_OPEN_TITLE = "Open With";

export function tooLargeMessage(name: string, size: number): string {
  return `${name} is ${formatSize(size)}. Notepad++ opens files up to ${formatSize(MAX_TEXT_FILE_BYTES)}; read this one on GitHub.`;
}

export function cannotOpenMessage(name: string): string {
  return `Windows cannot open this file:\n\n${name}\n\nTo open this file, Windows needs to know what program created it. Windows does not, and neither does FuseOS.`;
}

export function decideOpen(entry: DiskEntry): OpenDecision {
  if (entry.kind !== "file") {
    return entry.location === FLOPPY_JOKE_LOCATION
      ? { type: "jokeFolder", location: entry.location }
      : { type: "navigate", location: entry.location };
  }
  if (entry.location === FLOPPY_ZIP_LOCATION) return { type: "winzip" };
  if (entry.location === RICKROLL_LOCATION) return { type: "rickroll" };
  const path = editorPathOf(entry.location);
  switch (entry.fileKind) {
    case "image":
      return { type: "image", path };
    case "text":
      return (entry.size ?? 0) > MAX_TEXT_FILE_BYTES
        ? {
            type: "error",
            title: TOO_LARGE_TITLE,
            message: tooLargeMessage(entry.name, entry.size ?? 0),
          }
        : { type: "notepad", path };
    default:
      return {
        type: "error",
        title: CANNOT_OPEN_TITLE,
        message: cannotOpenMessage(entry.name),
      };
  }
}
