import { google } from "googleapis";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getGoogleClient } from "./google-auth.js";

export function registerGmailTools(server: McpServer) {
  server.tool(
    "gmail_list_messages",
    "List Gmail messages matching a query",
    {
      workspace_id: z.string(),
      query: z.string().default("is:unread").describe("Gmail search query (e.g. 'from:foo@bar.com is:unread')"),
      max_results: z.number().int().min(1).max(500).default(20),
      label_ids: z.array(z.string()).optional(),
    },
    async ({ workspace_id, query, max_results, label_ids }) => {
      const auth = await getGoogleClient(workspace_id);
      const gmail = google.gmail({ version: "v1", auth });
      const res = await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: max_results,
        labelIds: label_ids,
      });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gmail_get_message",
    "Get full details of a Gmail message including body",
    {
      workspace_id: z.string(),
      message_id: z.string(),
      format: z.enum(["full", "metadata", "minimal"]).default("full"),
    },
    async ({ workspace_id, message_id, format }) => {
      const auth = await getGoogleClient(workspace_id);
      const gmail = google.gmail({ version: "v1", auth });
      const res = await gmail.users.messages.get({ userId: "me", id: message_id, format });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gmail_send_email",
    "Send an email via Gmail",
    {
      workspace_id: z.string(),
      to: z.string().describe("Recipient email address(es), comma-separated"),
      subject: z.string(),
      body: z.string().describe("Plain-text body"),
      html_body: z.string().optional().describe("HTML body (overrides plain text if provided)"),
      cc: z.string().optional(),
      reply_to_message_id: z.string().optional().describe("Thread: Message-ID to reply to"),
    },
    async ({ workspace_id, to, subject, body, html_body, cc, reply_to_message_id }) => {
      const auth = await getGoogleClient(workspace_id);
      const gmail = google.gmail({ version: "v1", auth });

      const contentType = html_body ? "text/html" : "text/plain";
      const content = html_body ?? body;

      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        cc ? `Cc: ${cc}` : null,
        `Content-Type: ${contentType}; charset=utf-8`,
      ].filter(Boolean).join("\r\n");

      const raw = Buffer.from(`${headers}\r\n\r\n${content}`).toString("base64url");

      let threadId: string | undefined;
      if (reply_to_message_id) {
        const thread = await gmail.users.messages.get({ userId: "me", id: reply_to_message_id, format: "metadata" });
        threadId = thread.data.threadId ?? undefined;
      }

      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw, threadId },
      });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gmail_create_draft",
    "Create a Gmail draft",
    {
      workspace_id: z.string(),
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      html_body: z.string().optional(),
    },
    async ({ workspace_id, to, subject, body, html_body }) => {
      const auth = await getGoogleClient(workspace_id);
      const gmail = google.gmail({ version: "v1", auth });
      const contentType = html_body ? "text/html" : "text/plain";
      const content = html_body ?? body;
      const headers = [`To: ${to}`, `Subject: ${subject}`, `Content-Type: ${contentType}; charset=utf-8`].join("\r\n");
      const raw = Buffer.from(`${headers}\r\n\r\n${content}`).toString("base64url");
      const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gmail_label_message",
    "Add or remove labels on a Gmail message",
    {
      workspace_id: z.string(),
      message_id: z.string(),
      add_labels: z.array(z.string()).optional(),
      remove_labels: z.array(z.string()).optional(),
    },
    async ({ workspace_id, message_id, add_labels, remove_labels }) => {
      const auth = await getGoogleClient(workspace_id);
      const gmail = google.gmail({ version: "v1", auth });
      const res = await gmail.users.messages.modify({
        userId: "me",
        id: message_id,
        requestBody: { addLabelIds: add_labels, removeLabelIds: remove_labels },
      });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );

  server.tool(
    "gmail_list_labels",
    "List all Gmail labels for a workspace user",
    { workspace_id: z.string() },
    async ({ workspace_id }) => {
      const auth = await getGoogleClient(workspace_id);
      const gmail = google.gmail({ version: "v1", auth });
      const res = await gmail.users.labels.list({ userId: "me" });
      return { content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }] };
    }
  );
}
