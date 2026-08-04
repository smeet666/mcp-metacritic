/**
 * URL building.
 *
 * The API lives on a backend host, while the pages a reader should be sent to
 * live on the main site. Attribution links must point at the latter, which is
 * the only thing this server gives back in exchange for the data.
 */

import { invalidInput } from "../errors.js";
import type { Kind, Sentiment } from "../types.js";
import {
  API_BASE,
  API_SEGMENT,
  COMPONENT,
  MCO_TYPE_ID,
  SITE_BASE,
  SITE_SEGMENT,
  SORT_BY,
} from "./paths.js";

type Params = Record<string, string | number | undefined>;

function build(path: string, params: Params): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `${API_BASE}${path}?${suffix}` : `${API_BASE}${path}`;
}

/**
 * Slugs go into the path, so a malformed one would silently change which route
 * is called. Rejecting here keeps that from reaching the network.
 */
function checkSlug(slug: string): string {
  const trimmed = slug.trim();
  if (trimmed === "") {
    throw invalidInput("The slug is empty.", "Take it from a search_titles result.");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) {
    throw invalidInput(
      `"${slug}" does not look like a Metacritic slug.`,
      "Slugs are lowercase words joined by hyphens, such as the-matrix. Use search_titles to get one.",
    );
  }
  return trimmed;
}

export function searchUrl(query: string, limit: number, offset: number): string {
  const trimmed = query.trim();
  if (trimmed === "") {
    throw invalidInput("The search query is empty.", "Pass a title or part of one.");
  }
  return build(`/finder/metacritic/search/${encodeURIComponent(trimmed)}/web`, { limit, offset });
}

export function browseUrl(options: {
  kind: Kind;
  sort: keyof typeof SORT_BY;
  genre?: string;
  limit: number;
  offset: number;
}): string {
  return build("/finder/metacritic/web", {
    sortBy: SORT_BY[options.sort],
    mcoTypeId: MCO_TYPE_ID[options.kind],
    genres: options.genre,
    limit: options.limit,
    offset: options.offset,
  });
}

export function detailUrl(kind: Kind, slug: string): string {
  return build(`/${API_SEGMENT[kind]}/metacritic/${checkSlug(slug)}/web`, COMPONENT.product);
}

export function scoreUrl(kind: Kind, slug: string, source: "critic" | "user"): string {
  const component = source === "critic" ? COMPONENT.criticStats : COMPONENT.userStats;
  return build(
    `/reviews/metacritic/${source}/${API_SEGMENT[kind]}/${checkSlug(slug)}/stats/web`,
    component,
  );
}

export function reviewsUrl(options: {
  kind: Kind;
  slug: string;
  source: "critic" | "user";
  limit: number;
  offset: number;
}): string {
  const component = options.source === "critic" ? COMPONENT.criticReviews : COMPONENT.userReviews;
  return build(
    `/reviews/metacritic/${options.source}/${API_SEGMENT[options.kind]}/${checkSlug(options.slug)}/summary/web`,
    { ...component, limit: options.limit, offset: options.offset },
  );
}

/** Streaming offers, keyed by IMDb id rather than by Metacritic slug. */
export function watchUrl(imdbId: string, kind: Kind): string {
  const trimmed = imdbId.trim();
  if (!/^tt\d+$/.test(trimmed)) {
    throw invalidInput(
      `"${imdbId}" is not an IMDb id.`,
      "IMDb ids look like tt0133093. get_title returns one as imdb_id.",
    );
  }
  return build("/justwatch/metacritic/offersByIMDbId", {
    id: trimmed,
    type: kind === "show" ? "show" : "movie",
  });
}

/** The page a reader should be sent to, and the link attribution requires. */
export function titlePageUrl(kind: Kind, slug: string): string {
  return `${SITE_BASE}/${SITE_SEGMENT[kind]}/${slug}/`;
}

/** Which pre-sorted bucket of reviews to read. */
export function bucketFor(sentiment: Sentiment): string {
  return sentiment === "all" ? "default" : sentiment;
}
