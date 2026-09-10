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

async function connectTo(
  detail: string,
  over: { offers?: string; failing?: string; status?: number } = {},
): Promise<Client> {
  const routes: [string, string][] = [
    [ROUTE.detailMovie, detail],
    [ROUTE.criticScore, fixtureText("score-critic.json")],
    [ROUTE.userScore, fixtureText("score-user.json")],
    [ROUTE.offers, over.offers ?? fixtureText("offers.json")],
  ];
  const router = fixtureRouter(routes);
  const failing = over.failing;
  const server = createServer({
    config: testConfig(),
    logger: silentLogger,
    fetchImpl: failing
      ? async (url: any, init: any) => {
          if (String(url).includes(failing)) {
            return new Response("upstream said no", { status: over.status ?? 503 });
          }
          return router.impl(url, init);
        }
      : router.impl,
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

describe("a route this server could not read", () => {
  it("leaves where_to_watch out rather than answering with an empty list", async () => {
    const client = await connectTo(detailWith({}), { failing: ROUTE.offers });

    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["where_to_watch"] },
    });

    const out = result.structuredContent;
    expect(
      out,
      "an empty list states Metacritic lists no offer, which this read never established",
    ).not.toHaveProperty("where_to_watch");
    expect(out.notes.join(" ")).toContain("could not be read");
  });

  it("does not call a score absent while publishing the number from the entry page", async () => {
    const client = await connectTo(detailWith({}), {
      failing: ROUTE.criticScore,
      status: 404,
    });

    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["scores"] },
    });

    const out = result.structuredContent;
    expect(out.title.metascore, "the entry page carries the number").not.toBeNull();
    expect(
      out.notes.join(" "),
      "the same payload cannot carry a number and call it absent",
    ).not.toMatch(/publishes no critic score for this entry\./);
  });
});

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
