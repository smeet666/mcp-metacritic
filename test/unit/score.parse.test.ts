/**
 * Score documents.
 *
 * One rule runs through all of these: a score travels with the scale it is on.
 * Critic scores run to 100 and audience scores to 10, so a bare 8.9 next to a
 * bare 73 invites an answer that is wrong by an order of magnitude, and a `max`
 * filled in by assumption is worse than none at all.
 */

import { describe, expect, it } from "vitest";
import { McClient } from "../../src/mc/client.js";
import {
  constantFetch,
  expectMcError,
  fixtureText,
  happyRouter,
  ROUTE,
  silentLogger,
  testConfig,
} from "./_helpers.js";

const client = (fetchImpl: typeof fetch) =>
  new McClient({ config: testConfig(), logger: silentLogger, fetchImpl });

describe("critic score", () => {
  it("comes back out of 100, as the response says", async () => {
    const { data } = await client(happyRouter().impl).getScore("movie", "blue-horizon", "critic");

    expect(data.score).toBe(73);
    expect(data.max).toBe(100);
  });

  it("carries the breakdown behind the number", async () => {
    const { data } = await client(happyRouter().impl).getScore("movie", "blue-horizon", "critic");

    expect(data.reviewCount).toBe(36);
    expect(data.positiveCount).toBe(30);
    expect(data.neutralCount).toBe(5);
    expect(data.negativeCount).toBe(1);
    expect(data.sentiment).toBe("Generally favorable");
  });
});

describe("user score", () => {
  it("comes back out of 10, with its decimal intact", async () => {
    const { data } = await client(happyRouter().impl).getScore("movie", "blue-horizon", "user");

    expect(data.score).toBe(8.9);
    expect(data.max).toBe(10);
  });

  it("is fetched from the user route rather than the critic one", async () => {
    const fetch = happyRouter();
    await client(fetch.impl).getScore("movie", "blue-horizon", "user");

    expect(fetch.calls[0]!.url).toContain(ROUTE.userScore);
    expect(fetch.calls[0]!.url).not.toContain(ROUTE.criticScore);
  });
});

describe("a score that cannot be trusted", () => {
  it("raises parse_failure when the document carries no max, rather than assuming one", async () => {
    const fetchImpl = constantFetch(fixtureText("score-no-max.json")).impl;

    await expectMcError(
      () => client(fetchImpl).getScore("movie", "blue-horizon", "critic"),
      "parse_failure",
    );
  });

  it("raises not_found for an entry with no score document at all", async () => {
    const fetchImpl = constantFetch({ body: fixtureText("error-404.json"), status: 404 }).impl;

    await expectMcError(
      () => client(fetchImpl).getScore("movie", "unreleased-film", "critic"),
      "not_found",
    );
  });

  it("raises parse_failure on an unrecognised envelope", async () => {
    await expectMcError(
      () =>
        client(constantFetch(fixtureText("no-envelope.json")).impl).getScore(
          "movie",
          "blue-horizon",
          "critic",
        ),
      "parse_failure",
    );
  });
});

describe("the two scales side by side", () => {
  it("never reports the two scores on the same scale", async () => {
    const fetchImpl = happyRouter().impl;
    const instance = client(fetchImpl);

    const critic = await instance.getScore("movie", "blue-horizon", "critic");
    const user = await instance.getScore("movie", "blue-horizon", "user");

    expect(critic.data.max).toBe(100);
    expect(user.data.max).toBe(10);
    expect(critic.data.max).not.toBe(user.data.max);
  });
});
