/**
 * Serial request queue with an adaptive minimum interval.
 *
 * Metacritic publishes no rate limit and did not throttle consecutive requests
 * during testing, so the gap between requests is a choice this client makes
 * rather than a rule it is given. Requests run one at a time with a floor on
 * that gap. If the site ever does push back, the interval doubles and then
 * decays back down as requests succeed, which recovers faster than a fixed
 * delay and behaves better than a constant rate.
 */

export interface RateLimiterOptions {
  minIntervalMs: number;
  maxIntervalMs?: number;
}

const DEFAULT_MAX_INTERVAL_MS = 10_000;

export class RateLimiter {
  private readonly baseIntervalMs: number;
  private readonly maxIntervalMs: number;
  private intervalMs: number;
  /** Tail of the queue: each task chains onto the previous one. */
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(options: RateLimiterOptions) {
    this.baseIntervalMs = Math.max(0, options.minIntervalMs);
    this.maxIntervalMs = Math.max(
      this.baseIntervalMs,
      options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS,
    );
    this.intervalMs = this.baseIntervalMs;
  }

  get currentIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * Queue a task. Tasks run in call order, one at a time.
   *
   * A task may send several requests, since the retry loop lives inside its
   * slot. It must call `beforeRequest` around each of them: the pacing is
   * measured between requests, and stamping only the start of the task would
   * let the next one follow a long retry chain's final request immediately.
   */
  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => task());
    // The queue must keep draining even when a task rejects.
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Wait for this request's slot, then claim it.
   *
   * Called once per upstream request rather than once per task, so every
   * request is paced from the previous one whether or not they belong to the
   * same retry chain.
   */
  async beforeRequest(): Promise<void> {
    await this.waitForSlot();
    this.lastStart = Date.now();
  }

  /** Called after the site signals it is under load. */
  penalize(): void {
    const next = this.intervalMs === 0 ? 250 : this.intervalMs * 2;
    this.intervalMs = Math.min(this.maxIntervalMs, next);
  }

  /** Called after a success, so a single hiccup does not slow things down forever. */
  relax(): void {
    this.intervalMs = Math.max(this.baseIntervalMs, Math.floor(this.intervalMs * 0.75));
  }

  private async waitForSlot(): Promise<void> {
    if (this.intervalMs === 0 || this.lastStart === 0) {
      return;
    }
    const elapsed = Date.now() - this.lastStart;
    // Clamped to the interval: a clock stepped backwards, by NTP or a resumed
    // VM, would otherwise make this wait for the size of the step, and the
    // queue is serial so every pending request would wait behind it.
    const remaining = Math.min(this.intervalMs, this.intervalMs - elapsed);
    if (remaining > 0) {
      await sleep(remaining);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
