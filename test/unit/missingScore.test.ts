/**
 * An entry Metacritic has not scored.
 *
 * Some entries carry reviews without an aggregate. The detail route says so
 * with a null score and a review count; the listing routes say it with a zero,
 * which on a scale that starts at zero is a verdict rather than an absence. A
 * row that reads "0/100" for a film critics liked is the worst kind of wrong,
 * because nothing about it invites a second look.
 */

import { describe, expect, it } from "vitest";
import { McClient } from "../../src/mc/client.js";
import { parseDetail, parseScore } from "../../src/mc/parse.js";
import { constantFetch, silentLogger, testConfig } from "./_helpers.js";

const client = (fetchImpl: typeof fetch) =>
  new McClient({ config: testConfig(), logger: silentLogger, fetchImpl });

const listing = (score: number | null) =>
  JSON.stringify({
    data: {
      totalResults: 1,
      itemsPerPage: 10,
      items: [
        {
          id: 2_000_562_074,
          type: "movie",
          typeId: 2,
          title: "Angel's Egg",
          slug: "angels-egg-1985",
          premiereYear: 1985,
          releaseDate: "2025-11-19",
          rating: "",
          criticScoreSummary: { score, url: "/movie/angels-egg-1985/critic-reviews/" },
        },
      ],
    },
  });

describe("a search row for an entry with reviews but no aggregate", () => {
  it("reports no metascore rather than a metascore of zero", async () => {
    const { data } = await client(constantFetch(listing(0)).impl).search("angel's egg", 10, 0);

    expect(
      data.titles[0]!.metascore,
      "0 out of 100 is a verdict, and this entry has none",
    ).toBeNull();
  });

  it("leaves a real low score alone", async () => {
    const { data } = await client(constantFetch(listing(9)).impl).search("angel's egg", 10, 0);

    expect(data.titles[0]!.metascore).toBe(9);
  });

  it("agrees with what the detail route says about the same entry", async () => {
    // The detail route reports null for this slug. Two routes describing one
    // entry must not disagree about whether it has been scored.
    const fromListing = await client(constantFetch(listing(0)).impl).search("angel's egg", 10, 0);
    const fromDetail = await client(constantFetch(listing(null)).impl).search("angel's egg", 10, 0);

    expect(fromListing.data.titles[0]!.metascore).toBe(fromDetail.data.titles[0]!.metascore);
  });
});

describe("an unreleased entry nobody has rated yet", () => {
  const detail = (over: Record<string, unknown>) =>
    JSON.stringify({
      data: {
        item: {
          id: 2_000_600_001,
          type: "movie",
          typeId: 2,
          title: "Bluey: The Movie",
          slug: "bluey-the-movie",
          premiereYear: 2027,
          description: "A film that has not opened.",
          ...over,
        },
      },
    });

  it("reports no runtime rather than a runtime of zero minutes", () => {
    const { duration } = parseDetail(
      detail({ duration: 0 }),
      "https://example.test",
      "movie",
      "bluey-the-movie",
    );

    expect(duration, "no film is zero minutes long").toBeNull();
  });

  it("keeps a real runtime", () => {
    const { duration } = parseDetail(
      detail({ duration: 71 }),
      "https://example.test",
      "movie",
      "bluey-the-movie",
    );

    expect(duration).toBe(71);
  });

  it("reports no audience score rather than zero out of ten", () => {
    const score = parseScore(
      JSON.stringify({ data: { item: { max: 10, score: 0, reviewCount: 0 } } }),
      "https://example.test",
      "the audience score",
    );

    expect(score.score, "0 out of 10 from 0 ratings is a verdict nobody gave").toBeNull();
  });

  it("keeps a real low audience score", () => {
    const score = parseScore(
      JSON.stringify({ data: { item: { max: 10, score: 1.4, reviewCount: 812 } } }),
      "https://example.test",
      "the audience score",
    );

    expect(score.score).toBe(1.4);
  });
});

describe("a browse row for an entry with no aggregate", () => {
  it("reports no metascore rather than a metascore of zero", async () => {
    const { data } = await client(constantFetch(listing(0)).impl).browse({
      kind: "movie",
      sort: "score",
      limit: 10,
      offset: 0,
    });

    expect(data.titles[0]!.metascore).toBeNull();
  });
});
