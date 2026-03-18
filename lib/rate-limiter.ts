export interface RateLimitOptions {
  /**
   * Maximum number of messages allowed per window.
   */
  maxMessages: number;
  /**
   * Time window in milliseconds.
   */
  windowMs: number;
}

/**
 * Timer-based rate limiter — no Date.now() on the hot path.
 * A periodic timer resets the token counter every windowMs.
 */
export class RateLimiter {
  private remaining: number;
  private readonly opts: RateLimitOptions;
  private timer: Timer;

  constructor(opts: RateLimitOptions) {
    this.opts = opts;
    this.remaining = opts.maxMessages;
    this.timer = setInterval(() => {
      this.remaining = this.opts.maxMessages;
    }, opts.windowMs);
  }

  /**
   * Attempt to consume one token. Returns `true` if allowed, `false` if rate limited.
   */
  consume(): boolean {
    if (this.remaining <= 0) {
      return false;
    }
    this.remaining--;
    return true;
  }

  /**
   * Clears the internal reset timer. Call on socket close.
   */
  destroy() {
    clearInterval(this.timer);
  }
}
