/**
 * What get_title says about an entry whose page is thin.
 *
 * Metacritic publishes a full page for a well-known film and a sparse one for
 * everything else, and the sparse cases are where an answer is tempted to fill
 * a gap. Each case here holds one of those gaps to a statement the page
 * supports: a ceremony recording no win says nothing about wins, an entry with
 * no IMDb id cannot be keyed to a streaming offer, and a title already carrying
 * its year is not given a second one.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";
import {
  ROUTE,
  fixtureJson,
  fixtureRouter,
  fixtureText,
  silentLogger,
  testConfig,
} from "./_helpers.js";

let open: Array<() => Promise<void>> = [];

/** The entry page, with the fields a test is about replaced. */
function detailWith(over: Record<string, unknown>): string {
  const page = fixtureJson("detail-movie.json");
  page.data.item = { ...page.data.item, ...over };
  return JSON.stringify(page);
}

async function connectTo(detail: string, offers = fixtureText("offers.json")): Promise<Client> {
  const server = createServer({
    config: testConfig(),
    logger: silentLogger,
    fetchImpl: fixtureRouter([
      [ROUTE.detailMovie, detail],
      [ROUTE.criticScore, fixtureText("score-critic.json")],
      [ROUTE.userScore, fixtureText("score-user.json")],
      [ROUTE.offers, offers],
    ]).impl,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const instance = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([instance.connect(clientTransport), server.connect(serverTransport)]);
  open.push(async () => {
    await instance.close();
    await server.close();
  });
  return instance;
}

afterEach(async () => {
  await Promise.all(open.map((close) => close()));
  open = [];
});

const textOf = (result: any): string => result.content.map((part: any) => part.text).join("\n");

describe("an entry page that records less than a full one", () => {
  it("leaves a tally out of a ceremony rather than writing it as none", async () => {
    const client = await connectTo(
      detailWith({
        awards: [
          { awardEvent: "Harbour Guild Awards", wins: null, nominations: null },
          { awardEvent: "Torrance Film Prize", wins: 1, nominations: 1 },
        ],
      }),
    );

    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["awards"] },
    });

    const text = textOf(result);
    expect(text, "a ceremony the page gives no number for carries no number").toContain(
      "Harbour Guild Awards",
    );
    expect(text).not.toMatch(/Harbour Guild Awards: 0/);
    expect(text, "one win reads as one win").toContain("Torrance Film Prize: 1 win, 1 nomination");
  });

  it("says an entry with no IMDb id cannot be keyed to a streaming offer", async () => {
    const client = await connectTo(detailWith({ imdbId: null }));

    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["where_to_watch"] },
    });

    expect(
      result.structuredContent.notes.join(" "),
      "an empty list on its own would read as a film nobody streams",
    ).toContain("no IMDb id");
  });

  it("credits no company rather than leaving the line to be read as unasked", async () => {
    const client = await connectTo(detailWith({ production: { companies: [] } }));

    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["production"] },
    });

    expect(textOf(result)).toContain("Production: no company credited.");
  });

  it("appends no year to a title that already carries one", async () => {
    const client = await connectTo(
      detailWith({ title: "Blue Horizon (2011)", premiereYear: 2011 }),
    );

    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["basic"] },
    });

    expect(textOf(result)).not.toContain("Blue Horizon (2011) (2011)");
  });
});
