/**
 * Search and browse rows.
 *
 * Two things are load-bearing here. A listing must stay small, because the
 * upstream row carries a description, a genre list and a set of artwork
 * variants that would swamp a model's context ten rows in. And an absent
 * audience score must arrive as null, because 0 out of 10 is a verdict.
 */

import { describe, expect, it } from "vitest";
import { McClient } from "../../src/mc/client.js";
import {
  constantFetch,
  expectMcError,
  fixtureJson,
  fixtureText,
  happyRouter,
  ROUTE,
  silentLogger,
  testConfig,
} from "./_helpers.js";

const client = (fetchImpl: typeof fetch) =>
  new McClient({ config: testConfig(), logger: silentLogger, fetchImpl });

describe("search rows", () => {
  it("maps every upstream type onto a kind, including game-title", async () => {
    const { data } = await client(happyRouter().impl).search("lantern", 10, 0);

    expect(data.titles.map((title) => title.kind)).toEqual(["movie", "show", "game", "movie"]);
  });

  it("carries the fields needed to make a second call, and the critic score", async () => {
    const { data } = await client(happyRouter().impl).search("lantern", 10, 0);
    const first = data.titles[0]!;

    expect(first.id).toBe(2000100001);
    expect(first.slug).toBe("blue-horizon");
    expect(first.title).toBe("Blue Horizon");
    expect(first.year).toBe(2011);
    expect(first.releaseDate).toBe("2011-09-30");
    expect(first.rating).toBe("R");
    expect(first.metascore).toBe(81);
  });

  it("links every row to its page on the site, under the right catalogue segment", async () => {
    const { data } = await client(happyRouter().impl).search("lantern", 10, 0);

    expect(data.titles[0]!.sourceUrl).toContain("/movie/blue-horizon");
    expect(data.titles[1]!.sourceUrl).toContain("/tv/paper-lanterns");
    expect(data.titles[2]!.sourceUrl).toContain("/game/cinder-vale");
  });

  it("reports a missing audience score as null rather than as zero", async () => {
    const { data } = await client(happyRouter().impl).search("lantern", 10, 0);

    for (const title of data.titles) {
      expect(title.userScore, `${title.title} carries no userScore upstream`).toBeNull();
    }
  });

  it("reports a missing critic score as null rather than as zero", async () => {
    const { data } = await client(happyRouter().impl).search("lantern", 10, 0);
    const noScore = data.titles.find((title) => title.slug === "the-salt-road")!;

    expect(noScore.metascore).toBeNull();
  });

  it("reports the upstream total, which is what paging is judged against", async () => {
    const { data } = await client(happyRouter().impl).search("lantern", 10, 0);

    expect(data.totalResults).toBe(17);
    expect(data.itemCount).toBe(4);
  });

  it("drops the heavy fields: no description, genre or artwork survives a row", async () => {
    const { data } = await client(happyRouter().impl).search("lantern", 10, 0);
    const serialised = JSON.stringify(data);

    const fixture = fixtureJson("search.json");
    const row = fixture.data.items[0];

    expect(serialised).not.toContain("A lighthouse keeper counts the ships");
    expect(serialised).not.toContain("Neo-Noir");
    expect(serialised).not.toContain("1440x2160");
    expect(serialised).not.toContain(row.images[0].filename);
    expect(serialised).not.toContain("PlayStation 5");
    expect(serialised).not.toContain("__noise");
  });
});

describe("browse rows", () => {
  it("reads the audience score from the userScore object browse rows carry", async () => {
    const { data } = await client(happyRouter().impl).browse({
      kind: "movie",
      sort: "score",
      limit: 20,
      offset: 0,
    });

    expect(data.titles[0]!.userScore).toBe(8.8);
    expect(data.titles[1]!.userScore).toBe(6.1);
  });

  it("reads a userScore whose own score is null as null, not as zero", async () => {
    const { data } = await client(happyRouter().impl).browse({
      kind: "movie",
      sort: "score",
      limit: 20,
      offset: 0,
    });
    const unrated = data.titles.find((title) => title.slug === "gravel-choir")!;

    expect(unrated.userScore).toBeNull();
  });

  it("keeps both scores on their own scales, side by side", async () => {
    const { data } = await client(happyRouter().impl).browse({
      kind: "movie",
      sort: "score",
      limit: 20,
      offset: 0,
    });
    const first = data.titles[0]!;

    expect(first.metascore).toBe(81);
    expect(first.userScore).toBe(8.8);
  });

  it("stays as light as a search row", async () => {
    const { data } = await client(happyRouter().impl).browse({
      kind: "movie",
      sort: "score",
      limit: 20,
      offset: 0,
    });

    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain("Neo-Noir");
    expect(serialised).not.toContain("1440x2160");
    expect(serialised).not.toContain("quarry town choir");
  });
});

describe("a listing that cannot be read", () => {
  it("treats an empty items array as an answer, not as a failure", async () => {
    const { data } = await client(constantFetch(fixtureText("empty-items.json")).impl).search(
      "no-such-title",
      10,
      0,
    );

    expect(data.titles).toEqual([]);
    expect(data.totalResults).toBe(0);
    expect(data.itemCount).toBe(0);
  });

  it("raises not_found on the upstream errors envelope, served with HTTP 404", async () => {
    const fetchImpl = constantFetch({ body: fixtureText("error-404.json"), status: 404 }).impl;

    const error = await expectMcError(
      () => client(fetchImpl).search("blue horizon", 10, 0),
      "not_found",
    );
    expect(error.message).not.toMatch(/no result|empty/i);
  });

  it("raises parse_failure on an envelope that is neither data nor errors", async () => {
    await expectMcError(
      () => client(constantFetch(fixtureText("no-envelope.json")).impl).search("x", 10, 0),
      "parse_failure",
    );
  });

  it("raises parse_failure on a body that is not JSON at all", async () => {
    await expectMcError(
      () =>
        client(
          constantFetch({
            body: fixtureText("not-json.txt"),
            headers: { "content-type": "text/html" },
          }).impl,
        ).search("x", 10, 0),
      "parse_failure",
    );
  });

  it("skips a single unreadable row and keeps the rest of the page", async () => {
    const { data } = await client(constantFetch(fixtureText("partial-rows.json")).impl).search(
      "x",
      10,
      0,
    );

    expect(data.titles.map((title) => title.slug)).toEqual(["blue-horizon", "cinder-vale"]);
  });

  it("pages by what the site sent, not by what could be read", async () => {
    const { data } = await client(constantFetch(fixtureText("partial-rows.json")).impl).search(
      "x",
      10,
      0,
    );

    expect(data.itemCount, "three rows arrived, so the next offset is three further on").toBe(3);
    expect(data.titles.length).toBe(2);
  });

  it("raises parse_failure when no row on the page could be read", async () => {
    await expectMcError(
      () => client(constantFetch(fixtureText("unreadable-rows.json")).impl).search("x", 10, 0),
      "parse_failure",
    );
  });
});

describe("the request the client makes", () => {
  it("asks the search route for the query, limit and offset given", async () => {
    const fetch = happyRouter();
    await client(fetch.impl).search("blue horizon", 7, 20);

    const url = fetch.calls[0]!.url;
    expect(url).toContain(ROUTE.search);
    expect(decodeURIComponent(url)).toContain("blue horizon");
    expect(url).toContain("limit=7");
    expect(url).toContain("offset=20");
  });

  it("asks the browse route for the kind, sort and genre given", async () => {
    const fetch = happyRouter();
    await client(fetch.impl).browse({
      kind: "game",
      sort: "recent",
      genre: "Horror",
      limit: 5,
      offset: 0,
    });

    const url = fetch.calls[0]!.url;
    expect(url).toContain(ROUTE.browse);
    expect(url).toContain("Horror");
    expect(url).toContain("limit=5");
  });
});
