/** Browser-safe telemetry wire types. Private data stays in the separate report contracts. */
export type TelemetryProperty = string | number | boolean | null;
export interface TelemetryEvent {
  v: 1;
  id: string;
  gameId: string;
  /** Anonymous browser installation, never an account/email or claimed unique person. */
  userId: string;
  sessionId: string;
  name: string;
  occurredAt: number;
  properties: Record<string, TelemetryProperty>;
}
export interface TelemetryEventsRequest {
  events: TelemetryEvent[];
}
export interface TelemetryEventsResponse {
  acknowledgedIds: string[];
}
export type MetricsPeriod = "day" | "week" | "month";
export interface MetricsQuery {
  period: MetricsPeriod;
  /** Inclusive UTC date. The response explicitly includes full aligned periods. */
  from: string;
  /** Inclusive UTC date. */
  to: string;
  gameId?: string;
}
export interface MetricCounts {
  events: number;
  users: number;
  sessions: number;
  roundStarts: number;
  roundEnds: number;
  eventCounts: Record<string, number>;
}
export interface MetricsRow extends MetricCounts {
  /** UTC YYYY-MM-DD; end is exclusive. */
  periodStart: string;
  periodEnd: string;
  /** null is the whole platform, with cross-game users/sessions deduplicated. */
  gameId: string | null;
}
export interface MetricsResponse {
  period: MetricsPeriod;
  timezone: "UTC";
  from: string;
  toExclusive: string;
  /** A row for each aligned period, including periods with zero activity. */
  series: MetricsRow[];
  /** Per-game rows for each period. Uniques must not be summed across periods. */
  games: MetricsRow[];
  limits: { maxPeriods: number; maxDocuments: number };
  partial: false;
}
export * from "./debug-contracts.js";
export * from "./action-contracts.js";
