/**
 * Every route and every response field this server reads, in one place.
 *
 * Metacritic documents none of this: the routes are the ones its own web
 * frontend calls, and the field names come from reading those responses. That
 * makes a rename upstream both likely and silent, so collecting them here keeps
 * the repair to a single file, and the live canary asserts each one by name so
 * a change surfaces as a named failure rather than as empty answers.
 */

export const API_BASE = "https://backend.metacritic.com";
export const SITE_BASE = "https://www.metacritic.com";

/**
 * The API and the website disagree on plurality: the backend serves /movies/,
 * /shows/ and /games/, while the pages a reader should be linked to live at
 * /movie/, /tv/ and /game/. Both forms are needed and neither can be derived
 * from the other, so both are written out.
 */
export const API_SEGMENT = {
  movie: "movies",
  show: "shows",
  game: "games",
} as const;

export const SITE_SEGMENT = {
  movie: "movie",
  show: "tv",
  game: "game",
} as const;

/** Internal type ids the browse route filters on. */
export const MCO_TYPE_ID = {
  show: 1,
  movie: 2,
  game: 13,
} as const;

/** The `type` string search results carry, which does not match our own naming. */
export const SEARCH_TYPE = {
  movie: "movie",
  show: "show",
  game: "game-title",
} as const;

/** Sort orders the browse route accepts. */
export const SORT_BY = {
  score: "-metaScore",
  recent: "-releaseDate",
  popular: "-popularityCount",
} as const;

/**
 * Component identifiers the backend requires on several routes. They describe
 * the widget the response was built for, and requests omitting them are refused.
 */
export const COMPONENT = {
  product: { componentName: "product", componentType: "Product" },
  criticStats: { componentName: "critic-score-summary", componentType: "MetaScoreSummary" },
  userStats: { componentName: "user-score-summary", componentType: "MetaScoreSummary" },
  criticReviews: { componentName: "critic-reviews", componentType: "ProductReviewsSummary" },
  userReviews: { componentName: "user-reviews", componentType: "ProductReviewsSummary" },
} as const;

/** Field names read off responses. */
export const FIELD = {
  data: "data",
  errors: "errors",
  item: "item",
  items: "items",
  totalResults: "totalResults",
  /** Reviews arrive pre-sorted into these buckets, which is the sentiment filter. */
  reviewBuckets: { all: "default", positive: "positive", neutral: "neutral", negative: "negative" },
} as const;
