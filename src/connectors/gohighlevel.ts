import type { Connector, ConnectorContext, NormalizedEntity, PullResult } from "./types.js";

const BASE = "https://services.leadconnectorhq.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

async function ghlFetch(token: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers(token) });
  if (!res.ok) throw new Error(`GHL ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  dateUpdated?: string;
  dateAdded?: string;
  source?: string;
}

interface GhlOpportunity {
  id: string;
  name?: string;
  status?: string;
  monetaryValue?: number;
  pipelineId?: string;
  updatedAt?: string;
}

/**
 * Pulls contacts + opportunities for every client identity of external_type "location".
 * The stored credential is a location-scoped or agency access token.
 * Cursor: { lastSyncIso: string }.
 *
 * TODO: full pagination via startAfter/startAfterId once volumes require it —
 * currently fetches the most recent 100 per location per run.
 */
export const gohighlevelConnector: Connector = {
  id: "gohighlevel",
  displayName: "GoHighLevel",
  authMode: "oauth",
  implemented: true,
  capabilities: { pull: true, push: true, webhooks: true },

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    const token = String(ctx.credentials.access_token ?? ctx.credentials.private_token ?? "");
    if (!token) throw new Error("GoHighLevel connection has no access_token/private_token");

    const entities: NormalizedEntity[] = [];
    const locations = ctx.identities.filter((i) => i.external_type === "location");

    for (const loc of locations) {
      const contactsRes = await ghlFetch(token, `/contacts/?locationId=${loc.external_id}&limit=100`);
      const contacts = (contactsRes.contacts ?? []) as GhlContact[];
      for (const c of contacts) {
        entities.push({
          entityType: "contact",
          externalId: c.id,
          clientId: loc.client_id,
          title: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || c.id,
          occurredAt: c.dateUpdated ?? c.dateAdded,
          data: {
            email: c.email,
            phone: c.phone,
            tags: c.tags,
            source: c.source,
            locationId: loc.external_id,
          },
        });
      }

      const oppRes = await ghlFetch(token, `/opportunities/search?location_id=${loc.external_id}&limit=100`);
      const opportunities = (oppRes.opportunities ?? []) as GhlOpportunity[];
      for (const o of opportunities) {
        entities.push({
          entityType: "opportunity",
          externalId: o.id,
          clientId: loc.client_id,
          title: o.name ?? o.id,
          occurredAt: o.updatedAt,
          data: {
            status: o.status,
            monetaryValue: o.monetaryValue,
            pipelineId: o.pipelineId,
            locationId: loc.external_id,
          },
        });
      }
    }

    ctx.log.info(`gohighlevel pull: ${entities.length} records across ${locations.length} locations`);
    return { entities, nextCursor: { lastSyncIso: new Date().toISOString() } };
  },

  async push(ctx, change) {
    const token = String(ctx.credentials.access_token ?? ctx.credentials.private_token ?? "");
    if (change.entity_type !== "contact") {
      throw new Error(`gohighlevel push: unsupported entity_type ${change.entity_type}`);
    }

    if (change.operation === "update" && change.external_id) {
      await ghlFetch(token, `/contacts/${change.external_id}`, {
        method: "PUT",
        body: JSON.stringify(change.payload),
      });
      return {};
    }

    if (change.operation === "create") {
      const created = await ghlFetch(token, "/contacts", {
        method: "POST",
        body: JSON.stringify(change.payload),
      });
      const contact = created.contact as { id?: string } | undefined;
      return { externalId: contact?.id };
    }

    throw new Error(`gohighlevel push: unsupported operation ${change.operation}`);
  },
};
