/**
 * browse_titles: rankings and release lists.
 *
 * This is the tool that answers "best horror films" or "highest rated games",
 * questions a search box cannot serve because the caller has no title in mind.
 */

import { z } from "zod";
import type { McClient, Sort } from "../mc/client.js";
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

export const browseTitlesDescription = [
  "List films, shows or games by score, by release date or by current popularity.",
  "Use this when there is no specific title to look up: best rated, newest, what people are looking at now.",
  "Filter by genre with a single name such as Horror, Comedy or Action.",
  "Sorting by score returns the all-time ranking, which is dominated by older titles: combine with a genre to narrow it.",
  "Scores come back on their own scales, 100 for critics and 10 for users.",
  "Paging is approximate: Metacritic does not order tied entries stably, so an entry can appear on two consecutive pages. Deduplicate by slug rather than counting rows.",
].join(" ");

export const browseTitlesInput = strictInput({
  kind: z.enum(["movie", "show", "game"]).default("movie").describe("Which catalogue to list."),
  sort: z
    .enum(["score", "recent", "popular"])
    .default("score")
    .describe(
      "'score' is the critic ranking, 'recent' is by release date, 'popular' is current attention.",
    ),
  genre: z.string().optional().describe("Single genre name, such as Horror. Omit for all genres."),
  limit: z.number().int().min(1).max(50).default(20).describe("How many rows to return."),
  offset: z.number().int().min(0).default(0).describe("How many rows to skip, for paging."),
});

export const browseTitlesOutputShape = {
  kind: z.string(),
  sort: z.string(),
  genre: z.string().nullable(),
  results: z.array(titleSummarySchema),
  total_available: z
    .number()
    .int()
    .describe("How many entries match upstream, which is the size of what this samples."),
  offset: z.number().int(),
  next_offset: z
    .number()
    .int()
    .nullable()
    .describe(
      "Pass as 'offset' for the next page. Tied entries are not ordered stably upstream, so " +
        "deduplicate by slug across pages.",
    ),
  notes: z.array(z.string()),
};

export interface BrowseTitlesArgs {
  kind: Kind;
  sort: Sort;
  genre?: string;
  limit: number;
  offset: number;
}

export async function runBrowseTitles(
  client: McClient,
  args: BrowseTitlesArgs,
): Promise<ToolResult> {
  try {
    const { data, cached } = await client.browse({
      kind: args.kind,
      sort: args.sort,
      ...(args.genre ? { genre: args.genre } : {}),
      limit: args.limit,
      offset: args.offset,
    });

    const results = data.titles.map(toTitleSummaryOut);
    const notes: string[] = [];
    if (cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }
    if (results.length === 0) {
      notes.push(
        args.genre
          ? `No ${args.kind} matched the genre "${args.genre}" at this offset. Check the spelling, or drop the genre.`
          : "The listing returned no rows at this offset.",
      );
    }
    if (data.itemCount > data.titles.length) {
      notes.push(
        `${data.itemCount - data.titles.length} entries on this page could not be read and were skipped.`,
      );
    }

    // A short page is the end-of-list signal, judged on what the site sent
    // rather than on what could be read, since its offset counts entries.
    const nextOffset = data.itemCount < args.limit ? null : args.offset + data.itemCount;

    const heading = [
      args.genre ? `${args.genre} ` : "",
      `${args.kind}s`,
      args.sort === "score"
        ? " by critic score"
        : args.sort === "recent"
          ? " by release date"
          : " by current popularity",
    ].join("");

    const summary =
      results.length === 0
        ? `No rows for ${heading}.`
        : `${results.length} of ${data.totalResults} ${heading}:\n${renderTitleList(results)}`;

    return ok(
      {
        kind: args.kind,
        sort: args.sort,
        genre: args.genre ?? null,
        results,
        total_available: data.totalResults,
        offset: args.offset,
        next_offset: nextOffset,
        notes,
      },
      summary,
      { notes },
    );
  } catch (error) {
    return toToolError(error);
  }
}
