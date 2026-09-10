/**
 * What this server does with the site's own instructions, and with its own
 * memory.
 *
 * A site that answers "come back in a minute" has said something this server
 * cannot improve on, and a response of any size arrives on the same path as a
 * small one. Both are places where a client can cost a free site more than the
 * question was worth.
 */

import { describe, expect, it, vi } from "vitest";
import { McClient } from "../../src/mc/client.js";
import { fixtureText, happyRouter, silentLogger, testConfig } from "./_helpers.js";

describe("a wait the site asked for by name", () => {
  it("is served in full rather than cut to this server's own ceiling", async () => {
    vi.useFakeTimers();
    try {
      const waits: number[] = [];
      let call = 0;
      const client = new McClient({
        config: testConfig({ maxRetries: 1, minIntervalMs: 0 }),
        logger: silentLogger,
        fetchImpl: (async () => {
          call += 1;
          if (call === 1) {
            return new Response("slow down", {
              status: 429,
              headers: { "retry-after": "60" },
            });
          }
          return new Response(fixtureText("search.json"), { status: 200 });
        }) as typeof globalThis.fetch,
      });

      const original = globalThis.setTimeout;
      vi.stubGlobal("setTimeout", ((fn: () => void, ms?: number) => {
        if (ms !== undefined && ms > 0) {
          waits.push(ms);
        }
        return original(fn, 0);
      }) as typeof setTimeout);

      const run = client.search("lantern", 10, 0);
      await vi.runAllTimersAsync();
      await run;

      expect(
        Math.max(...waits),
        "coming back early is the one thing the site asked this client not to do",
      ).toBeGreaterThanOrEqual(60_000);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});

describe("a response larger than any answer could need", () => {
  it("is refused before its body is read", async () => {
    let bodyRead = false;
    const client = new McClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: (async () => {
        const response = new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "80000000" },
        });
        return {
          ...response,
          status: response.status,
          headers: response.headers,
          text: async () => {
            bodyRead = true;
            return "{}";
          },
        } as unknown as Response;
      }) as typeof globalThis.fetch,
    });

    await expect(client.search("lantern", 10, 0)).rejects.toThrow();
    expect(bodyRead, "a size the site declares is known before the body arrives").toBe(false);
  });
});

describe("two identical reads started together", () => {
  it("cost the site one request", async () => {
    const fetch = happyRouter();
    let calls = 0;
    const client = new McClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: (async (url: any, init: any) => {
        calls += 1;
        return fetch.impl(url, init);
      }) as typeof globalThis.fetch,
    });

    await Promise.all([client.search("lantern", 10, 0), client.search("lantern", 10, 0)]);

    expect(calls, "the second read starts before the first has anything to cache").toBe(1);
  });
});
