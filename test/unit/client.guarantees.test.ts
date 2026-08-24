/**
 * What `McClient` promises about its own traffic, whoever built the config.
 *
 * `./client` is a published export, so the pacing floor and the identifiable
 * User-Agent cannot live in the environment parser alone: a library caller
 * hands in a config object and never goes through it. These are the two things
 * the project offers in exchange for reading a source that publishes no terms,
 * so they have to hold on that path too.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_USER_AGENT, MIN_ALLOWED_INTERVAL_MS } from "../../src/config.js";
import { McClient } from "../../src/mc/client.js";
import { happyRouter, silentLogger, testConfig } from "./_helpers.js";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const userAgentOf = (fetch: ReturnType<typeof happyRouter>, index = 0): string =>
  new Headers(fetch.calls[index]!.init?.headers as Record<string, string>).get("user-agent") ?? "";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the User-Agent this client sends", () => {
  it("identifies the project by default", async () => {
    const fetch = happyRouter();
    await new McClient({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    }).search("blue horizon", 10, 0);

    expect(userAgentOf(fetch)).toBe(DEFAULT_USER_AGENT);
  });

  it("lets a caller name their own application", async () => {
    const fetch = happyRouter();
    await new McClient({
      config: testConfig({ userAgent: "acme-research/2.0 (+https://acme.example)" }),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    }).search("blue horizon", 10, 0);

    expect(userAgentOf(fetch)).toBe("acme-research/2.0 (+https://acme.example)");
  });

  it("stays attributable when a caller passes a browser's User-Agent off as its own", async () => {
    const fetch = happyRouter();
    await new McClient({
      config: testConfig({ userAgent: CHROME }),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    }).search("blue horizon", 10, 0);

    const sent = userAgentOf(fetch);
    expect(sent, "the caller's string is kept").toContain("Chrome/131.0.0.0");
    expect(sent, "and this project is named alongside it").toContain(DEFAULT_USER_AGENT);
  });

  it("catches the other browser spellings too", async () => {
    for (const disguise of [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      "AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
    ]) {
      const fetch = happyRouter();
      await new McClient({
        config: testConfig({ userAgent: disguise }),
        logger: silentLogger,
        fetchImpl: fetch.impl,
      }).search("blue horizon", 10, 0);

      expect(userAgentOf(fetch), disguise).toContain(DEFAULT_USER_AGENT);
    }
  });
});

describe("the pacing floor", () => {
  it("applies to a config handed in by a library caller, not only to the environment", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: testConfig({ minIntervalMs: 0 }),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    const both = Promise.all([
      client.search("blue horizon", 10, 0),
      client.search("cinder vale", 10, 0),
    ]);
    await vi.advanceTimersByTimeAsync(MIN_ALLOWED_INTERVAL_MS * 4);
    await both;

    expect(fetch.calls).toHaveLength(2);
    expect(
      fetch.calls[1]!.at - fetch.calls[0]!.at,
      "a caller asking for no pacing at all still gets the floor",
    ).toBeGreaterThanOrEqual(MIN_ALLOWED_INTERVAL_MS);
  });

  it("leaves a caller who asks to go slower alone", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: testConfig({ minIntervalMs: MIN_ALLOWED_INTERVAL_MS * 2 }),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    const both = Promise.all([
      client.search("blue horizon", 10, 0),
      client.search("cinder vale", 10, 0),
    ]);
    await vi.advanceTimersByTimeAsync(MIN_ALLOWED_INTERVAL_MS * 8);
    await both;

    expect(fetch.calls[1]!.at - fetch.calls[0]!.at).toBeGreaterThanOrEqual(
      MIN_ALLOWED_INTERVAL_MS * 2,
    );
  });
});
