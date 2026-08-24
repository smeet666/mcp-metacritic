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
  fixtureRouter,
  fixtureText,
  happyRouter,
  ROUTE,
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
    for (const entry of value) {
      walk(entry, visit);
    }
    return;
  }
  if (value && typeof value === "object") {
    visit(value);
    for (const entry of Object.values(value)) {
      walk(entry, visit);
    }
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

  it("gates the payload on the sections asked for: scores alone carries no entry text", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["scores"] },
    });

    const out = result.structuredContent;
    expect(out.description, "description belongs to 'basic'").toBeNull();
    expect(out.genres).toEqual([]);
    expect(out.duration_minutes).toBeNull();
    expect(out.imdb_id).toBeNull();
    expect(out.total_chars).toBe(0);
    expect(out.critic_score.score, "the section that was asked for is still served").toBe(73);
  });

  it("returns no score when scores were not asked for, and says the absence means nothing", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["basic"] },
    });

    const out = result.structuredContent;
    expect(out.critic_score).toBeNull();
    expect(out.user_score).toBeNull();
    expect(out.description, "'basic' is what carries the entry text").toBeTruthy();

    const notes = out.notes.join(" ");
    expect(notes, "a null the caller would read as 'Metacritic publishes none'").toContain(
      "not requested",
    );
    expect(notes).toContain("sections");
  });

  it("keeps networks and production as separate sections", async () => {
    const production: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["production"] },
    });
    const networks: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["networks"] },
    });

    expect(production.structuredContent.production).toBeDefined();
    expect(production.structuredContent.networks, "networks was not asked for").toBeUndefined();
    expect(networks.structuredContent.networks).toBeDefined();
    expect(networks.structuredContent.production, "production was not asked for").toBeUndefined();
  });

  it("does not report a failed score request as an absence of scores", async () => {
    const brokenScores = await connect(
      fixtureRouter([
        [ROUTE.criticScore, { status: 500, body: "boom" }],
        [ROUTE.userScore, { status: 500, body: "boom" }],
        [ROUTE.detailMovie, fixtureText("detail-movie.json")],
      ]),
    );

    const result: any = await brokenScores.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["basic", "scores"] },
    });

    expect(result.isError, "the entry itself was read, so this is not a failed call").toBeFalsy();
    expect(result.structuredContent.critic_score).toBeNull();

    const notes = result.structuredContent.notes.join(" ");
    expect(notes, "an unread score is not a published absence").not.toMatch(
      /publishes no (critic|user) score/i,
    );
    expect(notes, "the note names the failure").toContain("could not be read");
    expect(notes).toContain("network_error");
    expect(notes, "and says what that does not mean").toContain("rather than absent");
  });

  it("does report a genuinely missing score as an absence", async () => {
    const noScores = await connect(
      fixtureRouter([
        [ROUTE.criticScore, { status: 404, body: fixtureText("error-404.json") }],
        [ROUTE.userScore, { status: 404, body: fixtureText("error-404.json") }],
        [ROUTE.detailMovie, fixtureText("detail-movie.json")],
      ]),
    );

    const result: any = await noScores.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["scores"] },
    });

    const notes = result.structuredContent.notes.join(" ");
    expect(notes).toMatch(/publishes no critic score/i);
    expect(notes).not.toContain("could not be read");
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

  it("blames the offset, not the filter, when the offset ran off the end", async () => {
    const beyond: any = await readReviews({ sentiment: "positive", offset: 20 });
    const fromTheStart: any = await readReviews({ sentiment: "positive", offset: 0 });

    expect(fromTheStart.structuredContent.reviews.length, "the slice is not empty").toBe(4);
    expect(beyond.structuredContent.reviews).toEqual([]);

    const note = beyond.structuredContent.notes.join(" ");
    expect(note, "the offset is what ran out").toContain("offset=20");
    expect(note, "call again from the start").toContain("offset=0");
    expect(
      note,
      "saying no positive review is published would contradict the same call at offset 0",
    ).not.toMatch(/publishes no positive review/i);
  });

  it("says how many exist upstream, so what it serves is not read as the whole list", async () => {
    const result: any = await readReviews({});

    const { total_available, reviews, notes, source_url } = result.structuredContent;
    expect(total_available).toBe(36);

    const note = notes.find((entry: string) => entry.includes(String(total_available)))!;
    expect(note, "no note reconciles the total with what came back").toBeTruthy();
    expect(note, "the note states how many were served").toContain(String(reviews.length));
    expect(note, "and points at where the rest are").toContain(source_url);
  });

  it("does not describe a sentiment slice as the whole entry's count", async () => {
    const result: any = await readReviews({ sentiment: "negative" });

    const { total_available, reviews, notes } = result.structuredContent;
    expect(reviews.length).toBe(1);
    expect(total_available, "the total counts the entry, not the slice").toBe(36);

    const note = notes.find((entry: string) => entry.includes(String(total_available)))!;
    expect(note, "a slice must be named as a slice").toContain("negative");
    expect(note, "serving one of a slice is not serving zero").not.toMatch(/\b0\b/);
  });

  it("carries the entry page, so a review with no article link can still be cited", async () => {
    const result: any = await readReviews({});

    expect(result.structuredContent.source_url).toBe(
      "https://www.metacritic.com/movie/blue-horizon/",
    );
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

describe("the text mirror", () => {
  /** A server whose critic reviews are long enough to overrun the mirror budget. */
  const withLongQuotes = () =>
    connect(
      fixtureRouter([
        [ROUTE.criticReviews, fixtureText("reviews-critic-long.json")],
        [ROUTE.detailMovie, fixtureText("detail-movie.json")],
      ]),
    );

  it("keeps its attribution when the body is far too long to fit", async () => {
    const long = await withLongQuotes();

    const result: any = await long.callTool({
      name: "get_reviews",
      arguments: { slug: "blue-horizon", kind: "movie", limit: 50 },
    });

    const text = textOf(result);
    expect(
      text.length,
      "the whole block, trailer included, stays within budget",
    ).toBeLessThanOrEqual(2000);
    expect(text.length, "this test is pointless if the body fitted anyway").toBeGreaterThan(1500);
    expect(
      text.trimEnd().split("\n").at(-1)?.startsWith("Source: Metacritic"),
      "the credit is the line that must survive",
    ).toBe(true);
  });

  it("says it was shortened, since a text-only client cannot see what is missing", async () => {
    const long = await withLongQuotes();

    const result: any = await long.callTool({
      name: "get_reviews",
      arguments: { slug: "blue-horizon", kind: "movie", limit: 50 },
    });

    const text = textOf(result);
    expect(text).toContain("shortened");
    expect(
      result.structuredContent.reviews.length,
      "the structured output keeps every row the text had to drop",
    ).toBe(5);
  });

  it("gives get_title's mirror the entry URL alongside the credit", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie" },
    });

    const text = textOf(result);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text.endsWith("https://www.metacritic.com/movie/blue-horizon/")).toBe(true);
    expect(text).toContain("Source: Metacritic");
  });

  it("carries the notes into the text, not only into the structured payload", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "cinder-vale", kind: "game", sections: ["where_to_watch"] },
    });

    const text = textOf(result);
    expect(result.structuredContent.where_to_watch).toEqual([]);
    // Without the reason, "nothing listed" reads as "nothing streams it".
    for (const note of result.structuredContent.notes as string[]) {
      expect(text, `note missing from the mirror: ${note}`).toContain(note);
    }
    expect(text).toContain("Where to watch");
  });

  it("renders every section it was asked for, production included", async () => {
    const result: any = await client.callTool({
      name: "get_title",
      arguments: { slug: "blue-horizon", kind: "movie", sections: ["production"] },
    });

    const text = textOf(result);
    for (const company of result.structuredContent.production as Array<{ name: string }>) {
      expect(text, `company missing from the mirror: ${company.name}`).toContain(company.name);
    }
  });

  it("indents third-party quotes so they cannot read as the server's own words", async () => {
    const long = await withLongQuotes();

    const result: any = await long.callTool({
      name: "get_reviews",
      arguments: { slug: "blue-horizon", kind: "movie", limit: 1 },
    });

    const quote = result.structuredContent.reviews[0].quote as string;
    const text = textOf(result);
    expect(quote, "this fixture quote spans blank lines on purpose").toContain("\n");
    for (const line of quote.split("\n")) {
      expect(text, `quote line: ${JSON.stringify(line)}`).toContain(`   ${line}`);
    }
  });

  it("ends every review line with the article it came from", async () => {
    const long = await withLongQuotes();

    const result: any = await long.callTool({
      name: "get_reviews",
      arguments: { slug: "blue-horizon", kind: "movie", limit: 1 },
    });

    const review = result.structuredContent.reviews[0];
    expect(review.url).toBe("https://example.invalid/harbour/blue-horizon");
    expect(textOf(result)).toContain(`   ${review.url}`);
  });

  it("falls back to the entry page for a review with no article link", async () => {
    const long = await withLongQuotes();

    const result: any = await long.callTool({
      name: "get_reviews",
      arguments: { slug: "blue-horizon", kind: "movie", offset: 4, limit: 1 },
    });

    const review = result.structuredContent.reviews[0];
    expect(review.url, "the fixture entry carries no link").toBeNull();
    expect(textOf(result), "a quote with nowhere to point still points somewhere").toContain(
      `   ${result.structuredContent.source_url}`,
    );
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

    // Collected rather than counted: a closure written in a loop must not
    // carry a binding the loop reassigns.
    const checked: unknown[] = [];
    for (const result of results as any[]) {
      walk(result.structuredContent, (node) => {
        if ("score" in node && node.score !== null && node.score !== undefined) {
          expect(typeof node.max, `a score of ${node.score} with no max`).toBe("number");
          expect(node.max, `a score of ${node.score} on a zero scale`).toBeGreaterThan(0);
          checked.push(node.score);
        }
      });
    }

    expect(checked.length, "no score was found to check").toBeGreaterThan(0);
  });

  it("keeps the row scores under the names that say which scale they are on", async () => {
    const result: any = await client.callTool({
      name: "browse_titles",
      arguments: { kind: "movie", sort: "score" },
    });

    for (const row of result.structuredContent.results) {
      if (row.metascore !== null) {
        expect(row.metascore).toBeGreaterThan(10);
      }
      if (row.user_score !== null) {
        expect(row.user_score).toBeLessThanOrEqual(10);
      }
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
