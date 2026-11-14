import type {
  TelemetryEvent,
  TelemetryProperty,
} from "fuse-telemetry/contracts";
import type { SafeStorage } from "./safe-storage.js";

export const ANALYTICS_QUEUE_KEY = "fuse-metrics-outbox";
export const ANALYTICS_USER_KEY = "fuse-metrics-user";
export const ANALYTICS_SESSION_KEY = "fuse-metrics-session";
export const ANALYTICS_LEDGER_KEY = "fuse-metrics-rounds";
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const MAX_QUEUED_EVENTS = 200;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN =
  /^(?:gameId|userId|sessionId|room|roomCode|matchId|playerId|playerName|name|email|url|token|authorization|password)$/i;
export interface DeliveryEnvironment {
  storage: SafeStorage;
  now(): number;
  uuid(): string;
  schedule(callback: () => void, delayMs: number): () => void;
  /** Serializes persisted mutations across same-origin tabs. Network requests never hold this lock. */
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
  send(events: TelemetryEvent[]): Promise<string[]>;
}
export function boundedProperties(
  properties: Record<string, unknown>,
): Record<string, TelemetryProperty> {
  const result: Record<string, TelemetryProperty> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (Object.keys(result).length >= 24) break;
    if (
      !/^[_a-zA-Z][_a-zA-Z0-9]{0,47}$/.test(key) ||
      FORBIDDEN.test(key) ||
      ["__proto__", "constructor", "prototype"].includes(key)
    )
      continue;
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" &&
        Number.isFinite(value) &&
        Math.abs(value) <= Number.MAX_SAFE_INTEGER)
    )
      result[key] = value;
    else if (typeof value === "string") result[key] = value.slice(0, 160);
  }
  return result;
}
export function createAnalyticsDelivery(
  environment: DeliveryEnvironment,
  enabled: () => boolean,
) {
  const { storage, now } = environment;
  let pending = Promise.resolve();
  let sending = false;
  let cancel: (() => void) | undefined;
  let delay = 1000;
  let touchedAt = -Infinity;
  const read = (): TelemetryEvent[] => {
    try {
      const text = storage.getItem(ANALYTICS_QUEUE_KEY) ?? "[]";
      if (text.length > 2 * 1024 * 1024) return [];
      const raw: unknown = JSON.parse(text);
      if (!Array.isArray(raw)) return [];
      return raw
        .slice(-MAX_QUEUED_EVENTS)
        .filter((item): item is TelemetryEvent => {
          if (!item || typeof item !== "object") return false;
          const event = item as Partial<TelemetryEvent>;
          return (
            event.v === 1 &&
            typeof event.id === "string" &&
            UUID.test(event.id) &&
            typeof event.userId === "string" &&
            UUID.test(event.userId) &&
            typeof event.sessionId === "string" &&
            UUID.test(event.sessionId) &&
            typeof event.gameId === "string" &&
            /^[a-z][a-z0-9-]{0,31}$/.test(event.gameId) &&
            typeof event.name === "string" &&
            /^fuse\.[A-Za-z][A-Za-z0-9 ._-]{0,89}$/.test(event.name) &&
            typeof event.occurredAt === "number" &&
            event.occurredAt > now() - MAX_AGE &&
            event.occurredAt <= now() + 300000 &&
            !!event.properties &&
            !Array.isArray(event.properties) &&
            typeof event.properties === "object"
          );
        })
        .map((event) => ({
          ...event,
          properties: boundedProperties(event.properties),
        }));
    } catch {
      return [];
    }
  };
  const write = (events: TelemetryEvent[]) =>
    storage.setItem(
      ANALYTICS_QUEUE_KEY,
      JSON.stringify(events.slice(-MAX_QUEUED_EVENTS)),
    );
  const locked = (operation: () => Promise<void>) => {
    pending = pending
      .then(() => environment.exclusive(operation))
      .catch(() => undefined);
  };
  const session = () => {
    let userId = storage.getItem(ANALYTICS_USER_KEY);
    if (!userId || !UUID.test(userId)) {
      userId = environment.uuid();
      storage.setItem(ANALYTICS_USER_KEY, userId);
    }
    let previous: { id?: string; at?: number } = {};
    try {
      const raw: unknown = JSON.parse(
        storage.getItem(ANALYTICS_SESSION_KEY) ?? "{}",
      );
      if (raw && typeof raw === "object") previous = raw;
    } catch {
      /* corrupt local state */
    }
    const sessionId =
      typeof previous.id === "string" &&
      UUID.test(previous.id) &&
      typeof previous.at === "number" &&
      now() >= previous.at &&
      now() - previous.at < SESSION_IDLE_MS
        ? previous.id
        : environment.uuid();
    storage.setItem(
      ANALYTICS_SESSION_KEY,
      JSON.stringify({ id: sessionId, at: now() }),
    );
    return { userId, sessionId };
  };
  const schedule = () => {
    if (!cancel)
      cancel = environment.schedule(() => {
        cancel = undefined;
        flush();
      }, delay);
  };
  const flush = () => {
    if (sending) return;
    sending = true;
    const work = pending
      .then(() =>
        environment.exclusive(async () => {
          if (!enabled()) {
            storage.removeItem(ANALYTICS_QUEUE_KEY);
            return [];
          }
          return read().slice(0, 10);
        }),
      )
      .then(async (events) => {
        if (!events.length || !enabled()) return;
        try {
          const acknowledged = new Set(await environment.send(events));
          locked(async () => {
            if (!enabled()) {
              storage.removeItem(ANALYTICS_QUEUE_KEY);
              return;
            }
            const sent = new Set(events.map((event) => event.id));
            write(
              read().filter(
                (event) => !(sent.has(event.id) && acknowledged.has(event.id)),
              ),
            );
            delay = acknowledged.size ? 1000 : Math.min(60000, delay * 2);
          });
        } catch {
          delay = Math.min(60000, delay * 2);
        }
        await pending;
        if (read().length && enabled()) schedule();
      })
      .catch(() => undefined)
      .finally(() => {
        sending = false;
      });
    void work;
  };
  return {
    enqueue(
      gameId: string,
      name: string,
      properties: Record<string, unknown>,
      localScope?: { key: string; requires?: string },
    ) {
      if (
        !enabled() ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(gameId) ||
        !/^fuse\.[A-Za-z][A-Za-z0-9 ._-]{0,89}$/.test(name)
      )
        return;
      const id = environment.uuid(),
        occurredAt = now();
      locked(async () => {
        if (!enabled()) return;
        const identity = session();
        if (localScope) {
          if (localScope.key.length > 512) return;
          let ledger: string[] = [];
          try {
            const raw: unknown = JSON.parse(
              storage.getItem(ANALYTICS_LEDGER_KEY) ?? "[]",
            );
            if (Array.isArray(raw))
              ledger = raw
                .filter((key): key is string => typeof key === "string")
                .slice(-512);
          } catch {
            /* corrupt ledger */
          }
          const prefix = `${identity.sessionId}/${gameId}/${localScope.key}/`;
          const key = prefix + name;
          if (
            ledger.includes(key) ||
            (localScope.requires &&
              !ledger.includes(prefix + "fuse." + localScope.requires))
          )
            return;
          storage.setItem(
            ANALYTICS_LEDGER_KEY,
            JSON.stringify([...ledger, key].slice(-512)),
          );
        }
        write([
          ...read(),
          {
            v: 1,
            id,
            gameId,
            ...identity,
            name,
            occurredAt,
            properties: boundedProperties(properties),
          },
        ]);
        schedule();
      });
    },
    touch() {
      if (now() - touchedAt < 30000) return;
      touchedAt = now();
      locked(async () => {
        if (enabled()) session();
      });
    },
    clear() {
      cancel?.();
      cancel = undefined;
      locked(async () => {
        storage.removeItem(ANALYTICS_QUEUE_KEY);
      });
    },
    flush,
  };
}
