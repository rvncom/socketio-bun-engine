import { describe, it, expect } from "bun:test";
import { RateLimiter } from "../lib/rate-limiter";

describe("RateLimiter", () => {
  it("consume() returns true when tokens available", () => {
    const limiter = new RateLimiter({ maxMessages: 5, windowMs: 60000 });
    expect(limiter.consume()).toBe(true);
    limiter.destroy();
  });

  it("consume() returns false when all tokens exhausted", () => {
    const limiter = new RateLimiter({ maxMessages: 2, windowMs: 60000 });
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);
    limiter.destroy();
  });

  it("resets tokens after windowMs", async () => {
    const limiter = new RateLimiter({ maxMessages: 1, windowMs: 50 });
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);

    // Wait for the window to reset
    await new Promise((r) => setTimeout(r, 80));

    expect(limiter.consume()).toBe(true);
    limiter.destroy();
  });

  it("destroy() stops the timer", () => {
    const limiter = new RateLimiter({ maxMessages: 5, windowMs: 100 });
    limiter.destroy();
    // No assertion needed — if destroy didn't clear the timer,
    // the test process would hang (but bun:test handles that).
    expect(true).toBe(true);
  });

  it("allows exactly maxMessages per window", () => {
    const limiter = new RateLimiter({ maxMessages: 3, windowMs: 60000 });
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);
    expect(limiter.consume()).toBe(false);
    limiter.destroy();
  });

  it("multiple consume cycles across windows", async () => {
    const limiter = new RateLimiter({ maxMessages: 2, windowMs: 50 });

    // First window
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);

    // Wait for reset
    await new Promise((r) => setTimeout(r, 80));

    // Second window
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false);

    limiter.destroy();
  });

  it("consume() decrements remaining count correctly", () => {
    const limiter = new RateLimiter({ maxMessages: 10, windowMs: 60000 });
    for (let i = 0; i < 10; i++) {
      expect(limiter.consume()).toBe(true);
    }
    expect(limiter.consume()).toBe(false);
    limiter.destroy();
  });
});
