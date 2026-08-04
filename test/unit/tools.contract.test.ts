/**
 * The contract as a client sees it, over a real MCP session.
 *
 * These tests drive the server through the protocol rather than calling the
 * tool functions, because what a model gets is the protocol's view: the tool
 * list, the schemas, the structured content and the error flag. Everything
 * upstream is a fixture, so a failure here is about this server's promises.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";
import {
  fixtureText,
  happyRouter,
  sequenceFetch,
  silentLogger,
  testConfig,
  type FakeFetch,
} from "./_helpers.js";

const EXPECTED_TOOLS = ["browse_titles", "get_reviews", "get_title", "search_titles"];

let client: Client;
let open: Array<() => Promise<void>> = [];

/** A live session against a server whose upstream is the given fetch. */
async function connect(fetch: FakeFetch): Promise<Client> {
  const server = createServer({
    config: testConfig(),
    logger: silentLogger,
    fetchImpl: fetch.impl,
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

beforeEach(async () => {
  open = [];
  client = await connect(happyRouter());
});

afterEach(async () => {
  await Promise.all(open.map((close) => close()));
});

/** Walks any structured payload, so a leak cannot hide in a nested field. */
function walk(value: unknown, visit: (node: any) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, visit);
    return;
  }
  if (value && typeof value === "object") {
    visit(value);
    for (const entry of Object.values(value)) walk(entry, visit);
  }
}

const textOf = (result: any): string =>
  (result.content ?? []).map((block: any) => block.text ?? "").join("\n");

describe("the tool list", () => {
  it("offers exactly the four tools, and no more", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
  });

  it("declares every tool read-only and non-destructive", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBe(true);
      expect(tool.annotations?.destructiveHint, `${tool.name} destructiveHint`).toBe(false);
    }
  });

  it("describes what each tool is for, in more than a few words", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.description ?? "", `${tool.name} description`).not.toBe("");
      expect((tool.description ?? "").length, `${tool.name} description`).toBeGreaterThan(40);
    }
  });

  it("gives every tool an object input schema, which is what a client can fill in", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.inputSchema.type, `${tool.name} inputSchema`).toBe("object");
      expect(Object.keys(tool.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  it("tells a client how the two scales differ, before any tool is called", async () => {
    const instructions = client.getInstructions() ?? "";

    expect(instructions).toContain("100");
    expect(instructions).toContain("10");
    expect(instructions.toLowerCase()).toContain("metacritic");
  });
});

describe("search_titles", () => {
  it("returns one compact row per match, with the slug a follow-up call needs", async () => {
    const result: any = await client.callTool({
      name: "search_titles",
      arguments: { query: "lantern" },
    });

    expect(result.isError).toBeFalsy();
    const rows = result.structuredContent.results;
    expect(rows.length).toBe(4);
    expect(rows[0].slug).toBe("blue-horizon");
    expect(rows[0].kind).toBe("movie");
    expect(rows[0].metascore).toBe(81);
    expect(rows[0].source_url).toContain("metacritic.com");
  });

  it("leaks none of the heavy fields the upstream row carries", async () => {
    const result: any = await client.callTool({
      name: "search_titles",
      arguments: { query: "lantern" },
    });

    const serialised = JSON.stringify(result);
    for (const leak of [
      "A lighthouse keeper counts the ships",
      "Neo-Noir",
      "1440x2160",
      "poster",
      "PlayStation 5",
      "__noise",
    ]) {
      expect(serialised, `"${leak}" must not reach the model`).not.toContain(leak);
    }
  });

  it("reports an absent audience score as null rather than as zero", async () => {
    const result: any = await client.callTool({
      name: "search_titles",
      arguments: { query: "lantern" },
    });

    for (const row of result.structuredContent.results) {
      expect(row.user_score, `${row.title}`).toBeNull();
    }
  });

  it("narrows to one kind when asked", async () => {
    const result: any = await client.callTool({
      name: "search_titles",
      arguments: { query: "lantern", kind: "game" },
    });

    const rows = result.structuredContent.results;
    expect(rows.map((row: any) => row.kind)).toEqual(["game"]);
  });

  it("says so in words when nothing matched, rather than returning an empty text", async () => {
    const empty = await connect(sequenceFetch([fixtureText("empty-items.json")]));
    const result: any = await empty.callTool({
      name: "search_titles",
      arguments: { query: "no-such-entry" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.results).toEqual([]);
    expect(textOf(result)).toMatch(/no metacritic entry matched/i);
  });
});

describe("get_title", () => {
  it("returns the entry with both scores, each carrying its own scale", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie" },
    });

    expect(result.isError).toBeFalsy();
    const { critic_score, user_score } = result.structuredContent;
    expect(critic_score.score).toBe(73);
    expect(critic_score.max).toBe(100);
    expect(user_score.score).toBe(8.9);
    expect(user_score.max).toBe(10);
  });

  it("puts both scores in the text with their scales, since many clients show only that", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie" },
    });

    const text = textOf(result);
    expect(text).toContain("73/100");
    expect(text).toContain("8.9/10");
    expect(text).toContain("Source: Metacritic");
  });

  it("takes the kind from the caller, so a game reads as a game", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "cinder-vale", kind: "game" },
    });

    expect(result.structuredContent.title.kind).toBe("game");
    expect(result.structuredContent.title.title).toBe("Cinder Vale");
  });

  it("returns the sections asked for and no others", async () => {
    const basic: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["basic"] },
    });
    const withProduction: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["basic", "production"] },
    });

    expect(basic.structuredContent.production).toBeUndefined();
    expect(withProduction.structuredContent.production[0].name).toBe("Nine Fathoms Pictures");
  });

  it("returns awards as one tally per ceremony when that section is asked for", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["basic", "awards"] },
    });

    const awards = result.structuredContent.awards;
    expect(awards).toHaveLength(3);
    expect(awards[0]).toEqual({ ceremony: "Torrance Film Prize", wins: 4, nominations: 8 });
    expect(awards[1].wins, "no win recorded is null, not zero").toBeNull();
  });

  it("returns a watch offer as a link that can be followed", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["where_to_watch"] },
    });

    const offers = result.structuredContent.where_to_watch;
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      expect(offer.url, `${offer.provider}: a tracking redirect is not a link`).not.toContain(
        "cx=",
      );
    }
    expect(offers.map((offer: any) => offer.url)).toContain("https://watch.example.invalid/title");
  });

  it("paginates a long description instead of cutting it off silently", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", max_chars: 200, offset: 0 },
    });

    const { truncated, next_offset, total_chars, returned_chars } = result.structuredContent;
    expect(total_chars).toBeGreaterThan(0);
    if (truncated) {
      expect(next_offset).toBeGreaterThan(0);
      expect(returned_chars).toBeLessThan(total_chars);
    } else {
      expect(next_offset).toBeNull();
    }
  });
});

describe("get_reviews", () => {
  const readReviews = (args: Record<string, unknown>) =>
    client.callTool({
      name: "get_reviews",
      arguments: { slug: "blue-horizon", kind: "movie", ...args },
    }) as Promise<any>;

  it("returns the sample with attribution on every quote", async () => {
    const result: any = await readReviews({});

    expect(result.isError).toBeFalsy();
    const reviews = result.structuredContent.reviews;
    expect(reviews.length).toBe(7);
    for (const review of reviews) {
      expect(review.publication, "an unattributable quote must not reach a model").toBeTruthy();
      expect(review.url).toContain("https://");
    }
  });

  it("slices the sample itself, because the route ignores limit", async () => {
    const result: any = await readReviews({ limit: 2 });

    expect(result.structuredContent.reviews.length).toBe(2);
    expect(result.structuredContent.next_offset).toBe(2);
  });

  it("slices from the offset given, and stops at the end of the sample", async () => {
    const result: any = await readReviews({ offset: 6, limit: 10 });

    expect(result.structuredContent.reviews.length, "one entry is left after six").toBe(1);
    expect(result.structuredContent.next_offset, "nothing follows the last entry").toBeNull();
  });

  it("returns nothing, and does not fail, for an offset past the end of the sample", async () => {
    const result: any = await readReviews({ offset: 99 });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.reviews).toEqual([]);
    expect(result.structuredContent.next_offset).toBeNull();
    expect(textOf(result)).toMatch(/no critic review/i);
  });

  it("says how many exist upstream, so the sample is not read as the whole list", async () => {
    const result: any = await readReviews({});

    expect(result.structuredContent.total_available).toBe(36);
    expect(result.structuredContent.notes.join(" ")).toContain("sample");
  });

  it("returns a different slice for each sentiment", async () => {
    const positive: any = await readReviews({ sentiment: "positive" });
    const negative: any = await readReviews({ sentiment: "negative" });

    expect(positive.structuredContent.reviews.length).toBe(4);
    expect(negative.structuredContent.reviews.length).toBe(1);
    expect(positive.structuredContent.reviews[0].quote).not.toBe(
      negative.structuredContent.reviews[0].quote,
    );
  });

  it("reads user reviews on the ten-point scale", async () => {
    const result: any = await readReviews({ source: "user" });

    for (const review of result.structuredContent.reviews) {
      expect(review.max).toBe(10);
    }
  });

  it("reads critic reviews on the hundred-point scale", async () => {
    const result: any = await readReviews({ source: "critic" });

    for (const review of result.structuredContent.reviews) {
      expect(review.max).toBe(100);
    }
  });
});

describe("browse_titles", () => {
  it("returns rows with the audience score browse rows carry", async () => {
    const result: any = await client.callTool({
      name: "browse_titles",
      arguments: { kind: "movie", sort: "score" },
    });

    expect(result.isError).toBeFalsy();
    const rows = result.structuredContent.results;
    expect(rows[0].user_score).toBe(8.8);
    expect(rows[0].metascore).toBe(81);
  });

  it("pages by what the site sent", async () => {
    const result: any = await client.callTool({
      name: "browse_titles",
      arguments: { kind: "movie", sort: "score", limit: 3, offset: 0 },
    });

    expect(result.structuredContent.offset).toBe(0);
    expect(result.structuredContent.next_offset).toBe(3);
  });

  it("stops paging when the page is shorter than the limit", async () => {
    const result: any = await client.callTool({
      name: "browse_titles",
      arguments: { kind: "movie", sort: "score", limit: 20, offset: 0 },
    });

    expect(result.structuredContent.next_offset).toBeNull();
  });
});

describe("every score that reaches a model", () => {
  it("carries the scale it is on, in every tool's output", async () => {
    const results = await Promise.all([
      client.callTool({ name: "search_titles", arguments: { query: "lantern" } }),
      client.callTool({ name: "get_title", arguments: { slug: "blue-horizon", kind: "movie" } }),
      client.callTool({
        name: "get_reviews",
        arguments: { slug: "blue-horizon", kind: "movie" },
      }),
      client.callTool({ name: "browse_titles", arguments: { kind: "movie", sort: "score" } }),
    ]);

    let checked = 0;
    for (const result of results as any[]) {
      walk(result.structuredContent, (node) => {
        if ("score" in node && node.score !== null && node.score !== undefined) {
          expect(typeof node.max, `a score of ${node.score} with no max`).toBe("number");
          expect(node.max, `a score of ${node.score} on a zero scale`).toBeGreaterThan(0);
          checked += 1;
        }
      });
    }

    expect(checked, "no score was found to check").toBeGreaterThan(0);
  });

  it("keeps the row scores under the names that say which scale they are on", async () => {
    const result: any = await client.callTool({
      name: "browse_titles",
      arguments: { kind: "movie", sort: "score" },
    });

    for (const row of result.structuredContent.results) {
      if (row.metascore !== null) expect(row.metascore).toBeGreaterThan(10);
      if (row.user_score !== null) expect(row.user_score).toBeLessThanOrEqual(10);
    }
  });
});

describe("a failure a model can act on", () => {
  it("flags an unknown slug as an error and names the code in the text", async () => {
    const missing = await connect(
      sequenceFetch([{ status: 404, body: fixtureText("error-404.json") }]),
    );

    const result: any = await missing.callTool({
      name: "get_title",
      arguments: { slug: "no-such-film", kind: "movie" },
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("not_found");
    expect(text).toContain("search_titles");
    expect(result.structuredContent, "an error payload satisfies no output schema").toBeUndefined();
  });

  it("reports a shape it cannot read as parse_failure, never as an empty result", async () => {
    const broken = await connect(sequenceFetch([fixtureText("no-envelope.json")]));

    const result: any = await broken.callTool({
      name: "search_titles",
      arguments: { query: "blue horizon" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("parse_failure");
    expect(textOf(result)).not.toMatch(/no entry matched/i);
  });

  it("reports throttling as throttling, so a model does not conclude the title is missing", async () => {
    const throttled = await connect(sequenceFetch([{ status: 429, body: "slow down" }]));

    const result: any = await throttled.callTool({
      name: "search_titles",
      arguments: { query: "blue horizon" },
    });

    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("rate_limited");
    expect(text).not.toContain("not_found");
  });

  it("refuses an argument that is not in the schema before any request is made", async () => {
    const fetch = happyRouter();
    const strict = await connect(fetch);

    const result: any = await strict.callTool({
      name: "get_reviews",
      arguments: { slug: "", kind: "movie" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/validation|invalid/i);
    expect(fetch.calls, "an invalid call must not reach the site").toHaveLength(0);
  });

  it("keeps the text mirror in step with the structured content", async () => {
    const result: any = await client.callTool({
      name: "search_titles",
      arguments: { query: "lantern" },
    });

    const text = textOf(result);
    for (const row of result.structuredContent.results) {
      expect(text, `${row.title} is in the structured rows`).toContain(row.title);
      expect(text).toContain(row.slug);
    }
    expect(text).toContain("Source: Metacritic");
  });
});
