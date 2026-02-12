/**
 * Generic progressive rate limiter with double-keying support.
 * Used for login attempts, recovery code verification, and TOTP challenges.
 *
 * Cooldown schedule: 3 fails → 30s, 6 → 1min, 9 → 5min, 12+ → 15min.
 */

type RateBucket = {
  count: number;
  lockedUntil: number;
};

const COOLDOWN_TIERS: ReadonlyArray<{ threshold: number; cooldownMs: number }> = [
  { threshold: 12, cooldownMs: 15 * 60 * 1000 },
  { threshold: 9, cooldownMs: 5 * 60 * 1000 },
  { threshold: 6, cooldownMs: 60 * 1000 },
  { threshold: 3, cooldownMs: 30 * 1000 },
];

/** Resolve cooldown duration based on failure count. */
function cooldownForCount(count: number): number {
  for (const tier of COOLDOWN_TIERS) {
    if (count >= tier.threshold) {
      return tier.cooldownMs;
    }
  }
  return 0;
}

export type ProgressiveRateLimiter = {
  /** Check if the key is currently rate-limited. Returns remaining ms or 0. */
  check(key: string): number;
  /** Record a failed attempt for the key. */
  recordFailure(key: string): void;
  /** Reset the counter for the key (e.g. on success). */
  reset(key: string): void;
  /** Clear all state (for tests). */
  resetAll(): void;
};

/** Create a progressive rate limiter instance. */
export function createProgressiveRateLimiter(): ProgressiveRateLimiter {
  const buckets = new Map<string, RateBucket>();

  return {
    check(key: string): number {
      const bucket = buckets.get(key);
      if (!bucket) {
        return 0;
      }
      const now = Date.now();
      if (bucket.lockedUntil > now) {
        return bucket.lockedUntil - now;
      }
      return 0;
    },

    recordFailure(key: string): void {
      const now = Date.now();
      const bucket = buckets.get(key) ?? { count: 0, lockedUntil: 0 };
      bucket.count++;
      const cooldown = cooldownForCount(bucket.count);
      if (cooldown > 0) {
        bucket.lockedUntil = now + cooldown;
      }
      buckets.set(key, bucket);
    },

    reset(key: string): void {
      buckets.delete(key);
    },

    resetAll(): void {
      buckets.clear();
    },
  };
}

/**
 * Check double-keyed rate limiting (both keys must pass).
 * Returns remaining ms if EITHER key is locked, 0 if both are clear.
 */
export function checkDoubleKey(
  limiter: ProgressiveRateLimiter,
  key1: string,
  key2: string,
): number {
  return Math.max(limiter.check(key1), limiter.check(key2));
}

/**
 * Record failure for both keys in a double-keyed limiter.
 */
export function recordDoubleKeyFailure(
  limiter: ProgressiveRateLimiter,
  key1: string,
  key2: string,
): void {
  limiter.recordFailure(key1);
  limiter.recordFailure(key2);
}
