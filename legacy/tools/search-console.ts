import { google } from "googleapis";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoogleClient } from "./google-auth.js";

export function registerSearchConsoleTools(server: McpServer) {
  server.tool(
    "gsc_list_sites",
    "List all sites in Google Search Console for a workspace",
    { workspace_id: z.string() },
    async ({ workspace_id }) => {
      const auth = await getGoogleClient(workspace_id);
      const sc = google.searchconsole({ version: "v1", auth });
      const res = await sc.sites.list();
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gsc_query_performance",
    "Query Search Console performance data (clicks, impressions, CTR, position)",
    {
      workspace_id: z.string(),
      site_url: z.string().describe("e.g. https://example.com/ or sc-domain:example.com"),
      start_date: z.string().describe("YYYY-MM-DD"),
      end_date: z.string().describe("YYYY-MM-DD"),
      dimensions: z.array(z.enum(["query", "page", "country", "device", "date"])).default(["query"]),
      row_limit: z.number().int().min(1).max(25000).default(100),
      filters: z
        .array(
          z.object({
            dimension: z.string(),
            operator: z.enum(["equals", "contains", "notEquals", "notContains", "includingRegex", "excludingRegex"]),
            expression: z.string(),
          })
        )
        .optional(),
    },
    async ({ workspace_id, site_url, start_date, end_date, dimensions, row_limit, filters }) => {
      const auth = await getGoogleClient(workspace_id);
      const sc = google.searchconsole({ version: "v1", auth });
      const res = await sc.searchanalytics.query({
        siteUrl: site_url,
        requestBody: {
          startDate: start_date,
          endDate: end_date,
          dimensions,
          rowLimit: row_limit,
          dimensionFilterGroups: filters
            ? [{ filters: filters.map((f) => ({ dimension: f.dimension, operator: f.operator, expression: f.expression })) }]
            : undefined,
        },
      });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gsc_list_sitemaps",
    "List submitted sitemaps for a GSC site",
    { workspace_id: z.string(), site_url: z.string() },
    async ({ workspace_id, site_url }) => {
      const auth = await getGoogleClient(workspace_id);
      const sc = google.searchconsole({ version: "v1", auth });
      const res = await sc.sitemaps.list({ siteUrl: site_url });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gsc_inspect_url",
    "Inspect a URL in Google Search Console (index status, coverage, enhancements)",
    {
      workspace_id: z.string(),
      site_url: z.string(),
      inspect_url: z.string().url(),
    },
    async ({ workspace_id, site_url, inspect_url }) => {
      const auth = await getGoogleClient(workspace_id);
      const sc = google.searchconsole({ version: "v1", auth });
      const res = await sc.urlInspection.index.inspect({
        requestBody: { inspectionUrl: inspect_url, siteUrl: site_url },
      });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
