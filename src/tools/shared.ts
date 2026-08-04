/** Pieces shared by the four tools: schemas, error mapping, text mirrors. */

import { z } from "zod";
import { McError } from "../errors.js";
import type { ScoreSummary, TitleSummary } from "../types.js";

/** Many MCP clients render only the text block, so it must read on its own. */
export const MAX_TEXT_MIRROR_CHARS = 2000;

export const ATTRIBUTION = "Source: Metacritic";

export const kindSchema = z
  .enum(["movie", "show", "game"])
  .describe("Which catalogue the entry belongs to. Pass it back with the slug.");

export const titleSummarySchema = z.object({
  id: z.number().int(),
  kind: z.enum(["movie", "show", "game"]),
  title: z.string(),
  slug: z.string().describe("Identifier to pass to get_title and get_reviews, with 'kind'."),
  year: z.number().int().nullable(),
  release_date: z.string().nullable(),
  rating: z.string().nullable().describe("Age rating as published, such as R or TV-MA."),
  metascore: z
    .number()
    .nullable()
    .describe("Critic score, out of 100. Not comparable to user_score without rescaling."),
  user_score: z
    .number()
    .nullable()
    .describe("Audience score, out of 10. Not comparable to metascore without rescaling."),
  source_url: z.string().describe("Metacritic page. Show this when citing the entry."),
});

export type TitleSummaryOut = z.infer<typeof titleSummarySchema>;

export function toTitleSummaryOut(title: TitleSummary): TitleSummaryOut {
  return {
    id: title.id,
    kind: title.kind,
    title: title.title,
    slug: title.slug,
    year: title.year,
    release_date: title.releaseDate,
    rating: title.rating,
    metascore: title.metascore,
    user_score: title.userScore,
    source_url: title.sourceUrl,
  };
}

/**
 * Every score goes out with its own scale.
 *
 * Critic scores run to 100 and user scores to 10. A bare number invites a
 * comparison that is wrong by an order of magnitude, so `max` is not optional
 * and the description says what it is for.
 */
export const scoreSchema = z.object({
  score: z.number().nullable(),
  max: z.number().describe("Scale this score is on: 100 for critics, 10 for users."),
  review_count: z.number().int().nullable(),
  positive_count: z.number().int().nullable(),
  neutral_count: z.number().int().nullable(),
  negative_count: z.number().int().nullable(),
  sentiment: z.string().nullable().describe("Metacritic's own wording for the verdict."),
});

export function toScoreOut(score: ScoreSummary): z.infer<typeof scoreSchema> {
  return {
    score: score.score,
    max: score.max,
    review_count: score.reviewCount,
    positive_count: score.positiveCount,
    neutral_count: score.neutralCount,
    negative_count: score.negativeCount,
    sentiment: score.sentiment,
  };
}

export interface ToolResult {
  // The SDK's CallToolResult carries an index signature for protocol extensions.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Keep text from the site out of the shape this server's own lines take.
 *
 * The block ends with lines opening "Note:" and "Source:", and a caller has no
 * way to tell one of those from the same words inside a title, a quote or a
 * description written by whoever published it. Indenting a body line that
 * opens with one of those words keeps the two apart, and costs nothing: the
 * structured output still carries the text exactly as it was published.
 */
function indentMarkerLines(body: string): string {
  return body.replace(/^(Note:|Source:)/gm, " $1");
}

/**
 * Build a result whose text block always ends with its notes and attribution.
 *
 * The body is truncated to fit around the trailer rather than the whole block
 * being cut afterwards. Appending the credit and then truncating loses exactly
 * the credit, which is the one line that must survive: a client rendering only
 * the text would otherwise show third-party review quotes with no source.
 *
 * The notes belong to the trailer for the same reason. They are what qualifies
 * the answer, saying that a list was capped, that a score could not be read, or
 * that a section does not apply to this kind of entry. A client rendering only
 * the text reads an unqualified answer without them, which is the failure this
 * server exists to avoid.
 *
 * The trailer also states that the text was shortened, since a client that
 * cannot read `structuredContent` has no other way to know rows are missing.
 */
export function ok(
  structured: Record<string, unknown>,
  body: string,
  options: { notes?: string[]; sourceUrl?: string } = {},
): ToolResult {
  const attribution = options.sourceUrl ? `${ATTRIBUTION} — ${options.sourceUrl}` : ATTRIBUTION;
  // A run of notes must never crowd out the answer they qualify, so they are
  // dropped from the tail until the body keeps a readable share of the block.
  const noteLines = (options.notes ?? []).map((note) => `Note: ${note}`);
  while (noteLines.length > 0 && noteLines.join("\n").length > MAX_TEXT_MIRROR_CHARS / 2) {
    noteLines.pop();
  }
  const trailer = [...noteLines, attribution].join("\n");

  const cutMarker = "\n\n[shortened; the full result is in the structured output]";
  const reserved = `\n\n${trailer}`.length;
  const budget = MAX_TEXT_MIRROR_CHARS - reserved;

  const safe = indentMarkerLines(body);
  let text: string;
  if (safe.length <= budget) {
    text = `${safe}\n\n${trailer}`;
  } else {
    const kept = truncate(safe, Math.max(0, budget - cutMarker.length));
    text = `${kept}${cutMarker}\n\n${trailer}`;
  }

  return { content: [{ type: "text", text }], structuredContent: structured };
}

/**
 * Error results carry no structuredContent: the SDK validates it against the
 * tool's declared output schema, which an error payload does not satisfy.
 */
export function toToolError(error: unknown): ToolResult {
  const known =
    error instanceof McError
      ? error
      : new McError("network_error", error instanceof Error ? error.message : String(error));

  const lines = [`[${known.code}] ${known.message}`];
  if (known.details.hint) lines.push(`Hint: ${known.details.hint}`);

  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Cut a block of text at a line boundary, so a truncated description ends on a
 * sentence rather than mid-word. A single line longer than the budget is cut
 * hard, since there is no boundary to find.
 */
export function sliceAtLineBoundary(
  text: string,
  offset: number,
  maxChars: number,
): { slice: string; nextOffset: number | null } {
  const rest = text.slice(offset);
  if (rest.length <= maxChars) return { slice: rest, nextOffset: null };

  const window = rest.slice(0, maxChars);
  const lastBreak = window.lastIndexOf("\n");
  let cut = lastBreak > 0 ? lastBreak : maxChars;

  // Never cut between the two halves of a surrogate pair: both pages would show
  // a replacement character and no offset could ever reassemble it.
  const code = rest.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;

  return { slice: rest.slice(0, cut), nextOffset: offset + cut };
}

/** Compact listing, showing what a model needs to pick the right entry. */
export function renderTitleList(titles: TitleSummaryOut[]): string {
  return titles
    .map((title, index) => {
      const scores = [
        title.metascore === null ? "" : `critics ${title.metascore}/100`,
        title.user_score === null ? "" : `users ${title.user_score}/10`,
      ].filter(Boolean);
      // Some titles already end with their year, such as "Psycho (1960)", so
      // appending it again would read as a stutter.
      const yearShown = title.year !== null && !title.title.includes(`(${title.year})`);
      const parts = [
        `${index + 1}. ${title.title}`,
        yearShown ? `(${title.year})` : "",
        `· ${title.kind}`,
        scores.length > 0 ? `· ${scores.join(", ")}` : "",
        `· slug: ${title.slug}`,
      ];
      return parts.filter(Boolean).join(" ");
    })
    .join("\n");
}
