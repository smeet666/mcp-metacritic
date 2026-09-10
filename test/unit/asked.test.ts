/**
 * What a tool serves against what it was asked for.
 *
 * Metacritic sizes its own page, and it answers a request for three rows with
 * as many as it cares to send. A caller who asked for three and reads twenty is
 * paying for seventeen it did not want, and paging from that answer lands
 * wherever the site decided rather than where the caller stopped reading.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";
import { ROUTE, fixtureJson, fixtureRouter, silentLogger, testConfig } from "./_helpers.js";

let open: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(open.map((close) => close()));
  open = [];
});

/** The listing fixture, grown to more rows than a caller will ask for. */
function longListing(rows: number): string {
  const page = fixtureJson("browse.json");
  const first = page.data.items[0];
  page.data.items = Array.from({ length: rows }, (_unused, index) => ({
    ...first,
    id: 3_000_000 + index,
    slug: `entry-${index}`,
    title: `Entry ${index}`,
  }));
  return JSON.stringify(page);
}

async function connect(listing: string): Promise<Client> {
  const server = createServer({
    config: testConfig(),
    logger: silentLogger,
    fetchImpl: fixtureRouter([[ROUTE.browse, listing]]).impl,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  open.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe("a listing page longer than the rows asked for", () => {
  it("serves the number asked for", async () => {
    const client = await connect(longListing(24));

    const result: any = await client.callTool({
      name: "browse_titles",
      arguments: { kind: "movie", sort: "score", limit: 3 },
    });

    expect(result.structuredContent.results).toHaveLength(3);
  });

  it("pages from where the caller stopped reading", async () => {
    const client = await connect(longListing(24));

    const result: any = await client.callTool({
      name: "browse_titles",
      arguments: { kind: "movie", sort: "score", limit: 3, offset: 0 },
    });

    expect(
      result.structuredContent.next_offset,
      "paging past what was served skips the rows the site sent and nobody read",
    ).toBe(3);
  });
});

describe("a viewer's review", () => {
  it("carries no attribution fields the site publishes none of", async () => {
    const server = createServer({
      config: testConfig(),
      logger: silentLogger,
      fetchImpl: fixtureRouter([
        [ROUTE.userReviews, JSON.stringify(fixtureJson("reviews-user.json"))],
      ]).impl,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    open.push(async () => {
      await client.close();
      await server.close();
    });

    const result: any = await client.callTool({
      name: "get_reviews",
      arguments: { slug: "blue-horizon", kind: "movie", source: "user" },
    });

    const review = result.structuredContent.reviews[0];
    expect(review, "the fixture carries a review").toBeDefined();
    for (const key of ["publication", "author", "url"]) {
      expect(
        review,
        `${key} belongs to a critic's review, and a null here reads as a viewer nobody credited`,
      ).not.toHaveProperty(key);
    }
  });
});
