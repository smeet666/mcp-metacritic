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
 * What one answer from Metacritic amounts to.
 *
 * Three outcomes and no fourth: the body is usable, the thing asked for is not
 * there, or the edge is refusing for now. Two of those refusals arrive under a
 * success status — an empty body, and HTML where JSON belongs — and reading
 * them as answers hands the parser a document that reads as "nothing found".
 */
type Answer =
  | { kind: "usable" }
  | { kind: "refused"; error: McError }
  | { kind: "again"; error: McError; waitMs: number | null; penalise: boolean; because: string };

function readAnswer(
  url: string,
  status: number,
  body: string,
  retryAfterMs: number | null,
  ownGuessMs: number,
): Answer {
  if (status === 429 || status === 503 || status === 403) {
    return {
      kind: "again",
      error: rateLimited(url, retryAfterMs ?? ownGuessMs),
      // A server that says when to come back knows better than our own guess.
      waitMs: retryAfterMs,
      penalise: true,
      because: `refused with ${status}`,
    };
  }
  if (status >= 500) {
    return {
      kind: "again",
      error: upstreamError(url, status),
      waitMs: null,
      penalise: false,
      because: `status ${status}`,
    };
  }
  // An unknown slug is answered with a 404 carrying an error envelope. It is
  // reported as an absence rather than as a transport problem, because the
  // caller asked for something specific and needs to know it is not there.
  if (status === 404) {
    return { kind: "refused", error: notFound(url, "that request") };
  }
  if (status >= 400) {
    return { kind: "refused", error: upstreamError(url, status) };
  }

  const trimmed = body.trim();
  if (trimmed === "") {
    return {
      kind: "again",
      error: rateLimited(url, ownGuessMs),
      waitMs: null,
      penalise: true,
      because: "empty body, treated as a refusal",
    };
  }

  // Every route answers with JSON. An HTML body under a success status is the
  // edge answering instead of the application, usually a challenge or an error
  // page, and it clears on its own. Retried for that reason, but reported as a
  // parse failure if it never does: a body that is persistently not JSON means
  // the shape moved, and that is worth a bug report.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return {
      kind: "again",
      error: parseFailure(url, "the body is not JSON"),
      waitMs: retryAfterMs,
      penalise: true,
      because: "non-JSON body",
    };
  }

  return { kind: "usable" };
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

  return await limiter.schedule(async () => {
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

      const verdict = readAnswer(url, status, body, retryAfterMs, backoffDelay(attempt));
      if (verdict.kind === "refused") {
        throw verdict.error;
      }
      if (verdict.kind === "again") {
        if (verdict.penalise) {
          limiter.penalize();
          logger.info(`${verdict.because} on ${url}, interval now ${limiter.currentIntervalMs}ms`);
        }
        askedWaitMs = verdict.waitMs;
        lastError = verdict.error;
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
  if (!raw) {
    return null;
  }
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const when = Date.parse(raw);
  if (Number.isNaN(when)) {
    return null;
  }
  return Math.max(0, when - Date.now());
}

function asTransportError(error: unknown, url: string): McError {
  if (error instanceof McError) {
    return error;
  }
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
