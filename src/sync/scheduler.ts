import { env } from "../core/env.js";
import { logger } from "../core/logger.js";
import { getDueSchedules } from "../store/sync.js";
import { processOutboundQueue, runDueSyncs } from "./engine.js";

const log = logger("scheduler");

let timer: NodeJS.Timeout | null = null;
let ticking = false;

/**
 * In-process scheduler: every tick, run due provider syncs and drain the
 * outbound queue. Single-instance by design — if the hub ever runs replicated,
 * move claiming into Postgres (SELECT ... FOR UPDATE SKIP LOCKED via an RPC).
 */
export function startScheduler(): void {
  if (env.syncDisabled) {
    log.warn("sync disabled via SYNC_DISABLED=true — scheduler not started");
    return;
  }
  const tickMs = env.schedulerTickSeconds * 1000;
  timer = setInterval(() => void tick(), tickMs);
  timer.unref();
  log.info(`scheduler started (tick every ${env.schedulerTickSeconds}s)`);
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    await runDueSyncs(getDueSchedules);
    await processOutboundQueue();
  } catch (err) {
    log.error("tick failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    ticking = false;
  }
}
