/**
 * get_reviews: what individual critics and viewers wrote.
 *
 * The aggregate score is available everywhere. The individual verdicts, with
 * the publication that ran them and a link to the original article, are what
 * this source has and others do not.
 */

import { z } from "zod";
import type { McClient } from "../mc/client.js";
import type { Kind, Sentiment } from "../types.js";
import { ATTRIBUTION, kindSchema, ok, toToolError, truncate, type ToolResult } from "./shared.js";

/** Quotes are third-party writing, so they are excerpts rather than reproductions. */
const MAX_QUOTE_CHARS = 600;

export const getReviewsDescription = [
  "Read individual reviews of a Metacritic entry, from critics or from users.",
  "Get the slug and kind from search_titles first.",
  "Filter with 'sentiment' to read only what praised or panned it, which Metacritic groups itself.",
  "Metacritic returns a fixed sample rather than the full list, so 'total_available' is usually far larger than what comes back, and there is no way to page past the sample.",
  "Critic reviews carry the publication and a link to the original article: quote them with both.",
  "Critic scores run to 100 and user scores to 10, so do not average the two together.",
].join(" ");

export const getReviewsInputShape = {
  slug: z.string().min(1).describe("Identifier from search_titles, such as 'the-matrix'."),
  kind: kindSchema,
  source: z
    .enum(["critic", "user"])
    .default("critic")
    .describe("'critic' is the professional press, 'user' is the audience."),
  sentiment: z
    .enum(["all", "positive", "neutral", "negative"])
    .default("all")
    .describe("Which slice to read. Metacritic groups reviews this way itself."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("How many reviews to return from the sample Metacritic publishes."),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("How many of the sampled reviews to skip. The sample itself cannot be paged past."),
};

const reviewSchema = z.object({
  quote: z.string().nullable().describe("Excerpt as published, truncated if long."),
  score: z.number().nullable(),
  max: z.number().describe("Scale for this review's score: 100 for critics, 10 for users."),
  publication: z.string().nullable().describe("Who ran it. Name it when quoting."),
  author: z.string().nullable(),
  url: z.string().nullable().describe("Original article. Link it when quoting."),
  date: z.string().nullable(),
});

export const getReviewsOutputShape = {
  slug: z.string(),
  kind: z.string(),
  source: z.string(),
  sentiment: z.string(),
  reviews: z.array(reviewSchema),
  total_available: z
    .number()
    .int()
    .describe("How many reviews Metacritic counts in total. Usually far more than it serves here."),
  offset: z.number().int(),
  next_offset: z.number().int().nullable().describe("Pass as 'offset' for the next page."),
  notes: z.array(z.string()),
};

export interface GetReviewsArgs {
  slug: string;
  kind: Kind;
  source: "critic" | "user";
  sentiment: Sentiment;
  limit: number;
  offset: number;
}

export async function runGetReviews(client: McClient, args: GetReviewsArgs): Promise<ToolResult> {
  try {
    const request = {
      kind: args.kind,
      slug: args.slug,
      sentiment: args.sentiment,
      limit: args.limit,
      offset: args.offset,
    };

    // The two sources return different shapes, and only critics carry a
    // publication and a link, which is why they are read separately.
    const max = args.source === "critic" ? 100 : 10;
    const { data, cached } =
      args.source === "critic"
        ? await client.getCriticReviews(request)
        : await client.getUserReviews(request);

    // Metacritic ignores limit and offset on this route and always answers with
    // the same sample, so the slicing happens here. Asking upstream for more
    // would spend a request and change nothing.
    const sampled = data.reviews.slice(args.offset, args.offset + args.limit);

    const reviews = sampled.map((review) => ({
      quote: review.quote === null ? null : truncate(review.quote, MAX_QUOTE_CHARS),
      score: review.score,
      max,
      publication: "publication" in review ? review.publication : null,
      author: "author" in review ? review.author : null,
      url: "url" in review ? review.url : null,
      date: review.date,
    }));

    const notes: string[] = [];
    if (cached) notes.push("Served from this server's short-lived in-memory cache.");
    if (reviews.length === 0) {
      notes.push(
        args.sentiment === "all"
          ? "No review is published in this slice."
          : `No ${args.sentiment} review is published. Call again with sentiment="all" to see the rest.`,
      );
    }
    if (data.itemCount > data.reviews.length) {
      notes.push(
        `${data.itemCount - data.reviews.length} entries in the sample could not be attributed and were skipped.`,
      );
    }
    if (data.totalResults > data.reviews.length) {
      notes.push(
        `Metacritic counts ${data.totalResults} ${args.source} reviews in total but publishes a sample of ${data.reviews.length} through this route. The rest are only on the website.`,
      );
    }

    // Paging is within the sample, since the source will not serve past it.
    const consumed = args.offset + reviews.length;
    const nextOffset = consumed < data.reviews.length ? consumed : null;

    const listing = reviews
      .map((review, index) => {
        const who = [review.publication, review.author].filter(Boolean).join(", ");
        const head = `${index + 1}. ${review.score === null ? "" : `${review.score}/${max} `}${who || "anonymous"}`;
        return `${head}\n   ${review.quote ?? ""}`;
      })
      .join("\n");

    const summary =
      reviews.length === 0
        ? `No ${args.source} review to show for "${args.slug}".`
        : `${reviews.length} ${args.source} review${reviews.length === 1 ? "" : "s"} of "${args.slug}":\n${listing}\n\n${ATTRIBUTION}`;

    return ok(
      {
        slug: args.slug,
        kind: args.kind,
        source: args.source,
        sentiment: args.sentiment,
        reviews,
        total_available: data.totalResults,
        offset: args.offset,
        next_offset: nextOffset,
        notes,
      },
      summary,
    );
  } catch (error) {
    return toToolError(error);
  }
}
