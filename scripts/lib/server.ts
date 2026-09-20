import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { dirname } from "node:path";

/** A local server a browser script talks to. `url` always ends in a slash. */
export interface LocalServer {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/** A port nobody holds right now. Parallel worktrees share this machine, so no script may assume 8787. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address !== "string"
          ? resolve(address.port)
          : reject(new Error("No free port")),
      );
    });
  });
}

/** The `Home:` line of the banner `service/dev.ts` prints once it is listening. */
export function roomServiceUrl(log: string): string | undefined {
  return /^Home:\s+(http:\/\/\S+\/)/m.exec(log)?.[1];
}

export interface RoomServiceOptions {
  /** Where the port search starts. Omitted: a free port. The service walks up when this one is taken. */
  port?: number;
  /** The service's stdout and stderr. */
  logFile?: string;
  timeoutMs?: number;
}

/**
 * The production room protocol (packages/fuse-network-be) over in-memory metadata, serving `dist/`:
 * `service/dev.ts` as a child process, so its log stays separate from the smoke's. The URL comes from
 * the service's own banner, because it moves to the next port when the requested one is in use.
 */
export async function startRoomService(
  options: RoomServiceOptions = {},
): Promise<LocalServer> {
  const logFile = options.logFile ?? "artifacts/room-service.log";
  await mkdir(dirname(logFile), { recursive: true });
  const requested = options.port ?? (await freePort());
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "service/dev.ts", "--port", String(requested)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const log = createWriteStream(logFile);
  let output = "",
    started = false;
  // "close", not "exit": the last log lines arrive after the process is gone.
  const exited = new Promise<number | null>((resolve) =>
    child.once("close", (code) => resolve(code)),
  );
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timer);
    }
    await new Promise<void>((resolve) => log.end(resolve));
  };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Room service did not start; see ${logFile}`)),
        options.timeoutMs ?? 30_000,
      );
      const read = (chunk: Buffer) => {
        log.write(chunk);
        if (started) return;
        output += chunk.toString("utf8");
        const found = roomServiceUrl(output);
        if (!found) return;
        started = true;
        clearTimeout(timer);
        resolve(found);
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      void exited.then((code) => {
        clearTimeout(timer);
        reject(
          new Error(`Room service exited early (${code}):\n${output.trim()}`),
        );
      });
    });
    const answer = await fetch(url);
    if (!answer.ok)
      throw new Error(`Room service answered ${answer.status} on ${url}`);
    return { url, port: Number(new URL(url).port), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** Vite serving the source tree on a free port, for the scripts that import renderer modules in the page. */
export async function startViteServer(): Promise<LocalServer> {
  // Imported here so the CI runner, which only needs the room service, does not load Vite.
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { port: 0, host: "127.0.0.1", hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    await server.close();
    throw new Error("Vite did not report a port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    port: address.port,
    stop: () => server.close(),
  };
}
