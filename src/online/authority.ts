/** Service-owned lease decisions. Call inside the room's serialized storage transaction. */
export const LEASE_MS = 10_000;
export const LEASE_GUARD_MS = 250;
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
export function reserveAuthority(previous: AuthorityGrant | undefined, incarnation: string, holder: string, grantId: string, now: number): AuthorityGrant {
  if (!Number.isFinite(now) || now < 0 || !incarnation || !holder || !grantId) throw new Error('Invalid authority reservation');
  if (previous && previous.incarnation !== incarnation) throw new Error('Room incarnation mismatch');
  const epoch = (previous?.epoch ?? 0) + 1;
  if (!Number.isSafeInteger(epoch)) throw new Error('Authority epoch exhausted');
  const validFrom = Math.max(now, previous ? previous.expiresAt + LEASE_GUARD_MS : now);
  return { incarnation, epoch, holder, grantId, validFrom, expiresAt: validFrom + LEASE_MS };
}
export function sameGrant(a: GrantIdentity, b: GrantIdentity): boolean {
  return a.incarnation === b.incarnation && a.epoch === b.epoch && a.holder === b.holder && a.grantId === b.grantId;
}
export function renewAuthority(current: AuthorityGrant, claimant: GrantIdentity, now: number): AuthorityGrant | undefined {
  if (!Number.isFinite(now) || !sameGrant(current, claimant) || now < current.validFrom || now >= current.expiresAt) return;
  return { ...current, expiresAt: Math.max(current.expiresAt, now + LEASE_MS) };
}
export function isAuthorityGrant(value: unknown): value is AuthorityGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return ['incarnation', 'holder', 'grantId'].every(key => typeof v[key] === 'string' && v[key].length > 0 && v[key].length <= 128)
    && typeof v.epoch === 'number' && Number.isSafeInteger(v.epoch) && v.epoch > 0
    && typeof v.validFrom === 'number' && Number.isFinite(v.validFrom) && v.validFrom >= 0
    && typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt) && v.expiresAt > v.validFrom;
}

/** No symmetry assumption: service timestamp lies somewhere inside the measured RTT. */
export class AuthorityClock {
  private sample?: { received: number; lowerOffset: number; upperOffset: number };
  private observed?: number;
  constructor(private readonly now: () => number) {}
  synchronize(sent: number, service: number): boolean {
    const received = this.now();
    if (![sent, service, received].every(Number.isFinite) || sent < 0 || service < 0 || received < sent || received - sent > 500) {
      this.invalidate(); return false;
    }
    this.sample = { received, lowerOffset: service - received, upperOffset: service - sent };
    this.observed = received;
    return true;
  }
  invalidate(): void { this.sample = undefined; this.observed = undefined; }
  interval(): { earliest: number; latest: number } | undefined {
    const now = this.now(), sample = this.sample;
    if (!sample || !Number.isFinite(now)) return;
    const age = now - sample.received;
    if (age < 0 || age > 4000 || (this.observed !== undefined && now - this.observed > 500)) { this.invalidate(); return; }
    this.observed = now;
    const drift = age * .001;
    if (sample.upperOffset - sample.lowerOffset + 2 * drift > LEASE_GUARD_MS) return;
    return { earliest: now + sample.lowerOffset - drift, latest: now + sample.upperOffset + drift };
  }
  permits(grant: AuthorityGrant): boolean {
    const time = this.interval();
    return !!time && time.earliest >= grant.validFrom && time.latest < grant.expiresAt;
  }
}
