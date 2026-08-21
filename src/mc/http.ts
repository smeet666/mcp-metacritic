/**
 * HTTP layer: one GET, with backoff.
 *
 * Status codes are meaningful here, so they are read: 404 marks an unknown
 * slug, 429 and 503 mark push-back, and 5xx is worth retrying. What this layer
 * deliberately does not do is inspect the body, which is the parser's job.
 *
 * Metacritic advertises no rate limit and did not throttle during testing, so
 * the pacing is entirely self-imposed and the retry path is written for the day
 * that changes rather than for observed behaviour.
 */

import type { Config, Logger } from "../config.js";
import { McError, notFound, parseFailure, rateLimited, upstreamError } from "../errors.js";
import { type RateLimiter, sleep } from "./rateLimiter.js";

const BACKOFF_BASE_MS = 2000;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 20_000;

/** Exponential backoff with jitter, so parallel clients do not resynchronise. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const capped = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * BACKOFF_FACTOR ** attempt);
  return Math.round(capped * (0.5 + random() * 0.5));
}

export interface HttpDeps {
  config: Config;
  limiter: RateLimiter;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch one URL as text, retrying transient conditions.
 *
 * The retry loop runs inside a single limiter slot, so a queued request cannot
 * interleave with a chain that is backing off. Each attempt claims its own slot
 * through `beforeRequest`, which is what keeps the pacing honest between the
 * last request of one chain and the first request of the next.
 */
export async function fetchText(url: string, deps: HttpDeps): Promise<string> {
  const { config, limiter, logger } = deps;
  const doFetch = deps.fetchImpl ?? fetch;

  return limiter.schedule(async () => {
    let lastError: McError | undefined;

    // Set when the site says how long to stay away; it replaces our own guess
    // for the next attempt. Applied here rather than where it is read, so no
    // wait is ever served after the last attempt, when nobody would use it.
    let askedWaitMs: number | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delay = askedWaitMs ?? backoffDelay(attempt - 1);
        askedWaitMs = null;
        logger.info(`retry ${attempt}/${config.maxRetries} in ${delay}ms for ${url}`);
        await sleep(Math.min(delay, BACKOFF_MAX_MS));
      }

      let status: number;
      let body: string;
      let retryAfterMs: number | null = null;
      try {
        await limiter.beforeRequest();
        const response = await doFetch(url, {
          headers: {
            "User-Agent": config.userAgent,
            Accept: "application/json,*/*;q=0.8",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(config.timeoutMs),
        });
        status = response.status;
        retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        body = await response.text();
      } catch (error) {
        lastError = asTransportError(error, url);
        logger.debug(`${lastError.code} for ${url}: ${lastError.message}`);
        continue;
      }

      if (status === 429 || status === 503 || status === 403) {
        limiter.penalize();
        // A server that says when to come back knows better than our own guess.
        askedWaitMs = retryAfterMs;
        lastError = rateLimited(url, retryAfterMs ?? backoffDelay(attempt));
        logger.info(
          `refused on ${url} with ${status}, interval now ${limiter.currentIntervalMs}ms`,
        );
        continue;
      }
      if (status >= 500) {
        lastError = upstreamError(url, status);
        continue;
      }
      // An unknown slug is answered with a 404 carrying an error envelope. It is
      // reported as an absence rather than as a transport problem, because the
      // caller asked for something specific and needs to know it is not there.
      if (status === 404) throw notFound(url, "that request");
      if (status >= 400) throw upstreamError(url, status);

      // An empty body is not a valid answer from any of these endpoints, and is
      // how a stressed edge sometimes refuses. Retrying is safer than handing an
      // empty document to the parser, which would read as "nothing found".
      const trimmed = body.trim();
      if (trimmed === "") {
        limiter.penalize();
        lastError = rateLimited(url, backoffDelay(attempt));
        logger.info(`empty body on ${url}, treating as a refusal`);
        continue;
      }

      // Every route answers with JSON. An HTML body under a success status is
      // the edge answering instead of the application, usually a challenge or
      // an error page, and it clears on its own. Retrying is right; reporting a
      // parse failure would send the caller to the bug tracker for an outage.
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        limiter.penalize();
        // Retried because an edge challenge clears on its own, but reported as a
        // parse failure if it never does: a body that is persistently not JSON
        // means the shape moved, and that is worth a bug report.
        lastError = parseFailure(url, "the body is not JSON");
        askedWaitMs = retryAfterMs;
        logger.info(`non-JSON body on ${url}, retrying`);
        continue;
      }

      limiter.relax();
      return body;
    }

    throw lastError ?? new McError("network_error", `Could not fetch ${url}.`, { url });
  });
}

/** `Retry-After` carries either seconds or an HTTP date. */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - Date.now());
}

function asTransportError(error: unknown, url: string): McError {
  if (error instanceof McError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new McError("timeout", "Metacritic did not answer in time.", {
      url,
      hint: "Raise MC_TIMEOUT_MS if this happens often on a slow connection.",
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new McError("network_error", `Could not reach Metacritic: ${message}`, { url });
}
