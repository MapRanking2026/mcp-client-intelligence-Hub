import { db, must } from "../core/db.js";
import { decrypt } from "../lib/crypto.js";
import type { OutboundChangeRecord } from "../connectors/types.js";

export interface ScheduleRow {
  id: string;
  tenant_id: string;
  provider: string;
  enabled: boolean;
  interval_minutes: number;
  next_run_at: string;
  last_run_at: string | null;
  cursor: Record<string, unknown>;
  running: boolean;
}

export interface ConnectionRow {
  id: string;
  tenant_id: string;
  provider: string;
  auth_mode: string;
  status: string;
  credentials_ciphertext: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

export interface SyncRunRow {
  id: string;
  tenant_id: string;
  provider: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  counts: Record<string, number>;
  error: string | null;
}

// ── Connections ──────────────────────────────────────────────────────────────

export async function getConnection(tenantId: string, provider: string): Promise<ConnectionRow | null> {
  const res = await db()
    .from("connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();
  if (res.error) throw new Error(`getConnection ${provider}: ${res.error.message}`);
  return res.data as unknown as ConnectionRow | null;
}

export async function listConnections(tenantId: string): Promise<ConnectionRow[]> {
  const res = await db()
    .from("connections")
    .select("id, tenant_id, provider, auth_mode, status, error_message, metadata, credentials_ciphertext")
    .eq("tenant_id", tenantId);
  return must(res, "listConnections") as unknown as ConnectionRow[];
}

/** Decrypt stored credentials. Never expose the result outside the sync/push path. */
export function credentialsOf(conn: ConnectionRow): Record<string, unknown> {
  if (!conn.credentials_ciphertext) return {};
  return JSON.parse(decrypt(conn.credentials_ciphertext)) as Record<string, unknown>;
}

// ── Schedules ────────────────────────────────────────────────────────────────

export async function getDueSchedules(): Promise<ScheduleRow[]> {
  const res = await db()
    .from("sync_schedules")
    .select("*")
    .eq("enabled", true)
    .eq("running", false)
    .lte("next_run_at", new Date().toISOString());
  return must(res, "getDueSchedules") as unknown as ScheduleRow[];
}

export async function getSchedule(tenantId: string, provider: string): Promise<ScheduleRow | null> {
  const res = await db()
    .from("sync_schedules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();
  if (res.error) throw new Error(`getSchedule ${provider}: ${res.error.message}`);
  return res.data as unknown as ScheduleRow | null;
}

export async function listSchedules(tenantId: string): Promise<ScheduleRow[]> {
  const res = await db().from("sync_schedules").select("*").eq("tenant_id", tenantId);
  return must(res, "listSchedules") as unknown as ScheduleRow[];
}

export async function markScheduleRunning(id: string, running: boolean): Promise<void> {
  const res = await db()
    .from("sync_schedules")
    .update({ running, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (res.error) throw new Error(`markScheduleRunning: ${res.error.message}`);
}

export async function completeSchedule(
  id: string,
  intervalMinutes: number,
  cursor: Record<string, unknown>,
  failed: boolean
): Promise<void> {
  const now = Date.now();
  // Failed runs retry sooner (but back off from immediate hammering).
  const nextMinutes = failed ? Math.min(intervalMinutes, 10) : intervalMinutes;
  const update: Record<string, unknown> = {
    running: false,
    last_run_at: new Date(now).toISOString(),
    next_run_at: new Date(now + nextMinutes * 60_000).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  if (!failed) update.cursor = cursor;
  const res = await db().from("sync_schedules").update(update).eq("id", id);
  if (res.error) throw new Error(`completeSchedule: ${res.error.message}`);
}

export async function upsertSchedule(
  tenantId: string,
  provider: string,
  fields: { enabled?: boolean; interval_minutes?: number }
): Promise<void> {
  const res = await db()
    .from("sync_schedules")
    .upsert(
      { tenant_id: tenantId, provider, ...fields, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,provider" }
    );
  if (res.error) throw new Error(`upsertSchedule: ${res.error.message}`);
}

// ── Sync runs ────────────────────────────────────────────────────────────────

export async function startRun(tenantId: string, provider: string, trigger: string): Promise<string> {
  const res = await db()
    .from("sync_runs")
    .insert({ tenant_id: tenantId, provider, trigger, status: "running" })
    .select("id")
    .single();
  const row = must(res, "startRun") as unknown as { id: string };
  return row.id;
}

export async function finishRun(
  runId: string,
  status: "completed" | "failed",
  counts: Record<string, number>,
  error?: string
): Promise<void> {
  const res = await db()
    .from("sync_runs")
    .update({ status, counts, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", runId);
  if (res.error) throw new Error(`finishRun: ${res.error.message}`);
}

export async function recentRuns(tenantId: string, provider?: string, limit = 20): Promise<SyncRunRow[]> {
  let query = db()
    .from("sync_runs")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (provider) query = query.eq("provider", provider);
  const res = await query;
  return must(res, "recentRuns") as unknown as SyncRunRow[];
}

// ── Outbound changes (write-back queue) ─────────────────────────────────────

export async function enqueueOutbound(
  tenantId: string,
  change: {
    client_id?: string;
    provider: string;
    entity_type: string;
    external_id?: string;
    operation: "create" | "update";
    payload: Record<string, unknown>;
    requested_by?: string;
  }
): Promise<string> {
  const res = await db()
    .from("outbound_changes")
    .insert({ tenant_id: tenantId, ...change })
    .select("id")
    .single();
  const row = must(res, "enqueueOutbound") as unknown as { id: string };
  return row.id;
}

export interface OutboundRow extends OutboundChangeRecord {
  tenant_id: string;
  provider: string;
  status: string;
  attempts: number;
}

export async function pendingOutbound(limit = 25): Promise<OutboundRow[]> {
  const res = await db()
    .from("outbound_changes")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", 5)
    .order("created_at")
    .limit(limit);
  return must(res, "pendingOutbound") as unknown as OutboundRow[];
}

export async function resolveOutbound(
  id: string,
  status: "pushed" | "failed",
  attempts: number,
  error?: string,
  externalId?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    attempts,
    error: error ?? null,
    pushed_at: status === "pushed" ? new Date().toISOString() : null,
  };
  if (externalId) update.external_id = externalId;
  const res = await db().from("outbound_changes").update(update).eq("id", id);
  if (res.error) throw new Error(`resolveOutbound: ${res.error.message}`);
}

// ── Audit ────────────────────────────────────────────────────────────────────

export async function audit(
  tenantId: string,
  actor: string,
  action: string,
  target?: string,
  detail?: Record<string, unknown>
): Promise<void> {
  const res = await db().from("audit_log").insert({ tenant_id: tenantId, actor, action, target, detail });
  if (res.error) throw new Error(`audit: ${res.error.message}`);
}
