import type { Connector, ConnectorContext, NormalizedEntity, PullResult } from "./types.js";

const BASE = "https://api.clickup.com/api/v2";

async function cuFetch(token: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: token, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`ClickUp ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  status?: { status: string };
  date_updated?: string;
  date_created?: string;
  due_date?: string | null;
  url?: string;
  assignees?: Array<{ username?: string; email?: string }>;
  tags?: Array<{ name: string }>;
  priority?: { priority?: string } | null;
  list?: { id: string };
}

function normalizeTask(task: ClickUpTask, clientId: string | null): NormalizedEntity {
  return {
    entityType: "task",
    externalId: task.id,
    clientId,
    title: task.name,
    summary: task.description?.slice(0, 500),
    occurredAt: task.date_updated ? new Date(Number(task.date_updated)).toISOString() : undefined,
    data: {
      status: task.status?.status,
      dueDate: task.due_date ? new Date(Number(task.due_date)).toISOString() : null,
      url: task.url,
      assignees: task.assignees?.map((a) => a.username ?? a.email).filter(Boolean),
      tags: task.tags?.map((t) => t.name),
      priority: task.priority?.priority ?? null,
      listId: task.list?.id,
    },
  };
}

/**
 * Pulls tasks for every client identity of external_type "list".
 * Cursor: { lastSyncMs: number } — only tasks updated since the last run are fetched.
 */
export const clickupConnector: Connector = {
  id: "clickup",
  displayName: "ClickUp",
  authMode: "oauth",
  implemented: true,
  capabilities: { pull: true, push: true, webhooks: true },

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    const token = String(ctx.credentials.access_token ?? "");
    if (!token) throw new Error("ClickUp connection has no access_token");

    const since = Number(ctx.cursor.lastSyncMs ?? 0);
    const startedAt = Date.now();
    const entities: NormalizedEntity[] = [];

    const lists = ctx.identities.filter((i) => i.external_type === "list");
    for (const list of lists) {
      let page = 0;
      for (;;) {
        const params = new URLSearchParams({
          page: String(page),
          include_closed: "true",
          subtasks: "true",
        });
        if (since > 0) params.set("date_updated_gt", String(since));
        const data = await cuFetch(token, `/list/${list.external_id}/task?${params}`);
        const tasks = (data.tasks ?? []) as ClickUpTask[];
        entities.push(...tasks.map((t) => normalizeTask(t, list.client_id)));
        if (data.last_page === true || tasks.length === 0) break;
        page += 1;
        if (page > 50) break; // safety valve
      }
    }

    ctx.log.info(`clickup pull: ${entities.length} tasks across ${lists.length} lists`);
    return { entities, nextCursor: { lastSyncMs: startedAt } };
  },

  async push(ctx, change) {
    const token = String(ctx.credentials.access_token ?? "");
    if (change.entity_type !== "task") throw new Error(`clickup push: unsupported entity_type ${change.entity_type}`);

    if (change.operation === "update" && change.external_id) {
      const res = await fetch(`${BASE}/task/${change.external_id}`, {
        method: "PUT",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify(change.payload),
      });
      if (!res.ok) throw new Error(`ClickUp task update → ${res.status}: ${await res.text()}`);
      return {};
    }

    if (change.operation === "create") {
      const listId = String(change.payload.listId ?? "");
      if (!listId) throw new Error("clickup push create requires payload.listId");
      const { listId: _omit, ...body } = change.payload;
      const res = await fetch(`${BASE}/list/${listId}/task`, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`ClickUp task create → ${res.status}: ${await res.text()}`);
      const created = (await res.json()) as { id?: string };
      return { externalId: created.id };
    }

    throw new Error(`clickup push: unsupported operation ${change.operation}`);
  },

  async validate(ctx) {
    const token = String(ctx.credentials.access_token ?? "");
    await cuFetch(token, "/user");
  },
};
