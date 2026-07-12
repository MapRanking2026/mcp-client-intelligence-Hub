import http from "http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./mcp/server.js";
import { env } from "./core/env.js";
import { logger } from "./core/logger.js";

const log = logger("http");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function unauthorized(res: http.ServerResponse) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}

/**
 * Streamable HTTP MCP endpoint at /mcp (stateless mode: a fresh server+transport
 * per request — simple, restart-safe, horizontally scalable).
 * Auth: Bearer MCP_SECRET. Per-app api_keys can replace this without touching callers.
 */
export function startHttpServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${env.port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: "client-intelligence-hub", version: "2.0.0" }));
        return;
      }

      // Everything below requires auth.
      if (env.mcpSecret) {
        const auth = req.headers.authorization ?? "";
        if (auth !== `Bearer ${env.mcpSecret}`) {
          unauthorized(res);
          return;
        }
      }

      if (url.pathname === "/mcp") {
        if (req.method === "POST") {
          const body = await readBody(req);
          const mcpServer = buildMcpServer();
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          res.on("close", () => {
            void transport.close();
            void mcpServer.close();
          });
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
          return;
        }
        // Stateless mode: no SSE resumption streams, no sessions to delete.
        res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
        res.end(JSON.stringify({ error: "Method not allowed — stateless MCP endpoint accepts POST only" }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      log.error("request failed", { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });

  server.listen(env.port, () => {
    log.info(`Client Intelligence Hub listening on http://localhost:${env.port}`);
    log.info(`MCP endpoint:  POST http://localhost:${env.port}/mcp`);
    log.info(`Health check:  GET  http://localhost:${env.port}/health`);
  });
  return server;
}
