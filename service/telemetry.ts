import { createHmac, randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Firestore } from "@google-cloud/firestore";
import {
  RoomError,
  rateLimitAddress,
  type HttpExtension,
} from "fuse-network-be";
import { composeHttp } from "fuse-platform";
import { MetricsStore } from "fuse-telemetry/metrics";
import { createMetricsHttp } from "fuse-telemetry/metrics-http";
import { MemoryTelemetryDatabase } from "fuse-telemetry/metrics-memory";
import { FirestoreTelemetryDatabase } from "fuse-telemetry/metrics-firestore";
import {
  SharedTelemetryQuota,
  TelemetryAdmission,
} from "fuse-telemetry/limits";
import type { TelemetryDatabase } from "fuse-telemetry/metrics-database";
import {
  createDeveloperVerifier,
  type DeveloperVerifier,
} from "fuse-telemetry/developer-access";
import { DebugService } from "fuse-telemetry/debug-service";
import { createDebugHttpExtension } from "fuse-telemetry/debug-http";
import {
  MemoryDebugDatabase,
  MemoryPrivateObjectStorage,
} from "fuse-telemetry/debug-memory";
import {
  FileDebugDatabase,
  FilePrivateObjectStorage,
} from "fuse-telemetry/debug-file";
import { FirestoreDebugDatabase } from "fuse-telemetry/debug-firestore";
import { segmentKey, type DebugDatabase } from "fuse-telemetry/debug-store";
import type { PrivateObjectStorage } from "fuse-telemetry/storage";
import {
  GcsPrivateObjectStorage,
  googleStorageAuthorization,
} from "fuse-telemetry/gcp-storage";
import { OpenAITranscriber } from "fuse-telemetry/openai";
import {
  createWorkerVerifier,
  TranscriptionWorker,
  transcriptionWorkerHttp,
} from "fuse-telemetry/worker";
import type { AudioTranscriber } from "fuse-telemetry/transcription";
import { createActionService } from "fuse-telemetry/action-service";
import { createActionHttp } from "fuse-telemetry/action-http";
import {
  createOpenAIActionExtractor,
  type ActionExtractor,
} from "fuse-telemetry/action-extractor";
import {
  MemoryActionDatabase,
  FileActionDatabase,
  FirestoreActionDatabase,
} from "fuse-telemetry/action-adapters";
import type { ActionDatabase } from "fuse-telemetry/action-store";
import type { TranscriptActionSegment } from "fuse-telemetry/action-contracts";
import { telemetryConfiguration } from "./telemetry-config.js";

export interface TelemetryServicesOptions {
  gameIds: readonly string[];
  developer: DeveloperVerifier;
  metricsDatabase: TelemetryDatabase;
  debugDatabase: DebugDatabase;
  actionDatabase: ActionDatabase;
  objects: PrivateObjectStorage;
  rateLimitKey: string;
  recordingEnabled?: boolean;
  extractor: ActionExtractor;
  now?: () => number;
}

/** The same composition serves production, local previews and injected integration tests. */
export function createTelemetryServices(options: TelemetryServicesOptions) {
  const now = options.now ?? Date.now;
  const games = new Set([...options.gameIds, "fuseos"]);
  const quota = new SharedTelemetryQuota(
    options.metricsDatabase,
    options.rateLimitKey,
    now,
  );
  const metrics = new MetricsStore(
    options.metricsDatabase,
    [...games],
    quota,
    now,
  );
  const debug = new DebugService({
    database: options.debugDatabase,
    objects: options.objects,
    gameIds: games,
    now,
  });
  const actions = createActionService({
    database: options.actionDatabase,
    extractor: options.extractor,
    now,
    async readNeighbors(recordingId, sequence) {
      const indices = [
        sequence - 2,
        sequence - 1,
        sequence,
        sequence + 1,
      ].filter((n) => n >= 0 && n < 720);
      const records = await Promise.all(
        indices.map((n) =>
          options.debugDatabase.read(segmentKey(recordingId, n)),
        ),
      );
      const segments = await Promise.all(
        records.map(async (segment): Promise<TranscriptActionSegment[]> => {
          const at = now();
          if (
            segment?.kind !== "segment" ||
            segment.transcript === undefined ||
            segment.expiresAt <= at
          )
            return [];
          // Evidence metadata is capped; the session's paginated report list retains every report.
          const reports = await options.debugDatabase.reportsInRange(
            recordingId,
            segment.startMs,
            segment.endMs,
            at,
            20,
          );
          return [
            {
              sequence: segment.sequence,
              startMs: segment.startMs,
              endMs: segment.endMs,
              text: segment.transcript,
              ...("gameId" in segment && typeof segment.gameId === "string"
                ? { gameId: segment.gameId }
                : {}),
              reportIds: reports.map((report) => report.id),
            },
          ];
        }),
      );
      return segments.flat();
    },
  });
  const privateRoutes = composeHttp(
    createDebugHttpExtension({
      service: debug,
      verifier: options.developer,
      recordingEnabled: options.recordingEnabled ?? false,
      reportIdentity: (_request, address) =>
        createHmac("sha256", options.rateLimitKey)
          .update(rateLimitAddress(address))
          .digest("hex"),
    }),
    createActionHttp(actions, options.developer),
  );
  const admission = new TelemetryAdmission(now);
  const protectedRoutes: HttpExtension = {
    methods: privateRoutes.methods,
    headers: privateRoutes.headers,
    async handle(req, res, address) {
      const path = new URL(req.url ?? "/", "http://telemetry").pathname;
      if (!path.startsWith("/api/telemetry/") && !path.startsWith("/api/dev/"))
        return false;
      return admission.run(address, async () => {
        await quota.consume([
          {
            dimension: "private-api",
            identity: rateLimitAddress(address),
            cost: 1,
            limit: 300,
            windowMs: 60_000,
          },
        ]);
        return privateRoutes.handle(req, res, address);
      });
    },
  };
  return {
    metrics,
    debug,
    actions,
    http: composeHttp(
      createMetricsHttp({ metrics, developer: options.developer }),
      protectedRoutes,
    ),
  };
}

const unavailableExtractor: ActionExtractor = {
  async extract() {
    throw new Error("Action extraction is not configured");
  },
};

export function createMemoryTelemetry(options: {
  gameIds: readonly string[];
  developer: DeveloperVerifier;
  now?: () => number;
  recordingEnabled?: boolean;
  extractor?: ActionExtractor;
}) {
  return createTelemetryServices({
    ...options,
    metricsDatabase: new MemoryTelemetryDatabase(),
    debugDatabase: new MemoryDebugDatabase(),
    actionDatabase: new MemoryActionDatabase(),
    objects: new MemoryPrivateObjectStorage(),
    rateLimitKey: randomBytes(32).toString("hex"),
    extractor: options.extractor ?? unavailableExtractor,
  });
}

/** Local reports/media survive service restarts; metrics deliberately reset with the local service. */
export async function createLocalTelemetry(options: {
  directory: string;
  gameIds: readonly string[];
  developer: DeveloperVerifier;
  now?: () => number;
}) {
  return createTelemetryServices({
    ...options,
    metricsDatabase: new MemoryTelemetryDatabase(),
    debugDatabase: await FileDebugDatabase.open(
      join(options.directory, "reports"),
    ),
    actionDatabase: await FileActionDatabase.open(
      join(options.directory, "actions.json"),
    ),
    objects: new FilePrivateObjectStorage(join(options.directory, "objects")),
    rateLimitKey: randomBytes(32).toString("hex"),
    recordingEnabled: false,
    extractor: unavailableExtractor,
  });
}

export const telemetryUnavailable: HttpExtension = {
  async handle(req) {
    const path = new URL(req.url ?? "/", "http://telemetry").pathname;
    if (
      path.startsWith("/api/telemetry/") ||
      path.startsWith("/api/dev/") ||
      path === "/api/internal/transcription"
    )
      throw new RoomError(
        503,
        "Developer insights are not configured on this service",
      );
    return false;
  },
};

export function createProductionTelemetry(options: {
  firestore: Firestore;
  prefix: string;
  projectId: string;
  gameIds: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
}): HttpExtension {
  const config = telemetryConfiguration(options.environment);
  if (!config) return telemetryUnavailable;
  // No ephemeral fallback in production: accepted screenshots must survive instance shutdown.
  if (!config.bucket)
    throw new Error("TELEMETRY_BUCKET is required when telemetry is enabled");
  const services = createTelemetryServices({
    gameIds: options.gameIds,
    developer: createDeveloperVerifier(
      options.environment.FIREBASE_PROJECT_ID ?? options.projectId,
    ),
    metricsDatabase: new FirestoreTelemetryDatabase(
      options.firestore,
      options.prefix,
    ),
    debugDatabase: new FirestoreDebugDatabase(
      options.firestore,
      options.prefix,
    ),
    actionDatabase: new FirestoreActionDatabase(
      options.firestore,
      options.prefix,
    ),
    objects: new GcsPrivateObjectStorage(
      config.bucket,
      googleStorageAuthorization(),
    ),
    rateLimitKey: config.rateLimitKey,
    recordingEnabled: config.recordingEnabled,
    extractor: config.openaiKey
      ? createOpenAIActionExtractor({
          apiKey: config.openaiKey,
          model: config.actionModel,
          fetch,
        })
      : unavailableExtractor,
  });
  if (!config.recordingEnabled)
    return composeHttp(services.http, telemetryUnavailable);
  const transcriber: AudioTranscriber = new OpenAITranscriber({
    apiKey: config.openaiKey!,
    model: config.transcriptionModel,
    fetch,
  });
  const worker = new TranscriptionWorker({
    service: services.debug,
    transcriber,
    bucket: config.bucket,
    afterTranscript: (input) => services.actions.process(input),
  });
  const handleWorker = transcriptionWorkerHttp(
    worker,
    createWorkerVerifier(config.pushAudience!, config.pushServiceAccount!),
  );
  return composeHttp(
    { handle: (req, res) => handleWorker(req, res) },
    services.http,
  );
}
