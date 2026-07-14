import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  get port() {
    // Render/Heroku-style platforms inject PORT; MCP_PORT is the local override.
    return Number(process.env.PORT ?? process.env.MCP_PORT ?? 3001);
  },
  /** Static bearer secret for the MCP endpoint (per-app api_keys can layer on later). */
  get mcpSecret() {
    return process.env.MCP_SECRET;
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Single-tenant deployments pin the tenant here; multi-tenant resolves per API key. */
  get defaultTenantId() {
    return required("DEFAULT_TENANT_ID");
  },
  /** How often the scheduler checks for due syncs (seconds). */
  get schedulerTickSeconds() {
    return Number(process.env.SCHEDULER_TICK_SECONDS ?? 60);
  },
  get syncDisabled() {
    return process.env.SYNC_DISABLED === "true";
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
};
