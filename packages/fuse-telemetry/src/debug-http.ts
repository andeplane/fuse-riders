import type { IncomingMessage, ServerResponse } from "node:http";
import { RoomError, type HttpExtension } from "fuse-network-be";
import {
  requireDeveloper,
  type DeveloperVerifier,
} from "./developer-access.js";
import { DEBUG_LIMITS } from "./debug-contracts.js";
import { DebugService, debugAssert } from "./debug-service.js";
import { readDebugBody } from "./worker.js";

export interface DebugHttpOptions {
  service: DebugService;
  verifier: DeveloperVerifier;
  recordingEnabled?: boolean;
  /** HMAC-derived identity; never raw IP. */ reportIdentity: (
    req: IncomingMessage,
    address: string,
  ) => string;
}
const send = (res: ServerResponse, value: unknown) => {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
async function json(req: IncomingMessage, max = 16_384): Promise<unknown> {
  debugAssert(
    req.headers["content-type"]?.split(";")[0] === "application/json",
    415,
    "JSON required",
  );
  try {
    return JSON.parse((await readDebugBody(req, max)).toString());
  } catch (error) {
    if (error instanceof RoomError) throw error;
    throw new RoomError(400, "Invalid JSON");
  }
}
export function createDebugHttpExtension(
  options: DebugHttpOptions,
): HttpExtension {
  const { service, verifier } = options;
  return {
    methods: ["GET", "POST", "PUT"],
    headers: [
      "Authorization",
      "Content-Type",
      "X-Recording-Start-Ms",
      "X-Recording-Game-Id",
    ],
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://telemetry"),
        path = url.pathname,
        method = req.method;
      if (method === "POST" && path === "/api/telemetry/reports") {
        const input = await json(req, 3 * 1024 * 1024);
        let owner: string | undefined;
        if (input && typeof input === "object" && "recordingId" in input)
          owner = (await requireDeveloper(req, verifier)).uid;
        send(
          res,
          await service.submitReport(
            options.reportIdentity(req, address),
            owner,
            input,
          ),
        );
        return true;
      }
      if (method === "POST" && path === "/api/telemetry/recordings") {
        const principal = await requireDeveloper(req, verifier);
        debugAssert(
          options.recordingEnabled !== false,
          503,
          "Recording is not configured",
        );
        send(res, {
          recording: await service.createRecording(
            principal.uid,
            await json(req),
          ),
        });
        return true;
      }
      const upload =
        /^\/api\/telemetry\/recordings\/([^/]+)\/segments\/(\d+)$/.exec(path);
      if (method === "PUT" && upload) {
        const principal = await requireDeveloper(req, verifier);
        debugAssert(
          options.recordingEnabled !== false,
          503,
          "Recording is not configured",
        );
        debugAssert(
          req.headers["content-type"]?.split(";")[0] === "audio/wav",
          415,
          "PCM WAV required",
        );
        const offset = req.headers["x-recording-start-ms"];
        debugAssert(typeof offset === "string" && /^\d{1,8}$/.test(offset));
        send(
          res,
          await service.upload(
            principal.uid,
            upload[1]!,
            Number(upload[2]),
            Number(offset),
            await readDebugBody(req, DEBUG_LIMITS.segmentBytes),
            typeof req.headers["x-recording-game-id"] === "string"
              ? req.headers["x-recording-game-id"]
              : undefined,
          ),
        );
        return true;
      }
      const finish = /^\/api\/telemetry\/recordings\/([^/]+)\/finish$/.exec(
        path,
      );
      if (method === "POST" && finish) {
        const principal = await requireDeveloper(req, verifier);
        send(res, {
          recording: await service.finish(principal.uid, finish[1]!),
        });
        return true;
      }
      if (!path.startsWith("/api/dev/")) return false;
      if (
        !["/api/dev/reports", "/api/dev/recordings"].includes(path) &&
        !/^\/api\/dev\/(reports|recordings)\/[^/]+(?:\/screenshot|\/segments\/\d+\/audio)?$/.test(
          path,
        )
      )
        return false;
      await requireDeveloper(req, verifier);
      debugAssert(method === "GET", 405);
      const cursor = url.searchParams.get("cursor") ?? undefined,
        limit = Number(url.searchParams.get("limit") ?? 25);
      if (path === "/api/dev/reports") {
        send(
          res,
          await service.listReports(
            limit,
            cursor,
            url.searchParams.get("recordingId") ?? undefined,
          ),
        );
        return true;
      }
      if (path === "/api/dev/recordings") {
        send(res, await service.listRecordings(limit, cursor));
        return true;
      }
      const detail = /^\/api\/dev\/recordings\/([^/]+)$/.exec(path);
      const reportDetail = /^\/api\/dev\/reports\/([^/]+)$/.exec(path);
      if (reportDetail) {
        send(res, { report: await service.report(reportDetail[1]!) });
        return true;
      }
      if (detail) {
        send(res, await service.detail(detail[1]!));
        return true;
      }
      const audio =
          /^\/api\/dev\/recordings\/([^/]+)\/segments\/(\d+)\/audio$/.exec(
            path,
          ),
        screenshot = /^\/api\/dev\/reports\/([^/]+)\/screenshot$/.exec(path);
      if (audio || screenshot) {
        const object = audio
          ? await service.audio(audio[1]!, Number(audio[2]))
          : await service.screenshot(screenshot![1]!);
        debugAssert(object, 404, "Attachment not found");
        res.writeHead(200, {
          "Content-Type": object.mime,
          "Content-Length": object.bytes.length,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        });
        res.end(object.bytes);
        return true;
      }
      return false;
    },
  };
}
