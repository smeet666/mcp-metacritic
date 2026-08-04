/**
 * Responses to domain types.
 *
 * Every route answers with the same envelope: `{"data": …}` on success, or
 * `{"errors":[{"code":404,…}]}` on failure. Reading that envelope is the whole
 * job of the first half of this file, because getting it wrong is how a failure
 * turns into an answer that looks empty.
 *
 * The second half maps fields. Listing rows are trimmed here rather than in a
 * tool, so the heavy payload has no path out of this module.
 */

import { notFound, parseFailure } from "../errors.js";
import type {
  Award,
  Company,
  CriticReview,
  Kind,
  ReviewPage,
  ScoreSummary,
  Sentiment,
  TitleDetail,
  TitlePage,
  TitleSummary,
  UserReview,
  WatchOffer,
} from "../types.js";
import { FIELD, SEARCH_TYPE } from "./paths.js";
import { bucketFor, titlePageUrl } from "./urls.js";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Read the envelope and return the payload.
 *
 * An `errors` array is the site saying it could not serve the request, which is
 * an absence when the caller named something specific. Anything that is neither
 * shape means the response is not what this server knows how to read.
 */
export function envelope(raw: string, url: string, what: string): Json {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw parseFailure(url, "the body is not valid JSON");
  }

  if (!isObject(body)) throw parseFailure(url, "the body is not an object");

  const errors = body[FIELD.errors];
  if (Array.isArray(errors) && errors.length > 0) {
    const first = isObject(errors[0]) ? errors[0] : {};
    if (first.code === 404) throw notFound(url, what);
    throw parseFailure(
      url,
      `the site reported ${String(first.reason ?? first.code ?? "an error")}`,
    );
  }

  const data = body[FIELD.data];
  if (!isObject(data)) throw parseFailure(url, "the response carries no data object");
  return data;
}

const str = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const num = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const intOf = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
};

/** Map the site's own type wording onto ours. */
function kindOf(value: unknown): Kind | null {
  const type = str(value);
  if (type === SEARCH_TYPE.movie) return "movie";
  if (type === SEARCH_TYPE.show) return "show";
  if (type === SEARCH_TYPE.game) return "game";
  return null;
}

/**
 * A row without an id, a slug or a kind cannot be looked up or linked, so it is
 * not a row. Returning null lets the caller skip one bad entry among many while
 * still failing loudly when every entry is unreadable.
 */
function toSummary(node: unknown): TitleSummary | null {
  if (!isObject(node)) return null;

  const id = intOf(node.id);
  const slug = str(node.slug);
  const title = str(node.title);
  const kind = kindOf(node.type);
  if (id === null || !slug || !title || !kind) return null;

  const critic = isObject(node.criticScoreSummary) ? node.criticScoreSummary : {};

  // The two listing routes report the audience score differently: browse rows
  // carry `userScore: {score}`, search rows carry nothing at all. Both forms are
  // read, and a row with neither keeps null rather than inventing a zero.
  const userSummary = isObject(node.userScoreSummary) ? node.userScoreSummary : {};
  const userObject = isObject(node.userScore) ? node.userScore : {};
  const userScore = num(userSummary.score) ?? num(userObject.score) ?? num(node.userScore);

  return {
    id,
    kind,
    title,
    slug,
    year: intOf(node.premiereYear),
    releaseDate: str(node.releaseDate),
    rating: str(node.rating),
    metascore: num(critic.score),
    userScore,
    sourceUrl: titlePageUrl(kind, slug),
  };
}

/** Search and browse share this shape, so they share one reader. */
export function parseTitlePage(raw: string, url: string, what: string): TitlePage {
  const data = envelope(raw, url, what);
  const items = data[FIELD.items];
  if (!Array.isArray(items)) throw parseFailure(url, "the response carries no items array");

  const titles: TitleSummary[] = [];
  for (const node of items) {
    const row = toSummary(node);
    if (row) titles.push(row);
  }

  if (items.length > 0 && titles.length === 0) {
    throw parseFailure(url, `${items.length} rows but none could be read`);
  }

  return {
    titles,
    totalResults: intOf(data[FIELD.totalResults]) ?? titles.length,
    itemCount: items.length,
  };
}

function toCompanies(value: unknown): Company[] {
  const source = isObject(value) ? value.companies : value;
  if (!Array.isArray(source)) return [];
  const out: Company[] = [];
  for (const node of source) {
    const name = isObject(node) ? str(node.name) : str(node);
    if (name) out.push({ name, id: isObject(node) ? intOf(node.id) : null });
  }
  return out;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const node of value) {
    const name = isObject(node) ? str(node.name) : str(node);
    if (name) out.push(name);
  }
  return out;
}

/**
 * Awards are reported one entry per ceremony, as a tally rather than a list of
 * individual prizes. A ceremony where nothing was won carries `wins: null`, so
 * that is preserved instead of being flattened to zero: "no win recorded" and
 * "zero wins" are the same here, but only the source can say which it meant.
 */
function toAwards(value: unknown): Award[] {
  if (!Array.isArray(value)) return [];
  const out: Award[] = [];
  for (const node of value) {
    if (!isObject(node)) continue;
    const ceremony = str(node.awardEvent);
    if (!ceremony) continue;
    out.push({
      ceremony,
      wins: intOf(node.wins),
      nominations: intOf(node.nominations),
    });
  }
  return out;
}

export function parseDetail(raw: string, url: string, kind: Kind, slug: string): TitleDetail {
  const data = envelope(raw, url, `${kind} "${slug}"`);
  const item = data[FIELD.item];
  if (!isObject(item)) throw parseFailure(url, "the response carries no item object");

  // The detail route omits `type`, so the kind comes from the caller, who chose
  // the route. Building the summary by hand keeps that difference explicit.
  const id = intOf(item.id);
  const title = str(item.title);
  if (id === null || !title) throw parseFailure(url, "the entry has no id or no title");

  const critic = isObject(item.criticScoreSummary) ? item.criticScoreSummary : {};

  return {
    id,
    kind,
    title,
    slug,
    year: intOf(item.premiereYear),
    releaseDate: str(item.releaseDate),
    rating: str(item.rating),
    metascore: num(critic.score),
    userScore: null,
    sourceUrl: titlePageUrl(kind, slug),
    description: str(item.description),
    tagline: str(item.tagline),
    genres: toStringList(item.genres),
    duration: str(item.duration),
    imdbId: str(item.imdbId),
    networks: toStringList(item.networks),
    production: toCompanies(item.production),
    awards: toAwards(item.awards),
    criticScoreDetail: null,
    userScoreDetail: null,
  };
}

/**
 * A score summary, with its scale.
 *
 * `max` comes from the response rather than from the source name, because the
 * two scales differ and hard-coding them here would be a guess that survives
 * quietly if the site ever changes one.
 */
export function parseScore(raw: string, url: string, what: string): ScoreSummary {
  const data = envelope(raw, url, what);
  const item = data[FIELD.item];
  if (!isObject(item)) throw parseFailure(url, "the response carries no score object");

  const max = num(item.max);
  if (max === null) throw parseFailure(url, "the score carries no scale");

  return {
    score: num(item.score),
    max,
    reviewCount: intOf(item.reviewCount),
    positiveCount: intOf(item.positiveCount),
    neutralCount: intOf(item.neutralCount),
    negativeCount: intOf(item.negativeCount),
    sentiment: str(item.sentiment),
  };
}

function reviewBucket(data: Json, url: string, sentiment: Sentiment): unknown[] {
  const item = data[FIELD.item];
  if (!isObject(item)) throw parseFailure(url, "the response carries no reviews object");

  const bucket = item[bucketFor(sentiment)];
  // A bucket that does not exist means the site stopped grouping reviews this
  // way, which is a change worth reporting rather than an absence of reviews.
  if (!Array.isArray(bucket)) {
    throw parseFailure(url, `there is no "${bucketFor(sentiment)}" group of reviews`);
  }
  return bucket;
}

export function parseCriticReviews(
  raw: string,
  url: string,
  what: string,
  sentiment: Sentiment,
): ReviewPage<CriticReview> {
  const data = envelope(raw, url, what);
  const bucket = reviewBucket(data, url, sentiment);

  const reviews: CriticReview[] = [];
  for (const node of bucket) {
    if (!isObject(node)) continue;
    const quote = str(node.quote);
    const publication = str(node.publicationName);
    // A quote with no publication cannot be attributed, and attribution is the
    // condition under which this content is worth passing on at all.
    if (!quote || !publication) continue;
    reviews.push({
      quote,
      score: num(node.score),
      publication,
      author: str(node.author),
      url: str(node.url),
      date: str(node.date),
    });
  }

  if (bucket.length > 0 && reviews.length === 0) {
    throw parseFailure(url, `${bucket.length} reviews but none could be read`);
  }

  return {
    reviews,
    totalResults: intOf(data[FIELD.totalResults]) ?? reviews.length,
    itemCount: bucket.length,
  };
}

export function parseUserReviews(
  raw: string,
  url: string,
  what: string,
  sentiment: Sentiment,
): ReviewPage<UserReview> {
  const data = envelope(raw, url, what);
  const bucket = reviewBucket(data, url, sentiment);

  const reviews: UserReview[] = [];
  for (const node of bucket) {
    if (!isObject(node)) continue;
    const quote = str(node.quote);
    if (!quote) continue;
    reviews.push({ quote, score: num(node.score), date: str(node.date) });
  }

  if (bucket.length > 0 && reviews.length === 0) {
    throw parseFailure(url, `${bucket.length} reviews but none could be read`);
  }

  return {
    reviews,
    totalResults: intOf(data[FIELD.totalResults]) ?? reviews.length,
    itemCount: bucket.length,
  };
}

/**
 * Unwrap a click-tracking redirect.
 *
 * Offer links arrive as tracking URLs of about 800 characters, most of it a
 * base64 analytics payload, with the real destination in the `r` parameter.
 * Nine offers on one film came to 7 KB of redirects against 300 bytes of actual
 * links, so the destination is extracted and the wrapper dropped.
 */
function unwrapLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const target = new URL(link).searchParams.get("r");
    if (target && /^https?:\/\//i.test(target)) return target;
  } catch {
    // Not a URL this function understands; the original is still usable.
  }
  return link;
}

/** Streaming offers, grouped upstream by how you pay for them. */
export function parseOffers(raw: string, url: string, what: string): WatchOffer[] {
  const data = envelope(raw, url, what);
  const item = data[FIELD.item];
  if (!isObject(item)) throw parseFailure(url, "the response carries no offers object");

  const offers: WatchOffer[] = [];
  for (const [group, value] of Object.entries(item)) {
    if (!Array.isArray(value)) continue;
    for (const node of value) {
      if (!isObject(node)) continue;
      const provider = str(node.providerName);
      if (!provider) continue;
      offers.push({ provider, kind: group, url: unwrapLink(str(node.link)) });
    }
  }
  return offers;
}
