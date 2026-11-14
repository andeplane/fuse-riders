import type { IncomingMessage } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";
import {
  developerBearer,
  requireDeveloper,
  type DeveloperVerifier,
} from "./developer-access.js";
import type { ActionStatus } from "./action-contracts.js";
import type { ActionPrincipal, ActionService } from "./action-service.js";

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const timeout = setTimeout(
    () => req.destroy(new RoomError(408, "Request too slow")),
    10_000,
  );
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > 4096) throw new RoomError(413, "Action request too large");
      chunks.push(chunk);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError(400, "Invalid action request JSON");
  } finally {
    clearTimeout(timeout);
  }
}
/** Private action-only access. Agent tokens cannot pass developer/media/recording authentication. */
export function createActionHttp(
  service: ActionService,
  verifier: DeveloperVerifier,
): HttpExtension {
  return {
    methods: ["POST", "DELETE"],
    headers: ["Authorization"],
    async handle(req, res) {
      const url = new URL(req.url ?? "/", "http://gateway"),
        path = url.pathname;
      const mutation = path.match(
        /^\/api\/dev\/actions\/([^/]+)\/(claim|renew|complete|release|dismiss)$/,
      );
      const revoke = path.match(/^\/api\/dev\/agent-tokens\/([^/]+)$/);
      if (
        path !== "/api/dev/actions" &&
        path !== "/api/dev/agent-tokens" &&
        !mutation &&
        !revoke
      )
        return false;
      res.setHeader("Cache-Control", "no-store");
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
        return true;
      };
      if (path === "/api/dev/agent-tokens" || revoke) {
        const developer = await requireDeveloper(req, verifier);
        if (revoke && req.method === "DELETE") {
          await service.revokeToken(revoke[1]!, developer.uid);
          return json({ revoked: true });
        }
        if (!revoke && req.method === "POST") {
          const value = await body(req);
          if (
            Object.keys(value).some(
              (key) => !["recordingId", "gameId", "expiresInMs"].includes(key),
            )
          )
            throw new RoomError(400, "Unknown agent token field");
          return json(await service.mintToken(value, developer.uid), 201);
        }
        throw new RoomError(405, "Method not allowed");
      }
      const bearer = developerBearer(req);
      let principal: ActionPrincipal;
      if (bearer.startsWith("fa1.")) {
        const agent = await service.verifyAgentToken(bearer);
        if (!agent) throw new RoomError(403, "Agent token expired or revoked");
        principal = agent;
      } else principal = await requireDeveloper(req, verifier);
      if (path === "/api/dev/actions" && req.method === "GET") {
        const allowed = [
          "recordingId",
          "gameId",
          "since",
          "status",
          "cursor",
          "limit",
        ];
        if (
          [...url.searchParams.keys()].some(
            (key) =>
              !allowed.includes(key) ||
              url.searchParams.getAll(key).length !== 1,
          )
        )
          throw new RoomError(400, "Unknown or duplicate action filter");
        const numeric = (key: string) => {
          const raw = url.searchParams.get(key);
          if (raw === null) return undefined;
          if (!/^\d{1,16}$/.test(raw))
            throw new RoomError(400, `Invalid ${key}`);
          return Number(raw);
        };
        return json(
          await service.list(
            {
              recordingId: url.searchParams.get("recordingId") ?? undefined,
              gameId: url.searchParams.get("gameId") ?? undefined,
              since: numeric("since"),
              status: (url.searchParams.get("status") ?? undefined) as
                ActionStatus | undefined,
              cursor: url.searchParams.get("cursor") ?? undefined,
              limit: numeric("limit"),
            },
            principal,
          ),
        );
      }
      if (mutation && req.method === "POST") {
        const operation = mutation[2] as
          "claim" | "renew" | "complete" | "release" | "dismiss";
        const value = await body(req);
        const fields =
          operation === "claim"
            ? ["agentName", "leaseMs"]
            : operation === "renew"
              ? ["token", "leaseMs"]
              : operation === "release"
                ? ["token"]
                : operation === "dismiss"
                  ? ["note"]
                  : ["token", "note"];
        if (Object.keys(value).some((key) => !fields.includes(key)))
          throw new RoomError(400, "Unknown action field");
        return json(
          await service.mutate(mutation[1]!, operation, value, principal),
        );
      }
      throw new RoomError(405, "Method not allowed");
    },
  };
}
