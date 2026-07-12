import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const BASE = "https://services.leadconnectorhq.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

async function ghlFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers(token) });
  if (!res.ok) throw new Error(`GHL ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export function registerGhlTools(server: McpServer) {
  // ── Contacts ──────────────────────────────────────────────────────────────
  server.tool(
    "ghl_search_contacts",
    "Search GHL contacts by name, email, or phone",
    {
      token: z.string().describe("GHL location access token"),
      location_id: z.string(),
      query: z.string().describe("Name, email, or phone to search"),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ token, location_id, query, limit }) => {
      const data = await ghlFetch(
        token,
        `/contacts/search?locationId=${location_id}&query=${encodeURIComponent(query)}&limit=${limit}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "ghl_get_contact",
    "Get a single GHL contact by ID",
    { token: z.string(), contact_id: z.string() },
    async ({ token, contact_id }) => {
      const data = await ghlFetch(token, `/contacts/${contact_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "ghl_create_contact",
    "Create a new GHL contact",
    {
      token: z.string(),
      location_id: z.string(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ token, location_id, first_name, last_name, email, phone, tags }) => {
      const data = await ghlFetch(token, "/contacts", {
        method: "POST",
        body: JSON.stringify({ locationId: location_id, firstName: first_name, lastName: last_name, email, phone, tags }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "ghl_update_contact",
    "Update a GHL contact",
    {
      token: z.string(),
      contact_id: z.string(),
      fields: z.record(z.unknown()).describe("Fields to update (firstName, lastName, email, phone, tags, etc.)"),
    },
    async ({ token, contact_id, fields }) => {
      const data = await ghlFetch(token, `/contacts/${contact_id}`, {
        method: "PUT",
        body: JSON.stringify(fields),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Opportunities ─────────────────────────────────────────────────────────
  server.tool(
    "ghl_list_opportunities",
    "List opportunities in a GHL pipeline",
    {
      token: z.string(),
      location_id: z.string(),
      pipeline_id: z.string().optional(),
      stage_id: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ token, location_id, pipeline_id, stage_id, limit }) => {
      const params = new URLSearchParams({ location_id, limit: String(limit) });
      if (pipeline_id) params.set("pipeline_id", pipeline_id);
      if (stage_id) params.set("pipeline_stage_id", stage_id);
      const data = await ghlFetch(token, `/opportunities/search?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "ghl_create_opportunity",
    "Create an opportunity in a GHL pipeline",
    {
      token: z.string(),
      location_id: z.string(),
      pipeline_id: z.string(),
      stage_id: z.string(),
      contact_id: z.string(),
      name: z.string(),
      monetary_value: z.number().optional(),
      status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
    },
    async ({ token, location_id, pipeline_id, stage_id, contact_id, name, monetary_value, status }) => {
      const data = await ghlFetch(token, "/opportunities", {
        method: "POST",
        body: JSON.stringify({
          locationId: location_id,
          pipelineId: pipeline_id,
          pipelineStageId: stage_id,
          contactId: contact_id,
          name,
          monetaryValue: monetary_value,
          status,
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Conversations / SMS / Email ────────────────────────────────────────────
  server.tool(
    "ghl_send_message",
    "Send an SMS or email via GHL conversation",
    {
      token: z.string(),
      location_id: z.string(),
      contact_id: z.string(),
      type: z.enum(["SMS", "Email"]),
      message: z.string(),
      subject: z.string().optional().describe("Required for Email"),
    },
    async ({ token, location_id, contact_id, type, message, subject }) => {
      const data = await ghlFetch(token, "/conversations/messages", {
        method: "POST",
        body: JSON.stringify({ locationId: location_id, contactId: contact_id, type, message, subject }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Locations ─────────────────────────────────────────────────────────────
  server.tool(
    "ghl_list_locations",
    "List all sub-account locations under the agency",
    {
      token: z.string().describe("Agency-level private integration token"),
      agency_id: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ token, agency_id, limit }) => {
      const data = await ghlFetch(token, `/locations/search?companyId=${agency_id}&limit=${limit}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Calendars / Appointments ───────────────────────────────────────────────
  server.tool(
    "ghl_list_appointments",
    "List appointments for a contact or date range",
    {
      token: z.string(),
      location_id: z.string(),
      contact_id: z.string().optional(),
      start_time: z.string().optional().describe("ISO 8601"),
      end_time: z.string().optional().describe("ISO 8601"),
    },
    async ({ token, location_id, contact_id, start_time, end_time }) => {
      const params = new URLSearchParams({ locationId: location_id });
      if (contact_id) params.set("contactId", contact_id);
      if (start_time) params.set("startTime", start_time);
      if (end_time) params.set("endTime", end_time);
      const data = await ghlFetch(token, `/appointments?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
