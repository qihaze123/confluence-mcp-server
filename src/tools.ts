import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConfluenceClient } from "./confluence.js";

function jsonContent(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorContent(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

/**
 * Register all Confluence tools on the given MCP server instance.
 */
export function registerTools(server: McpServer, client: ConfluenceClient): void {
  server.tool(
    "confluence_get_current_user",
    "Get current authenticated Confluence user (whoami).",
    {},
    async () => {
      try {
        const user = await client.getCurrentUser();
        return jsonContent(user);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_search_pages",
    "Search Confluence pages by keyword. Returns unified fields: id, type, title, spaceKey, url, version.",
    {
      query: z
        .string()
        .optional()
        .describe("Search keywords (optional, empty string means only space/type filter)"),
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
        const pages = await client.searchPages(query ?? "", spaceKey, limit ?? 10);
        return jsonContent(pages);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_execute_cql_search",
    "Execute raw Confluence CQL search. Returns unified fields: id, type, title, spaceKey, url, version.",
    {
      cql: z.string().describe("Raw Confluence CQL expression"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results to return (default 10, max 50)"),
      expand: z
        .string()
        .optional()
        .describe("Comma-separated expand fields (default: space,version)"),
    },
    async ({ cql, limit, expand }) => {
      try {
        const pages = await client.executeCqlSearch(
          cql,
          limit ?? 10,
          expand ?? "space,version",
        );
        return jsonContent(pages);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_get_page",
    "Get a Confluence page by ID. Returns unified fields and bodyStorageValue.",
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
        return jsonContent(page);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_get_page_outline",
    "Get a page outline by parsing headings from body.storage. Returns unified fields plus headings[] for low-token navigation.",
    {
      pageId: z.string().describe("Confluence page ID"),
    },
    async ({ pageId }) => {
      try {
        const outline = await client.getPageOutline(pageId);
        return jsonContent(outline);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_get_page_section",
    "Get a single page section by heading. The server fetches full storage internally but only returns the matched section to save tokens.",
    {
      pageId: z.string().describe("Confluence page ID"),
      heading: z.string().describe("Heading text used to locate the target section"),
      occurrence: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("When the same heading appears multiple times, choose which occurrence (default 1)"),
      includeHeading: z
        .boolean()
        .optional()
        .describe("Include the heading tag in the returned section (default true)"),
      matchMode: z
        .enum(["exact", "contains"])
        .optional()
        .describe("Heading match mode: exact or contains (default exact)"),
    },
    async ({ pageId, heading, occurrence, includeHeading, matchMode }) => {
      try {
        const section = await client.getPageSection({
          pageId,
          heading,
          occurrence,
          includeHeading,
          matchMode,
        });
        return jsonContent(section);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_get_page_anchor_block",
    "Get a page block between two invisible anchor macros. Returns only the matched block to save tokens.",
    {
      pageId: z.string().describe("Confluence page ID"),
      startAnchor: z.string().describe("Start anchor name"),
      endAnchor: z.string().describe("End anchor name"),
    },
    async ({ pageId, startAnchor, endAnchor }) => {
      try {
        const block = await client.getPageAnchorBlock({
          pageId,
          startAnchor,
          endAnchor,
        });
        return jsonContent(block);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_create_page",
    "Create a Confluence page. Supports optional parentId. Returns unified fields.",
    {
      title: z.string().describe("Page title"),
      bodyStorageValue: z
        .string()
        .describe("Page body in Confluence storage format (XHTML)"),
      spaceKey: z
        .string()
        .optional()
        .describe("Confluence space key (uses CONF_DEFAULT_SPACE if omitted)"),
      parentId: z
        .string()
        .optional()
        .describe("Optional parent page ID (ancestor)"),
    },
    async ({ title, bodyStorageValue, spaceKey, parentId }) => {
      try {
        const page = await client.createPage({
          title,
          bodyStorageValue,
          spaceKey,
          parentId,
        });
        return jsonContent(page);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_update_page",
    "Update a Confluence page content. Auto increments version. Returns unified fields.",
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
        .describe("Whether this is a minor edit (default true)"),
      message: z
        .string()
        .optional()
        .describe("Version update message / change comment"),
    },
    async ({ pageId, title, bodyStorageValue, minorEdit, message }) => {
      try {
        const page = await client.updatePage({
          pageId,
          title,
          bodyStorageValue,
          minorEdit,
          message,
        });
        return jsonContent(page);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_update_page_section",
    "Update one page section by heading. The server fetches full storage internally, replaces the matched range, and writes back the whole page so the model only sends the section content.",
    {
      pageId: z.string().describe("Confluence page ID"),
      heading: z.string().describe("Heading text used to locate the target section"),
      sectionStorageValue: z
        .string()
        .describe("Replacement storage XHTML for the target section"),
      occurrence: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("When the same heading appears multiple times, choose which occurrence (default 1)"),
      includeHeading: z
        .boolean()
        .optional()
        .describe("When true replace from the heading tag itself; when false only replace the body below it (default true)"),
      matchMode: z
        .enum(["exact", "contains"])
        .optional()
        .describe("Heading match mode: exact or contains (default exact)"),
      title: z
        .string()
        .optional()
        .describe("New page title (keeps current title if omitted)"),
      minorEdit: z
        .boolean()
        .optional()
        .describe("Whether this is a minor edit (default true)"),
      message: z
        .string()
        .optional()
        .describe("Version update message / change comment"),
    },
    async ({
      pageId,
      heading,
      sectionStorageValue,
      occurrence,
      includeHeading,
      matchMode,
      title,
      minorEdit,
      message,
    }) => {
      try {
        const page = await client.updatePageSection({
          pageId,
          heading,
          sectionStorageValue,
          occurrence,
          includeHeading,
          matchMode,
          title,
          minorEdit,
          message,
        });
        return jsonContent(page);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_preview_page_section_update",
    "Preview a heading-based section update. Returns the currently matched section, the proposed replacement, and a hash that must be echoed to the confirmed update call.",
    {
      pageId: z.string().describe("Confluence page ID"),
      heading: z.string().describe("Heading text used to locate the target section"),
      sectionStorageValue: z
        .string()
        .describe("Proposed replacement storage XHTML for the target section"),
      occurrence: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("When the same heading appears multiple times, choose which occurrence (default 1)"),
      includeHeading: z
        .boolean()
        .optional()
        .describe("Include the heading tag in the previewed replace range (default true)"),
      matchMode: z
        .enum(["exact", "contains"])
        .optional()
        .describe("Heading match mode: exact or contains (default exact)"),
    },
    async ({ pageId, heading, sectionStorageValue, occurrence, includeHeading, matchMode }) => {
      try {
        const preview = await client.previewPageSectionUpdate({
          pageId,
          heading,
          sectionStorageValue,
          occurrence,
          includeHeading,
          matchMode,
        });
        return jsonContent(preview);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_update_page_section_confirmed",
    "Confirm a heading-based section update after preview. The server re-reads the page and only updates when the preview hash still matches current content.",
    {
      pageId: z.string().describe("Confluence page ID"),
      heading: z.string().describe("Heading text used to locate the target section"),
      sectionStorageValue: z
        .string()
        .describe("Replacement storage XHTML for the target section"),
      expectedCurrentHash: z
        .string()
        .describe("Hash returned by confluence_preview_page_section_update"),
      occurrence: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("When the same heading appears multiple times, choose which occurrence (default 1)"),
      includeHeading: z
        .boolean()
        .optional()
        .describe("When true replace from the heading tag itself; when false only replace the body below it (default true)"),
      matchMode: z
        .enum(["exact", "contains"])
        .optional()
        .describe("Heading match mode: exact or contains (default exact)"),
      title: z
        .string()
        .optional()
        .describe("New page title (keeps current title if omitted)"),
      minorEdit: z
        .boolean()
        .optional()
        .describe("Whether this is a minor edit (default true)"),
      message: z
        .string()
        .optional()
        .describe("Version update message / change comment"),
    },
    async ({
      pageId,
      heading,
      sectionStorageValue,
      expectedCurrentHash,
      occurrence,
      includeHeading,
      matchMode,
      title,
      minorEdit,
      message,
    }) => {
      try {
        const page = await client.confirmPageSectionUpdate({
          pageId,
          heading,
          sectionStorageValue,
          expectedCurrentHash,
          occurrence,
          includeHeading,
          matchMode,
          title,
          minorEdit,
          message,
        });
        return jsonContent(page);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_add_anchor_block_to_section",
    "Insert invisible start/end anchor macros around a heading-based section so later updates can target a stable block instead of relying on heading matching.",
    {
      pageId: z.string().describe("Confluence page ID"),
      heading: z.string().describe("Heading text used to locate the section"),
      startAnchor: z.string().describe("Start anchor name to insert before the section"),
      endAnchor: z.string().describe("End anchor name to insert after the section"),
      occurrence: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("When the same heading appears multiple times, choose which occurrence (default 1)"),
      matchMode: z
        .enum(["exact", "contains"])
        .optional()
        .describe("Heading match mode: exact or contains (default exact)"),
      title: z
        .string()
        .optional()
        .describe("New page title (keeps current title if omitted)"),
      minorEdit: z
        .boolean()
        .optional()
        .describe("Whether this is a minor edit (default true)"),
      message: z
        .string()
        .optional()
        .describe("Version update message / change comment"),
    },
    async ({
      pageId,
      heading,
      startAnchor,
      endAnchor,
      occurrence,
      matchMode,
      title,
      minorEdit,
      message,
    }) => {
      try {
        const block = await client.addAnchorsAroundSection({
          pageId,
          heading,
          startAnchor,
          endAnchor,
          occurrence,
          matchMode,
          title,
          minorEdit,
          message,
        });
        return jsonContent(block);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_preview_page_anchor_block_update",
    "Preview an anchor-based block update. Returns the current block, the proposed replacement, and a hash that must be echoed to the confirmed update call.",
    {
      pageId: z.string().describe("Confluence page ID"),
      startAnchor: z.string().describe("Start anchor name"),
      endAnchor: z.string().describe("End anchor name"),
      blockStorageValue: z
        .string()
        .describe("Proposed replacement storage XHTML between the two anchors"),
    },
    async ({ pageId, startAnchor, endAnchor, blockStorageValue }) => {
      try {
        const preview = await client.previewPageAnchorBlockUpdate({
          pageId,
          startAnchor,
          endAnchor,
          blockStorageValue,
        });
        return jsonContent(preview);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_update_page_anchor_block_confirmed",
    "Confirm an anchor-based block update after preview. The server re-reads the page and only updates when the preview hash still matches current content.",
    {
      pageId: z.string().describe("Confluence page ID"),
      startAnchor: z.string().describe("Start anchor name"),
      endAnchor: z.string().describe("End anchor name"),
      blockStorageValue: z
        .string()
        .describe("Replacement storage XHTML between the two anchors"),
      expectedCurrentHash: z
        .string()
        .describe("Hash returned by confluence_preview_page_anchor_block_update"),
      title: z
        .string()
        .optional()
        .describe("New page title (keeps current title if omitted)"),
      minorEdit: z
        .boolean()
        .optional()
        .describe("Whether this is a minor edit (default true)"),
      message: z
        .string()
        .optional()
        .describe("Version update message / change comment"),
    },
    async ({
      pageId,
      startAnchor,
      endAnchor,
      blockStorageValue,
      expectedCurrentHash,
      title,
      minorEdit,
      message,
    }) => {
      try {
        const block = await client.confirmPageAnchorBlockUpdate({
          pageId,
          startAnchor,
          endAnchor,
          blockStorageValue,
          expectedCurrentHash,
          title,
          minorEdit,
          message,
        });
        return jsonContent(block);
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "confluence_upload_attachment",
    "Upload an attachment to a Confluence page. Supports local filePath or base64Data; same-name files are updated by default. Returns attachment fields and image storage markup when applicable.",
    {
      pageId: z.string().describe("Confluence page ID"),
      filePath: z
        .string()
        .optional()
        .describe("Local file path to upload from the MCP server machine"),
      base64Data: z
        .string()
        .optional()
        .describe("Base64 file content, optionally as a data URL"),
      fileName: z
        .string()
        .optional()
        .describe("Attachment file name. Required for base64Data; defaults to basename(filePath)"),
      contentType: z
        .string()
        .optional()
        .describe("MIME type such as image/png. Inferred from fileName when omitted"),
      comment: z.string().optional().describe("Attachment version comment"),
      minorEdit: z
        .boolean()
        .optional()
        .describe("Whether this attachment version is a minor edit (default true)"),
      overwrite: z
        .boolean()
        .optional()
        .describe("Update same-name attachment as a new version when true (default true); fail on duplicates when false"),
    },
    async ({
      pageId,
      filePath,
      base64Data,
      fileName,
      contentType,
      comment,
      minorEdit,
      overwrite,
    }) => {
      try {
        const attachment = await client.uploadAttachment({
          pageId,
          filePath,
          base64Data,
          fileName,
          contentType,
          comment,
          minorEdit,
          overwrite,
        });
        return jsonContent(attachment);
      } catch (error) {
        return errorContent(error);
      }
    },
  );
}
