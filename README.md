# Client Intelligence Hub (MCP Server)

Central source of truth for all client data. Syncs every connected platform on
a schedule, normalizes it into one client workspace, and serves it to MTOS and
AI agents over MCP. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Setup

1. **Database** — apply the schema to your Supabase project:
   paste `db/schema.sql` into the Supabase SQL editor and run it.

2. **Environment** — `.env` needs (in addition to the existing keys):

   ```
   DEFAULT_TENANT_ID=<uuid of your tenant row>
   SCHEDULER_TICK_SECONDS=60        # optional
   SYNC_DISABLED=true               # optional: run API without syncing
   ```

3. **Seed** — create the tenant and first clients (SQL editor):

   ```sql
   insert into tenants (name) values ('Map Ranking') returning id;
   -- put that id in DEFAULT_TENANT_ID, then:
   insert into clients (tenant_id, name, website) values ('<tenant-id>', 'Acme Plumbing', 'https://acmeplumbing.com');
   ```

4. **Connect a provider** — store encrypted credentials in `connections` and
   link external accounts to clients via the `link_client_account` MCP tool
   (or SQL). Then enable its schedule:

   ```sql
   insert into sync_schedules (tenant_id, provider, interval_minutes) values ('<tenant-id>', 'clickup', 60);
   ```

5. **Run**

   ```
   npm install
   npm run dev        # tsx watch
   npm run build && npm start
   ```

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /mcp` | MCP (Streamable HTTP). Auth: `Authorization: Bearer $MCP_SECRET` |
| `GET /health` | Liveness check |

Claude Code connection: `claude mcp add --transport http hub http://localhost:3001/mcp --header "Authorization: Bearer <secret>"`

## Layout

```
db/schema.sql          Postgres schema (canonical store)
src/core/              env, logger, db client
src/lib/crypto.ts      AES-256-GCM for credentials at rest
src/connectors/        Connector SDK + implementations (clickup, gohighlevel, google/*) + stubs
src/store/             Repositories: clients, entities/metrics, assets, sync bookkeeping
src/sync/              Scheduler + sync engine + outbound push queue
src/mcp/server.ts      The 16-tool MCP surface
src/http.ts            Streamable HTTP transport + auth
legacy/                V1 prototype (stateless token-in-params proxy) — reference only
```

## Adding a connector

1. Create `src/connectors/<provider>.ts` implementing `Connector`
   (see `clickup.ts` as the template — `pull` receives decrypted credentials,
   identity links, and the saved cursor; returns normalized entities/metrics).
2. Replace its stub entry in `src/connectors/registry.ts`.
3. Insert a `connections` row (encrypted credentials) and a `sync_schedules` row.

No core changes required.
