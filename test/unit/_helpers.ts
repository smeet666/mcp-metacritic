/**
 * Shared test scaffolding: fixture readers, a scriptable fetch, and the URL
 * router the client is driven through.
 *
 * The unit suite never touches the network. Every test builds its upstream out
 * of fixtures, which is what lets a failure be read as "this response shape is
 * mishandled" rather than "Metacritic was slow today".
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { Config } from "../../src/config.js";
import { DEFAULTS, DEFAULT_USER_AGENT } from "../../src/config.js";
import type { ErrorCode } from "../../src/errors.js";
import { McError } from "../../src/errors.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

export function fixtureJson<T = any>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

/**
 * No pacing and no retries by default: a unit test that waits a second per
 * request stops being run. Tests that are about pacing set their own interval.
 */
export function testConfig(over: Partial<Config> = {}): Config {
  return {
    userAgent: DEFAULT_USER_AGENT,
    minIntervalMs: 0,
    timeoutMs: 1000,
    maxRetries: 0,
    cacheTtlMs: 0,
    scoresCacheTtlMs: 0,
    cacheMaxEntries: 0,
    logLevel: "silent",
    ...over,
  };
}

/** The same configuration with the caches actually on, for cache behaviour tests. */
export function cachingConfig(over: Partial<Config> = {}): Config {
  return testConfig({
    cacheTtlMs: DEFAULTS.cacheTtlMs,
    scoresCacheTtlMs: DEFAULTS.scoresCacheTtlMs,
    cacheMaxEntries: DEFAULTS.cacheMaxEntries,
    ...over,
  });
}

export const silentLogger = {
  error: () => {},
  info: () => {},
  debug: () => {},
};

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  at: number;
}

export interface ScriptedResponse {
  body?: string;
  status?: number;
  headers?: Record<string, string>;
  /** Thrown instead of answering, for network and abort behaviour. */
  throws?: unknown;
}

export interface FakeFetch {
  impl: typeof fetch;
  calls: FetchCall[];
}

/**
 * A fetch built from a responder. Records every call with its timestamp, which
 * is how the pacing tests observe the rate limiter from the outside.
 */
export function makeFetch(
  responder: (url: string, callIndex: number) => ScriptedResponse | string,
): FakeFetch {
  const calls: FetchCall[] = [];

  const impl = (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    const index = calls.length;
    calls.push({ url, init, at: Date.now() });

    const raw = responder(url, index);
    const scripted: ScriptedResponse = typeof raw === "string" ? { body: raw } : raw;
    if (scripted.throws !== undefined) {
      throw scripted.throws;
    }

    return new Response(scripted.body ?? "", {
      status: scripted.status ?? 200,
      headers: scripted.headers ?? { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

/** Always answers the same thing, whatever is asked. */
export function constantFetch(response: ScriptedResponse | string): FakeFetch {
  return makeFetch(() => response);
}

/** Answers each call from the list in order, then repeats the last entry. */
export function sequenceFetch(responses: Array<ScriptedResponse | string>): FakeFetch {
  return makeFetch((_url, index) => responses[Math.min(index, responses.length - 1)]!);
}

export type Route = [match: string, response: ScriptedResponse | string];

/**
 * Maps a URL substring to a fixture. Routes are tried in order, so a specific
 * route can be listed before a general one.
 */
export function fixtureRouter(routes: Route[]): FakeFetch {
  return makeFetch((url) => {
    const hit = routes.find(([match]) => url.includes(match));
    if (!hit) {
      throw new Error(`no fixture route matches ${url}`);
    }
    return hit[1];
  });
}

/** The route fragments the client builds, named so tests read as intent. */
export const ROUTE = {
  search: "/finder/metacritic/search/",
  browse: "/finder/metacritic/web",
  detailMovie: "/movies/metacritic/",
  detailGame: "/games/metacritic/",
  criticScore: "componentName=critic-score-summary",
  userScore: "componentName=user-score-summary",
  criticReviews: "componentName=critic-reviews",
  userReviews: "componentName=user-reviews",
  offers: "/justwatch/",
} as const;

/** Every route answered from the happy-path fixtures. */
export function happyRouter(): FakeFetch {
  return fixtureRouter([
    [ROUTE.search, fixtureText("search.json")],
    [ROUTE.criticScore, fixtureText("score-critic.json")],
    [ROUTE.userScore, fixtureText("score-user.json")],
    [ROUTE.criticReviews, fixtureText("reviews-critic.json")],
    [ROUTE.userReviews, fixtureText("reviews-user.json")],
    [ROUTE.detailMovie, fixtureText("detail-movie.json")],
    [ROUTE.detailGame, fixtureText("detail-game.json")],
    [ROUTE.offers, fixtureText("offers.json")],
    [ROUTE.browse, fixtureText("browse.json")],
  ]);
}

/**
 * Asserts the call fails with an McError carrying the expected code, and
 * returns it so a test can go on to check the details it puts in front of the
 * model. A resolved call is a failure here: silently returning nothing is the
 * exact behaviour the error taxonomy exists to prevent.
 */
export async function expectMcError(
  run: () => Promise<unknown>,
  code: ErrorCode,
): Promise<McError> {
  let caught: unknown;
  let resolved = false;
  try {
    await run();
    resolved = true;
  } catch (error) {
    caught = error;
  }

  expect(resolved, `expected an McError with code "${code}", but the call resolved`).toBe(false);
  expect(caught, `expected an McError with code "${code}", got ${String(caught)}`).toBeInstanceOf(
    McError,
  );
  const error = caught as McError;
  expect(error.code, `error message was: ${error.message}`).toBe(code);
  return error;
}
