import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "../core/env.js";
import { listConnectors } from "../connectors/registry.js";
import {
  createClient,
  getClient,
  linkIdentity,
  listClients,
  listIdentities,
  updateClient,
} from "../store/clients.js";
import { getMetrics, listEntities, searchClientData } from "../store/entities.js";
import { assetKinds, createAsset, getAsset, listAssets, updateAsset } from "../store/assets.js";
import {
  audit,
  enqueueOutbound,
  listConnections,
  listSchedules,
  recentRuns,
  upsertSchedule,
} from "../store/sync.js";
import { runSync } from "../sync/engine.js";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * The hub's MCP surface. Design rules:
 *  - Agents reference clients by hub ID; credentials/tokens NEVER appear in tool
 *    params or results.
 *  - Reads come from the synchronized store (no live provider calls).
 *  - Writes to external systems go through the outbound queue, not directly.
 */
export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "client-intelligence-hub", version: "2.0.0" });
  const tenantId = env.defaultTenantId;

  // ── Clients ────────────────────────────────────────────────────────────────
  server.tool(
    "list_clients",
    "List all clients in the hub with id, name, and status",
    { status: z.enum(["active", "paused", "churned", "prospect"]).optional() },
    async ({ status }) => {
      const clients = await listClients(tenantId, status);
      return json(clients.map((c) => ({ id: c.id, name: c.name, status: c.status, website: c.website })));
    }
  );

  server.tool(
    "get_client",
    "Get a client's full centralized record: profile, health, linked external accounts, recent activity, and recent assets",
    { client_id: z.string().uuid() },
    async ({ client_id }) => {
      const [client, identities, recentEntities, recentAssets] = await Promise.all([
        getClient(tenantId, client_id),
        listIdentities(tenantId, undefined, client_id),
        listEntities(tenantId, { clientId: client_id, limit: 25 }),
        listAssets(tenantId, { clientId: client_id, limit: 10 }),
      ]);
      return json({
        client,
        linkedAccounts: identities,
        recentActivity: recentEntities.map((e) => ({
          provider: e.provider,
          type: e.entity_type,
          title: e.title,
          occurredAt: e.occurred_at,
          data: e.data,
        })),
        recentAssets: recentAssets.map((a) => ({ id: a.id, kind: a.kind, title: a.title, createdAt: a.created_at, sourceApp: a.source_app })),
      });
    }
  );

  server.tool(
    "create_client",
    "Create a new client record in the hub",
    {
      name: z.string().min(1),
      status: z.enum(["active", "paused", "churned", "prospect"]).default("active"),
      website: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      profile: z.record(z.unknown()).optional(),
    },
    async (fields) => {
      const client = await createClient(tenantId, fields);
      await audit(tenantId, "mcp", "client.create", client.id, { name: client.name });
      return json(client);
    }
  );

  server.tool(
    "update_client",
    "Update a client's hub record (name, status, contact info, or profile fields). Profile fields are merged shallowly.",
    {
      client_id: z.string().uuid(),
      name: z.string().optional(),
      status: z.enum(["active", "paused", "churned", "prospect"]).optional(),
      website: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      profile: z.record(z.unknown()).optional().describe("Merged into the existing profile object"),
    },
    async ({ client_id, profile, ...rest }) => {
      const fields: Record<string, unknown> = { ...rest };
      if (profile) {
        const current = await getClient(tenantId, client_id);
        fields.profile = { ...current.profile, ...profile };
      }
      const client = await updateClient(tenantId, client_id, fields);
      await audit(tenantId, "mcp", "client.update", client_id, { fields: Object.keys(fields) });
      return json(client);
    }
  );

  server.tool(
    "link_client_account",
    "Link an external account/object (ClickUp list, GHL location, GSC site, GA4 property, …) to a client so syncs attribute its data correctly",
    {
      client_id: z.string().uuid(),
      provider: z.string().describe("Provider id, e.g. 'clickup', 'gohighlevel', 'google-search-console'"),
      external_type: z.string().describe("e.g. 'list', 'location', 'site', 'ga4_property', 'gbp_location', 'ads_customer_id'"),
      external_id: z.string(),
      display_name: z.string().optional(),
    },
    async ({ client_id, ...identity }) => {
      await linkIdentity(tenantId, client_id, identity);
      await audit(tenantId, "mcp", "identity.link", client_id, identity);
      return json({ ok: true, linked: identity });
    }
  );

  // ── Data access ────────────────────────────────────────────────────────────
  server.tool(
    "search_client_data",
    "Full-text search across all synced records and saved assets, optionally scoped to one client",
    {
      query: z.string().min(2),
      client_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ query, client_id, limit }) => json(await searchClientData(tenantId, query, client_id, limit))
  );

  server.tool(
    "get_client_activity",
    "Get synced records for a client (tasks, contacts, opportunities, reviews, emails, …), filterable by provider/type/date",
    {
      client_id: z.string().uuid(),
      provider: z.string().optional(),
      entity_type: z.string().optional(),
      since: z.string().optional().describe("ISO timestamp — only records that occurred after this"),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ client_id, provider, entity_type, since, limit }) =>
      json(await listEntities(tenantId, { clientId: client_id, provider, entityType: entity_type, since, limit }))
  );

  server.tool(
    "get_client_metrics",
    "Get daily time-series metrics for a client (e.g. gsc.clicks, gsc.impressions, ads.cost, ga4.sessions)",
    {
      client_id: z.string().uuid(),
      metrics: z.array(z.string()).optional().describe("Metric names to include; omit for all"),
      from: z.string().optional().describe("YYYY-MM-DD"),
      to: z.string().optional().describe("YYYY-MM-DD"),
    },
    async ({ client_id, metrics, from, to }) => json(await getMetrics(tenantId, { clientId: client_id, metrics, from, to }))
  );

  // ── Assets (agent/app write-back into the client record) ──────────────────
  server.tool(
    "save_asset",
    "Save a generated artifact (note, report, analysis, email draft, meeting summary, action items, document) into a client's record",
    {
      client_id: z.string().uuid(),
      kind: z.enum(assetKinds),
      title: z.string().min(1),
      content_md: z.string().optional().describe("Markdown content of the asset"),
      content_url: z.string().optional().describe("URL for large/binary assets stored elsewhere"),
      source_app: z.string().default("mcp-agent").describe("Which app/agent is saving this, e.g. 'mtos'"),
      created_by: z.string().optional(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.unknown()).optional(),
    },
    async (fields) => {
      const asset = await createAsset(tenantId, {
        ...fields,
        tags: fields.tags ?? [],
        metadata: fields.metadata ?? {},
      });
      await audit(tenantId, fields.source_app, "asset.create", asset.id, { kind: asset.kind, title: asset.title });
      return json({ id: asset.id, createdAt: asset.created_at });
    }
  );

  server.tool(
    "get_asset",
    "Get a saved asset by id, including its full content",
    { asset_id: z.string().uuid() },
    async ({ asset_id }) => json(await getAsset(tenantId, asset_id))
  );

  server.tool(
    "list_assets",
    "List saved assets, optionally filtered by client, kind, or tag (content omitted — use get_asset)",
    {
      client_id: z.string().uuid().optional(),
      kind: z.enum(assetKinds).optional(),
      tag: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
    },
    async ({ client_id, kind, tag, limit }) => {
      const assets = await listAssets(tenantId, { clientId: client_id, kind, tag, limit });
      return json(assets.map(({ content_md: _c, ...rest }) => rest));
    }
  );

  server.tool(
    "update_asset",
    "Update a saved asset's title, content, or tags",
    {
      asset_id: z.string().uuid(),
      title: z.string().optional(),
      content_md: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async ({ asset_id, ...fields }) => {
      const asset = await updateAsset(tenantId, asset_id, fields);
      await audit(tenantId, "mcp", "asset.update", asset_id);
      return json({ id: asset.id, updatedAt: asset.updated_at });
    }
  );

  // ── Write-back to external systems ─────────────────────────────────────────
  server.tool(
    "push_external_update",
    "Queue a create/update to an external system (e.g. update a GHL contact, create a ClickUp task). The hub pushes it with stored credentials and confirms on the next sync.",
    {
      client_id: z.string().uuid(),
      provider: z.string(),
      entity_type: z.string().describe("e.g. 'contact' (gohighlevel), 'task' (clickup)"),
      operation: z.enum(["create", "update"]),
      external_id: z.string().optional().describe("Required for updates — the provider-side id"),
      payload: z.record(z.unknown()).describe("Provider-shaped fields for the create/update"),
      requested_by: z.string().optional(),
    },
    async ({ client_id, provider, entity_type, operation, external_id, payload, requested_by }) => {
      const id = await enqueueOutbound(tenantId, {
        client_id,
        provider,
        entity_type,
        external_id,
        operation,
        payload,
        requested_by,
      });
      await audit(tenantId, requested_by ?? "mcp", "outbound.enqueue", id, { provider, entity_type, operation });
      return json({ queued: true, change_id: id, note: "Processed by the next scheduler tick (≤60s)" });
    }
  );

  // ── Sync operations & status ───────────────────────────────────────────────
  server.tool(
    "get_sync_status",
    "Show all connectors: connection status, schedule, last runs, and whether they're implemented yet",
    {},
    async () => {
      const [connections, schedules, runs] = await Promise.all([
        listConnections(tenantId),
        listSchedules(tenantId),
        recentRuns(tenantId, undefined, 30),
      ]);
      const connectors = listConnectors().map((c) => {
        const conn = connections.find((x) => x.provider === c.id);
        const sched = schedules.find((x) => x.provider === c.id);
        const lastRun = runs.find((r) => r.provider === c.id);
        return {
          provider: c.id,
          name: c.displayName,
          implemented: c.implemented,
          connected: conn ? conn.status : "not_connected",
          schedule: sched ? { enabled: sched.enabled, intervalMinutes: sched.interval_minutes, nextRunAt: sched.next_run_at } : null,
          lastRun: lastRun
            ? { status: lastRun.status, startedAt: lastRun.started_at, counts: lastRun.counts, error: lastRun.error }
            : null,
        };
      });
      return json(connectors);
    }
  );

  server.tool(
    "trigger_sync",
    "Immediately run a sync for one provider instead of waiting for the schedule",
    { provider: z.string() },
    async ({ provider }) => json(await runSync(tenantId, provider, "manual"))
  );

  server.tool(
    "set_sync_schedule",
    "Enable/disable a provider's scheduled sync or change its interval (minutes)",
    {
      provider: z.string(),
      enabled: z.boolean().optional(),
      interval_minutes: z.number().int().min(5).max(1440).optional(),
    },
    async ({ provider, enabled, interval_minutes }) => {
      await upsertSchedule(tenantId, provider, { enabled, interval_minutes });
      return json({ ok: true, provider, enabled, interval_minutes });
    }
  );

  return server;
}
