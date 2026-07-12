import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoogleClient } from "./google-auth.js";

/**
 * Google Ads uses the REST API (gaql endpoint).
 * Requires `developer-token` header + customer-id.
 */
async function adsQuery(
  accessToken: string,
  devToken: string,
  customerId: string,
  gaql: string
): Promise<unknown> {
  const res = await fetch(
    `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: gaql }),
    }
  );
  if (!res.ok) throw new Error(`Google Ads ${customerId} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export function registerGoogleAdsTools(server: McpServer) {
  server.tool(
    "gads_list_campaigns",
    "List Google Ads campaigns for a customer",
    {
      workspace_id: z.string(),
      customer_id: z.string().describe("10-digit customer ID without dashes"),
      dev_token: z.string().describe("Google Ads developer token"),
      status_filter: z.enum(["ENABLED", "PAUSED", "REMOVED", "ALL"]).default("ENABLED"),
    },
    async ({ workspace_id, customer_id, dev_token, status_filter }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const where = status_filter !== "ALL" ? `WHERE campaign.status = '${status_filter}'` : "";
      const data = await adsQuery(
        token!,
        dev_token,
        customer_id,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.ctr, metrics.average_cpc
         FROM campaign ${where} ORDER BY metrics.cost_micros DESC LIMIT 50`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gads_get_campaign_metrics",
    "Get detailed metrics for a specific Google Ads campaign over a date range",
    {
      workspace_id: z.string(),
      customer_id: z.string(),
      dev_token: z.string(),
      campaign_id: z.string(),
      start_date: z.string().describe("YYYY-MM-DD"),
      end_date: z.string().describe("YYYY-MM-DD"),
    },
    async ({ workspace_id, customer_id, dev_token, campaign_id, start_date, end_date }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const data = await adsQuery(
        token!,
        dev_token,
        customer_id,
        `SELECT campaign.id, campaign.name,
                metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.ctr,
                metrics.average_cpc, metrics.conversions, metrics.cost_per_conversion,
                segments.date
         FROM campaign
         WHERE campaign.id = ${campaign_id}
           AND segments.date BETWEEN '${start_date}' AND '${end_date}'
         ORDER BY segments.date`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gads_list_keywords",
    "List keywords and their performance for an ad group",
    {
      workspace_id: z.string(),
      customer_id: z.string(),
      dev_token: z.string(),
      ad_group_id: z.string().optional(),
      campaign_id: z.string().optional(),
    },
    async ({ workspace_id, customer_id, dev_token, ad_group_id, campaign_id }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const conditions: string[] = ["ad_group_criterion.type = 'KEYWORD'"];
      if (ad_group_id) conditions.push(`ad_group.id = ${ad_group_id}`);
      if (campaign_id) conditions.push(`campaign.id = ${campaign_id}`);
      const where = `WHERE ${conditions.join(" AND ")}`;
      const data = await adsQuery(
        token!,
        dev_token,
        customer_id,
        `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
                ad_group_criterion.status, metrics.clicks, metrics.impressions,
                metrics.cost_micros, metrics.ctr, metrics.average_cpc, metrics.quality_score
         FROM keyword_view ${where} ORDER BY metrics.cost_micros DESC LIMIT 100`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gads_custom_query",
    "Run a custom GAQL (Google Ads Query Language) query",
    {
      workspace_id: z.string(),
      customer_id: z.string(),
      dev_token: z.string(),
      gaql: z.string().describe("Full GAQL SELECT statement"),
    },
    async ({ workspace_id, customer_id, dev_token, gaql }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const data = await adsQuery(token!, dev_token, customer_id, gaql);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
