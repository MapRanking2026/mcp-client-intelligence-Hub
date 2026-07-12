import { getConnector } from "../connectors/registry.js";
import type { ConnectorContext } from "../connectors/types.js";
import { logger } from "../core/logger.js";
import { listIdentities } from "../store/clients.js";
import { upsertEntities, upsertMetrics } from "../store/entities.js";
import {
  completeSchedule,
  credentialsOf,
  finishRun,
  getConnection,
  getSchedule,
  markScheduleRunning,
  pendingOutbound,
  resolveOutbound,
  startRun,
  type ScheduleRow,
} from "../store/sync.js";

const log = logger("sync");
const MAX_PULL_PAGES = 25;

export interface SyncOutcome {
  runId: string;
  status: "completed" | "failed" | "skipped";
  counts: Record<string, number>;
  error?: string;
}

/** Run one provider sync for one tenant. Used by both the scheduler and manual triggers. */
export async function runSync(
  tenantId: string,
  provider: string,
  trigger: "schedule" | "manual" | "webhook"
): Promise<SyncOutcome> {
  const connector = getConnector(provider);
  if (!connector) return { runId: "", status: "skipped", counts: {}, error: `Unknown provider ${provider}` };
  if (!connector.implemented) {
    return { runId: "", status: "skipped", counts: {}, error: `Connector ${provider} not implemented yet` };
  }

  const connection = await getConnection(tenantId, provider);
  if (!connection || connection.status === "disabled") {
    return { runId: "", status: "skipped", counts: {}, error: `No active connection for ${provider}` };
  }

  const schedule = await getSchedule(tenantId, provider);
  const runId = await startRun(tenantId, provider, trigger);
  if (schedule) await markScheduleRunning(schedule.id, true);

  const counts: Record<string, number> = { fetched: 0, created: 0, updated: 0, skipped: 0, metrics: 0 };
  try {
    const ctx: ConnectorContext = {
      tenantId,
      credentials: credentialsOf(connection),
      identities: await listIdentities(tenantId, provider),
      cursor: schedule?.cursor ?? {},
      log: logger(`sync:${provider}`),
    };

    let cursor = ctx.cursor;
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const result = await connector.pull({ ...ctx, cursor });
      const c = await upsertEntities(tenantId, provider, result.entities);
      counts.fetched += c.fetched;
      counts.created += c.created;
      counts.updated += c.updated;
      counts.skipped += c.skipped;
      if (result.metrics?.length) counts.metrics += await upsertMetrics(tenantId, provider, result.metrics);
      cursor = result.nextCursor;
      if (!result.hasMore) break;
    }

    await finishRun(runId, "completed", counts);
    if (schedule) await completeSchedule(schedule.id, schedule.interval_minutes, cursor, false);
    log.info(`sync completed`, { provider, tenantId, ...counts });
    return { runId, status: "completed", counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, "failed", counts, message);
    if (schedule) await completeSchedule(schedule.id, schedule.interval_minutes, schedule.cursor, true);
    log.error(`sync failed`, { provider, tenantId, error: message });
    return { runId, status: "failed", counts, error: message };
  }
}

/** Find and run every due schedule (called by the scheduler tick). */
export async function runDueSyncs(getDue: () => Promise<ScheduleRow[]>): Promise<void> {
  const due = await getDue();
  for (const schedule of due) {
    await runSync(schedule.tenant_id, schedule.provider, "schedule");
  }
}

/** Drain the outbound write-back queue: push hub-originated changes to providers. */
export async function processOutboundQueue(): Promise<void> {
  const pending = await pendingOutbound();
  for (const change of pending) {
    const connector = getConnector(change.provider);
    if (!connector?.push) {
      await resolveOutbound(change.id, "failed", change.attempts + 1, `Connector ${change.provider} has no push support`);
      continue;
    }
    const connection = await getConnection(change.tenant_id, change.provider);
    if (!connection) {
      await resolveOutbound(change.id, "failed", change.attempts + 1, `No connection for ${change.provider}`);
      continue;
    }
    try {
      const ctx: ConnectorContext = {
        tenantId: change.tenant_id,
        credentials: credentialsOf(connection),
        identities: await listIdentities(change.tenant_id, change.provider),
        cursor: {},
        log: logger(`push:${change.provider}`),
      };
      const result = await connector.push(ctx, change);
      await resolveOutbound(change.id, "pushed", change.attempts + 1, undefined, result.externalId);
      log.info("outbound pushed", { provider: change.provider, id: change.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await resolveOutbound(change.id, "failed", change.attempts + 1, message);
      log.error("outbound push failed", { provider: change.provider, id: change.id, error: message });
    }
  }
}
