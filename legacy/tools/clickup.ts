import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const BASE = "https://api.clickup.com/api/v2";

function headers(token: string) {
  return { Authorization: token, "Content-Type": "application/json" };
}

async function cuFetch(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers(token) });
  if (!res.ok) throw new Error(`ClickUp ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

export function registerClickUpTools(server: McpServer) {
  server.tool(
    "clickup_get_teams",
    "List all workspaces (teams) for the authenticated ClickUp user",
    { token: z.string() },
    async ({ token }) => {
      const data = await cuFetch(token, "/team");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "clickup_get_spaces",
    "List spaces in a ClickUp team",
    { token: z.string(), team_id: z.string() },
    async ({ token, team_id }) => {
      const data = await cuFetch(token, `/team/${team_id}/space?archived=false`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "clickup_get_lists",
    "List all lists in a ClickUp space",
    { token: z.string(), space_id: z.string() },
    async ({ token, space_id }) => {
      const data = await cuFetch(token, `/space/${space_id}/list`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "clickup_get_tasks",
    "Get tasks from a ClickUp list with optional filters",
    {
      token: z.string(),
      list_id: z.string(),
      status: z.string().optional(),
      assignee: z.number().int().optional(),
      due_date_gt: z.number().optional().describe("Unix ms timestamp"),
      due_date_lt: z.number().optional(),
      page: z.number().int().default(0),
    },
    async ({ token, list_id, status, assignee, due_date_gt, due_date_lt, page }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("statuses[]", status);
      if (assignee) params.set("assignees[]", String(assignee));
      if (due_date_gt) params.set("due_date_gt", String(due_date_gt));
      if (due_date_lt) params.set("due_date_lt", String(due_date_lt));
      const data = await cuFetch(token, `/list/${list_id}/task?${params}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "clickup_create_task",
    "Create a new task in a ClickUp list",
    {
      token: z.string(),
      list_id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      status: z.string().optional(),
      due_date: z.number().optional().describe("Unix ms timestamp"),
      assignees: z.array(z.number()).optional(),
      priority: z.number().int().min(1).max(4).optional().describe("1=urgent 2=high 3=normal 4=low"),
      tags: z.array(z.string()).optional(),
    },
    async ({ token, list_id, name, description, status, due_date, assignees, priority, tags }) => {
      const data = await cuFetch(token, `/list/${list_id}/task`, {
        method: "POST",
        body: JSON.stringify({ name, description, status, due_date, assignees, priority, tags }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "clickup_update_task",
    "Update an existing ClickUp task",
    {
      token: z.string(),
      task_id: z.string(),
      fields: z.record(z.unknown()).describe("Fields to update: name, status, due_date, assignees, priority, etc."),
    },
    async ({ token, task_id, fields }) => {
      const data = await cuFetch(token, `/task/${task_id}`, {
        method: "PUT",
        body: JSON.stringify(fields),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "clickup_search_tasks",
    "Full-text search across a ClickUp team",
    {
      token: z.string(),
      team_id: z.string(),
      query: z.string(),
    },
    async ({ token, team_id, query }) => {
      const data = await cuFetch(token, `/team/${team_id}/task?query=${encodeURIComponent(query)}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "clickup_add_comment",
    "Add a comment to a ClickUp task",
    {
      token: z.string(),
      task_id: z.string(),
      comment_text: z.string(),
      notify_all: z.boolean().default(false),
    },
    async ({ token, task_id, comment_text, notify_all }) => {
      const data = await cuFetch(token, `/task/${task_id}/comment`, {
        method: "POST",
        body: JSON.stringify({ comment_text, notify_all }),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
