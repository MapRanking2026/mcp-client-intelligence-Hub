import crypto from "crypto";
import { db, must } from "../core/db.js";
import type { MetricPoint, NormalizedEntity } from "../connectors/types.js";

export interface EntityRow {
  id: string;
  tenant_id: string;
  client_id: string | null;
  provider: string;
  entity_type: string;
  external_id: string;
  title: string | null;
  summary: string | null;
  data: Record<string, unknown>;
  occurred_at: string | null;
  last_synced_at: string;
}

export interface UpsertCounts {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

function hashOf(e: NormalizedEntity): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ t: e.title, s: e.summary, d: e.data, c: e.clientId ?? null }))
    .digest("hex");
}

/**
 * Idempotent batch upsert with content-hash change detection, so unchanged
 * records don't churn updated_at (and consumers can trust it).
 */
export async function upsertEntities(
  tenantId: string,
  provider: string,
  entities: NormalizedEntity[]
): Promise<UpsertCounts> {
  const counts: UpsertCounts = { fetched: entities.length, created: 0, updated: 0, skipped: 0 };
  if (entities.length === 0) return counts;

  const keys = entities.map((e) => e.externalId);
  const existingRes = await db()
    .from("entities")
    .select("external_id, entity_type, content_hash")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .in("external_id", keys);
  const existing = must(existingRes, "upsertEntities/select") as unknown as Array<{
    external_id: string;
    entity_type: string;
    content_hash: string | null;
  }>;
  const existingHash = new Map(existing.map((r) => [`${r.entity_type}:${r.external_id}`, r.content_hash]));

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  for (const e of entities) {
    const hash = hashOf(e);
    const prior = existingHash.get(`${e.entityType}:${e.externalId}`);
    if (prior === hash) {
      counts.skipped += 1;
      continue;
    }
    if (prior === undefined) counts.created += 1;
    else counts.updated += 1;
    rows.push({
      tenant_id: tenantId,
      provider,
      entity_type: e.entityType,
      external_id: e.externalId,
      client_id: e.clientId ?? null,
      title: e.title ?? null,
      summary: e.summary ?? null,
      data: e.data,
      raw: e.raw ?? null,
      occurred_at: e.occurredAt ?? null,
      content_hash: hash,
      last_synced_at: now,
      updated_at: now,
    });
  }

  if (rows.length > 0) {
    const res = await db()
      .from("entities")
      .upsert(rows, { onConflict: "tenant_id,provider,entity_type,external_id" });
    if (res.error) throw new Error(`upsertEntities: ${res.error.message}`);
  }
  return counts;
}

export async function listEntities(
  tenantId: string,
  filter: { clientId?: string; provider?: string; entityType?: string; since?: string; limit?: number }
): Promise<EntityRow[]> {
  let query = db()
    .from("entities")
    .select("id, tenant_id, client_id, provider, entity_type, external_id, title, summary, data, occurred_at, last_synced_at")
    .eq("tenant_id", tenantId)
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(filter.limit ?? 50);
  if (filter.clientId) query = query.eq("client_id", filter.clientId);
  if (filter.provider) query = query.eq("provider", filter.provider);
  if (filter.entityType) query = query.eq("entity_type", filter.entityType);
  if (filter.since) query = query.gte("occurred_at", filter.since);
  const res = await query;
  return must(res, "listEntities") as unknown as EntityRow[];
}

export async function upsertMetrics(tenantId: string, provider: string, points: MetricPoint[]): Promise<number> {
  if (points.length === 0) return 0;
  const rows = points.map((p) => ({
    tenant_id: tenantId,
    provider,
    client_id: p.clientId ?? null,
    metric: p.metric,
    date: p.date,
    dim_key: p.dimensions ? JSON.stringify(p.dimensions) : "",
    dims: p.dimensions ?? {},
    value: p.value,
    synced_at: new Date().toISOString(),
  }));
  // PK covers (tenant, provider, metric, date, dim_key, client_id) — upsert refreshes values.
  const res = await db()
    .from("metrics_daily")
    .upsert(rows, { onConflict: "tenant_id,provider,metric,date,dim_key,client_id" });
  if (res.error) throw new Error(`upsertMetrics: ${res.error.message}`);
  return rows.length;
}

export interface MetricRow {
  provider: string;
  metric: string;
  date: string;
  dim_key: string;
  value: number;
}

export async function getMetrics(
  tenantId: string,
  filter: { clientId: string; metrics?: string[]; from?: string; to?: string; limit?: number }
): Promise<MetricRow[]> {
  let query = db()
    .from("metrics_daily")
    .select("provider, metric, date, dim_key, value")
    .eq("tenant_id", tenantId)
    .eq("client_id", filter.clientId)
    .order("date", { ascending: false })
    .limit(filter.limit ?? 1000);
  if (filter.metrics?.length) query = query.in("metric", filter.metrics);
  if (filter.from) query = query.gte("date", filter.from);
  if (filter.to) query = query.lte("date", filter.to);
  const res = await query;
  return must(res, "getMetrics") as unknown as MetricRow[];
}

export interface SearchHit {
  source: string;
  id: string;
  client_id: string | null;
  provider: string;
  record_type: string;
  title: string | null;
  snippet: string | null;
  occurred_at: string | null;
  rank: number;
}

export async function searchClientData(
  tenantId: string,
  query: string,
  clientId?: string,
  limit = 20
): Promise<SearchHit[]> {
  const res = await db().rpc("search_client_data", {
    p_tenant: tenantId,
    p_query: query,
    p_client: clientId ?? null,
    p_limit: limit,
  });
  return must(res, "searchClientData") as unknown as SearchHit[];
}
