/**
 * Reviews.
 *
 * The reviews route returns all four sentiment buckets in one payload and
 * ignores limit and offset entirely, always answering with the same fixed
 * sample. Both facts shape what the tests below insist on: the bucket asked for
 * is the bucket returned, and paging is something this server does itself.
 */

import { describe, expect, it } from "vitest";
import { McClient } from "../../src/mc/client.js";
import type { Sentiment } from "../../src/types.js";
import {
  cachingConfig,
  constantFetch,
  expectMcError,
  fixtureJson,
  fixtureText,
  happyRouter,
  ROUTE,
  silentLogger,
  testConfig,
} from "./_helpers.js";

const client = (fetchImpl: typeof fetch, config = testConfig()) =>
  new McClient({ config, logger: silentLogger, fetchImpl });

const criticReviews = (sentiment: Sentiment, instance = client(happyRouter().impl)) =>
  instance.getCriticReviews({
    kind: "movie",
    slug: "blue-horizon",
    sentiment,
    limit: 10,
    offset: 0,
  });

describe("critic reviews", () => {
  it("reads the whole sample the site publishes, not the limit asked for", async () => {
    const { data } = await criticReviews("all");

    expect(data.reviews.length).toBe(7);
    expect(data.itemCount).toBe(7);
  });

  it("reports the upstream total, which is far larger than the sample", async () => {
    const { data } = await criticReviews("all");

    expect(data.totalResults).toBe(36);
    expect(data.totalResults).toBeGreaterThan(data.reviews.length);
  });

  it("keeps the attribution a quote cannot be published without", async () => {
    const { data } = await criticReviews("all");
    const first = data.reviews[0]!;

    expect(first.quote).toBe("A film that trusts its silences, and is right to.");
    expect(first.publication).toBe("The Harbour Review");
    expect(first.author).toBe("Marisol Vane");
    expect(first.url).toBe("https://example.invalid/harbour/blue-horizon");
    expect(first.score).toBe(91);
    expect(first.date).toBe("2011-10-01");
  });

  it("drops a review that names no publication, since it cannot be attributed", async () => {
    const fetchImpl = constantFetch(fixtureText("reviews-critic-no-publication.json")).impl;
    const { data } = await criticReviews("all", client(fetchImpl));

    expect(data.reviews.map((review) => review.quote)).toEqual([
      "Attributable, and therefore quotable.",
      "Also attributable.",
    ]);
    for (const review of data.reviews) {
      expect(review.publication).not.toBeNull();
    }
  });

  it("still counts the dropped review in what arrived", async () => {
    const fetchImpl = constantFetch(fixtureText("reviews-critic-no-publication.json")).impl;
    const { data } = await criticReviews("all", client(fetchImpl));

    expect(data.itemCount, "three entries were in the sample").toBe(3);
    expect(data.reviews.length, "two of them could be attributed").toBe(2);
  });
});

describe("the four sentiment buckets", () => {
  it("returns the bucket asked for, each with its own length", async () => {
    const instance = client(happyRouter().impl);

    const all = await criticReviews("all", instance);
    const positive = await criticReviews("positive", instance);
    const neutral = await criticReviews("neutral", instance);
    const negative = await criticReviews("negative", instance);

    expect(all.data.reviews.length).toBe(7);
    expect(positive.data.reviews.length).toBe(4);
    expect(neutral.data.reviews.length).toBe(2);
    expect(negative.data.reviews.length).toBe(1);
  });

  it("returns different reviews for two calls differing only by sentiment", async () => {
    const instance = client(happyRouter().impl, cachingConfig());

    const positive = await criticReviews("positive", instance);
    const negative = await criticReviews("negative", instance);

    expect(positive.data.reviews[0]!.quote).not.toBe(negative.data.reviews[0]!.quote);
    expect(negative.data.reviews[0]!.quote).toBe("A postcard mistaken for a novel.");
  });

  it("keeps the buckets apart even when the cache is on and the URL is the same", async () => {
    const fetch = happyRouter();
    const instance = client(fetch.impl, cachingConfig());

    const positive = await criticReviews("positive", instance);
    const neutral = await criticReviews("neutral", instance);
    const negative = await criticReviews("negative", instance);
    const positiveAgain = await criticReviews("positive", instance);

    const reviewsUrls = fetch.calls.filter((call) => call.url.includes(ROUTE.criticReviews));
    expect(
      new Set(reviewsUrls.map((call) => call.url)).size,
      "the four sentiments share one upstream URL, which is what makes this a trap",
    ).toBe(1);

    expect(positive.data.reviews.length).toBe(4);
    expect(neutral.data.reviews.length).toBe(2);
    expect(negative.data.reviews.length).toBe(1);
    expect(positiveAgain.data.reviews[0]!.quote).toBe(positive.data.reviews[0]!.quote);
    expect(positiveAgain.cached, "the second positive call is the one that may be replayed").toBe(
      true,
    );
  });

  it("holds the same separation for user reviews", async () => {
    const instance = client(happyRouter().impl, cachingConfig());

    const positive = await instance.getUserReviews({
      kind: "movie",
      slug: "blue-horizon",
      sentiment: "positive",
      limit: 10,
      offset: 0,
    });
    const negative = await instance.getUserReviews({
      kind: "movie",
      slug: "blue-horizon",
      sentiment: "negative",
      limit: 10,
      offset: 0,
    });

    expect(positive.data.reviews.length).toBe(3);
    expect(negative.data.reviews.length).toBe(1);
    expect(positive.data.reviews[0]!.quote).not.toBe(negative.data.reviews[0]!.quote);
  });
});

describe("user reviews", () => {
  it("keeps the quote, score and date, which is all a user entry carries", async () => {
    const { data } = await client(happyRouter().impl).getUserReviews({
      kind: "movie",
      slug: "blue-horizon",
      sentiment: "all",
      limit: 10,
      offset: 0,
    });
    const first = data.reviews[0]!;

    expect(first.quote).toBe("Watched it twice in one night.");
    expect(first.score).toBe(10);
    expect(first.date).toBe("2011-11-02");
    expect(data.totalResults).toBe(1204);
  });

  it("keeps every entry, since a user review has no publication to require", async () => {
    const fixture = fixtureJson("reviews-user.json");
    const { data } = await client(happyRouter().impl).getUserReviews({
      kind: "movie",
      slug: "blue-horizon",
      sentiment: "all",
      limit: 10,
      offset: 0,
    });

    expect(data.reviews.length).toBe(fixture.data.item.default.length);
  });

  it("is read from the user route rather than the critic one", async () => {
    const fetch = happyRouter();
    await client(fetch.impl).getUserReviews({
      kind: "movie",
      slug: "blue-horizon",
      sentiment: "all",
      limit: 10,
      offset: 0,
    });

    expect(fetch.calls[0]!.url).toContain(ROUTE.userReviews);
  });
});

describe("reviews that cannot be read", () => {
  it("raises not_found when the entry has no review document", async () => {
    const fetchImpl = constantFetch({ body: fixtureText("error-404.json"), status: 404 }).impl;

    await expectMcError(() => criticReviews("all", client(fetchImpl)), "not_found");
  });

  it("raises parse_failure on an unrecognised envelope", async () => {
    const fetchImpl = constantFetch(fixtureText("no-envelope.json")).impl;

    await expectMcError(() => criticReviews("all", client(fetchImpl)), "parse_failure");
  });

  it("raises parse_failure on a body that is not JSON", async () => {
    const fetchImpl = constantFetch(fixtureText("not-json.txt")).impl;

    await expectMcError(() => criticReviews("all", client(fetchImpl)), "parse_failure");
  });
});
