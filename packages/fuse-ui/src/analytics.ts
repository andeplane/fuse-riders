/** First-party product metrics. Gameplay never depends on delivery succeeding. */
import { safeStorage, type SafeStorage } from "./safe-storage.js";
import { bootFailedProps, sanitizeProperties } from "./analytics-text.js";
import {
  createAnalyticsDelivery,
  type DeliveryEnvironment,
} from "./analytics-client.js";
import { createEndpoints } from "fuse-network-fe";
export type GraphicsReport =
  | { kind: "ready"; renderer: string }
  | { kind: "failed"; stage: "startup" | "context" | "render" };
export const EVENT_PREFIX = "fuse.";
export const OPT_OUT_KEY = "fuse-analytics-opt-out";
const OVERRIDE_KEY = "fuse-analytics";
export function analyticsOverride(
  search: string,
  storage: Pick<Storage, "getItem" | "setItem">,
): string | null {
  const found = new URLSearchParams(search).get("analytics");
  try {
    if (found === "1" || found === "0") {
      storage.setItem(OVERRIDE_KEY, found);
      return found;
    }
    return storage.getItem(OVERRIDE_KEY);
  } catch {
    return found;
  }
}
export function analyticsEnabled(
  override: string | null,
  port: string,
): boolean {
  if (override === "1") return true;
  if (override === "0") return false;
  return port === "";
}
export function doNotTrackOn(flags: readonly unknown[]): boolean {
  return flags.some(
    (flag) => flag === true || flag === 1 || flag === "1" || flag === "yes",
  );
}
export type AnalyticsStatus =
  "on" | "flagOff" | "addressOff" | "doNotTrack" | "optedOut";
export function analyticsStatus(state: {
  override: string | null;
  port: string;
  doNotTrack: boolean;
  optedOut: boolean;
}): AnalyticsStatus {
  if (!analyticsEnabled(state.override, state.port))
    return state.override === "0" ? "flagOff" : "addressOff";
  if (state.doNotTrack) return "doNotTrack";
  return state.optedOut ? "optedOut" : "on";
}
export interface AnalyticsEnvironment extends DeliveryEnvironment {
  storage: SafeStorage;
  search(): string;
  port(): string;
  doNotTrack(): boolean;
  onStorage?(listener: (key: string | null) => void): void;
  onFlush?(listener: () => void): void;
  onActivity?(listener: () => void): void;
}
export interface Analytics {
  start(superProperties: Record<string, unknown>): void;
  track(
    event: string,
    properties?: Record<string, unknown>,
    localScope?: { key: string; requires?: string },
  ): void;
  status(): AnalyticsStatus;
  setOptOut(optedOut: boolean): void;
  onChange(listener: () => void): () => void;
  reportBootFailure(error: unknown): void;
  reportGraphics(event: GraphicsReport): void;
}
export function createAnalytics(
  gameId: string,
  environment: AnalyticsEnvironment,
): Analytics {
  const status = (): AnalyticsStatus =>
    analyticsStatus({
      override: analyticsOverride(environment.search(), environment.storage),
      port: environment.port(),
      doNotTrack: environment.doNotTrack(),
      optedOut: environment.storage.getItem(OPT_OUT_KEY) === "1",
    });
  const delivery = createAnalyticsDelivery(
    environment,
    () => status() === "on",
  );
  let started = false;
  let superProperties: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  const clean = (properties: Record<string, unknown>) => {
    const room = new URLSearchParams(environment.search()).get("room");
    return sanitizeProperties(properties, {
      max: 160,
      secrets: room ? [room] : [],
    });
  };
  const sync = () => {
    if (status() !== "on") delivery.clear();
    else if (started) delivery.flush();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* isolated UI listener */
      }
    }
  };
  try {
    environment.onStorage?.((key) => {
      if (key === null || key === OPT_OUT_KEY) sync();
    });
    environment.onFlush?.(() => delivery.flush());
    environment.onActivity?.(() => {
      if (started && status() === "on") delivery.touch();
    });
  } catch {
    /* unavailable browser surfaces do not break startup */
  }
  const analytics: Analytics = {
    status,
    start(properties) {
      started = true;
      superProperties = { ...superProperties, ...clean(properties) };
      if (status() === "on") delivery.flush();
      else delivery.clear();
    },
    track(event, properties, localScope) {
      if (started && status() === "on")
        delivery.enqueue(
          gameId,
          EVENT_PREFIX + event,
          clean({ ...superProperties, ...properties }),
          localScope,
        );
    },
    setOptOut(optedOut) {
      if (optedOut) environment.storage.setItem(OPT_OUT_KEY, "1");
      else environment.storage.removeItem(OPT_OUT_KEY);
      sync();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reportGraphics(event) {
      if (event.kind === "ready") {
        analytics.start({ renderer: event.renderer });
        analytics.track("Graphics Ready");
      } else analytics.track("Graphics Failed", { stage: event.stage });
    },
    reportBootFailure(error) {
      analytics.start({});
      const { name, ...properties } = bootFailedProps(error);
      analytics.track("Boot Failed", {
        ...properties,
        errorClass: name,
        role: "boot",
      });
    },
  };
  return analytics;
}
export function createBrowserAnalytics(gameId: string): Analytics {
  const storage = safeStorage(() => localStorage);
  return createAnalytics(gameId, {
    storage,
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    schedule: (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
    exclusive: async (operation) => {
      if (navigator.locks)
        return await navigator.locks.request("fuse-analytics", operation);
      return await operation();
    },
    send: async (events) => {
      const endpoints = createEndpoints(
        { basePath: "/", apiOrigin: import.meta.env.VITE_API_ORIGIN },
        location.origin,
      );
      const response = await fetch(endpoints.apiUrl("/api/telemetry/events"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
      if (!response.ok) throw new Error("Metrics unavailable");
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("acknowledgedIds" in body) ||
        !Array.isArray(body.acknowledgedIds)
      )
        throw new Error("Invalid metrics acknowledgement");
      return body.acknowledgedIds.filter(
        (id): id is string => typeof id === "string",
      );
    },
    search: () => location.search,
    port: () => location.port,
    doNotTrack: () =>
      doNotTrackOn([
        navigator.doNotTrack,
        (navigator as { msDoNotTrack?: unknown }).msDoNotTrack,
        (window as { doNotTrack?: unknown }).doNotTrack,
      ]),
    onStorage: (listener) =>
      window.addEventListener("storage", (event) => listener(event.key)),
    onFlush: (listener) => {
      window.addEventListener("online", listener);
      window.addEventListener("pagehide", listener);
      document.addEventListener("visibilitychange", listener);
    },
    onActivity: (listener) => {
      for (const type of ["pointerdown", "keydown"])
        window.addEventListener(type, listener, { passive: true });
    },
  });
}
