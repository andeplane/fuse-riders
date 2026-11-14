import { appendFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";

/**
 * Where a `?debugtiming` page's session goes when the game runs locally: `POST /api/dev/timing-log` appends the
 * page's JSON lines to `<directory>/<game>-<session>.jsonl`, so whoever debugs the timing afterwards (a person or
 * an agent) reads the whole session from a file instead of from a screenshot. Local only: `service/dev.ts`
 * mounts it, the deployed service (`service/index.ts`) does not, and the page asks only on a local host.
 *
 * The request is checked like any other boundary: names are a fixed alphabet (they become a file name), the body
 * is bounded while it is read, every line must be a JSON object, and one session's file stops growing at a limit.
 */
export const TIMING_LOG_PATH = "/api/dev/timing-log";
export const MAX_TIMING_BODY_BYTES = 1_000_000;
export const MAX_TIMING_FILE_BYTES = 50_000_000;
const NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** The slice of the file system the log needs. */
export interface TimingLogFiles {
  ensure(directory: string): Promise<void>;
  /** Bytes in the file, 0 when there is none. */
  size(path: string): Promise<number>;
  append(path: string, text: string): Promise<void>;
}
export const nodeTimingLogFiles: TimingLogFiles = {
  ensure: async (directory) =>
    void (await mkdir(directory, { recursive: true })),
  size: (path) =>
    stat(path).then(
      (found) => found.size,
      () => 0,
    ),
  append: (path, text) => appendFile(path, text, "utf8"),
};

async function readText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_TIMING_BODY_BYTES)
      throw new RoomError(413, "Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The lines of a body that are JSON objects, re-serialised one per line; undefined when any line is not one. */
export function timingLines(body: string): string | undefined {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    out.push(JSON.stringify(value));
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

export function createTimingLogHttp(
  directory: string,
  files: TimingLogFiles = nodeTimingLogFiles,
): HttpExtension {
  /** One write at a time, so two requests cannot both find room under the limit and overshoot it together. */
  let writing: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = writing.then(work, work);
    writing = turn.catch(() => undefined);
    return turn;
  };
  return {
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://local");
      if (url.pathname !== TIMING_LOG_PATH) return false;
      const answer = (status: number, body: Record<string, unknown>) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
        return true;
      };
      if (req.method !== "POST") return answer(405, { error: "POST only" });
      const game = url.searchParams.get("game") ?? "",
        session = url.searchParams.get("session") ?? "";
      if (!NAME.test(game) || !NAME.test(session))
        return answer(400, { error: "Invalid game or session name" });
      const lines = timingLines(await readText(req));
      if (lines === undefined)
        return answer(400, { error: "Every line must be a JSON object" });
      const path = join(directory, `${game}-${session}.jsonl`);
      if (lines !== "") {
        const full = await inTurn(async () => {
          await files.ensure(directory);
          // Bytes, not characters: a song title can be any script.
          if (
            (await files.size(path)) + Buffer.byteLength(lines, "utf8") >
            MAX_TIMING_FILE_BYTES
          )
            return true;
          await files.append(path, lines);
          return false;
        });
        if (full) return answer(413, { error: "This session's log is full" });
      }
      return answer(200, { file: path });
    },
  };
}
