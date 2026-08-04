/** Domain types shared by the Metacritic client and the tools. */

/** What a title is. Metacritic keys everything else off this. */
export type Kind = "movie" | "show" | "game";

/**
 * A search or browse row.
 *
 * This type exists to make the size problem unrepresentable. A detail response
 * runs to 46 KB for a single film, most of it artwork variants, and a list of
 * those would be unusable. Listing methods return only this shape, so no tool
 * can hand the heavy payload to a model even by mistake.
 */
export interface TitleSummary {
  id: number;
  kind: Kind;
  title: string;
  /** Stable identifier in URLs. Pass it back to read the full entry. */
  slug: string;
  year: number | null;
  releaseDate: string | null;
  /** Age rating as published, such as R or TV-MA. */
  rating: string | null;
  metascore: number | null;
  userScore: number | null;
  sourceUrl: string;
}

/**
 * An aggregate score.
 *
 * `max` is carried rather than assumed: critic scores run to 100 and user
 * scores to 10, so a bare number invites a comparison that is off by an order
 * of magnitude.
 */
export interface ScoreSummary {
  score: number | null;
  max: number;
  reviewCount: number | null;
  positiveCount: number | null;
  neutralCount: number | null;
  negativeCount: number | null;
  /** Metacritic's own wording, such as "Generally favorable". */
  sentiment: string | null;
}

export interface Company {
  name: string;
  id: number | null;
}

/**
 * One ceremony's tally for a title.
 *
 * Metacritic reports awards per ceremony rather than per category, so there is
 * no individual prize to name here: "Academy Awards, USA, 4 wins from 8
 * nominations" is the whole of what it publishes.
 */
export interface Award {
  ceremony: string;
  /** Upstream reports "no win" as null rather than as zero. */
  wins: number | null;
  nominations: number | null;
}

export interface TitleDetail extends TitleSummary {
  description: string | null;
  tagline: string | null;
  genres: string[];
  duration: string | null;
  /** IMDb identifier, which lets a caller cross-reference other sources. */
  imdbId: string | null;
  networks: string[];
  production: Company[];
  awards: Award[];
  /**
   * The full breakdown behind the bare numbers on `TitleSummary`: counts per
   * sentiment and Metacritic's own wording for the verdict.
   */
  criticScoreDetail: ScoreSummary | null;
  userScoreDetail: ScoreSummary | null;
}

export interface CriticReview {
  quote: string | null;
  score: number | null;
  /** Publication that ran the review, required when quoting it. */
  publication: string | null;
  author: string | null;
  /** Link to the original article, required when quoting it. */
  url: string | null;
  date: string | null;
}

export interface UserReview {
  quote: string | null;
  score: number | null;
  date: string | null;
}

/** Which slice of reviews to read. Metacritic pre-sorts them into these buckets. */
export type Sentiment = "all" | "positive" | "neutral" | "negative";

export interface ReviewPage<T> {
  reviews: T[];
  /** How many exist upstream, before limit and offset. */
  totalResults: number;
  /** How many entries the response carried, which paging must advance by. */
  itemCount: number;
}

export interface WatchOffer {
  provider: string;
  /** rent, buy, stream or free, as the source groups them. */
  kind: string;
  url: string | null;
}

export interface TitlePage {
  titles: TitleSummary[];
  totalResults: number;
  itemCount: number;
}
