import { google } from "googleapis";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoogleClient } from "./google-auth.js";

async function gbpPost(accessToken: string, path: string, body: unknown) {
  const res = await fetch(`https://mybusiness.googleapis.com/v4/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GBP ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export function registerGbpTools(server: McpServer) {
  server.tool(
    "gbp_list_accounts",
    "List Google Business Profile accounts for a workspace",
    { workspace_id: z.string() },
    async ({ workspace_id }) => {
      const auth = await getGoogleClient(workspace_id);
      const client = google.mybusinessaccountmanagement({ version: "v1", auth });
      const res = await client.accounts.list();
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_list_locations",
    "List GBP locations under an account",
    {
      workspace_id: z.string(),
      account_name: z.string().describe("Format: accounts/{accountId}"),
    },
    async ({ workspace_id, account_name }) => {
      const auth = await getGoogleClient(workspace_id);
      const client = google.mybusinessbusinessinformation({ version: "v1", auth });
      const res = await client.accounts.locations.list({ parent: account_name });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_get_location",
    "Get a single GBP location",
    {
      workspace_id: z.string(),
      location_name: z.string().describe("Format: locations/{locationId}"),
    },
    async ({ workspace_id, location_name }) => {
      const auth = await getGoogleClient(workspace_id);
      const client = google.mybusinessbusinessinformation({ version: "v1", auth });
      const res = await client.locations.get({ name: location_name });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_list_reviews",
    "List reviews for a GBP location",
    {
      workspace_id: z.string(),
      location_name: z.string().describe("Format: locations/{locationId}"),
      page_size: z.number().int().min(1).max(200).default(50),
    },
    async ({ workspace_id, location_name, page_size }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const res = await fetch(
        `https://mybusiness.googleapis.com/v4/${location_name}/reviews?pageSize=${page_size}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_reply_to_review",
    "Reply to a GBP review",
    {
      workspace_id: z.string(),
      review_name: z.string().describe("Format: locations/{locationId}/reviews/{reviewId}"),
      reply_text: z.string(),
    },
    async ({ workspace_id, review_name, reply_text }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const res = await fetch(
        `https://mybusiness.googleapis.com/v4/${review_name}/reply`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ comment: reply_text }),
        }
      );
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_create_post",
    "Create a Google Business Profile local post",
    {
      workspace_id: z.string(),
      location_name: z.string().describe("Format: locations/{locationId}"),
      summary: z.string(),
      cta_type: z.enum(["LEARN_MORE", "BOOK", "ORDER", "SHOP", "SIGN_UP", "CALL"]).optional(),
      cta_url: z.string().url().optional(),
      event_title: z.string().optional(),
      event_start: z.string().optional().describe("ISO 8601"),
      event_end: z.string().optional(),
    },
    async ({ workspace_id, location_name, summary, cta_type, cta_url, event_title, event_start, event_end }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const body: Record<string, unknown> = { languageCode: "en-US", summary };
      if (cta_type) body.callToAction = { actionType: cta_type, url: cta_url };
      if (event_title) body.event = { title: event_title, schedule: { startDateTime: event_start, endDateTime: event_end } };
      const data = await gbpPost(token!, `${location_name}/localPosts`, body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "gbp_get_insights",
    "Get location insights (impressions, clicks, calls) from GBP",
    {
      workspace_id: z.string(),
      location_name: z.string(),
      start_date: z.string().describe("YYYY-MM-DD"),
      end_date: z.string().describe("YYYY-MM-DD"),
    },
    async ({ workspace_id, location_name, start_date, end_date }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const data = await gbpPost(token!, `${location_name}:reportInsights`, {
        locationNames: [location_name],
        basicRequest: {
          metricRequests: [{ metric: "ALL" }],
          timeRange: { startTime: `${start_date}T00:00:00Z`, endTime: `${end_date}T23:59:59Z` },
        },
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
