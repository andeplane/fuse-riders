import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Operation = "claim" | "renew" | "release" | "complete";
export type InsightsCommand =
  | { operation: "list"; filters: Record<string, string> }
  | { operation: Operation; id: string; agentName?: string; note?: string };
export interface InsightsCapabilities {
  request(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; value: unknown }>;
  files: {
    read(id: string): Promise<string>;
    /** Production adapter must persist atomically with mode 0600. */
    save(id: string, contents: string): Promise<void>;
    remove(id: string): Promise<void>;
  };
}
const statuses = new Set([
  "proposed",
  "claimed",
  "done",
  "dismissed",
  "retracted",
]);
const validId = (id: string) => /^[A-Za-z0-9_-]{1,160}$/.test(id);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseInsightsCommand(args: readonly string[]): InsightsCommand {
  const [operation, ...rest] = args;
  if (operation === "list") {
    const filters: Record<string, string> = {};
    const allowed = new Set([
      "gameId",
      "recordingId",
      "since",
      "cursor",
      "status",
      "limit",
    ]);
    for (let index = 0; index < rest.length; index += 2) {
      const flag = rest[index] ?? "",
        value = rest[index + 1];
      const key = flag.startsWith("--") ? flag.slice(2) : "";
      if (
        !allowed.has(key) ||
        filters[key] !== undefined ||
        !value ||
        value.startsWith("--")
      )
        throw new Error(
          "Use list [--gameId ID] [--recordingId ID] [--since EPOCH_MS] [--cursor CURSOR] [--status STATUS] [--limit N]",
        );
      if (
        (key === "since" || key === "limit") &&
        (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value)))
      )
        throw new Error("Numeric filters require safe nonnegative integers");
      if (key === "status" && !statuses.has(value))
        throw new Error("Invalid action status");
      filters[key] = value;
    }
    return { operation, filters };
  }
  if (
    !["claim", "renew", "release", "complete"].includes(operation ?? "") ||
    !validId(rest[0] ?? "")
  )
    throw new Error(
      "Use list, claim ID [--agent NAME], renew ID, release ID, or complete ID --note NOTE",
    );
  const id = rest[0]!;
  if (
    operation === "claim" &&
    (rest.length === 1 ||
      (rest.length === 3 &&
        rest[1] === "--agent" &&
        rest[2]!.trim().length > 0 &&
        rest[2]!.length <= 80))
  )
    return { operation, id, agentName: rest[2] ?? "codex" };
  if (
    operation === "complete" &&
    rest.length === 3 &&
    rest[1] === "--note" &&
    rest[2]!.trim() &&
    rest[2]!.length <= 1000
  )
    return { operation, id, note: rest[2]! };
  if ((operation === "renew" || operation === "release") && rest.length === 1)
    return { operation, id };
  throw new Error(
    "Invalid command arguments; secrets are read from environment or local claim files",
  );
}

export function insightsOrigin(raw: string | undefined): string {
  if (!raw) throw new Error("FUSE_DEV_API_ORIGIN is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid FUSE_DEV_API_ORIGIN");
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "FUSE_DEV_API_ORIGIN must be an HTTPS origin (HTTP is allowed for localhost)",
    );
  return url.origin;
}

/** No output side effects: the caller prints only the returned private action data. */
export async function runInsightsCommand(
  command: InsightsCommand,
  environment: Readonly<Record<string, string | undefined>>,
  capabilities: InsightsCapabilities,
): Promise<unknown> {
  const apiOrigin = insightsOrigin(environment.FUSE_DEV_API_ORIGIN);
  const bearer = environment.FUSE_DEV_AGENT_TOKEN;
  if (!bearer || !/^fa1\.[A-Za-z0-9._-]+$/.test(bearer))
    throw new Error(
      "FUSE_DEV_AGENT_TOKEN must contain an action-only token minted in /dev/",
    );
  const headers = {
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
  };
  let url = `${apiOrigin}/api/dev/actions`,
    body: Record<string, string> | undefined;
  if (command.operation === "list")
    url += `?${new URLSearchParams(command.filters)}`;
  else {
    if (!validId(command.id)) throw new Error("Invalid action ID");
    url += `/${encodeURIComponent(command.id)}/${command.operation}`;
    if (command.operation === "claim")
      body = { agentName: command.agentName ?? "codex" };
    else {
      let lease: unknown;
      try {
        lease = JSON.parse(await capabilities.files.read(command.id));
      } catch {
        throw new Error(
          "A readable saved claim is required; claim files are private local state",
        );
      }
      if (
        !object(lease) ||
        typeof lease.token !== "string" ||
        !lease.token ||
        lease.id !== command.id ||
        lease.apiOrigin !== apiOrigin
      )
        throw new Error(
          "Saved claim is invalid or belongs to a different API origin",
        );
      body = { token: lease.token };
      if (command.operation === "complete") body.note = command.note ?? "";
    }
  }
  let response: { status: number; value: unknown };
  try {
    response = await capabilities.request(url, {
      method: body ? "POST" : "GET",
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      "Developer API request failed; claim state preserved. Check connectivity before retrying",
    );
  }
  // Never echo response bodies or transport exceptions: either can contain credentials.
  if (response.status < 200 || response.status >= 300)
    throw new Error(
      `Developer API returned HTTP ${response.status}; claim state preserved`,
    );
  if (!object(response.value))
    throw new Error("Invalid developer API response; claim state preserved");
  const value = response.value;
  if (command.operation === "list") {
    if (!Array.isArray(value.actions) || !value.actions.every(object))
      throw new Error("Invalid actions page");
    return {
      actions: value.actions.map(actionMetadata),
      ...(typeof value.nextCursor === "string"
        ? { nextCursor: value.nextCursor }
        : {}),
      scannedRecordings: value.scannedRecordings,
    };
  }
  const item =
    command.operation === "claim" || command.operation === "renew"
      ? value.action
      : value;
  if (!object(item) || item.id !== command.id)
    throw new Error("Invalid action response; claim state preserved");
  if (command.operation === "claim" || command.operation === "renew") {
    if (typeof value.token !== "string" || !value.token)
      throw new Error("Missing claim lease token; claim state preserved");
    try {
      await capabilities.files.save(
        command.id,
        JSON.stringify({
          id: command.id,
          apiOrigin,
          token: value.token,
          expiresAt: object(item.lease) ? item.lease.expiresAt : undefined,
        }),
      );
    } catch {
      throw new Error(
        "Cannot save private claim file; the server lease may still be active. Retry after its expiry",
      );
    }
  } else {
    try {
      await capabilities.files.remove(command.id);
    } catch {
      throw new Error(
        "Server operation succeeded but local claim cleanup failed; remove the stale claim file",
      );
    }
  }
  return { action: actionMetadata(item) };
}

function actionMetadata(
  action: Record<string, unknown>,
): Record<string, unknown> {
  const keys = [
    "id",
    "recordingId",
    "gameId",
    "title",
    "detail",
    "evidence",
    "status",
    "createdAt",
    "updatedAt",
    "revision",
    "lease",
    "resolution",
    "retraction",
    "correction",
  ];
  return Object.fromEntries(
    keys.filter((key) => key in action).map((key) => [key, action[key]]),
  );
}

export function nodeInsightsCapabilities(
  directory = resolve(".fuse-insights", "claims"),
): InsightsCapabilities {
  const file = (id: string) => {
    if (!validId(id)) throw new Error("Invalid action ID");
    return resolve(directory, `${id}.json`);
  };
  return {
    async request(url, init) {
      const response = await fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      return {
        status: response.status,
        value: response.ok ? await response.json() : undefined,
      };
    },
    files: {
      read: (id) => readFile(file(id), "utf8"),
      async save(id, contents) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await chmod(directory, 0o700);
        const temporary = `${file(id)}.${crypto.randomUUID()}.tmp`;
        try {
          await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
          await rename(temporary, file(id));
        } finally {
          await unlink(temporary).catch(() => undefined);
        }
      },
      remove: (id) => unlink(file(id)),
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(
        await runInsightsCommand(
          parseInsightsCommand(process.argv.slice(2)),
          process.env,
          nodeInsightsCapabilities(),
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Developer insights command failed",
    );
    process.exitCode = 1;
  }
}
