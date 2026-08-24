/**
 * get_title: read one entry, section by section.
 *
 * The detail response runs to 46 KB for a film, so sections are opt-in and the
 * default pair answers the question people actually ask: what is this, and is
 * it any good.
 */

import { z } from "zod";
import type { McClient } from "../mc/client.js";
import { McError } from "../errors.js";
import type { Kind, ScoreSummary, TitleDetail, WatchOffer } from "../types.js";
import { strictInput } from "./arguments.js";
import {
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

/**
 * Where the description stopped, and what a section left out means for the null
 * it leaves behind.
 *
 * The audience score only exists on the scores route, so without that section
 * its absence here says nothing about the title. Saying so beats a bare null a
 * caller would read as "Metacritic publishes none".
 */
function notesOnWhatWasReadAndAsked(read: {
  basic: boolean;
  wanted: Set<Section>;
  slice: string;
  nextOffset: number | null;
  fullLength: number;
  offset: number;
  maxChars: number;
}): string[] {
  const { basic, wanted, slice, nextOffset, fullLength, offset, maxChars } = read;
  const notes: string[] = [];

  if (basic && nextOffset !== null) {
    notes.push(
      `The description is longer than ${maxChars} characters. Call again with offset=${nextOffset} for the rest.`,
    );
  }
  if (basic && slice === "" && offset > 0 && fullLength > 0) {
    notes.push(
      `offset=${offset} is past the end of a description of ${fullLength} characters. Call again with offset=0 to read it from the start.`,
    );
  }
  if (!wanted.has("scores")) {
    notes.push(
      "Scores were not requested, so critic_score and user_score are null here regardless of what Metacritic publishes. Add 'scores' to sections to read them.",
    );
  }

  return notes;
}

/** How many companies a production credit shows before it stops. */
const PRODUCTION_CAP = 25;

/**
 * Put the sections a caller asked for into the payload, and say what was cut.
 *
 * A section left out carries no key at all rather than an empty one: an empty
 * list is a statement that Metacritic holds none, and only a section that was
 * asked for can make it.
 */
function attachAskedSections(
  structured: Record<string, unknown>,
  item: TitleDetail,
  wanted: Set<Section>,
  notes: string[],
): Array<{ name: string }> {
  if (wanted.has("awards")) {
    structured.awards = item.awards;
  }
  if (wanted.has("networks")) {
    structured.networks = item.networks;
  }

  if (!wanted.has("production")) {
    return [];
  }

  const production = item.production.slice(0, PRODUCTION_CAP);
  structured.production = production;
  if (item.production.length > PRODUCTION_CAP) {
    notes.push(
      `${item.production.length} companies are credited and the first ${PRODUCTION_CAP} are shown. The list mixes producers with distributors and home-video labels across every territory.`,
    );
  }
  return production;
}

const SECTIONS = ["basic", "scores", "awards", "production", "networks", "where_to_watch"] as const;
type Section = (typeof SECTIONS)[number];

export const getTitleDescription = [
  "Read one Metacritic entry by slug and kind, both from search_titles.",
  "Sections are opt-in because a full entry is large: 'basic' and 'scores' are the default and cover most questions.",
  "'scores' fetches the critic and audience breakdowns, each with its own scale, so never compare the two numbers directly.",
  "Sections gate the payload: asking for 'scores' alone returns no description, and 'basic' alone returns no scores.",
  "'networks' lists the broadcasters of a show; 'where_to_watch' costs an extra request and covers films and shows only.",
  "A long description paginates: when 'truncated' is true, call again with 'offset' set to 'next_offset'.",
].join(" ");

export const getTitleInput = strictInput({
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
});

export const getTitleOutputShape = {
  title: titleSummarySchema,
  description: z.string().nullable(),
  tagline: z.string().nullable(),
  genres: z.array(z.string()),
  duration_minutes: z
    .number()
    .int()
    .nullable()
    .describe("Runtime in minutes for a film, or the length of a typical episode for a show."),
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
  networks: z.array(z.string()).optional().describe("Broadcasters, for shows."),
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
    if (detail.cached) {
      notes.push("Served from this server's short-lived in-memory cache.");
    }
    const item = detail.data;

    let criticScore: ScoreSummary | null = null;
    let userScore: ScoreSummary | null = null;
    if (wanted.has("scores")) {
      [criticScore, userScore] = await Promise.all([
        optionalScore(client, args.kind, args.slug, "critic", notes),
        optionalScore(client, args.kind, args.slug, "user", notes),
      ]);
    }

    const basic = wanted.has("basic");
    const full = basic ? (item.description ?? "") : "";
    const { slice, nextOffset } = sliceAtLineBoundary(full, args.offset, args.max_chars);
    notes.push(
      ...notesOnWhatWasReadAndAsked({
        basic,
        wanted,
        slice,
        nextOffset,
        fullLength: full.length,
        offset: args.offset,
        maxChars: args.max_chars,
      }),
    );

    const structured: Record<string, unknown> = {
      title: {
        ...toTitleSummaryOut(item),
        metascore: criticScore?.score ?? item.metascore,
        user_score: userScore?.score ?? null,
      },
      description: basic && slice !== "" ? slice : null,
      tagline: basic ? item.tagline : null,
      genres: basic ? item.genres : [],
      duration_minutes: basic ? item.duration : null,
      imdb_id: basic ? item.imdbId : null,
      total_chars: basic ? full.length : 0,
      returned_chars: basic ? slice.length : 0,
      offset: args.offset,
      next_offset: basic ? nextOffset : null,
      truncated: basic && nextOffset !== null,
      critic_score: criticScore ? toScoreOut(criticScore) : null,
      user_score: userScore ? toScoreOut(userScore) : null,
      notes,
    };

    const production = attachAskedSections(structured, item, wanted, notes);
    const offers = wanted.has("where_to_watch")
      ? await watchOffers(client, item, args.kind, notes)
      : [];
    if (wanted.has("where_to_watch")) {
      structured.where_to_watch = offers;
    }

    return ok(
      structured,
      render(item, slice, wanted, {
        critic: criticScore,
        user: userScore,
        offers,
        production,
      }),
      {
        notes,
        sourceUrl: item.sourceUrl,
      },
    );
  } catch (error) {
    return toToolError(error);
  }
}

/**
 * Read a score, distinguishing an absence from a failure.
 *
 * Only `not_found` means the site publishes no score for this entry. Every
 * other error is a failure to ask, and saying "no score is published" on the
 * back of a timeout states something false about the data. That distinction is
 * the whole rule this server is built on, and it has to hold here too.
 */
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
  } catch (error) {
    if (error instanceof McError && error.code === "not_found") {
      notes.push(`Metacritic publishes no ${source} score for this entry.`);
    } else {
      const reason = error instanceof McError ? error.code : "an unexpected error";
      notes.push(
        `The ${source} score could not be read (${reason}), so it is missing here rather than absent from Metacritic. Call again to retry.`,
      );
    }
    return null;
  }
}

async function watchOffers(
  client: McClient,
  item: TitleDetail,
  kind: Kind,
  notes: string[],
): Promise<WatchOffer[]> {
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

/**
 * The text block, built from the same sections the structured output was.
 *
 * A client that renders only text must see the answer to what it asked for and
 * nothing it did not: showing genres when 'basic' was not requested contradicts
 * the structured payload, and omitting the streaming offers hides a section the
 * caller paid a request for.
 */
/** The ceremonies a title was named at, with what it took away from each. */
function renderAwards(item: TitleDetail, wanted: Set<Section>): string[] {
  if (!wanted.has("awards") || item.awards.length === 0) {
    return [];
  }

  return [
    "",
    "Awards:",
    ...item.awards.map((a) => {
      const tally = [
        a.wins === null ? "" : `${a.wins} win${a.wins === 1 ? "" : "s"}`,
        a.nominations === null
          ? ""
          : `${a.nominations} nomination${a.nominations === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return `  ${a.ceremony}${tally.length > 0 ? `: ${tally.join(", ")}` : ""}`;
    }),
  ];
}

/**
 * The sections a caller asked for, each printed rather than announced.
 *
 * A section a caller asked for and that holds nothing says so: "no company
 * credited" and a missing line are different answers, and only the first one
 * tells a reader that the question was put.
 */
function renderAskedSections(
  item: TitleDetail,
  wanted: Set<Section>,
  offers: WatchOffer[],
  production: Array<{ name: string }>,
): string[] {
  const lines: string[] = [];

  lines.push(...renderAwards(item, wanted));

  if (wanted.has("networks") && item.networks.length > 0) {
    lines.push("", `Networks: ${item.networks.join(", ")}`);
  }

  if (wanted.has("production")) {
    lines.push(
      "",
      production.length === 0
        ? "Production: no company credited."
        : `Production: ${production.map((company) => company.name).join(", ")}`,
    );
  }

  if (wanted.has("where_to_watch")) {
    lines.push("", offers.length === 0 ? "Where to watch: nothing listed." : "Where to watch:");
    for (const o of offers) {
      lines.push(`  ${o.provider} (${o.kind})${o.url ? ` — ${o.url}` : ""}`);
    }
  }

  return lines;
}

function render(
  item: TitleDetail,
  description: string,
  wanted: Set<Section>,
  said: {
    critic: ScoreSummary | null;
    user: ScoreSummary | null;
    offers: WatchOffer[];
    production: Array<{ name: string }>;
  },
): string {
  const { critic, user, offers, production } = said;
  // Some titles already carry their year, so it is only appended when absent.
  const yearShown = item.year !== null && !item.title.includes(`(${item.year})`);
  const header = [item.title, yearShown ? `(${item.year})` : "", `· ${item.kind}`]
    .filter(Boolean)
    .join(" ");

  const lines = [header];
  if (wanted.has("basic")) {
    if (item.genres.length > 0) {
      lines.push(`Genres: ${item.genres.join(", ")}`);
    }
    if (item.duration !== null) {
      lines.push(`Runtime: ${item.duration} min`);
    }
  }
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
  if (description) {
    lines.push("", description);
  }

  lines.push(...renderAskedSections(item, wanted, offers, production));

  return lines.join("\n");
}
