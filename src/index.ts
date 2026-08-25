#!/usr/bin/env node
/**
 * Entry point: an MCP server for Metacritic over stdio.
 */

import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLogger, loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const server = createServer({ config, logger });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    // The close is attempted, and a close that fails is no reason to stay
    // alive: the process leaves either way.
    server
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `[mcp-metacritic] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
