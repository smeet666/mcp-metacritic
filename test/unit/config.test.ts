/**
 * Configuration read from the environment.
 *
 * The rule these tests hold to is that a bad value never changes behaviour
 * quietly and never stops the process: an MCP server that exits at startup
 * because of a typo in a client config file is close to undiagnosable from the
 * host application.
 */

import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULTS,
  DEFAULT_USER_AGENT,
  MAX_ALLOWED_INTERVAL_MS,
  MIN_ALLOWED_INTERVAL_MS,
  createLogger,
  loadConfig,
} from "../../src/config.js";

let written: string[] = [];

beforeEach(() => {
  written = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("defaults", () => {
  it("runs with an empty environment", () => {
    const config = loadConfig({});

    expect(config.userAgent).toBe(DEFAULT_USER_AGENT);
    expect(config.minIntervalMs).toBe(DEFAULTS.minIntervalMs);
    expect(config.timeoutMs).toBe(DEFAULTS.timeoutMs);
    expect(config.maxRetries).toBe(DEFAULTS.maxRetries);
    expect(config.cacheTtlMs).toBe(DEFAULTS.cacheTtlMs);
    expect(config.scoresCacheTtlMs).toBe(DEFAULTS.scoresCacheTtlMs);
    expect(config.logLevel).toBe(DEFAULTS.logLevel);
  });

  it("identifies the client, so the site can see who is calling", () => {
    expect(DEFAULT_USER_AGENT).toContain("mcp-metacritic");
    expect(DEFAULT_USER_AGENT).toContain("github.com");
  });

  it("gives scores a shorter life than catalogue entries", () => {
    const config = loadConfig({});

    expect(config.scoresCacheTtlMs).toBeLessThan(config.cacheTtlMs);
  });
});

describe("values that are accepted", () => {
  it("takes a custom user agent", () => {
    expect(loadConfig({ MC_USER_AGENT: "acme-bot/2.0" }).userAgent).toBe("acme-bot/2.0");
  });

  it("ignores a user agent that is only whitespace", () => {
    expect(loadConfig({ MC_USER_AGENT: "   " }).userAgent).toBe(DEFAULT_USER_AGENT);
  });

  it("takes an interval at or above the floor", () => {
    expect(loadConfig({ MC_MIN_INTERVAL_MS: String(MIN_ALLOWED_INTERVAL_MS) }).minIntervalMs).toBe(
      MIN_ALLOWED_INTERVAL_MS,
    );
    expect(loadConfig({ MC_MIN_INTERVAL_MS: "2500" }).minIntervalMs).toBe(2500);
  });

  it("rounds a fractional number rather than refusing it", () => {
    expect(loadConfig({ MC_TIMEOUT_MS: "1500.6" }).timeoutMs).toBe(1501);
  });

  it("takes every log level it names", () => {
    for (const level of ["silent", "error", "info", "debug"] as const) {
      expect(loadConfig({ MC_LOG_LEVEL: level }).logLevel).toBe(level);
    }
    expect(loadConfig({ MC_LOG_LEVEL: " DEBUG " }).logLevel).toBe("debug");
  });

  it("accepts zero retries and a disabled cache, which are meaningful choices", () => {
    const config = loadConfig({ MC_MAX_RETRIES: "0", MC_CACHE_TTL_MS: "0" });

    expect(config.maxRetries).toBe(0);
    expect(config.cacheTtlMs).toBe(0);
  });
});

describe("values that are refused", () => {
  it("never throws, whatever it is handed", () => {
    expect(() =>
      loadConfig({
        MC_MIN_INTERVAL_MS: "fast",
        MC_TIMEOUT_MS: "-1",
        MC_MAX_RETRIES: "999",
        MC_CACHE_TTL_MS: "NaN",
        MC_CACHE_MAX_ENTRIES: "-5",
        MC_LOG_LEVEL: "loud",
      }),
    ).not.toThrow();
  });

  it("refuses an interval below the floor without falling back to the floor itself", () => {
    const config = loadConfig({ MC_MIN_INTERVAL_MS: "0" });

    expect(config.minIntervalMs).toBe(DEFAULTS.minIntervalMs);
    expect(config.minIntervalMs).toBeGreaterThanOrEqual(MIN_ALLOWED_INTERVAL_MS);
  });

  it("clamps an interval above the ceiling, keeping the caller's intent to go slow", () => {
    const config = loadConfig({ MC_MIN_INTERVAL_MS: "600000" });

    expect(config.minIntervalMs).toBe(MAX_ALLOWED_INTERVAL_MS);
    expect(config.minIntervalMs).toBeGreaterThan(DEFAULTS.minIntervalMs);
  });

  it("falls back rather than clamping an out-of-range number, so a typo cannot disable a guard", () => {
    expect(loadConfig({ MC_MAX_RETRIES: "-1" }).maxRetries).toBe(DEFAULTS.maxRetries);
    expect(loadConfig({ MC_MAX_RETRIES: "1000" }).maxRetries).toBe(DEFAULTS.maxRetries);
    expect(loadConfig({ MC_TIMEOUT_MS: "5" }).timeoutMs).toBe(DEFAULTS.timeoutMs);
  });

  it("falls back on a value that is not a number", () => {
    expect(loadConfig({ MC_TIMEOUT_MS: "soon" }).timeoutMs).toBe(DEFAULTS.timeoutMs);
    expect(loadConfig({ MC_MIN_INTERVAL_MS: "slow" }).minIntervalMs).toBe(DEFAULTS.minIntervalMs);
  });

  it("falls back on an unknown log level", () => {
    expect(loadConfig({ MC_LOG_LEVEL: "loud" }).logLevel).toBe(DEFAULTS.logLevel);
  });

  it("says on stderr what it ignored and what it used instead", () => {
    loadConfig({ MC_MIN_INTERVAL_MS: "10" });

    const message = written.join("");
    expect(message).toContain("MC_MIN_INTERVAL_MS");
    expect(message).toContain(String(MIN_ALLOWED_INTERVAL_MS));
    expect(message).toContain(String(DEFAULTS.minIntervalMs));
  });

  it("warns on stderr and never on stdout, which carries the protocol", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    loadConfig({ MC_LOG_LEVEL: "loud", MC_TIMEOUT_MS: "nope" });

    expect(written.length).toBeGreaterThan(0);
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe("logger", () => {
  it("says nothing at all when silent", () => {
    const logger = createLogger("silent");

    logger.error("e");
    logger.info("i");
    logger.debug("d");

    expect(written).toEqual([]);
  });

  it("emits at and below the level it was given", () => {
    createLogger("info").debug("not this");
    expect(written.join("")).not.toContain("not this");

    createLogger("info").error("this one");
    expect(written.join("")).toContain("this one");
  });

  it("writes to stderr, never to stdout", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    createLogger("debug").debug("hello");

    expect(written.join("")).toContain("hello");
    expect(stdout).not.toHaveBeenCalled();
  });
});
