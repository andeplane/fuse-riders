import { createHash } from "node:crypto";
import { RoomError, rateLimitAddress } from "fuse-network-be";
import type {
  MetricCounts,
  MetricsPeriod,
  MetricsQuery,
  MetricsResponse,
  MetricsRow,
  TelemetryEvent,
  TelemetryEventsResponse,
  TelemetryProperty,
} from "./contracts.js";
import { record, type TelemetryDatabase } from "./metrics-database.js";
import type { QuotaCharge, TelemetryQuota } from "./limits.js";

export const MAX_EVENT_BATCH = 50;
export const MAX_EVENT_BODY_BYTES = 65_536;
export const MAX_METRIC_PERIODS = 93;
export const MAX_METRIC_DOCUMENTS = 16_000;
export const METRIC_SHARDS = 8;
const DAY = 86_400_000,
  EVENT_RETENTION = 90 * DAY,
  SUMMARY_RETENTION = 365 * DAY;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_KEY =
  /^(?:name|username|displayname|playername|ridername|email|uid|userid|sessionid|room|roomcode|roomid|invite|inviteurl|url|.*(?:token|password|secret|authorization|capability|url)|matchid|roundid|peerid)$/i;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const emptyMetricCounts = (): MetricCounts => ({
  events: 0,
  users: 0,
  sessions: 0,
  roundStarts: 0,
  roundEnds: 0,
  eventCounts: {},
});

/** Server-side privacy guard; the browser also removes game-known names and room codes before sending. */
export function scrubTelemetryText(value: string): string {
  return value
    .replace(/\p{Cf}/gu, "")
    .replace(/%(?:3[ADF]|26|2F)/gi, (text) => decodeURIComponent(text))
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, "[url]")
    .replace(/\?[\w.%~-]+=[^\s"'<>)\]]*/g, "[query]")
    .replace(
      /\b(room|token|secret|auth|authorization|password)\s*[=:]\s*(?:(?:bearer|basic)\s+)?[^\s"'<>&,;)\]]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[token]",
    )
    .replace(/\b[0-9a-f]{24,}\b/gi, "[token]")
    .replace(/[\w-]{40,}/g, "[token]")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim()
    .slice(0, 200);
}
export function parseTelemetryEvents(
  value: unknown,
  games: ReadonlySet<string>,
  now: number,
): TelemetryEvent[] {
  const body = record(value);
  if (
    !body ||
    Object.keys(body).some((key) => key !== "events") ||
    !Array.isArray(body.events) ||
    body.events.length < 1 ||
    body.events.length > MAX_EVENT_BATCH
  )
    throw new RoomError(400, "Expected 1–50 telemetry events");
  return body.events.map((raw) => {
    const e = record(raw);
    if (
      !e ||
      Object.keys(e).some(
        (key) =>
          ![
            "v",
            "id",
            "gameId",
            "userId",
            "sessionId",
            "name",
            "occurredAt",
            "properties",
          ].includes(key),
      ) ||
      e.v !== 1 ||
      ![e.id, e.userId, e.sessionId].every(
        (id) => typeof id === "string" && UUID.test(id),
      ) ||
      typeof e.gameId !== "string" ||
      !games.has(e.gameId) ||
      typeof e.name !== "string" ||
      !/^fuse\.[A-Za-z][A-Za-z0-9 ._-]{0,89}$/.test(e.name) ||
      !Number.isSafeInteger(e.occurredAt) ||
      Number(e.occurredAt) < now - EVENT_RETENTION ||
      Number(e.occurredAt) > now + 300_000
    )
      throw new RoomError(400, "Invalid telemetry event");
    const input = record(e.properties);
    if (!input || Object.keys(input).length > 24)
      throw new RoomError(400, "Invalid event properties");
    const properties: Record<string, TelemetryProperty> = {};
    for (const key of Object.keys(input).sort()) {
      const item = input[key];
      if (
        !/^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(key) ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        throw new RoomError(400, "Invalid property key");
      if (PRIVATE_KEY.test(key.replace(/_/g, ""))) continue;
      if (typeof item === "string" && item.length <= 200)
        properties[key] = scrubTelemetryText(item);
      else if (
        typeof item === "boolean" ||
        item === null ||
        (typeof item === "number" &&
          Number.isFinite(item) &&
          Math.abs(item) <= Number.MAX_SAFE_INTEGER)
      )
        properties[key] = item;
      else
        throw new RoomError(400, "Properties must be bounded primitive values");
    }
    return {
      v: 1,
      id: String(e.id).toLowerCase(),
      gameId: e.gameId,
      userId: String(e.userId).toLowerCase(),
      sessionId: String(e.sessionId).toLowerCase(),
      name: e.name,
      occurredAt: Number(e.occurredAt),
      properties,
    };
  });
}
export function periodStart(time: number, period: MetricsPeriod): number {
  const date = new Date(time);
  date.setUTCHours(0, 0, 0, 0);
  if (period === "month") date.setUTCDate(1);
  if (period === "week")
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.getTime();
}
export function periodEnd(start: number, period: MetricsPeriod): number {
  if (period === "day") return start + DAY;
  if (period === "week") return start + 7 * DAY;
  const date = new Date(start);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getTime();
}
const dateString = (time: number) => new Date(time).toISOString().slice(0, 10);
const periodId = (period: MetricsPeriod, start: number) =>
  `${period}-${dateString(start)}`;
const rollupKey = (
  period: MetricsPeriod,
  start: number,
  game: string,
  shard: number,
) => `telemetry-rollups/${periodId(period, start)}-${game}-${shard}`;
function membershipKey(
  period: MetricsPeriod,
  start: number,
  game: string,
  dimension: string,
  identity: string,
): string {
  return `telemetry-memberships/${hash(JSON.stringify([period, start, game, dimension, identity]))}`;
}
function storedCounts(value: unknown): MetricCounts {
  if (value === undefined) return emptyMetricCounts();
  const data = record(value),
    counts = record(data?.eventCounts);
  if (
    !data ||
    !counts ||
    Object.keys(counts).length > 128 ||
    ![
      data.events,
      data.users,
      data.sessions,
      data.roundStarts,
      data.roundEnds,
      ...Object.values(counts),
    ].every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
  )
    throw new Error("Stored metric summary is incompatible");
  return {
    events: Number(data.events),
    users: Number(data.users),
    sessions: Number(data.sessions),
    roundStarts: Number(data.roundStarts),
    roundEnds: Number(data.roundEnds),
    eventCounts: Object.fromEntries(
      Object.entries(counts).map(([key, count]) => [key, Number(count)]),
    ),
  };
}
function addCounts(target: MetricCounts, next: MetricCounts): void {
  target.events += next.events;
  target.users += next.users;
  target.sessions += next.sessions;
  target.roundStarts += next.roundStarts;
  target.roundEnds += next.roundEnds;
  for (const [key, count] of Object.entries(next.eventCounts))
    target.eventCounts[key] = (target.eventCounts[key] ?? 0) + count;
}
function parsedDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new RoomError(400, "Expected UTC YYYY-MM-DD dates");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || dateString(time) !== value)
    throw new RoomError(400, "Invalid date");
  return time;
}
export class MetricsStore {
  private games: ReadonlySet<string>;
  constructor(
    private database: TelemetryDatabase,
    gameIds: readonly string[],
    private quota: TelemetryQuota,
    private now: () => number = Date.now,
  ) {
    if (
      gameIds.length < 1 ||
      gameIds.length > 100 ||
      gameIds.some((id) => !/^[a-z][a-z0-9-]{0,63}$/.test(id) || id === "all")
    )
      throw new Error("Invalid metric game IDs");
    this.games = new Set(gameIds);
  }
  async ingest(
    body: unknown,
    address: string,
  ): Promise<TelemetryEventsResponse> {
    const now = this.now(),
      events = parseTelemetryEvents(body, this.games, now);
    const sessions = new Map<string, number>();
    for (const event of events)
      sessions.set(event.sessionId, (sessions.get(event.sessionId) ?? 0) + 1);
    const charges: QuotaCharge[] = [
      {
        dimension: "events-ip-minute",
        identity: rateLimitAddress(address),
        cost: events.length,
        limit: 2000,
        windowMs: 60_000,
      },
      {
        dimension: "events-ip-day",
        identity: rateLimitAddress(address),
        cost: events.length,
        limit: 50_000,
        windowMs: DAY,
      },
      ...[...sessions].map(([identity, cost]) => ({
        dimension: "events-session-minute",
        identity,
        cost,
        limit: 300,
        windowMs: 60_000,
      })),
    ];
    await this.quota.consume(charges);
    const acknowledgedIds: string[] = [];
    // Separate bounded transactions allow a full batch without exceeding Firestore's transaction write limits.
    // If interrupted, retrying the same IDs acknowledges already accepted events without recounting them.
    for (const event of events) {
      await this.accept(event, now);
      acknowledgedIds.push(event.id);
    }
    return { acknowledgedIds };
  }
  private async accept(event: TelemetryEvent, now: number): Promise<void> {
    const eventKey = `telemetry-events/${event.id}`;
    const fingerprint = hash(JSON.stringify(event));
    const shard =
      Number.parseInt(hash(event.id).slice(0, 8), 16) % METRIC_SHARDS;
    const entries = (["day", "week", "month"] as const).flatMap((period) => {
      const start = periodStart(event.occurredAt, period);
      return ["all", event.gameId].map((game) => ({
        period,
        start,
        game,
        key: rollupKey(period, start, game, shard),
        user: membershipKey(period, start, game, "user", event.userId),
        session: membershipKey(period, start, game, "session", event.sessionId),
        expiresAt: periodEnd(start, period) + SUMMARY_RETENTION,
      }));
    });
    await this.database.transact(async (tx) => {
      const existing = record((await tx.getMany([eventKey]))[0]);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new RoomError(409, "Event ID already has different content");
        return;
      }
      const values = await tx.getMany(
        entries.flatMap((entry) => [entry.key, entry.user, entry.session]),
      );
      const updates = entries.map((entry, i) => {
        const counts = storedCounts(values[i * 3]);
        if (
          !(event.name in counts.eventCounts) &&
          Object.keys(counts.eventCounts).length >= 128
        )
          throw new RoomError(422, "Event name cardinality limit reached");
        counts.events++;
        counts.users += values[i * 3 + 1] === undefined ? 1 : 0;
        counts.sessions += values[i * 3 + 2] === undefined ? 1 : 0;
        counts.roundStarts += event.name === "fuse.Round Started" ? 1 : 0;
        counts.roundEnds += event.name === "fuse.Round Ended" ? 1 : 0;
        counts.eventCounts[event.name] =
          (counts.eventCounts[event.name] ?? 0) + 1;
        return {
          entry,
          counts,
          firstUser: values[i * 3 + 1] === undefined,
          firstSession: values[i * 3 + 2] === undefined,
        };
      });
      // A future-clock event can be retried for five minutes longer. Keep its receipt until after
      // its final admissible retry, so TTL can never remove the dedupe key while delivery is valid.
      tx.set(eventKey, {
        ...event,
        receivedAt: now,
        expiresAt: Math.max(now, event.occurredAt) + EVENT_RETENTION + 1,
        fingerprint,
      });
      for (const { entry, counts, firstUser, firstSession } of updates) {
        tx.set(entry.key, {
          ...counts,
          period: entry.period,
          start: entry.start,
          gameId: entry.game,
          shard,
          expiresAt: entry.expiresAt,
        });
        if (firstUser) tx.set(entry.user, { expiresAt: entry.expiresAt });
        if (firstSession) tx.set(entry.session, { expiresAt: entry.expiresAt });
      }
    });
  }
  async metrics(query: MetricsQuery): Promise<MetricsResponse> {
    if (!["day", "week", "month"].includes(query.period))
      throw new RoomError(400, "Unknown metric period");
    if (query.gameId !== undefined && !this.games.has(query.gameId))
      throw new RoomError(400, "Unknown game");
    const from = parsedDate(query.from),
      to = parsedDate(query.to),
      now = this.now();
    if (from > to) throw new RoomError(400, "Date range is reversed");
    if (
      from < periodStart(now - SUMMARY_RETENTION, "day") ||
      to > periodStart(now, "day")
    )
      throw new RoomError(
        422,
        "Metric dates must be within retained history and today",
      );
    const starts: number[] = [],
      first = periodStart(from, query.period),
      last = periodStart(to, query.period);
    for (
      let start = first;
      start <= last;
      start = periodEnd(start, query.period)
    ) {
      starts.push(start);
      if (starts.length > MAX_METRIC_PERIODS)
        throw new RoomError(
          422,
          `Choose at most ${MAX_METRIC_PERIODS} periods`,
        );
    }
    const games = query.gameId ? [query.gameId] : [...this.games].sort();
    const scopes = query.gameId ? games : ["all", ...games];
    const rows = starts.flatMap((start) =>
      scopes.map((game) => ({ start, game })),
    );
    const keys = rows.flatMap(({ start, game }) =>
      Array.from({ length: METRIC_SHARDS }, (_, shard) =>
        rollupKey(query.period, start, game, shard),
      ),
    );
    if (keys.length > MAX_METRIC_DOCUMENTS)
      throw new RoomError(
        422,
        `Query needs ${keys.length} documents; maximum ${MAX_METRIC_DOCUMENTS}. Narrow the dates or select one game.`,
      );
    const documents = await this.database.readMany(keys);
    if (documents.length !== keys.length)
      throw new Error("Metric query returned an incomplete result");
    const output: MetricsRow[] = rows.map(({ start, game }, index) => {
      const row: MetricsRow = {
        ...emptyMetricCounts(),
        periodStart: dateString(start),
        periodEnd: dateString(periodEnd(start, query.period)),
        gameId: game === "all" ? null : game,
      };
      for (let shard = 0; shard < METRIC_SHARDS; shard++)
        addCounts(row, storedCounts(documents[index * METRIC_SHARDS + shard]));
      return row;
    });
    return {
      period: query.period,
      timezone: "UTC",
      from: dateString(first),
      toExclusive: dateString(periodEnd(last, query.period)),
      series: output.filter((row) =>
        query.gameId ? row.gameId === query.gameId : row.gameId === null,
      ),
      games: output.filter((row) => row.gameId !== null),
      limits: {
        maxPeriods: MAX_METRIC_PERIODS,
        maxDocuments: MAX_METRIC_DOCUMENTS,
      },
      partial: false,
    };
  }
}
