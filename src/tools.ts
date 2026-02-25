import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConfluenceClient } from "./confluence.js";

/**
 * Register all Confluence tools on the given MCP server instance.
 */
export function registerTools(server: McpServer, client: ConfluenceClient): void {
  // ── confluence_search_pages ─────────────────────────────────────────────

  server.tool(
    "confluence_search_pages",
    "Search Confluence pages by keyword. Returns id, title, spaceKey, url for each result.",
    {
      query: z.string().describe("Search keywords"),
      spaceKey: z
        .string()
        .optional()
        .describe("Confluence space key (uses CONF_DEFAULT_SPACE if omitted)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("Max results to return (default 10, max 25)"),
    },
    async ({ query, spaceKey, limit }) => {
      try {
        const pages = await client.searchPages(query, spaceKey, limit ?? 10);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(pages, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: String(err) }],
        };
      }
    },
  );

  // ── confluence_get_page ─────────────────────────────────────────────────

  server.tool(
    "confluence_get_page",
    "Get a Confluence page by ID. Returns id, title, spaceKey, version, bodyStorageValue (HTML).",
    {
      pageId: z.string().describe("Confluence page ID"),
      expand: z
        .string()
        .optional()
        .describe("Comma-separated expand fields (default: body.storage,version,space)"),
    },
    async ({ pageId, expand }) => {
      try {
        const page = await client.getPage(pageId, expand);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: String(err) }],
        };
      }
    },
  );

  // ── confluence_update_page ──────────────────────────────────────────────

  server.tool(
    "confluence_update_page",
    "Update a Confluence page's content. Automatically increments the version number. Returns id, title, newVersion, url.",
    {
      pageId: z.string().describe("Confluence page ID"),
      title: z
        .string()
        .optional()
        .describe("New page title (keeps current title if omitted)"),
      bodyStorageValue: z
        .string()
        .describe("New page body in Confluence storage format (XHTML)"),
      minorEdit: z
        .boolean()
        .optional()
        .describe("Whether this is a minor edit (default true, suppresses notifications)"),
      message: z
        .string()
        .optional()
        .describe("Version update message / change comment"),
    },
    async ({ pageId, title, bodyStorageValue, minorEdit, message }) => {
      try {
        const result = await client.updatePage({
          pageId,
          title,
          bodyStorageValue,
          minorEdit,
          message,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: String(err) }],
        };
      }
    },
  );
}
