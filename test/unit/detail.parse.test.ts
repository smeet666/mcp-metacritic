/**
 * The detail route.
 *
 * The response carries no `type`, so the kind can only come from the caller.
 * That is the interesting part: nothing in the payload can correct a caller who
 * asks for a game with a film's slug, so the kind must be threaded through
 * rather than guessed.
 */

import { describe, expect, it } from "vitest";
import { McClient } from "../../src/mc/client.js";
import {
  constantFetch,
  expectMcError,
  fixtureText,
  happyRouter,
  silentLogger,
  testConfig,
} from "./_helpers.js";

const client = (fetchImpl: typeof fetch) =>
  new McClient({ config: testConfig(), logger: silentLogger, fetchImpl });

describe("detail", () => {
  it("takes the kind from the caller, since the response does not carry one", async () => {
    const movie = await client(happyRouter().impl).getDetail("movie", "blue-horizon");
    const game = await client(happyRouter().impl).getDetail("game", "cinder-vale");

    expect(movie.data.kind).toBe("movie");
    expect(game.data.kind).toBe("game");
  });

  it("reads the identity fields a citation needs", async () => {
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");

    expect(data.id).toBe(2000100001);
    expect(data.title).toBe("Blue Horizon");
    expect(data.slug).toBe("blue-horizon");
    expect(data.year).toBe(2011);
    expect(data.releaseDate).toBe("2011-09-30");
    expect(data.rating).toBe("R");
    expect(data.sourceUrl).toContain("/movie/blue-horizon");
  });

  it("reads the long-form fields a listing row deliberately drops", async () => {
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");

    expect(data.description).toContain("A lighthouse keeper counts the ships");
    expect(data.tagline).toBe("Some lights are warnings.");
    expect(data.genres).toEqual(["Neo-Noir", "Drama"]);
    expect(data.duration).toBe("1 h 52 m");
  });

  it("keeps the IMDb id, which is what streaming offers are keyed by", async () => {
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");

    expect(data.imdbId).toBe("tt0910111");
  });

  it("flattens production companies to name and id", async () => {
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");

    expect(data.production).toEqual([
      { name: "Nine Fathoms Pictures", id: 501 },
      { name: "Cold Coast Films", id: 502 },
    ]);
  });

  it("surfaces one tally per ceremony", async () => {
    // Upstream lists one entry per ceremony, shaped {awardEvent, wins,
    // nominations}, with no per-category detail to name.
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");

    expect(data.awards.map((award) => award.ceremony)).toEqual([
      "Torrance Film Prize",
      "Coastal Critics Circle",
      "Harbour Guild Awards",
    ]);
    expect(data.awards[0]).toEqual({
      ceremony: "Torrance Film Prize",
      wins: 4,
      nominations: 8,
    });
  });

  it("keeps an unrecorded win null rather than calling it zero", async () => {
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");
    const nominatedOnly = data.awards.find((award) => award.ceremony === "Coastal Critics Circle")!;

    expect(
      nominatedOnly.wins,
      "the source records no win, which is not the same as none",
    ).toBeNull();
    expect(nominatedOnly.nominations).toBe(3);
  });

  it("skips a tally with no ceremony to attribute it to", async () => {
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");

    expect(data.awards).toHaveLength(3);
    for (const award of data.awards) {
      expect(award.ceremony, "an award with no ceremony names nothing").toBeTruthy();
    }
  });

  it("carries the critic score that comes with the entry", async () => {
    const { data } = await client(happyRouter().impl).getDetail("movie", "blue-horizon");

    expect(data.metascore).toBe(81);
  });

  it("leaves absent fields null rather than inventing them", async () => {
    const { data } = await client(happyRouter().impl).getDetail("game", "cinder-vale");

    expect(data.tagline).toBeNull();
    expect(data.duration).toBeNull();
    expect(data.imdbId).toBeNull();
    expect(data.awards).toEqual([]);
    expect(data.networks).toEqual([]);
  });

  it("asks the catalogue segment that matches the kind", async () => {
    const movieFetch = happyRouter();
    await client(movieFetch.impl).getDetail("movie", "blue-horizon");
    const gameFetch = happyRouter();
    await client(gameFetch.impl).getDetail("game", "cinder-vale");

    expect(movieFetch.calls[0]!.url).toContain("/movies/metacritic/blue-horizon");
    expect(gameFetch.calls[0]!.url).toContain("/games/metacritic/cinder-vale");
  });

  it("raises not_found for a slug the site has no entry for", async () => {
    const fetchImpl = constantFetch({ body: fixtureText("error-404.json"), status: 404 }).impl;

    const error = await expectMcError(
      () => client(fetchImpl).getDetail("movie", "no-such-film"),
      "not_found",
    );
    expect(error.details.hint, "the hint must point at the way back in").toContain("search_titles");
  });

  it("raises parse_failure on an envelope it does not recognise", async () => {
    await expectMcError(
      () => client(constantFetch(fixtureText("no-envelope.json")).impl).getDetail("movie", "x"),
      "parse_failure",
    );
  });

  it("raises parse_failure rather than returning a blank entry for a non-JSON body", async () => {
    await expectMcError(
      () => client(constantFetch(fixtureText("not-json.txt")).impl).getDetail("movie", "x"),
      "parse_failure",
    );
  });
});

describe("watch offers", () => {
  it("labels each offer with the group it came from", async () => {
    const { data } = await client(happyRouter().impl).getWatchOffers("tt0910111", "movie");

    expect(data.map((offer) => offer.kind).sort()).toEqual(["buy", "rent", "rent"]);
    expect(data.map((offer) => offer.provider)).toContain("Lantern Video");
    expect(data.map((offer) => offer.provider)).toContain("Coastline Store");
  });

  it("keeps the link, since an offer without one cannot be acted on", async () => {
    const { data } = await client(happyRouter().impl).getWatchOffers("tt0910111", "movie");

    for (const offer of data) {
      expect(offer.url, `${offer.provider} (${offer.kind})`).toContain("https://");
    }
  });

  it("unwraps a click-tracking redirect to the destination it hides", async () => {
    const { data } = await client(happyRouter().impl).getWatchOffers("tt0910111", "movie");
    const rented = data.find(
      (offer) => offer.kind === "rent" && offer.provider === "Lantern Video",
    )!;
    const bought = data.find((offer) => offer.kind === "buy")!;

    expect(rented.url).toBe("https://watch.example.invalid/title");
    expect(bought.url).toBe("https://watch.example.invalid/title/buy");
  });

  it("passes a plain link through unchanged", async () => {
    const { data } = await client(happyRouter().impl).getWatchOffers("tt0910111", "movie");
    const direct = data.find((offer) => offer.provider === "Coastline Store")!;

    expect(direct.url).toBe("https://example.invalid/coastline/blue-horizon");
  });

  it("hands out no tracker URLs at all", async () => {
    const { data } = await client(happyRouter().impl).getWatchOffers("tt0910111", "movie");

    for (const offer of data) {
      expect(offer.url, `${offer.provider} (${offer.kind})`).not.toContain("click.");
      expect(
        offer.url,
        "a tracker's analytics payload has no business reaching a model",
      ).not.toContain("cx=");
      expect((offer.url ?? "").length, `${offer.provider} link length`).toBeLessThan(200);
    }
  });

  it("contributes nothing for an empty group", async () => {
    const { data } = await client(happyRouter().impl).getWatchOffers("tt0910111", "movie");

    expect(data.some((offer) => offer.kind === "free")).toBe(false);
  });

  it("keys the request on the IMDb id", async () => {
    const fetch = happyRouter();
    await client(fetch.impl).getWatchOffers("tt0910111", "movie");

    expect(fetch.calls[0]!.url).toContain("tt0910111");
  });
});
