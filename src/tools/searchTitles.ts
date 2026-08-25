/**
 * search_titles: find an entry and its slug.
 *
 * Rows carry the critic Metascore, so the common question about the critical
 * verdict is answered in one call. They carry no audience score, because the
 * search route does not report one.
 */

import { z } from "zod";
import type { McClient } from "../mc/client.js";
import type { Kind } from "../types.js";
import { strictInput } from "./arguments.js";
import {
  ok,
  renderTitleList,
  titleSummarySchema,
  toTitleSummaryOut,
  toToolError,
  type ToolResult,
} from "./shared.js";

const WHITESPACE = /\s/;

export const searchTitlesDescription = [
  "Search Metacritic for films, shows and games by title.",
  "Returns one compact row per match, carrying the critic Metascore, so a question about the critical verdict needs no second call.",
  "Search rows carry no audience score: use get_title for that, or browse_titles, which does return it.",
  "Use the slug and kind with get_title for the full entry, or with get_reviews for what critics wrote.",
  "There is no paging: 'limit' is the only lever, and results always start from the most relevant match.",
  "This searches titles only. It cannot find an entry from a plot detail, a person or a studio.",
].join(" ");

export const searchTitlesInput = strictInput({
  query: z.string().min(1).describe("Title or part of one, for example 'the matrix'."),
  kind: z
    .enum(["movie", "show", "game", "any"])
    .default("any")
    .describe("Restrict results to one catalogue. Metacritic searches all three at once."),
  limit: z.number().int().min(1).max(50).default(10).describe("How many rows to return."),
});

export const searchTitlesOutputShape = {
  query: z.string(),
  results: z.array(titleSummarySchema),
  total_available: z
    .number()
    .int()
    .describe(
      "How many entries Metacritic counted. For a query of several words it counts entries " +
        "matching any one of them, so the number is far larger than the useful matches and should " +
        "not be read as a match count.",
    ),
  notes: z.array(z.string()),
};

export interface SearchTitlesArgs {
  query: string;
  kind: Kind | "any";
  limit: number;
}

export async function runSearchTitles(
  client: McClient,
  args: SearchTitlesArgs,
): Promise<ToolResult> {
  try {
    // The upstream search has no type filter, so a narrowed search must ask for
    // more rows than requested and filter here, or a kind with few matches would
    // come back empty while results exist further down the list.
    const upstreamLimit = args.kind === "any" ? args.limit : Math.min(50, args.limit * 3);
    const { data, cached } = await client.search(args.query, upstreamLimit, 0);

    const matching =
      args.kind === "any" ? data.titles : data.titles.filter((title) => title.kind === args.kind);
    const results = matching.slice(0, args.limit).map(toTitleSummaryOut);

    // Filtering by kind happens here, over a fixed upstream window, so the
    // ceiling is what that window held rather than what the catalogue holds.
    const windowExhausted = args.kind !== "any" && matching.length === results.length;

    const notes: string[] = [];
    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }

    // A query of several words is counted loosely upstream: "the matrix" reports
    // over 55 000 entries because it counts anything matching either word. Saying
    // "narrow the query" on the back of that number would be advice built on a
    // count that does not mean what it appears to mean.
    const looseCount = WHITESPACE.test(args.query.trim());
    if (looseCount) {
      notes.push(
        "Metacritic counts a multi-word query loosely, so total_available is far larger than the number of real matches. The rows themselves are ordered by relevance.",
      );
    } else if (data.totalResults > results.length) {
      notes.push(
        `${data.totalResults} entries matched and ${results.length} are shown. Raise 'limit' for more, or narrow the query: this tool cannot page.`,
      );
    }
    if (results.length === 0) {
      notes.push(
        args.kind === "any"
          ? "No entry matched. Metacritic matches on the title alone, so try a shorter fragment of it."
          : `No ${args.kind} matched. Other kinds may still match: call again with kind="any".`,
      );
    } else if (windowExhausted && results.length < args.limit) {
      notes.push(
        `Every ${args.kind} in the window Metacritic returned is shown. There may be more further down its ranking, which this tool cannot reach.`,
      );
    }

    const summary =
      results.length === 0
        ? `No Metacritic entry matched "${args.query}".`
        : `${results.length} entr${results.length === 1 ? "y" : "ies"} for "${args.query}":\n${renderTitleList(results)}`;

    return ok({ query: args.query, results, total_available: data.totalResults, notes }, summary, {
      notes,
    });
  } catch (error) {
    return toToolError(error);
  }
}
