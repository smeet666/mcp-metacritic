/**
 * The in-memory cache, and what the client is allowed to put in it.
 *
 * The cache exists to spare the site repeated requests inside one session. The
 * two things it must never do are keep a response that could not be read, which
 * would replay a bad minute upstream for hours, and answer one question with
 * another question's answer.
 */

import { describe, expect, it } from "vitest";
import { TtlLruCache } from "../../src/mc/cache.js";
import { McClient } from "../../src/mc/client.js";
import {
  cachingConfig,
  expectMcError,
  fixtureText,
  happyRouter,
  ROUTE,
  sequenceFetch,
  silentLogger,
} from "./_helpers.js";

const HOUR = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TtlLruCache", () => {
  it("gives back what was put in", () => {
    const cache = new TtlLruCache<string>(10, HOUR);

    cache.set("a", "blue-horizon");

    expect(cache.get("a")).toBe("blue-horizon");
  });

  it("returns undefined for a key it has never seen", () => {
    expect(new TtlLruCache<string>(10, HOUR).get("missing")).toBeUndefined();
  });

  it("counts what it holds and can be emptied", () => {
    const cache = new TtlLruCache<number>(10, HOUR);

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("forgets an entry once its lifetime is up", async () => {
    const cache = new TtlLruCache<string>(10, 20);

    cache.set("a", "stale");
    expect(cache.get("a")).toBe("stale");

    await sleep(40);

    expect(cache.get("a"), "an expired entry is a miss, not an old answer").toBeUndefined();
  });

  it("keeps the newest entries when it runs out of room", () => {
    const cache = new TtlLruCache<number>(2, HOUR);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect(cache.size).toBeLessThanOrEqual(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("evicts the least recently used entry, not the oldest one written", () => {
    const cache = new TtlLruCache<number>(2, HOUR);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);

    expect(cache.get("a"), "read most recently, so it stays").toBe(1);
    expect(cache.get("b"), "untouched since it was written").toBeUndefined();
  });

  it("holds nothing when it is configured with no room at all", () => {
    const cache = new TtlLruCache<number>(0, HOUR);

    cache.set("a", 1);

    expect(cache.get("a")).toBeUndefined();
  });

  it("replaces the value under an existing key", () => {
    const cache = new TtlLruCache<string>(10, HOUR);

    cache.set("a", "first");
    cache.set("a", "second");

    expect(cache.get("a")).toBe("second");
    expect(cache.size).toBe(1);
  });
});

describe("what the client caches", () => {
  it("answers a repeated question from memory, and says so", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    const first = await client.search("blue horizon", 10, 0);
    const second = await client.search("blue horizon", 10, 0);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(fetch.calls).toHaveLength(1);
    expect(second.data.titles[0]!.slug).toBe(first.data.titles[0]!.slug);
  });

  it("treats a different question as a different question", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    await client.search("blue horizon", 10, 0);
    await client.search("cinder vale", 10, 0);

    expect(fetch.calls).toHaveLength(2);
  });

  it("never keeps a response it could not read", async () => {
    const body = fixtureText("search.json");
    const fetch = sequenceFetch([fixtureText("no-envelope.json"), body]);
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    await expectMcError(() => client.search("blue horizon", 10, 0), "parse_failure");
    const recovered = await client.search("blue horizon", 10, 0);

    expect(recovered.cached, "the failure must not have been stored").toBe(false);
    expect(recovered.data.titles).not.toHaveLength(0);
    expect(fetch.calls).toHaveLength(2);
  });

  it("never keeps a missing entry, so a title added later can still be found", async () => {
    const fetch = sequenceFetch([
      { status: 404, body: fixtureText("error-404.json") },
      { status: 200, body: fixtureText("detail-movie.json") },
    ]);
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    await expectMcError(() => client.getDetail("movie", "blue-horizon"), "not_found");
    const found = await client.getDetail("movie", "blue-horizon");

    expect(found.data.title).toBe("Blue Horizon");
    expect(fetch.calls).toHaveLength(2);
  });

  it("does not serve one sentiment's reviews for another's, though they share a URL", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });
    const read = (sentiment: "positive" | "negative") =>
      client.getCriticReviews({
        kind: "movie",
        slug: "blue-horizon",
        sentiment,
        limit: 10,
        offset: 0,
      });

    const positive = await read("positive");
    const negative = await read("negative");

    expect(negative.data.reviews[0]!.quote).not.toBe(positive.data.reviews[0]!.quote);
    expect(negative.data.reviews.length).not.toBe(positive.data.reviews.length);
    expect(
      fetch.calls.filter((c) => c.url.includes(ROUTE.criticReviews)).length,
      "the URL is identical, so a URL-keyed cache would answer the second from the first",
    ).toBeGreaterThanOrEqual(1);
  });

  it("pages a sample it already holds without going back to the site", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });
    const page = (offset: number) =>
      client.getCriticReviews({
        kind: "movie",
        slug: "blue-horizon",
        sentiment: "all",
        limit: 2,
        offset,
      });

    const first = await page(0);
    const second = await page(2);

    expect(first.cached).toBe(false);
    expect(second.cached, "the second page is a slice of what is already in memory").toBe(true);
    expect(
      fetch.calls.filter((call) => call.url.includes(ROUTE.criticReviews)),
      "the route ignores limit and offset, so asking again would spend a request for nothing",
    ).toHaveLength(1);
  });

  it("asks the reviews route for no limit or offset, since it honours neither", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    await client.getCriticReviews({
      kind: "movie",
      slug: "blue-horizon",
      sentiment: "all",
      limit: 7,
      offset: 3,
    });

    const url = fetch.calls[0]!.url;
    expect(url).not.toContain("limit=");
    expect(url).not.toContain("offset=");
  });

  it("keeps critic and user scores of one title apart", async () => {
    const client = new McClient({
      config: cachingConfig(),
      logger: silentLogger,
      fetchImpl: happyRouter().impl,
    });

    const critic = await client.getScore("movie", "blue-horizon", "critic");
    const user = await client.getScore("movie", "blue-horizon", "user");

    expect(critic.data.max).toBe(100);
    expect(user.data.max).toBe(10);
  });

  it("goes back to the network when caching is switched off", async () => {
    const fetch = happyRouter();
    const client = new McClient({
      config: cachingConfig({ cacheTtlMs: 0, cacheMaxEntries: 0 }),
      logger: silentLogger,
      fetchImpl: fetch.impl,
    });

    const first = await client.search("blue horizon", 10, 0);
    const second = await client.search("blue horizon", 10, 0);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(false);
    expect(fetch.calls).toHaveLength(2);
  });
});
