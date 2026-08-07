/**
 * What happens to an argument no tool declares.
 *
 * A caller who mistypes an argument name, or qualifies one this server keeps
 * plain, must be told. An argument that is read and dropped leaves the answer
 * computed on a default, which reads as an answer to the question that was
 * asked and is not one.
 *
 * Everything here goes over the protocol, because the refusal is the server's
 * answer to a client rather than an internal check.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";
import { happyRouter, silentLogger, testConfig } from "./_helpers.js";

/** One valid call per tool, so a refusal is never mistaken for a broken tool. */
const CALLS: Array<[string, Record<string, unknown>]> = [
  ["search_titles", { query: "lantern" }],
  ["get_title", { slug: "blue-horizon", kind: "movie" }],
  ["get_reviews", { slug: "blue-horizon", kind: "movie" }],
  ["browse_titles", { kind: "movie", sort: "score" }],
];

async function connect(): Promise<Client> {
  const server = createServer({
    config: testConfig(),
    logger: silentLogger,
    fetchImpl: happyRouter().impl,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "unknown-arguments", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

interface CallResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
}

/** What a caller receives: whether the call failed, and what it was told. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  const result = (await client.callTool({ name, arguments: args })) as CallResult;
  return {
    isError: result.isError === true,
    text: (result.content ?? []).map((part) => part.text ?? "").join("\n"),
  };
}

describe("the schema a client reads before calling", () => {
  it("says on every tool that an argument it does not declare is refused", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(CALLS.length);
    for (const tool of tools) {
      expect(
        (tool.inputSchema as { additionalProperties?: unknown }).additionalProperties,
        tool.name,
      ).toBe(false);
    }
  });
});

describe("an argument no tool declares", () => {
  it("is refused by every tool, and the refusal names it", async () => {
    const client = await connect();
    for (const [name, args] of CALLS) {
      const result = await call(client, name, { ...args, not_an_argument: 1 });
      expect(result.isError, name).toBe(true);
      expect(result.text, name).toContain("not_an_argument");
    }
  });

  it("is refused under the code the caller can branch on", async () => {
    const client = await connect();
    const result = await call(client, "search_titles", { query: "lantern", not_an_argument: 1 });
    expect(result.text).toContain("invalid_input");
  });

  it("is answered with the declared name when one is a misspelling of it", async () => {
    const client = await connect();
    // "limt" is one substitution away from "limit", the only declared name it is close to.
    const result = await call(client, "search_titles", { query: "lantern", limt: 3 });
    expect(result.text).toContain("did you mean 'limit'");
  });

  it("is answered with the declared name when the given one is a substring of it", async () => {
    const client = await connect();
    // "chars" is what "max_chars" ends with, and no other declared name of get_title
    // shares three or more characters with it in that position.
    const result = await call(client, "get_title", {
      slug: "blue-horizon",
      kind: "movie",
      chars: 500,
    });
    expect(result.text).toContain("did you mean 'max_chars'");
  });

  it("lists the names the tool does take", async () => {
    const client = await connect();
    const result = await call(client, "browse_titles", {
      kind: "movie",
      sort: "score",
      topic: "x",
    });
    expect(result.text).toContain("This tool takes: kind, sort, genre, limit, offset.");
  });

  it("leaves the arguments a tool does declare working", async () => {
    const client = await connect();
    for (const [name, args] of CALLS) {
      const result = await call(client, name, args);
      expect(result.isError, `${name}: ${result.text}`).toBe(false);
    }
  });
});
