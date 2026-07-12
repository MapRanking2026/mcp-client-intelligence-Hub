# Client Intelligence Hub — Architecture

The hub is the **source of truth for client data** across the agency's entire AI
ecosystem. It continuously syncs every connected platform into one normalized,
queryable client workspace, and exposes that workspace to applications and AI
agents (MTOS first) through a single MCP endpoint.

```
 External platforms                    THE HUB                        Consumers
┌──────────────────┐      ┌────────────────────────────────┐      ┌─────────────┐
│ ClickUp          │      │  ┌──────────┐   ┌───────────┐  │      │ MTOS        │
│ GoHighLevel      │ pull │  │   Sync   │──▶│ Canonical │  │ MCP  │ AI agents   │
│ Gmail / Drive    │◀────▶│  │  Engine  │   │   Store   │◀─┼─────▶│ Claude Code │
│ Google Ads / LSA │ push │  │(scheduled│   │ (Postgres)│  │      │ future apps │
│ GA4 / GSC / GBP  │      │  │ hourly)  │   └───────────┘  │      └─────────────┘
│ Calendar / Meet  │      │  └──────────┘         ▲        │
│ Rank tracker …   │      │   connectors    outbound queue │
└──────────────────┘      └────────────────────────────────┘
```

## Core principles

1. **Apps never call providers directly.** One request to the hub replaces a
   dozen live API calls. Reads are served from the already-synced store.
2. **Credentials never leave the server.** V1 passed OAuth tokens as MCP tool
   parameters — through the LLM context. V2 stores them AES-256-GCM encrypted in
   the `connections` table; agents reference clients by hub ID only.
3. **Real data only.** Everything readable through the hub was either pulled
   from a provider (with provenance: provider, external_id, synced_at) or
   explicitly written by an app/agent (with source_app + audit log). Nothing is
   estimated.
4. **Adding an integration touches no core code.** A connector is one module
   implementing the `Connector` interface plus one registry entry.

## The three layers

### 1. Canonical store (Postgres / Supabase) — `db/schema.sql`

| Table | Role |
|---|---|
| `clients` | The central record: profile, status, contact info, health |
| `client_identities` | **Identity resolution** — maps (provider, external_type, external_id) → client. The linchpin: syncs use it to attribute data |
| `entities` | Normalized records from providers (tasks, contacts, opportunities, reviews, emails, meetings…) in a common envelope with full-text search |
| `metrics_daily` | Time-series (GSC clicks, Ads cost, GA4 sessions, rank positions…) keyed by client/metric/date/dimensions |
| `assets` | Artifacts written back by agents/apps: notes, reports, analyses, email drafts, meeting summaries, action items |
| `connections` | Per-provider credentials, encrypted at rest |
| `sync_schedules` / `sync_runs` | Per-provider cadence (default 60 min, adjustable at runtime), incremental cursors, full run history |
| `outbound_changes` | Write-back queue to external systems |
| `audit_log` / `api_keys` | Who did what; per-app access keys |

**Why Postgres and not Firestore** (which MTOS uses today): client intelligence
is relational (join entities ↔ clients ↔ metrics), heavy on time-series
aggregation, and needs full-text search — all native to Postgres and weak or
expensive in Firestore. MTOS keeps Firestore for its own app state; it consumes
client data from the hub. Long-term, MTOS's integration syncing (ClickUp etc.)
migrates into the hub so it exists in exactly one place.

### 2. Sync engine — `src/sync/`, `src/connectors/`

- **Scheduler** (`scheduler.ts`): ticks every 60s, runs due `sync_schedules`,
  drains the outbound queue. Single-instance by design; if the hub is ever
  replicated, move claiming into Postgres (`FOR UPDATE SKIP LOCKED`).
- **Engine** (`engine.ts`): loads the connection (decrypts credentials), the
  provider's identity links, and the saved cursor; calls `connector.pull()`
  (paginated); upserts entities with **content-hash change detection** (unchanged
  records don't churn); records a `sync_run`; advances the cursor; reschedules.
  Failures retry within ≤10 minutes instead of waiting the full interval.
- **Connector interface** (`connectors/types.ts`): `pull(ctx) → { entities,
  metrics, nextCursor, hasMore }`, optional `push(ctx, change)`, optional
  `validate(ctx)`. Connectors receive decrypted credentials + identity links and
  return normalized data — they never touch the database.

Implemented: **ClickUp** (tasks per linked list, incremental by
`date_updated_gt`, push create/update), **GoHighLevel** (contacts +
opportunities per linked location, push contact create/update),
**Google Search Console** (daily clicks/impressions/CTR/position per linked
site, 90-day backfill, re-pulls a trailing window for GSC's data lag).
Declared stubs with implementation notes: Gmail, Drive, Google Ads, LSA, GA4,
GBP, Meet, Calendar, rank tracker, map check-ins.

### 3. MCP access layer — `src/mcp/server.ts`, `src/http.ts`

Streamable HTTP transport at `POST /mcp` (stateless: fresh server per request —
restart-safe, horizontally scalable), replacing v1's deprecated SSE transport.
Bearer-secret auth today; per-app `api_keys` (already in schema) next.

**Tool surface** (16 tools): `list_clients`, `get_client` (the 360° record:
profile + linked accounts + recent activity + recent assets), `create_client`,
`update_client`, `link_client_account`, `search_client_data` (full-text across
entities + assets), `get_client_activity`, `get_client_metrics`, `save_asset`,
`get_asset`, `list_assets`, `update_asset`, `push_external_update`,
`get_sync_status`, `trigger_sync`, `set_sync_schedule`.

## Bidirectional sync & conflict policy

- **Provider → hub**: scheduled incremental pulls. Provider is authoritative
  for provider-owned data (a GHL contact's phone number, a ClickUp task's
  status).
- **Hub-native data** (assets, client profile): the hub is authoritative;
  written via `save_asset` / `update_client`, audited with `source_app`.
- **Hub → provider**: agents call `push_external_update`, which **queues** the
  change (`outbound_changes`). The scheduler pushes it with server-held
  credentials and the next pull confirms it landed. Queuing (vs. live proxying)
  gives retries, rate-limit isolation, an audit trail, and keeps agent latency
  flat. Conflicts resolve as: last write to the provider wins, and the next
  pull re-syncs whatever the provider now says — the hub never silently
  overwrites provider state it hasn't seen.

## Identity resolution

Every synced object must belong to a client. The `client_identities` table maps
external anchors (a ClickUp list, a GHL location, a GSC site, a GA4 property, a
GBP location…) to hub clients. Linking is explicit (`link_client_account`) —
deterministic and auditable. Auto-suggestion (matching by domain/name/phone) is
a planned layer on top, but auto-linking is never silent.

## Security model

- Credentials: AES-256-GCM (`src/lib/crypto.ts`, key = `TENANT_ENCRYPTION_KEY`),
  decrypted only inside the sync/push path.
- Access: bearer secret now; hashed per-app API keys with scopes next.
- Every mutation is written to `audit_log` with actor + action + target.
- Multi-tenant-ready: every table is tenant-scoped; single-tenant deployments
  pin `DEFAULT_TENANT_ID`.

## Roadmap

1. **Now**: apply `db/schema.sql`, seed tenant + clients + identity links,
   connect ClickUp/GHL/GSC, let hourly sync run.
2. **Next**: port MTOS's OAuth callback flows to write into `connections`;
   point MTOS's client workspace at the hub; implement GA4, GBP, Google Ads
   connectors (highest-value metrics).
3. **Then**: Gmail/Drive/Calendar/Meet connectors; webhook ingestion
   (`capabilities.webhooks`) for near-real-time ClickUp/GHL updates; per-app API
   keys; embedding-based semantic search over entities + assets.
4. **Later**: auto identity-suggestion, computed client health scoring, event
   stream for consumers (changed-since queries already work via `updated_at`).
