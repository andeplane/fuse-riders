import type { IncomingMessage } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";
import type { MetricsPeriod } from "./contracts.js";
import {
  requireDeveloper,
  type DeveloperVerifier,
} from "./developer-access.js";
import { TelemetryAdmission } from "./limits.js";
import { MAX_EVENT_BODY_BYTES, type MetricsStore } from "./metrics.js";

async function readBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"]
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new RoomError(415, "Expected application/json");
  const length = req.headers["content-length"];
  if (
    length &&
    (!/^\d+$/.test(length) || Number(length) > MAX_EVENT_BODY_BYTES)
  )
    throw new RoomError(413, "Telemetry body exceeds 64 KiB");
  const chunks: Buffer[] = [];
  let size = 0;
  const deadline = setTimeout(
    () => req.destroy(new RoomError(408, "Request too slow")),
    10_000,
  );
  deadline.unref();
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_EVENT_BODY_BYTES)
        throw new RoomError(413, "Telemetry body exceeds 64 KiB");
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(deadline);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RoomError(400, "Invalid JSON");
  }
}
export function createMetricsHttp(options: {
  metrics: MetricsStore;
  developer: DeveloperVerifier;
  admission?: TelemetryAdmission;
}): HttpExtension {
  const admission = options.admission ?? new TelemetryAdmission();
  return {
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://telemetry");
      if (
        !["/api/telemetry/events", "/api/dev/metrics", "/api/dev/me"].includes(
          url.pathname,
        )
      )
        return false;
      await admission.run(address, async () => {
        const json = (value: unknown) => {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify(value));
        };
        if (url.pathname === "/api/telemetry/events") {
          if (req.method !== "POST") throw new RoomError(405, "Use POST");
          json(await options.metrics.ingest(await readBody(req), address));
          return;
        }
        if (req.method !== "GET") throw new RoomError(405, "Use GET");
        const principal = await requireDeveloper(req, options.developer);
        if (url.pathname === "/api/dev/me") {
          json(principal);
          return;
        }
        const period = url.searchParams.get("period");
        if (period !== "day" && period !== "week" && period !== "month")
          throw new RoomError(400, "Choose day, week or month");
        if (
          [...url.searchParams.keys()].some(
            (key) => !["period", "from", "to", "gameId"].includes(key),
          ) ||
          ["period", "from", "to", "gameId"].some(
            (key) => url.searchParams.getAll(key).length > 1,
          )
        )
          throw new RoomError(400, "Invalid metric query parameters");
        const gameId = url.searchParams.get("gameId");
        json(
          await options.metrics.metrics({
            period: period as MetricsPeriod,
            from: url.searchParams.get("from") ?? "",
            to: url.searchParams.get("to") ?? "",
            ...(gameId === null ? {} : { gameId }),
          }),
        );
      });
      return true;
    },
  };
}
