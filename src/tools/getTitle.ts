/**
 * get_title: read one entry, section by section.
 *
 * The detail response runs to 46 KB for a film, so sections are opt-in and the
 * default pair answers the question people actually ask: what is this, and is
 * it any good.
 */

import { z } from "zod";
import type { McClient } from "../mc/client.js";
import type { Kind, ScoreSummary, TitleDetail } from "../types.js";
import {
  ATTRIBUTION,
  kindSchema,
  ok,
  scoreSchema,
  sliceAtLineBoundary,
  titleSummarySchema,
  toScoreOut,
  toTitleSummaryOut,
  toToolError,
  type ToolResult,
} from "./shared.js";

const SECTIONS = ["basic", "scores", "awards", "production", "where_to_watch"] as const;
type Section = (typeof SECTIONS)[number];

export const getTitleDescription = [
  "Read one Metacritic entry by slug and kind, both from search_titles.",
  "Sections are opt-in because a full entry is large: 'basic' and 'scores' are the default and cover most questions.",
  "'scores' fetches the critic and audience breakdowns, each with its own scale, so never compare the two numbers directly.",
  "'where_to_watch' costs an extra request and only works for films and shows.",
  "A long description paginates: when 'truncated' is true, call again with 'offset' set to 'next_offset'.",
].join(" ");

export const getTitleInputShape = {
  slug: z.string().min(1).describe("Identifier from search_titles, such as 'the-matrix'."),
  kind: kindSchema,
  sections: z
    .array(z.enum(SECTIONS))
    .default(["basic", "scores"])
    .describe("Which parts to return. Each extra section beyond the default costs a request."),
  max_chars: z
    .number()
    .int()
    .min(200)
    .max(20000)
    .default(4000)
    .describe("Character budget for the description."),
  offset: z.number().int().min(0).default(0).describe("Where to resume the description."),
};

export const getTitleOutputShape = {
  title: titleSummarySchema,
  description: z.string().nullable(),
  tagline: z.string().nullable(),
  genres: z.array(z.string()),
  duration: z.string().nullable(),
  imdb_id: z
    .string()
    .nullable()
    .describe("IMDb identifier, usable to cross-reference other sources."),
  total_chars: z.number().int().describe("Length of the full description."),
  returned_chars: z.number().int(),
  offset: z.number().int(),
  next_offset: z.number().int().nullable().describe("Pass as 'offset' to read the rest."),
  truncated: z.boolean(),
  critic_score: scoreSchema.nullable(),
  user_score: scoreSchema.nullable(),
  awards: z
    .array(
      z.object({
        ceremony: z.string().describe("Awards body, such as 'Academy Awards, USA'."),
        wins: z.number().int().nullable().describe("Null when the source records no win."),
        nominations: z.number().int().nullable(),
      }),
    )
    .optional()
    .describe("One tally per ceremony. Metacritic publishes no per-category detail."),
  networks: z.array(z.string()).optional(),
  production: z.array(z.object({ name: z.string(), id: z.number().int().nullable() })).optional(),
  where_to_watch: z
    .array(z.object({ provider: z.string(), kind: z.string(), url: z.string().nullable() }))
    .optional(),
  notes: z.array(z.string()),
};

export interface GetTitleArgs {
  slug: string;
  kind: Kind;
  sections: Section[];
  max_chars: number;
  offset: number;
}

export async function runGetTitle(client: McClient, args: GetTitleArgs): Promise<ToolResult> {
  try {
    const wanted = new Set<Section>(args.sections);
    const notes: string[] = [];

    const detail = await client.getDetail(args.kind, args.slug);
    if (detail.cached) notes.push("Served from this server's short-lived in-memory cache.");
    const item = detail.data;

    let criticScore: ScoreSummary | null = null;
    let userScore: ScoreSummary | null = null;
    if (wanted.has("scores")) {
      // A title with no reviews yet has no score document, which is an absence
      // rather than a failure: the entry itself is perfectly valid.
      [criticScore, userScore] = await Promise.all([
        optionalScore(client, args.kind, args.slug, "critic", notes),
        optionalScore(client, args.kind, args.slug, "user", notes),
      ]);
    }

    const full = item.description ?? "";
    const { slice, nextOffset } = sliceAtLineBoundary(full, args.offset, args.max_chars);
    if (nextOffset !== null) {
      notes.push(
        `The description is longer than ${args.max_chars} characters. Call again with offset=${nextOffset} for the rest.`,
      );
    }
    if (slice === "" && args.offset > 0 && full.length > 0) {
      notes.push(
        `offset=${args.offset} is past the end of a description of ${full.length} characters. Call again with offset=0 to read it from the start.`,
      );
    }

    const structured: Record<string, unknown> = {
      title: {
        ...toTitleSummaryOut(item),
        metascore: criticScore?.score ?? item.metascore,
        user_score: userScore?.score ?? null,
      },
      description: slice === "" ? null : slice,
      tagline: item.tagline,
      genres: item.genres,
      duration: item.duration,
      imdb_id: item.imdbId,
      total_chars: full.length,
      returned_chars: slice.length,
      offset: args.offset,
      next_offset: nextOffset,
      truncated: nextOffset !== null,
      critic_score: criticScore ? toScoreOut(criticScore) : null,
      user_score: userScore ? toScoreOut(userScore) : null,
      notes,
    };

    if (wanted.has("awards")) structured.awards = item.awards;
    if (wanted.has("production")) {
      structured.production = item.production;
      structured.networks = item.networks;
    }
    if (wanted.has("where_to_watch")) {
      structured.where_to_watch = await watchOffers(client, item, args.kind, notes);
    }

    return ok(structured, render(item, slice, criticScore, userScore));
  } catch (error) {
    return toToolError(error);
  }
}

async function optionalScore(
  client: McClient,
  kind: Kind,
  slug: string,
  source: "critic" | "user",
  notes: string[],
): Promise<ScoreSummary | null> {
  try {
    const { data } = await client.getScore(kind, slug, source);
    return data;
  } catch {
    notes.push(`No ${source} score is published for this entry yet.`);
    return null;
  }
}

async function watchOffers(
  client: McClient,
  item: TitleDetail,
  kind: Kind,
  notes: string[],
): Promise<unknown[]> {
  if (kind === "game") {
    notes.push("Streaming offers do not apply to games.");
    return [];
  }
  if (!item.imdbId) {
    notes.push("This entry carries no IMDb id, which is what streaming offers are keyed by.");
    return [];
  }
  try {
    const { data } = await client.getWatchOffers(item.imdbId, kind);
    return data;
  } catch {
    notes.push("Streaming offers could not be read for this entry.");
    return [];
  }
}

function render(
  item: TitleDetail,
  description: string,
  critic: ScoreSummary | null,
  user: ScoreSummary | null,
): string {
  // Some titles already carry their year, so it is only appended when absent.
  const yearShown = item.year !== null && !item.title.includes(`(${item.year})`);
  const header = [item.title, yearShown ? `(${item.year})` : "", `· ${item.kind}`]
    .filter(Boolean)
    .join(" ");

  const lines = [header];
  if (item.genres.length > 0) lines.push(`Genres: ${item.genres.join(", ")}`);
  if (critic?.score !== null && critic !== null) {
    lines.push(
      `Critics: ${critic.score}/${critic.max} from ${critic.reviewCount ?? "?"} reviews${critic.sentiment ? ` (${critic.sentiment})` : ""}`,
    );
  }
  if (user?.score !== null && user !== null) {
    lines.push(
      `Users: ${user.score}/${user.max} from ${user.reviewCount ?? "?"} ratings${user.sentiment ? ` (${user.sentiment})` : ""}`,
    );
  }
  if (description) lines.push("", description);
  lines.push("", `${ATTRIBUTION} — ${item.sourceUrl}`);
  return lines.join("\n");
}
