/**
 * The chart lab's notes on their way to disk: in local development the page posts its notes, and a picture of the lab
 * for a note just written, to the dev server, which keeps them in a folder beside the checkout so whoever tunes the
 * charts (a person or an agent) can read them without the browser. Both ends validate through this module.
 */
import { NotesError, parseNotes, writeNotes, type NotesFile } from "./notes.js";
import { parseTaps, writeTaps, type TapsFile } from "./taps.js";

/** Where the page posts, under the site's base. */
export const NOTES_UPLOAD_PATH = "__chart-lab/notes";
/** The largest body the server reads: the notes and one picture. */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

const PNG_PREFIX = "data:image/png;base64,";
const NOTE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** What the page sends: every note, and the picture taken as one of them was saved. */
export interface NotesUpload {
  notes: NotesFile;
  shot?: { id: string; png: string };
  /** One song's tapped rhythm (record mode), whenever it changes. */
  taps?: TapsFile;
}

/** What the server writes: the notes file's text, and the picture's file name and bytes. */
export interface NotesToStore {
  notes: string;
  shot?: { file: string; bytes: Uint8Array };
  taps?: { file: string; text: string };
}

export const writeNotesUpload = (upload: NotesUpload): string =>
  JSON.stringify(upload);

/**
 * Checks a posted body and turns it into what goes on disk. The notes are re-validated and rewritten; the picture
 * must be a PNG data URL named by the id of one of those notes, so its file name is never the sender's free choice.
 */
export function parseNotesUpload(text: string): NotesToStore {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new NotesError("the upload is not JSON");
  }
  if (typeof body !== "object" || body === null)
    throw new NotesError("the upload is not an object");
  const { notes, shot, taps } = body as {
    notes?: unknown;
    shot?: unknown;
    taps?: unknown;
  };
  const file = parseNotes(JSON.stringify(notes));
  const stored: NotesToStore = { notes: writeNotes(file) };
  if (taps !== undefined) {
    // The song id is checked by `parseTaps`, so the file name is never the sender's free choice.
    const tapped = parseTaps(JSON.stringify(taps));
    stored.taps = { file: `${tapped.song}.json`, text: writeTaps(tapped) };
  }
  if (shot === undefined) return stored;
  if (typeof shot !== "object" || shot === null)
    throw new NotesError("the picture is not an object");
  const { id, png } = shot as { id?: unknown; png?: unknown };
  if (typeof id !== "string" || !NOTE_ID.test(id))
    throw new NotesError("the picture's note id is not valid");
  if (!file.notes.some((note) => note.id === id))
    throw new NotesError("the picture is for a note that is not in the file");
  if (typeof png !== "string" || !png.startsWith(PNG_PREFIX))
    throw new NotesError("the picture is not a PNG data URL");
  let binary: string;
  try {
    binary = atob(png.slice(PNG_PREFIX.length));
  } catch {
    throw new NotesError("the picture is not valid base64");
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  // A PNG starts with these eight bytes.
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!magic.every((byte, index) => bytes[index] === byte))
    throw new NotesError("the picture is not a PNG");
  stored.shot = { file: `${id}.png`, bytes };
  return stored;
}
