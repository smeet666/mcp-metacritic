/**
 * Live smoke tests against Metacritic.
 *
 * These are the tests the fixtures cannot replace: they are what notices the
 * day the upstream shape moves. They are skipped unless MC_LIVE=1, since a
 * suite that reaches the network on every run is a suite that fails for
 * reasons that have nothing to do with the change under test.
 *
 *   MC_LIVE=1 npm run test:live
 *
 * One request per route, paced by the client's own rate limiter, and every
 * assertion names the field it guards so a break reads as "the site stopped
 * sending X" rather than "something is wrong".
 */

import { describe, expect, it } from "vitest";
import { McClient } from "../../src/mc/client.js";
import { McError } from "../../src/errors.js";
import { loadConfig } from "../../src/config.js";

const LIVE = process.env.MC_LIVE === "1";
const TIMEOUT = 120_000;

/** A long-established entry, chosen because it is not going to be edited away. */
const SLUG = "inception";
const KIND = "movie" as const;

const client = new McClient({ config: loadConfig({ MC_LOG_LEVEL: "silent" }) });

describe.runIf(LIVE)("live: Metacritic", () => {
  it(
    "search returns rows that stay small after trimming",
    async () => {
      const { data } = await client.search(SLUG, 5, 0);

      expect(data.titles.length, "search returned no rows at all").toBeGreaterThan(0);

      const first = data.titles[0]!;
      expect(typeof first.id, "row.id").toBe("number");
      expect(first.slug, "row.slug, which every follow-up call needs").toBeTruthy();
      expect(["movie", "show", "game"], "row.kind").toContain(first.kind);
      expect(first.sourceUrl, "row.sourceUrl, needed to cite the entry").toContain(
        "metacritic.com",
      );

      const serialised = JSON.stringify(data);
      expect(
        serialised.length / data.titles.length,
        "bytes per row: a row carrying artwork or a description would be far larger",
      ).toBeLessThan(600);
      expect(serialised, "no artwork filename may survive into a row").not.toMatch(/\.jpg/);
      expect(serialised, "no image dimensions may survive into a row").not.toMatch(/\d+x\d+/);
    },
    TIMEOUT,
  );

  it(
    "search reports an audience score it was not sent as null, never as zero",
    async () => {
      const { data } = await client.search(SLUG, 5, 0);

      for (const title of data.titles) {
        expect(
          title.userScore === null || title.userScore > 0,
          `${title.title}: userScore must be null when absent, not 0`,
        ).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    "browse returns the audience score, on its own scale",
    async () => {
      const { data } = await client.browse({ kind: KIND, sort: "score", limit: 5, offset: 0 });

      expect(data.titles.length, "browse returned no rows").toBeGreaterThan(0);
      const scored = data.titles.filter((title) => title.userScore !== null);
      expect(scored.length, "no browse row carried a userScore").toBeGreaterThan(0);
      for (const title of scored) {
        expect(title.userScore, `${title.title}: userScore is out of 10`).toBeLessThanOrEqual(10);
      }
    },
    TIMEOUT,
  );

  it(
    "detail carries the long-form fields a listing row drops",
    async () => {
      const { data } = await client.getDetail(KIND, SLUG);

      expect(data.title, "detail.title").toBeTruthy();
      expect(data.kind, "detail.kind comes from the caller, not the response").toBe(KIND);
      expect(data.description, "detail.description").toBeTruthy();
      expect(data.genres.length, "detail.genres").toBeGreaterThan(0);
      expect(data.imdbId, "detail.imdbId, which streaming offers are keyed by").toMatch(/^tt\d+/);
    },
    TIMEOUT,
  );

  it(
    "detail reports awards as one tally per ceremony",
    async () => {
      const { data } = await client.getDetail(KIND, SLUG);

      expect(data.awards.length, "detail.awards came back empty").toBeGreaterThan(0);
      for (const award of data.awards) {
        expect(award.ceremony, "award.ceremony, the only name the source publishes").toBeTruthy();
        expect(
          award.wins === null || award.wins > 0,
          `${award.ceremony}: award.wins is null when unrecorded, never 0`,
        ).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    "watch offers come back as destinations rather than click trackers",
    async () => {
      const detail = await client.getDetail(KIND, SLUG);
      const imdbId = detail.data.imdbId!;
      const { data } = await client.getWatchOffers(imdbId, KIND);

      expect(data.length, "no offer at all for a widely available film").toBeGreaterThan(0);
      for (const offer of data) {
        expect(offer.provider, "offer.provider").toBeTruthy();
        expect(offer.kind, "offer.kind, the group it was listed under").toBeTruthy();
        expect(offer.url, `${offer.provider}: offer.url`).toBeTruthy();
        expect(
          (offer.url ?? "").length,
          `${offer.provider}: offer.url is a destination, not a tracking payload`,
        ).toBeLessThan(300);
        expect(
          offer.url,
          `${offer.provider}: offer.url still carries tracker parameters`,
        ).not.toMatch(/[?&]cx=/);
      }
    },
    TIMEOUT,
  );

  it(
    "the critic score comes back out of 100",
    async () => {
      const { data } = await client.getScore(KIND, SLUG, "critic");

      expect(data.max, "criticScore.max").toBe(100);
      expect(data.score, "criticScore.score").toBeGreaterThan(0);
      expect(data.score, "criticScore.score is on the 100 scale").toBeLessThanOrEqual(100);
      expect(data.reviewCount, "criticScore.reviewCount").toBeGreaterThan(0);
      expect(data.sentiment, "criticScore.sentiment, Metacritic's own wording").toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    "the user score comes back out of 10",
    async () => {
      const { data } = await client.getScore(KIND, SLUG, "user");

      expect(data.max, "userScore.max").toBe(10);
      expect(data.score, "userScore.score is on the 10 scale").toBeLessThanOrEqual(10);
      expect(data.score, "userScore.score").toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "the four sentiment buckets are four different sets of reviews",
    async () => {
      const read = (sentiment: "all" | "positive" | "neutral" | "negative") =>
        client.getCriticReviews({ kind: KIND, slug: SLUG, sentiment, limit: 20, offset: 0 });

      const all = await read("all");
      const positive = await read("positive");
      const neutral = await read("neutral");
      const negative = await read("negative");

      for (const [name, page] of [
        ["all", all],
        ["positive", positive],
        ["neutral", neutral],
        ["negative", negative],
      ] as const) {
        expect(page.data.reviews.length, `the ${name} bucket came back empty`).toBeGreaterThan(0);
      }

      const quoteOf = (page: typeof all) => page.data.reviews[0]!.quote;
      expect(
        quoteOf(positive),
        "positive and negative must not be the same bucket served twice",
      ).not.toBe(quoteOf(negative));
      expect(quoteOf(neutral), "neutral must not be the negative bucket").not.toBe(
        quoteOf(negative),
      );

      const scoreOf = (page: typeof all) => page.data.reviews[0]!.score ?? 0;
      expect(scoreOf(positive), "a positive review outscores a negative one").toBeGreaterThan(
        scoreOf(negative),
      );
    },
    TIMEOUT,
  );

  it(
    "every critic review it returns can be attributed and linked",
    async () => {
      const { data } = await client.getCriticReviews({
        kind: KIND,
        slug: SLUG,
        sentiment: "all",
        limit: 10,
        offset: 0,
      });

      expect(data.reviews.length, "the critic sample was empty").toBeGreaterThan(0);
      for (const review of data.reviews) {
        expect(review.publication, "review.publication, required to quote it").toBeTruthy();
        expect(review.quote, "review.quote").toBeTruthy();
        expect(review.url, "review.url, required to link the original").toBeTruthy();
      }
      expect(
        data.totalResults,
        "totalResults counts every review, not just the published sample",
      ).toBeGreaterThanOrEqual(data.reviews.length);
    },
    TIMEOUT,
  );

  it(
    "user reviews come back on the ten-point scale",
    async () => {
      const { data } = await client.getUserReviews({
        kind: KIND,
        slug: SLUG,
        sentiment: "all",
        limit: 10,
        offset: 0,
      });

      expect(data.reviews.length, "the user sample was empty").toBeGreaterThan(0);
      for (const review of data.reviews) {
        if (review.score !== null) {
          expect(review.score, "userReview.score is out of 10").toBeLessThanOrEqual(10);
        }
      }
    },
    TIMEOUT,
  );

  it(
    "an unknown slug raises not_found rather than answering with nothing",
    async () => {
      let caught: unknown;
      try {
        await client.getDetail(KIND, "no-such-film-a7f3c9e1");
      } catch (error) {
        caught = error;
      }

      expect(caught, "a missing entry must raise, never resolve empty").toBeInstanceOf(McError);
      expect((caught as McError).code, "error.code").toBe("not_found");
    },
    TIMEOUT,
  );
});
