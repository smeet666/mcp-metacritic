/**
 * Error taxonomy surfaced to the calling model.
 *
 * The rule this file exists to enforce: a failure must never be reported as an
 * empty result. A model that sees "no title found" cannot tell that apart from
 * a genuine absence, and will confidently tell the user the film does not exist.
 *
 * Metacritic makes that distinction readable. A successful response carries a
 * `data` object; a failure carries an `errors` array instead, with its own code.
 * Anything matching neither shape is a parse failure rather than an empty answer.
 */

export type ErrorCode =
  | "not_found"
  | "invalid_input"
  | "rate_limited"
  | "parse_failure"
  | "network_error"
  | "timeout";

export interface ErrorDetails {
  url?: string;
  status?: number;
  retryAfterMs?: number;
  hint?: string;
}

export class McError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: ErrorDetails = {},
  ) {
    super(message);
    this.name = "McError";
  }
}

const ISSUES_URL = "https://github.com/smeet666/mcp-metacritic/issues";

export function notFound(url: string, what: string): McError {
  return new McError("not_found", `Metacritic has no entry for ${what}.`, {
    url,
    status: 404,
    hint: "Use search_titles to find an entry, then pass its slug and kind to this tool.",
  });
}

export function invalidInput(message: string, hint?: string): McError {
  return new McError("invalid_input", message, hint ? { hint } : {});
}

export function rateLimited(url: string, retryAfterMs: number): McError {
  return new McError(
    "rate_limited",
    "Metacritic is refusing requests from this client for now. This does NOT mean the title is missing.",
    {
      url,
      retryAfterMs,
      hint:
        `Wait about ${Math.ceil(retryAfterMs / 1000)} seconds, then call the same tool again with the ` +
        "same arguments. If it keeps happening, raise MC_MIN_INTERVAL_MS.",
    },
  );
}

/**
 * Raised when a response arrives but does not have the shape this server reads.
 *
 * Metacritic publishes no API documentation, so its response shapes can change
 * without notice. Failing here is what turns such a change into a report rather
 * than into answers that look empty.
 */
export function parseFailure(url: string, what: string): McError {
  return new McError(
    "parse_failure",
    `Metacritic answered, but the response did not have the expected shape (${what}).`,
    { url, hint: `Please report this, with the request you made, at ${ISSUES_URL}` },
  );
}

export function upstreamError(url: string, status: number): McError {
  return new McError("network_error", `Metacritic returned HTTP ${status}.`, {
    url,
    status,
    ...(status >= 500
      ? { hint: "This is a problem on Metacritic's side. Try again shortly." }
      : {}),
  });
}
