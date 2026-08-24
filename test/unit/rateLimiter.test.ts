/**
 * The self-imposed pacing.
 *
 * Metacritic publishes no rate limit, which is a reason to pace deliberately
 * rather than a licence to go fast. Two properties matter and neither is
 * visible from a single call: requests are spaced, and the queue that spaces
 * them keeps draining when one of them fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../../src/mc/rateLimiter.js";

const INTERVAL = 60;

/**
 * The clock is pinned and moved by hand, so a gap is what the limiter asked for
 * rather than what the machine happened to take. Measured against the real
 * clock, a pacing test fails whenever the machine stalls, which says nothing
 * about the pacing.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const limiter = (minIntervalMs = INTERVAL) => new RateLimiter({ minIntervalMs });

describe("scheduling", () => {
  it("returns what the task returned", async () => {
    await expect(limiter().schedule(async () => "blue-horizon")).resolves.toBe("blue-horizon");
  });

  it("lets the first request through without making it wait", async () => {
    const started = Date.now();

    await limiter(1000).beforeRequest();

    expect(Date.now() - started).toBe(0);
  });

  it("spaces consecutive requests by at least the configured interval", async () => {
    const instance = limiter();
    const startedAt: number[] = [];
    const record = async () => {
      await instance.beforeRequest();
      startedAt.push(Date.now());
    };

    const all = Promise.all([
      instance.schedule(record),
      instance.schedule(record),
      instance.schedule(record),
    ]);
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    await all;

    expect(startedAt).toHaveLength(3);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(INTERVAL);
    expect(startedAt[2]! - startedAt[1]!).toBeGreaterThanOrEqual(INTERVAL);
  });

  it("spaces the attempts inside one task, so a retry chain is paced like anything else", async () => {
    const instance = limiter();
    const attemptedAt: number[] = [];

    const run = instance.schedule(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await instance.beforeRequest();
        attemptedAt.push(Date.now());
      }
    });
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    await run;

    expect(attemptedAt[1]! - attemptedAt[0]!).toBeGreaterThanOrEqual(INTERVAL);
    expect(attemptedAt[2]! - attemptedAt[1]!).toBeGreaterThanOrEqual(INTERVAL);
  });

  it("runs queued tasks one at a time, in the order they were scheduled", async () => {
    const instance = limiter(1);
    const events: string[] = [];

    const all = Promise.all(
      ["a", "b", "c"].map((name) =>
        instance.schedule(async () => {
          events.push(`start ${name}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          events.push(`end ${name}`);
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(100);
    await all;

    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("gives a failing task's error to its own caller and to nobody else", async () => {
    const instance = limiter(1);
    const boom = new Error("upstream said no");

    const failing = instance.schedule(async () => {
      throw boom;
    });
    const following = instance.schedule(async () => "still here");

    await expect(failing).rejects.toBe(boom);
    await expect(following).resolves.toBe("still here");
  });

  it("keeps draining the queue after a rejection, however many are waiting", async () => {
    const instance = limiter(1);
    const results: string[] = [];

    const tasks = [
      instance.schedule(async () => {
        throw new Error("first fails");
      }),
      instance.schedule(async () => {
        results.push("second");
      }),
      instance.schedule(async () => {
        throw new Error("third fails");
      }),
      instance.schedule(async () => {
        results.push("fourth");
      }),
    ];

    const settled = await Promise.allSettled(tasks);

    expect(settled.map((entry) => entry.status)).toEqual([
      "rejected",
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect(results).toEqual(["second", "fourth"]);
  });

  it("still paces the tasks that follow a rejection", async () => {
    const instance = limiter();
    const startedAt: number[] = [];

    const failing = instance.schedule(async () => {
      await instance.beforeRequest();
      startedAt.push(Date.now());
      throw new Error("no");
    });
    const following = instance.schedule(async () => {
      await instance.beforeRequest();
      startedAt.push(Date.now());
    });

    const settled = Promise.allSettled([failing, following]);
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    await settled;

    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(INTERVAL);
  });
});

describe("backing off and recovering", () => {
  it("starts at the configured interval", () => {
    expect(limiter(700).currentIntervalMs).toBe(700);
  });

  it("widens the interval when the site pushes back", () => {
    const instance = limiter(700);

    instance.penalize();

    expect(instance.currentIntervalMs).toBeGreaterThan(700);
  });

  it("keeps widening while the pushback continues", () => {
    const instance = limiter(700);

    instance.penalize();
    const once = instance.currentIntervalMs;
    instance.penalize();

    expect(instance.currentIntervalMs).toBeGreaterThan(once);
  });

  it("comes back down once requests succeed again, never below the configured floor", () => {
    const instance = limiter(700);
    instance.penalize();
    instance.penalize();
    const penalised = instance.currentIntervalMs;

    for (let i = 0; i < 20; i += 1) {
      instance.relax();
    }

    expect(instance.currentIntervalMs).toBeLessThan(penalised);
    expect(instance.currentIntervalMs).toBeGreaterThanOrEqual(700);
  });

  it("applies the widened interval to the next request", async () => {
    const instance = limiter(20);
    instance.penalize();
    instance.penalize();
    const widened = instance.currentIntervalMs;
    const startedAt: number[] = [];
    const record = async () => {
      await instance.beforeRequest();
      startedAt.push(Date.now());
    };

    const all = Promise.all([instance.schedule(record), instance.schedule(record)]);
    await vi.advanceTimersByTimeAsync(widened * 3);
    await all;

    expect(widened).toBeGreaterThan(20);
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(widened);
  });
});
