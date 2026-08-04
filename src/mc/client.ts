/**
 * High-level Metacritic client.
 *
 * This module knows nothing about MCP, which keeps it testable against plain
 * strings and usable as a library through the `./client` export.
 */

import type { Config, Logger } from "../config.js";
import {
  DEFAULT_USER_AGENT,
  MIN_ALLOWED_INTERVAL_MS,
  createLogger,
  loadConfig,
} from "../config.js";
import type {
  CriticReview,
  Kind,
  ReviewPage,
  ScoreSummary,
  Sentiment,
  TitleDetail,
  TitlePage,
  UserReview,
  WatchOffer,
} from "../types.js";
import { TtlLruCache } from "./cache.js";
import { fetchText } from "./http.js";
import {
  parseCriticReviews,
  parseDetail,
  parseOffers,
  parseScore,
  parseTitlePage,
  parseUserReviews,
} from "./parse.js";
import type { SORT_BY } from "./paths.js";
import { RateLimiter } from "./rateLimiter.js";
import { browseUrl, detailUrl, reviewsUrl, scoreUrl, searchUrl, watchUrl } from "./urls.js";

export interface McClientOptions {
  config?: Config;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

export interface Outcome<T> {
  data: T;
  /** True when served from the in-memory cache rather than the network. */
  cached: boolean;
}

export type Sort = keyof typeof SORT_BY;

/**
 * Apply the guarantees this project makes about its own traffic.
 *
 * The environment parser already enforces both, but `McClient` is published as
 * a library through the `./client` export and takes a caller-built config, so
 * without this the pacing floor and the honest identity are optional for anyone
 * importing it. They are the two things this server offers in exchange for
 * reading a source that publishes no terms, so they hold on every path.
 *
 * A caller may still name their own application in the User-Agent, and there
 * are good reasons to. Passing the traffic off as a browser is a different
 * thing, and gets the project's own identity appended so it stays attributable.
 */
function withGuarantees(config: Config): Config {
  const userAgent = /mozilla\/|applewebkit|chrome\/|safari\/|gecko/i.test(config.userAgent)
    ? `${config.userAgent} ${DEFAULT_USER_AGENT}`
    : config.userAgent;
  return {
    ...config,
    userAgent,
    minIntervalMs: Math.max(MIN_ALLOWED_INTERVAL_MS, config.minIntervalMs),
  };
}

export class McClient {
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly limiter: RateLimiter;
  /**
   * Two caches, because the two kinds of data age at different speeds. A
   * catalogue entry changes when someone edits it, which is rare. A score moves
   * every time a review lands, which around a release is constantly.
   */
  private readonly catalogueCache: TtlLruCache<unknown>;
  private readonly scoresCache: TtlLruCache<unknown>;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: McClientOptions = {}) {
    this.config = withGuarantees(options.config ?? loadConfig());
    this.logger = options.logger ?? createLogger(this.config.logLevel);
    this.limiter = new RateLimiter({ minIntervalMs: this.config.minIntervalMs });
    this.catalogueCache = new TtlLruCache<unknown>(
      this.config.cacheMaxEntries,
      this.config.cacheTtlMs,
    );
    this.scoresCache = new TtlLruCache<unknown>(
      this.config.cacheMaxEntries,
      this.config.scoresCacheTtlMs,
    );
    this.fetchImpl = options.fetchImpl;
  }

  /**
   * Search across films, shows and games.
   *
   * The return type carries rows only. The upstream response embeds artwork
   * variants on every match, and dropping them here rather than in a tool means
   * they have no path out of this layer.
   */
  async search(query: string, limit: number, offset: number): Promise<Outcome<TitlePage>> {
    const url = searchUrl(query, limit, offset);
    return this.fetchParsed(url, this.catalogueCache, (body) =>
      parseTitlePage(body, url, `the query "${query}"`),
    );
  }

  async browse(options: {
    kind: Kind;
    sort: Sort;
    genre?: string;
    limit: number;
    offset: number;
  }): Promise<Outcome<TitlePage>> {
    const url = browseUrl(options);
    return this.fetchParsed(url, this.catalogueCache, (body) =>
      parseTitlePage(body, url, `that ${options.kind} listing`),
    );
  }

  async getDetail(kind: Kind, slug: string): Promise<Outcome<TitleDetail>> {
    const url = detailUrl(kind, slug);
    // The trimmed form is what reached the network, so it is also what the
    // public link and the echoed slug must be built from.
    const clean = slug.trim();
    return this.fetchParsed(url, this.catalogueCache, (body) =>
      parseDetail(body, url, kind, clean),
    );
  }

  async getScore(
    kind: Kind,
    slug: string,
    source: "critic" | "user",
  ): Promise<Outcome<ScoreSummary>> {
    const url = scoreUrl(kind, slug, source);
    return this.fetchParsed(url, this.scoresCache, (body) =>
      parseScore(body, url, `the ${source} score of ${kind} "${slug}"`),
    );
  }

  async getCriticReviews(options: {
    kind: Kind;
    slug: string;
    sentiment: Sentiment;
    limit: number;
    offset: number;
  }): Promise<Outcome<ReviewPage<CriticReview>>> {
    const url = reviewsUrl({ ...options, source: "critic" });
    return this.fetchParsed(
      url,
      this.scoresCache,
      (body) =>
        parseCriticReviews(
          body,
          url,
          `reviews of ${options.kind} "${options.slug}"`,
          options.sentiment,
        ),
      options.sentiment,
    );
  }

  async getUserReviews(options: {
    kind: Kind;
    slug: string;
    sentiment: Sentiment;
    limit: number;
    offset: number;
  }): Promise<Outcome<ReviewPage<UserReview>>> {
    const url = reviewsUrl({ ...options, source: "user" });
    return this.fetchParsed(
      url,
      this.scoresCache,
      (body) =>
        parseUserReviews(
          body,
          url,
          `reviews of ${options.kind} "${options.slug}"`,
          options.sentiment,
        ),
      options.sentiment,
    );
  }

  async getWatchOffers(imdbId: string, kind: Kind): Promise<Outcome<WatchOffer[]>> {
    const url = watchUrl(imdbId, kind);
    return this.fetchParsed(url, this.scoresCache, (body) =>
      parseOffers(body, url, `streaming offers for ${imdbId}`),
    );
  }

  /**
   * Fetch, parse, then cache. In that order: a response that could not be read
   * is never stored, so a bad minute upstream cannot be replayed from memory
   * for the rest of the cache lifetime.
   */
  private async fetchParsed<T>(
    url: string,
    cache: TtlLruCache<unknown>,
    parse: (body: string) => T,
    /**
     * Distinguishes parses of the same response. The reviews route returns every
     * sentiment in one payload, so two calls differing only by sentiment share a
     * URL: keying on the URL alone would serve the first answer to the second.
     */
    variant = "",
  ): Promise<Outcome<T>> {
    const key = variant ? `${url}#${variant}` : url;
    const hit = cache.get(key);
    if (hit !== undefined) {
      this.logger.debug(`cache hit ${key}`);
      return { data: hit as T, cached: true };
    }

    const body = await fetchText(url, {
      config: this.config,
      limiter: this.limiter,
      logger: this.logger,
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });

    const data = parse(body);
    cache.set(key, data);
    return { data, cached: false };
  }
}
