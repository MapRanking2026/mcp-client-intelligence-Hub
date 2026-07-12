import "dotenv/config";
import { startHttpServer } from "./http.js";
import { startScheduler, stopScheduler } from "./sync/scheduler.js";
import { logger } from "./core/logger.js";

const log = logger("main");

const httpServer = startHttpServer();
startScheduler();

function shutdown(signal: string) {
  log.info(`${signal} received — shutting down`);
  stopScheduler();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
