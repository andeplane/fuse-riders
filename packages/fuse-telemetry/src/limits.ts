import { createHmac } from "node:crypto";
import { AddressBudget, RoomError, rateLimitAddress } from "fuse-network-be";
import { record, type TelemetryDatabase } from "./metrics-database.js";

export interface QuotaCharge {
  /** Stable server-selected dimension, never a raw client string as a document path. */
  dimension: string;
  identity: string;
  cost: number;
  limit: number;
  windowMs: number;
}
export interface TelemetryQuota {
  consume(charges: readonly QuotaCharge[]): Promise<void>;
}
/** Atomic multi-dimensional quotas across all gateway instances. HMAC keys never leave this process. */
export class SharedTelemetryQuota implements TelemetryQuota {
  constructor(
    private database: TelemetryDatabase,
    private secret: string,
    private now: () => number = Date.now,
  ) {
    if (Buffer.byteLength(secret) < 32)
      throw new Error(
        "Telemetry rate-limit key must contain at least 32 bytes",
      );
  }
  async consume(charges: readonly QuotaCharge[]): Promise<void> {
    if (charges.length === 0 || charges.length > 64)
      throw new Error("Invalid quota charge count");
    const now = this.now();
    const buckets = new Map<
      string,
      { cost: number; limit: number; expiresAt: number }
    >();
    for (const charge of charges) {
      if (
        !/^[a-z][a-z0-9-]{0,40}$/.test(charge.dimension) ||
        charge.identity.length > 256 ||
        !Number.isSafeInteger(charge.cost) ||
        charge.cost < 1 ||
        !Number.isSafeInteger(charge.limit) ||
        charge.limit < 1 ||
        !Number.isSafeInteger(charge.windowMs) ||
        charge.windowMs < 1000 ||
        charge.windowMs > 86_400_000
      )
        throw new Error("Invalid quota charge");
      const window = Math.floor(now / charge.windowMs);
      const digest = createHmac("sha256", this.secret)
        .update(
          JSON.stringify([
            charge.dimension,
            charge.identity,
            charge.windowMs,
            window,
          ]),
        )
        .digest("hex");
      const key = `telemetry-limits/${digest}`;
      const existing = buckets.get(key);
      buckets.set(key, {
        cost: (existing?.cost ?? 0) + charge.cost,
        limit: charge.limit,
        expiresAt: (window + 2) * charge.windowMs,
      });
    }
    await this.database.transact(async (tx) => {
      const keys = [...buckets.keys()],
        values = await tx.getMany(keys);
      const next = keys.map((key, i) => {
        const bucket = buckets.get(key)!,
          data = record(values[i]);
        if (data && (!Number.isSafeInteger(data.used) || Number(data.used) < 0))
          throw new Error("Stored telemetry quota is invalid");
        const used = Number(data?.used ?? 0) + bucket.cost;
        if (used > bucket.limit)
          throw new RoomError(429, "Telemetry limit reached; retry later");
        return { key, used, expiresAt: bucket.expiresAt };
      });
      for (const { key, ...value } of next) tx.set(key, value);
    });
  }
}
/** Cheap bounded work admission before JSON parsing, database calls or token verification. */
export class TelemetryAdmission {
  private budget: AddressBudget;
  private pending = 0;
  private addresses = new Map<string, number>();
  constructor(now: () => number = Date.now) {
    this.budget = new AddressBudget(now, 60, 2, 5000);
  }
  async run<T>(address: string, operation: () => Promise<T>): Promise<T> {
    const key = rateLimitAddress(address),
      active = this.addresses.get(key) ?? 0;
    if (this.pending >= 64 || active >= 4 || !this.budget.take(key))
      throw new RoomError(429, "Telemetry busy; retry later");
    this.pending++;
    this.addresses.set(key, active + 1);
    try {
      return await operation();
    } finally {
      this.pending--;
      const remaining = this.addresses.get(key)! - 1;
      if (remaining) this.addresses.set(key, remaining);
      else this.addresses.delete(key);
    }
  }
}
