#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildConfig, ConfluenceClient } from "./confluence.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  // 1. Validate env and build config (exits on failure)
  const config = buildConfig();

  // Log startup info to stderr (never stdout — that's the MCP transport)
  console.error(
    `[confluence-mcp] Connecting to ${config.baseUrl} as ${config.username}`,
  );
  if (config.defaultSpace) {
    console.error(`[confluence-mcp] Default space: ${config.defaultSpace}`);
  }

  // 2. Create Confluence REST client
  const client = new ConfluenceClient(config);

  // 3. Create MCP server and register tools
  const server = new McpServer({
    name: "confluence-mcp-server",
    version: "1.0.0",
  });

  registerTools(server, client);

  // 4. Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[confluence-mcp] Server running on stdio");
}

main().catch((err) => {
  console.error("[confluence-mcp] Fatal:", err);
  process.exit(1);
});
