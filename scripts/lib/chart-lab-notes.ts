/**
 * The dev server's side of the Fusemania chart lab's notes: `POST <base>__chart-lab/notes` writes the lab's notes to
 * `<dir>/notes.json` and a note's picture to `<dir>/shots/<note id>.png`. Development only (the built site has no
 * server), and only for a page this same dev server served to this machine.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import { NotesError } from "../../games/fusemania/src/lab/notes.ts";
import {
  MAX_UPLOAD_BYTES,
  NOTES_UPLOAD_PATH,
  parseNotesUpload,
} from "../../games/fusemania/src/lab/notes-upload.ts";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Whether a request may write notes: from this machine, for a local host name, and not from another site's page. */
export function mayStoreNotes(request: {
  remoteAddress: string | undefined;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
}): boolean {
  if (!request.remoteAddress || !LOOPBACK.has(request.remoteAddress))
    return false;
  if (!request.host || !LOCAL_HOST.test(request.host)) return false;
  // A page elsewhere cannot send JSON here without a preflight this server never answers; its origin is checked too.
  if (!request.contentType?.startsWith("application/json")) return false;
  if (request.origin === undefined) return true;
  try {
    return new URL(request.origin).host === request.host;
  } catch {
    return false;
  }
}

/** Writes a checked upload under `dir` and returns the files written, relative to it. */
export function storeNotes(dir: string, body: string): string[] {
  const stored = parseNotesUpload(body);
  mkdirSync(join(dir, "shots"), { recursive: true });
  writeFileSync(join(dir, "notes.json"), stored.notes);
  const written = ["notes.json"];
  if (stored.shot) {
    writeFileSync(join(dir, "shots", stored.shot.file), stored.shot.bytes);
    written.push(`shots/${stored.shot.file}`);
  }
  return written;
}

export function chartLabNotes(dir: string): Plugin {
  return {
    name: "chart-lab-notes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== `${server.config.base}${NOTES_UPLOAD_PATH}`) {
          next();
          return;
        }
        const reply = (status: number, body: object) => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(body));
        };
        if (
          request.method !== "POST" ||
          !mayStoreNotes({
            remoteAddress: request.socket.remoteAddress,
            host: request.headers.host,
            origin: request.headers.origin,
            contentType: request.headers["content-type"],
          })
        ) {
          reply(403, { error: "not allowed" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        request.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_UPLOAD_BYTES) {
            reply(413, { error: "too large" });
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        request.on("end", () => {
          if (size > MAX_UPLOAD_BYTES) return;
          try {
            const written = storeNotes(
              dir,
              Buffer.concat(chunks).toString("utf8"),
            );
            reply(200, { dir, written });
          } catch (error) {
            if (error instanceof NotesError)
              reply(400, { error: error.message });
            else reply(500, { error: String(error) });
          }
        });
      });
    },
  };
}
