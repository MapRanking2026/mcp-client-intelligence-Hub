import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoogleClient } from "./google-auth.js";

const LSA_BASE = "https://localservices.googleapis.com/v1";

async function lsaFetch(accessToken: string, path: string, init?: RequestInit) {
  const res = await fetch(`${LSA_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    },
  });
  if (!res.ok) throw new Error(`LSA ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export function registerLsaTools(server: McpServer) {
  server.tool(
    "lsa_list_accounts",
    "List Google Local Services Ads accounts",
    { workspace_id: z.string() },
    async ({ workspace_id }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const data = await lsaFetch(token!, "/accounts");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "lsa_list_leads",
    "List LSA leads (phone calls, messages) for an account",
    {
      workspace_id: z.string(),
      account_id: z.string(),
      lead_type: z.enum(["PHONE_CALL", "MESSAGE", "ALL"]).default("ALL"),
      lead_status: z.enum(["NEW", "ACTIVE", "BOOKED", "DECLINED", "EXPIRED", "DISABLED", "CONSUMER_DECLINED", "WIPED_OUT", "ALL"]).default("ALL"),
      page_size: z.number().int().min(1).max(1000).default(50),
    },
    async ({ workspace_id, account_id, lead_type, lead_status, page_size }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const params = new URLSearchParams({ pageSize: String(page_size) });
      if (lead_type !== "ALL") params.set("filter", `lead_type="${lead_type}"`);
      const data = await lsaFetch(token!, `/accounts/${account_id}/leads?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "lsa_get_lead",
    "Get a single LSA lead by name",
    {
      workspace_id: z.string(),
      lead_name: z.string().describe("Format: accounts/{accountId}/leads/{leadId}"),
    },
    async ({ workspace_id, lead_name }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const data = await lsaFetch(token!, `/${lead_name}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "lsa_update_lead",
    "Update an LSA lead status",
    {
      workspace_id: z.string(),
      lead_name: z.string().describe("Format: accounts/{accountId}/leads/{leadId}"),
      lead_status: z.enum(["ACTIVE", "BOOKED", "DECLINED"]),
    },
    async ({ workspace_id, lead_name, lead_status }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const data = await lsaFetch(token!, `/${lead_name}`, {
        method: "PATCH",
        body: JSON.stringify({ leadStatus: lead_status }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "lsa_get_account_budget",
    "Get budget and spend summary for an LSA account",
    {
      workspace_id: z.string(),
      account_id: z.string(),
    },
    async ({ workspace_id, account_id }) => {
      const auth = await getGoogleClient(workspace_id);
      const { token } = await auth.getAccessToken();
      const data = await lsaFetch(token!, `/accounts/${account_id}/accountBudget`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
