/**
 * MCP server wiring.
 *
 * One client, one rate limiter and one pair of caches are shared by all tools,
 * so the self-imposed pacing applies to the server as a whole rather than being
 * reset by each tool in turn.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config, Logger } from "./config.js";
import { createLogger, loadConfig } from "./config.js";
import { McClient } from "./mc/client.js";
import {
  browseTitlesDescription,
  browseTitlesInput,
  browseTitlesOutputShape,
  runBrowseTitles,
} from "./tools/browseTitles.js";
import type { BrowseTitlesArgs } from "./tools/browseTitles.js";
import {
  getReviewsDescription,
  getReviewsInput,
  getReviewsOutputShape,
  runGetReviews,
} from "./tools/getReviews.js";
import type { GetReviewsArgs } from "./tools/getReviews.js";
import {
  getTitleDescription,
  getTitleInput,
  getTitleOutputShape,
  runGetTitle,
} from "./tools/getTitle.js";
import type { GetTitleArgs } from "./tools/getTitle.js";
import {
  runSearchTitles,
  searchTitlesDescription,
  searchTitlesInput,
  searchTitlesOutputShape,
} from "./tools/searchTitles.js";
import type { SearchTitlesArgs } from "./tools/searchTitles.js";
import { PKG_VERSION } from "./version.js";

export interface CreateServerOptions {
  config?: Config;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

/** This server only reads, so every tool is read-only. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export function createServer(options: CreateServerOptions = {}): McpServer {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);
  const client = new McClient({
    config,
    logger,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const server = new McpServer(
    { name: "mcp-metacritic", version: PKG_VERSION },
    {
      instructions:
        "Tools for Metacritic: films, shows and games, their scores, and the reviews behind them. " +
        "No API key is needed. Typical flow: search_titles to find an entry and its slug and kind, " +
        "then get_title for the entry or get_reviews for what critics wrote. search_titles carries " +
        "the critic Metascore, so a question about the critical verdict needs no second call, but " +
        "it carries no audience score: read that with get_title, or with browse_titles. " +
        "The two scores are on different scales: the critic Metascore runs to 100 and the audience " +
        "score to 10, so never compare or average them without rescaling; every score is returned " +
        "with its own 'max' for that reason. " +
        "Use browse_titles when there is no title to look up, such as best rated or newest releases. " +
        "When you repeat a review, name the publication and link the original article, and when you " +
        "cite a score, credit Metacritic and link the entry: every result carries a source_url.",
    },
  );

  server.registerTool(
    "search_titles",
    {
      title: "Search Metacritic",
      description: searchTitlesDescription,
      inputSchema: searchTitlesInput,
      outputSchema: z.object(searchTitlesOutputShape),
      annotations: READ_ONLY,
    },
    async (args) => runSearchTitles(client, args as SearchTitlesArgs),
  );

  server.registerTool(
    "get_title",
    {
      title: "Read an entry",
      description: getTitleDescription,
      inputSchema: getTitleInput,
      outputSchema: z.object(getTitleOutputShape),
      annotations: READ_ONLY,
    },
    async (args) => runGetTitle(client, args as GetTitleArgs),
  );

  server.registerTool(
    "get_reviews",
    {
      title: "Read reviews",
      description: getReviewsDescription,
      inputSchema: getReviewsInput,
      outputSchema: z.object(getReviewsOutputShape),
      annotations: READ_ONLY,
    },
    async (args) => runGetReviews(client, args as GetReviewsArgs),
  );

  server.registerTool(
    "browse_titles",
    {
      title: "Browse rankings",
      description: browseTitlesDescription,
      inputSchema: browseTitlesInput,
      outputSchema: z.object(browseTitlesOutputShape),
      annotations: READ_ONLY,
    },
    async (args) => runBrowseTitles(client, args as BrowseTitlesArgs),
  );

  logger.info(
    `ready: user-agent="${config.userAgent}", min interval ${config.minIntervalMs}ms, ` +
      `catalogue cache ${config.cacheTtlMs}ms, scores cache ${config.scoresCacheTtlMs}ms`,
  );

  return server;
}
