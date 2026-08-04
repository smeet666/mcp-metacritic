/**
 * The transport layer: what each HTTP outcome is turned into, and what is worth
 * trying again.
 *
 * The distinction that matters is between "this title does not exist" and "this
 * request did not work". The first is an answer, the second is a failure, and a
 * model told the wrong one will state the wrong thing with confidence.
 */

import { describe, expect, it } from "vitest";
import { backoffDelay, fetchText } from "../../src/mc/http.js";
import { RateLimiter } from "../../src/mc/rateLimiter.js";
import {
  constantFetch,
  expectMcError,
  fixtureText,
  sequenceFetch,
  silentLogger,
  testConfig,
} from "./_helpers.js";

/** A retry chain sleeps for real between attempts, so these tests need room. */
const RETRY_TIMEOUT = 30_000;

const URL = "https://backend.metacritic.com/finder/metacritic/search/blue%20horizon/web";

const call = (
  fetchImpl: typeof fetch,
  over: Parameters<typeof testConfig>[0] = {},
): Promise<string> => {
  const config = testConfig(over);
  return fetchText(URL, {
    config,
    limiter: new RateLimiter({ minIntervalMs: config.minIntervalMs }),
    logger: silentLogger,
    fetchImpl,
  });
};

describe("a successful response", () => {
  it("comes back as text for the parser to read", async () => {
    const body = fixtureText("search.json");

    await expect(call(constantFetch(body).impl)).resolves.toBe(body);
  });

  it("names this client in the User-Agent, so the site can see who is calling", async () => {
    const fetch = constantFetch(fixtureText("search.json"));

    await call(fetch.impl, { userAgent: "acme-bot/2.0" });

    const headers = new Headers(fetch.calls[0]!.init?.headers as Record<string, string>);
    expect(headers.get("user-agent")).toBe("acme-bot/2.0");
  });
});

describe("failures that are worth retrying", () => {
  it(
    "retries a server error and returns the answer when it recovers",
    async () => {
      const body = fixtureText("search.json");
      const fetch = sequenceFetch([
        { status: 500, body: "boom" },
        { status: 200, body },
      ]);

      await expect(call(fetch.impl, { maxRetries: 2 })).resolves.toBe(body);
      expect(fetch.calls).toHaveLength(2);
    },
    RETRY_TIMEOUT,
  );

  it(
    "gives up after the configured number of retries and says the request failed",
    async () => {
      const fetch = constantFetch({ status: 500, body: "boom" });

      const error = await expectMcError(() => call(fetch.impl, { maxRetries: 2 }), "network_error");

      expect(fetch.calls, "one attempt plus two retries").toHaveLength(3);
      expect(error.details.status).toBe(500);
      expect(error.message).toContain("500");
    },
    RETRY_TIMEOUT,
  );

  it("makes exactly one attempt when retries are switched off", async () => {
    const fetch = constantFetch({ status: 500, body: "boom" });

    await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "network_error");

    expect(fetch.calls).toHaveLength(1);
  });

  it(
    "paces every attempt of a retry chain, retries included",
    async () => {
      const body = fixtureText("search.json");
      const fetch = sequenceFetch([
        { status: 500, body: "boom" },
        { status: 500, body: "boom" },
        { status: 200, body },
      ]);

      await call(fetch.impl, { maxRetries: 2, minIntervalMs: 40 });

      expect(fetch.calls).toHaveLength(3);
      expect(fetch.calls[1]!.at - fetch.calls[0]!.at).toBeGreaterThanOrEqual(32);
      expect(fetch.calls[2]!.at - fetch.calls[1]!.at).toBeGreaterThanOrEqual(32);
    },
    RETRY_TIMEOUT,
  );

  it("backs off further with each attempt", () => {
    expect(backoffDelay(0)).toBeGreaterThan(0);
    expect(backoffDelay(1)).toBeGreaterThan(backoffDelay(0));
    expect(backoffDelay(2)).toBeGreaterThan(backoffDelay(1));
  });
});

describe("push-back from the host", () => {
  it("reads a 403 as push-back rather than as a permanent refusal", async () => {
    // The site sits behind bot management, which answers a rate-limited client
    // with 403 as readily as with 429.
    const fetch = constantFetch({ status: 403, body: "Forbidden" });

    const error = await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "rate_limited");

    expect(error.details.retryAfterMs).toBeGreaterThan(0);
    expect(error.message).toContain("does NOT mean the title is missing");
  });

  it(
    "honours Retry-After given in seconds",
    async () => {
      const fetch = constantFetch({
        status: 429,
        body: "slow down",
        headers: { "retry-after": "2" },
      });

      const error = await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "rate_limited");

      expect(error.details.retryAfterMs).toBe(2000);
    },
    RETRY_TIMEOUT,
  );

  it(
    "honours Retry-After given as an HTTP date",
    async () => {
      const fetch = constantFetch({
        status: 503,
        body: "come back later",
        headers: { "retry-after": new Date(Date.now() + 8_000).toUTCString() },
      });

      const error = await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "rate_limited");

      const waitSeconds = (error.details.retryAfterMs ?? 0) / 1000;
      expect(waitSeconds, "a date eight seconds out is an eight second wait").toBeGreaterThan(4);
      expect(waitSeconds).toBeLessThanOrEqual(9);
    },
    RETRY_TIMEOUT,
  );

  it(
    "tells the caller how long to wait, in words as well as in the details",
    async () => {
      const fetch = constantFetch({
        status: 429,
        body: "slow down",
        headers: { "retry-after": "3" },
      });

      const error = await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "rate_limited");

      expect(error.details.hint).toContain("3");
    },
    RETRY_TIMEOUT,
  );
});

describe("a body that is not JSON", () => {
  it(
    "is retried, since an edge challenge page clears on its own",
    async () => {
      const body = fixtureText("search.json");
      const fetch = sequenceFetch([
        {
          status: 200,
          body: fixtureText("not-json.txt"),
          headers: { "content-type": "text/html" },
        },
        { status: 200, body },
      ]);

      await expect(call(fetch.impl, { maxRetries: 2 })).resolves.toBe(body);
      expect(fetch.calls, "the challenge page was not the final answer").toHaveLength(2);
    },
    RETRY_TIMEOUT,
  );

  it(
    "surfaces as parse_failure when every attempt returns one",
    async () => {
      const fetch = constantFetch({
        status: 200,
        body: fixtureText("not-json.txt"),
        headers: { "content-type": "text/html" },
      });

      const error = await expectMcError(() => call(fetch.impl, { maxRetries: 1 }), "parse_failure");

      expect(fetch.calls, "one attempt plus one retry").toHaveLength(2);
      expect(error.details.hint, "an unreadable shape is worth reporting").toContain("github.com");
    },
    RETRY_TIMEOUT,
  );
});

describe("failures that are not worth retrying", () => {
  it("does not retry a 404, which is an answer rather than a fault", async () => {
    const fetch = constantFetch({ status: 404, body: fixtureText("error-404.json") });

    await expect(
      call(fetch.impl, { maxRetries: 3 }).catch(() => "handled by the parser"),
    ).resolves.toBeDefined();
    expect(fetch.calls, "a missing entry is not going to appear on a second try").toHaveLength(1);
  });

  it("reports throttling as rate_limited, never as a missing title", async () => {
    const fetch = constantFetch({
      status: 429,
      body: "slow down",
      headers: { "retry-after": "2" },
    });

    const error = await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "rate_limited");

    expect(error.details.retryAfterMs).toBeGreaterThan(0);
    expect(error.message).toContain("does NOT mean the title is missing");
    expect(error.details.hint).toBeTruthy();
  });

  it("reports a refused connection as network_error", async () => {
    const fetch = constantFetch({ throws: new TypeError("fetch failed") });

    const error = await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "network_error");

    expect(error.details.url).toBe(URL);
  });

  it("reports an aborted request as a timeout rather than as a network fault", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    const fetch = constantFetch({ throws: abort });

    await expectMcError(() => call(fetch.impl, { maxRetries: 0 }), "timeout");
  });

  it("puts the URL on every failure, so a report can say what was asked for", async () => {
    const error = await expectMcError(
      () => call(constantFetch({ status: 500 }).impl, { maxRetries: 0 }),
      "network_error",
    );

    expect(error.details.url).toBe(URL);
  });
});
