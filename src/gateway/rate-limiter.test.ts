import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createProgressiveRateLimiter,
  checkDoubleKey,
  recordDoubleKeyFailure,
} from "./rate-limiter.js";

describe("ProgressiveRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows first attempts without rate limiting", () => {
    const limiter = createProgressiveRateLimiter();
    expect(limiter.check("ip:1.2.3.4")).toBe(0);
  });

  it("does not lock before 3 failures", () => {
    const limiter = createProgressiveRateLimiter();
    limiter.recordFailure("k");
    limiter.recordFailure("k");
    expect(limiter.check("k")).toBe(0);
  });

  it("locks for 30s after 3 failures", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("k");
    }
    const remaining = limiter.check("k");
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30_000);
  });

  it("locks for 1min after 6 failures", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 6; i++) {
      limiter.recordFailure("k");
    }
    const remaining = limiter.check("k");
    expect(remaining).toBeGreaterThan(30_000);
    expect(remaining).toBeLessThanOrEqual(60_000);
  });

  it("locks for 5min after 9 failures", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 9; i++) {
      limiter.recordFailure("k");
    }
    const remaining = limiter.check("k");
    expect(remaining).toBeGreaterThan(60_000);
    expect(remaining).toBeLessThanOrEqual(5 * 60_000);
  });

  it("locks for 15min after 12+ failures", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 12; i++) {
      limiter.recordFailure("k");
    }
    const remaining = limiter.check("k");
    expect(remaining).toBeGreaterThan(5 * 60_000);
    expect(remaining).toBeLessThanOrEqual(15 * 60_000);
  });

  it("unlocks after cooldown expires", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("k");
    }
    expect(limiter.check("k")).toBeGreaterThan(0);
    vi.advanceTimersByTime(31_000);
    expect(limiter.check("k")).toBe(0);
  });

  it("reset clears the counter", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 6; i++) {
      limiter.recordFailure("k");
    }
    expect(limiter.check("k")).toBeGreaterThan(0);
    limiter.reset("k");
    expect(limiter.check("k")).toBe(0);
  });

  it("resetAll clears all keys", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("a");
    }
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("b");
    }
    limiter.resetAll();
    expect(limiter.check("a")).toBe(0);
    expect(limiter.check("b")).toBe(0);
  });

  it("tracks keys independently", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("a");
    }
    expect(limiter.check("a")).toBeGreaterThan(0);
    expect(limiter.check("b")).toBe(0);
  });
});

describe("double-key rate limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns max of both keys", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure("ip:1");
    }
    for (let i = 0; i < 6; i++) {
      limiter.recordFailure("user:alice");
    }
    const remaining = checkDoubleKey(limiter, "ip:1", "user:alice");
    // user:alice has 60s cooldown > ip:1 has 30s
    expect(remaining).toBeGreaterThan(30_000);
  });

  it("recordDoubleKeyFailure increments both keys", () => {
    const limiter = createProgressiveRateLimiter();
    for (let i = 0; i < 3; i++) {
      recordDoubleKeyFailure(limiter, "ip:x", "user:bob");
    }
    expect(limiter.check("ip:x")).toBeGreaterThan(0);
    expect(limiter.check("user:bob")).toBeGreaterThan(0);
  });
});
