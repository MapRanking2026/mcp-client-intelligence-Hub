import "dotenv/config";
import http from "http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { registerGhlTools } from "./tools/ghl.js";
import { registerClickUpTools } from "./tools/clickup.js";
import { registerGbpTools } from "./tools/gbp.js";
import { registerSearchConsoleTools } from "./tools/search-console.js";
import { registerGoogleAdsTools } from "./tools/google-ads.js";
import { registerLsaTools } from "./tools/google-lsa.js";
import { registerGmailTools } from "./tools/gmail.js";

// ── Build MCP server ──────────────────────────────────────────────────────────
const server = new McpServer({
  name: "mtos-mcp",
  version: "1.0.0",
});

registerGhlTools(server);
registerClickUpTools(server);
registerGbpTools(server);
registerSearchConsoleTools(server);
registerGoogleAdsTools(server);
registerLsaTools(server);
registerGmailTools(server);

// ── HTTP server with SSE transport ────────────────────────────────────────────
const PORT = Number(process.env.MCP_PORT ?? 3001);
const SECRET = process.env.MCP_SECRET;

/** Active SSE transports keyed by session-id. */
const transports = new Map<string, SSEServerTransport>();

const httpServer = http.createServer(async (req, res) => {
  // Optional bearer-token auth
  if (SECRET) {
    const auth = req.headers["authorization"] ?? "";
    if (auth !== `Bearer ${SECRET}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // ── SSE connection ─────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/sse") {
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await server.connect(transport);
    return;
  }

  // ── Incoming messages from client ──────────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId");
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      await transport.handlePostMessage(req, res, JSON.parse(body));
    });
    return;
  }

  // ── Health check ───────────────────────────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "mtos-mcp", version: "1.0.0" }));
    return;
  }

  res.writeHead(404);
  res.end();
});

httpServer.listen(PORT, () => {
  console.log(`[mtos-mcp] Server running on http://localhost:${PORT}`);
  console.log(`[mtos-mcp] SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`[mtos-mcp] Health:       http://localhost:${PORT}/health`);
});
