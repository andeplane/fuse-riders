/** Service-owned lease decisions. Call inside the room's serialized storage transaction. */
export const LEASE_MS = 10_000;
export const LEASE_GUARD_MS = 250;
/** Checks further apart than this (the authority's own tick loop stalled) drop the sample; a GC pause or a busy frame does not. */
export const STALL_MS = 1500;
export interface AuthorityGrant {
  incarnation: string;
  epoch: number;
  holder: string;
  grantId: string;
  validFrom: number;
  expiresAt: number;
}
export interface GrantIdentity {
  incarnation: string;
  epoch: number;
  holder: string;
  grantId: string;
}
export function reserveAuthority(
  previous: AuthorityGrant | undefined,
  incarnation: string,
  holder: string,
  grantId: string,
  now: number,
): AuthorityGrant {
  if (!Number.isFinite(now) || now < 0 || !incarnation || !holder || !grantId)
    throw new Error("Invalid authority reservation");
  if (previous && previous.incarnation !== incarnation)
    throw new Error("Room incarnation mismatch");
  const epoch = (previous?.epoch ?? 0) + 1;
  if (!Number.isSafeInteger(epoch))
    throw new Error("Authority epoch exhausted");
  const validFrom = Math.max(
    now,
    previous ? previous.expiresAt + LEASE_GUARD_MS : now,
  );
  return {
    incarnation,
    epoch,
    holder,
    grantId,
    validFrom,
    expiresAt: validFrom + LEASE_MS,
  };
}
export function sameGrant(a: GrantIdentity, b: GrantIdentity): boolean {
  return (
    a.incarnation === b.incarnation &&
    a.epoch === b.epoch &&
    a.holder === b.holder &&
    a.grantId === b.grantId
  );
}
export function renewAuthority(
  current: AuthorityGrant,
  claimant: GrantIdentity,
  now: number,
): AuthorityGrant | undefined {
  if (
    !Number.isFinite(now) ||
    !sameGrant(current, claimant) ||
    now < current.validFrom ||
    now >= current.expiresAt
  )
    return;
  return { ...current, expiresAt: Math.max(current.expiresAt, now + LEASE_MS) };
}
export function isAuthorityGrant(value: unknown): value is AuthorityGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    ["incarnation", "holder", "grantId"].every(
      (key) =>
        typeof v[key] === "string" && v[key].length > 0 && v[key].length <= 128,
    ) &&
    typeof v.epoch === "number" &&
    Number.isSafeInteger(v.epoch) &&
    v.epoch > 0 &&
    typeof v.validFrom === "number" &&
    Number.isFinite(v.validFrom) &&
    v.validFrom >= 0 &&
    typeof v.expiresAt === "number" &&
    Number.isFinite(v.expiresAt) &&
    v.expiresAt > v.validFrom
  );
}

/** No symmetry assumption: service timestamp lies somewhere inside the measured RTT. */
export class AuthorityClock {
  private sample?: {
    received: number;
    lowerOffset: number;
    upperOffset: number;
  };
  private observed?: number;
  private reason = "no-sample";
  private roundTripMs?: number;
  diagnostics(): { reason: string; roundTripMs?: number } {
    return { reason: this.reason, roundTripMs: this.roundTripMs };
  }
  constructor(private readonly now: () => number) {}
  /** `maxRoundTrip`: the authority's fence keeps the tight 500 ms bound; a view accepts a slower probe. */
  synchronize(sent: number, service: number, maxRoundTrip = 500): boolean {
    const received = this.now();
    this.roundTripMs = received - sent;
    if (
      ![sent, service, received].every(Number.isFinite) ||
      sent < 0 ||
      service < 0 ||
      received < sent ||
      received - sent > maxRoundTrip
    ) {
      this.invalidate();
      this.reason = "invalid-round-trip";
      return false;
    }
    this.sample = {
      received,
      lowerOffset: service - received,
      upperOffset: service - sent,
    };
    this.observed = received;
    this.reason = "sampled";
    return true;
  }
  invalidate(): void {
    this.sample = undefined;
    this.observed = undefined;
    this.reason = "invalidated";
  }
  /**
   * `strict` is the authority's own fence: a sample must be tight (round trip within the lease guard) and checked
   * continuously, or it does not act. A view only needs to know the lease is current: a slow probe or a busy main
   * thread on a phone must not pause it every two seconds.
   */
  interval(strict = true): { earliest: number; latest: number } | undefined {
    const now = this.now(),
      sample = this.sample;
    if (!sample || !Number.isFinite(now)) return;
    const age = now - sample.received;
    // A stall longer than this between checks means the tab was suspended: the sample is gone, not just old.
    if (
      age < 0 ||
      age > 4000 ||
      (strict && this.observed !== undefined && now - this.observed > STALL_MS)
    ) {
      this.invalidate();
      this.reason = "stale-or-suspended";
      return;
    }
    this.observed = now;
    const drift = age * 0.001;
    // A slow probe widens the interval, and the lease check below is conservative in both directions, so it is
    // never refused outright: a host reaching its room service over a real network sees 100–400 ms round trips.
    return {
      earliest: now + sample.lowerOffset - drift,
      latest: now + sample.upperOffset + drift,
    };
  }
  permits(grant: AuthorityGrant, strict = true): boolean {
    const time = this.interval(strict);
    const permitted =
      !!time &&
      time.earliest >= grant.validFrom &&
      time.latest < grant.expiresAt;
    if (time) this.reason = permitted ? "permitted" : "outside-lease";
    return permitted;
  }
}
