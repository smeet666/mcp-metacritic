/**
 * What a count in an answer is a count of.
 *
 * Metacritic publishes a total beside a page of rows, and a caller reads that
 * number to decide whether the list is the whole of what exists. A page whose
 * total the site left out carries no such number, and the rows on it count the
 * page rather than the catalogue.
 */

import { describe, expect, it } from "vitest";
import { parseCriticReviews, parseScore, parseTitlePage } from "../../src/mc/parse.js";
import {
  fixtureJson,
  fixtureText,
  fixtureRouter,
  ROUTE,
  silentLogger,
  testConfig,
} from "./_helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

const url = "https://backend.metacritic.com/x";

function withoutTotal(name: string): string {
  const page = fixtureJson(name);
  const { totalResults: _dropped, ...rest } = page.data;
  return JSON.stringify({ ...page, data: rest });
}

describe("a page the site published no total for", () => {
  it("carries no total rather than the number of rows on it", () => {
    const page = parseTitlePage(withoutTotal("search.json"), url, "a search");

    expect(
      page.totalResults,
      "the rows on one page are not a count of what the catalogue holds",
    ).toBeNull();
    expect(page.titles.length).toBeGreaterThan(0);
  });

  it("carries no total for reviews either", () => {
    const parsed = parseCriticReviews(
      withoutTotal("reviews-critic.json"),
      url,
      "critic reviews",
      "all",
    );

    expect(parsed.totalResults).toBeNull();
    expect(parsed.reviews.length).toBeGreaterThan(0);
  });
});

describe("a score the dedicated route publishes", () => {
  it("keeps a zero the site put review counts behind", () => {
    const page = fixtureJson("score-critic.json");
    page.data.item = { ...page.data.item, score: 0, reviewCount: 7 };

    const summary = parseScore(JSON.stringify(page), url, "a critic score");

    expect(
      summary.score,
      "this route answers 404 for an entry with no score, so a zero here is one",
    ).toBe(0);
  });
});

describe("a search narrowed to one kind", () => {
  it("says the count covers every kind the query matched", async () => {
    const server = createServer({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: fixtureRouter([[ROUTE.search, fixtureText("search.json")]]).impl,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result: any = await client.callTool({
      name: "search_titles",
      arguments: { query: "lantern", kind: "movie" },
    });

    expect(
      result.structuredContent.notes.join(" "),
      "a caller reads that number as the number of films",
    ).toContain("counts every kind");

    await client.close();
    await server.close();
  });
});
