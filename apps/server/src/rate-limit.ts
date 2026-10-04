/**
 * In-process rate limiting (SPEC §6.3): per key 1,000 req/min with a 50 req/s burst,
 * auth endpoints 10/min per IP. Token buckets; single-process deployments by design
 * (scale profile shares nothing — limits are then per instance, documented).
 */
interface Bucket {
  tokens: number;
  updated: number;
}

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfter: number;
}

export class RateLimiter {
  private minute = new Map<string, Bucket>();
  private second = new Map<string, Bucket>();

  constructor(
    private readonly perMinute: number,
    private readonly perSecond: number,
  ) {}

  private take(map: Map<string, Bucket>, key: string, capacity: number, refillPerMs: number, now: number): { ok: boolean; tokens: number } {
    const b = map.get(key) ?? { tokens: capacity, updated: now };
    b.tokens = Math.min(capacity, b.tokens + (now - b.updated) * refillPerMs);
    b.updated = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    map.set(key, b);
    return { ok, tokens: b.tokens };
  }

  check(key: string, now = Date.now()): RateDecision {
    const m = this.take(this.minute, key, this.perMinute, this.perMinute / 60_000, now);
    const s = m.ok ? this.take(this.second, key, this.perSecond, this.perSecond / 1000, now) : { ok: false, tokens: 0 };
    if (!s.ok && m.ok) {
      // Refund the minute token: the burst limit rejected this one.
      const b = this.minute.get(key)!;
      b.tokens = Math.min(this.perMinute, b.tokens + 1);
    }
    const allowed = m.ok && s.ok;
    const remaining = Math.max(0, Math.floor(this.minute.get(key)!.tokens));
    const retryAfter = allowed ? 0 : !m.ok ? Math.ceil((1 - m.tokens) / (this.perMinute / 60)) : 1;
    if (this.minute.size > 50_000) this.gc(now);
    return { allowed, limit: this.perMinute, remaining, resetSeconds: Math.ceil(((this.perMinute - remaining) / this.perMinute) * 60), retryAfter };
  }

  private gc(now: number): void {
    for (const [k, b] of this.minute) if (now - b.updated > 120_000) this.minute.delete(k);
    for (const [k, b] of this.second) if (now - b.updated > 10_000) this.second.delete(k);
  }
}
