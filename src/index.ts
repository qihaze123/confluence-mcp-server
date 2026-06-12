#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildConfigFromInput,
  ConfluenceClient,
  type ConfluenceConfig,
  type ConfluenceConfigInput,
  tryBuildConfigFromEnv,
} from "./confluence.js";
import { registerTools } from "./tools.js";

type ConnectionSource = "environment" | "runtime";

class RuntimeConfluenceConnection {
  private client?: ConfluenceClient;
  private config?: ConfluenceConfig;
  private source?: ConnectionSource;
  private configuredAt?: string;
  private lastError?: string;

  configure(
    config: ConfluenceConfig,
    source: ConnectionSource,
    client = new ConfluenceClient(config),
  ): void {
    this.config = config;
    this.client = client;
    this.source = source;
    this.configuredAt = new Date().toISOString();
    this.lastError = undefined;
  }

  setError(error: unknown): void {
    this.lastError = errorMessage(error);
  }

  getClient(): ConfluenceClient {
    if (!this.client) {
      throw new Error(
        "Confluence connection is not configured. Call confluence_configure_connection first, or set CONF_BASE_URL plus auth env vars before starting the server.",
      );
    }
    return this.client;
  }

  getStatus() {
    if (!this.config) {
      return {
        configured: false,
        lastError: this.lastError,
        message:
          "No Confluence connection is configured. Call confluence_configure_connection, or set CONF_* environment variables.",
      };
    }

    return {
      configured: true,
      source: this.source,
      configuredAt: this.configuredAt,
      baseUrl: this.config.baseUrl,
      mode: this.config.mode,
      authMode: this.config.resolvedAuthMode,
      username: this.config.username,
      defaultSpace: this.config.defaultSpace,
      lastError: this.lastError,
    };
  }
}

function createClientProxy(runtime: RuntimeConfluenceConnection): ConfluenceClient {
  return new Proxy({} as ConfluenceClient, {
    get(_target, property) {
      const client = runtime.getClient();
      const value = Reflect.get(client, property);
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

function jsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function errorContent(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: errorMessage(error),
      },
    ],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logConnectionStatus(
  config: ConfluenceConfig,
  source: ConnectionSource,
): void {
  const identity = config.username ?? "token-auth";
  console.error(
    `[confluence-mcp] Connecting to ${config.baseUrl} (mode=${config.mode}, auth=${config.resolvedAuthMode}, source=${source}) as ${identity}`,
  );
  if (config.defaultSpace) {
    console.error(`[confluence-mcp] Default space: ${config.defaultSpace}`);
  }
}

function registerConnectionTools(
  server: McpServer,
  runtime: RuntimeConfluenceConnection,
): void {
  server.tool(
    "confluence_configure_connection",
    "Configure the Confluence connection for this MCP server process. Use this when CONF_* env vars were not set or when switching to another Confluence site.",
    {
      baseUrl: z
        .string()
        .min(1)
        .describe("Confluence base URL, for example https://confluence.example.com"),
      mode: z
        .enum(["cloud", "server", "dc", "datacenter", "data-center"])
        .optional()
        .describe("Deployment mode (default server). dc/datacenter map to server."),
      authMode: z
        .enum(["auto", "basic", "bearer"])
        .optional()
        .describe("Authentication mode (default auto). Cloud always uses Basic."),
      username: z
        .string()
        .optional()
        .describe("Login username or Cloud email address."),
      token: z
        .string()
        .optional()
        .describe("Access token. Cloud treats this as an API token; Server auto mode treats it as Bearer."),
      password: z
        .string()
        .optional()
        .describe("Password. Server auto/basic mode uses this with username."),
      defaultSpace: z
        .string()
        .optional()
        .describe("Default Confluence space key used when a tool omits spaceKey."),
      verify: z
        .boolean()
        .optional()
        .describe("Verify credentials by calling whoami after configuring (default true)."),
    },
    async ({ verify, ...input }) => {
      try {
        const config = buildConfigFromInput(input as ConfluenceConfigInput);
        const candidateClient = new ConfluenceClient(config);

        const currentUser = verify === false
          ? undefined
          : await candidateClient.getCurrentUser();

        runtime.configure(config, "runtime", candidateClient);
        logConnectionStatus(config, "runtime");

        return jsonContent({
          ...runtime.getStatus(),
          verified: verify !== false,
          currentUser,
        });
      } catch (error) {
        runtime.setError(error);
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_get_connection_status",
    "Get the current Confluence connection status without returning secrets.",
    {},
    async () => jsonContent(runtime.getStatus()),
  );
}

async function main(): Promise<void> {
  // 1. Build an initial env-backed connection when available.
  const runtime = new RuntimeConfluenceConnection();
  try {
    const config = tryBuildConfigFromEnv();
    if (config) {
      runtime.configure(config, "environment");
      logConnectionStatus(config, "environment");
    } else {
      console.error(
        "[confluence-mcp] No CONF_* connection env vars found; starting unconfigured.",
      );
    }
  } catch (error) {
    runtime.setError(error);
    console.error(
      `[confluence-mcp] Ignoring invalid CONF_* environment config: ${errorMessage(error)}`,
    );
  }

  // 2. Create a client proxy that resolves the current runtime connection per call.
  const client = createClientProxy(runtime);

  // 3. Create MCP server and register tools
  const server = new McpServer({
    name: "confluence-mcp-server",
    version: readPackageVersion(),
  });

  registerConnectionTools(server, runtime);
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
