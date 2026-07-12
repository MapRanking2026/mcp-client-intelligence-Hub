-- ============================================================================
-- Client Intelligence Hub — canonical Postgres schema (Supabase)
-- Apply via Supabase SQL editor or `psql -f db/schema.sql`.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Tenancy ─────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ── Clients: the central record everything hangs off ───────────────────────
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  status      text not null default 'active',          -- active | paused | churned | prospect
  website     text,
  phone       text,
  email       text,
  address     jsonb,
  profile     jsonb not null default '{}'::jsonb,      -- normalized business profile (industry, services, market, notes)
  health      jsonb,                                   -- latest computed health snapshot
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clients_tenant_idx on clients (tenant_id, status);

-- ── Identity resolution: which external objects belong to which client ─────
-- The linchpin of the hub. One client ↔ many (provider, external_type, external_id).
create table if not exists client_identities (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  provider       text not null,                        -- 'clickup', 'gohighlevel', 'google-search-console', ...
  external_type  text not null,                        -- 'list', 'location', 'site', 'ga4_property', 'gbp_location', ...
  external_id    text not null,
  display_name   text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (tenant_id, provider, external_type, external_id)
);
create index if not exists client_identities_client_idx on client_identities (client_id);
create index if not exists client_identities_provider_idx on client_identities (tenant_id, provider);

-- ── Connections: provider credentials per tenant (encrypted at rest) ───────
create table if not exists connections (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenants(id) on delete cascade,
  provider                text not null,
  auth_mode               text not null default 'oauth',   -- oauth | api_key | service_account
  status                  text not null default 'connected', -- connected | action_required | error | disabled
  credentials_ciphertext  text,                            -- AES-256-GCM blob (see src/lib/crypto.ts)
  scopes                  text[],
  external_account_id     text,
  token_expires_at        timestamptz,
  last_validated_at       timestamptz,
  error_message           text,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, provider)
);

-- ── Sync scheduling & bookkeeping ───────────────────────────────────────────
create table if not exists sync_schedules (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  provider          text not null,
  enabled           boolean not null default true,
  interval_minutes  int not null default 60,
  next_run_at       timestamptz not null default now(),
  last_run_at       timestamptz,
  cursor            jsonb not null default '{}'::jsonb,   -- connector-defined incremental cursor
  running           boolean not null default false,
  updated_at        timestamptz not null default now(),
  unique (tenant_id, provider)
);
create index if not exists sync_schedules_due_idx on sync_schedules (enabled, next_run_at);

create table if not exists sync_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  provider     text not null,
  status       text not null default 'running',          -- running | completed | failed
  trigger      text not null default 'schedule',         -- schedule | manual | webhook
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  counts       jsonb not null default '{}'::jsonb,       -- { fetched, created, updated, skipped, metrics }
  error        text
);
create index if not exists sync_runs_recent_idx on sync_runs (tenant_id, provider, started_at desc);

-- ── Entities: normalized records pulled from providers ─────────────────────
-- Every synced object (task, contact, email thread, review, campaign, meeting…)
-- lands here in a common envelope; provider-specific detail lives in `data`.
create table if not exists entities (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  client_id       uuid references clients(id) on delete set null,
  provider        text not null,
  entity_type     text not null,                         -- 'task', 'contact', 'opportunity', 'email_thread', 'review', ...
  external_id     text not null,
  title           text,
  summary         text,
  data            jsonb not null default '{}'::jsonb,    -- normalized fields
  raw             jsonb,                                 -- trimmed original payload (debugging/reprocessing)
  occurred_at     timestamptz,                           -- when the thing happened in the source system
  content_hash    text,                                  -- change detection
  first_seen_at   timestamptz not null default now(),
  last_synced_at  timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  search          tsvector generated always as (
                    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))
                  ) stored,
  unique (tenant_id, provider, entity_type, external_id)
);
create index if not exists entities_client_idx on entities (client_id, entity_type, occurred_at desc);
create index if not exists entities_search_idx on entities using gin (search);

-- ── Metrics: daily time series (GA4, GSC, Ads, LSA, rank tracker…) ─────────
create table if not exists metrics_daily (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  client_id  uuid references clients(id) on delete cascade,
  provider   text not null,
  metric     text not null,                              -- 'gsc.clicks', 'ads.cost', 'ga4.sessions', ...
  date       date not null,
  dim_key    text not null default '',                   -- stable hash/label of dimensions ('' = total)
  dims       jsonb not null default '{}'::jsonb,
  value      numeric not null,
  synced_at  timestamptz not null default now(),
  primary key (tenant_id, provider, metric, date, dim_key, client_id)
);
create index if not exists metrics_client_idx on metrics_daily (client_id, metric, date desc);

-- ── Assets: artifacts written back by AI agents & applications ──────────────
create table if not exists assets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  kind        text not null,                             -- note | report | analysis | email_draft | meeting_summary | action_items | document
  title       text not null,
  content_md  text,                                      -- inline markdown content
  content_url text,                                      -- object-storage URL for large/binary assets
  mime_type   text,
  source_app  text not null default 'unknown',           -- which app/agent created it (e.g. 'mtos', 'claude-code')
  created_by  text,
  tags        text[] not null default '{}',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search      tsvector generated always as (
                to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_md, ''))
              ) stored
);
create index if not exists assets_client_idx on assets (client_id, kind, created_at desc);
create index if not exists assets_search_idx on assets using gin (search);

-- ── Outbound changes: write-back queue to external providers ────────────────
create table if not exists outbound_changes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  client_id     uuid references clients(id) on delete set null,
  provider      text not null,
  entity_type   text not null,
  external_id   text,                                    -- null for creates
  operation     text not null,                           -- create | update
  payload       jsonb not null,
  status        text not null default 'pending',         -- pending | pushed | confirmed | failed
  attempts      int not null default 0,
  requested_by  text,
  error         text,
  created_at    timestamptz not null default now(),
  pushed_at     timestamptz
);
create index if not exists outbound_pending_idx on outbound_changes (status, created_at);

-- ── Audit log ────────────────────────────────────────────────────────────────
create table if not exists audit_log (
  id         bigint generated always as identity primary key,
  tenant_id  uuid,
  actor      text not null,                              -- app/agent/api-key name
  action     text not null,                              -- 'asset.create', 'client.update', 'outbound.enqueue', ...
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- ── API keys for consuming applications (MTOS, agents, future apps) ────────
create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  name         text not null,
  key_hash     text not null unique,                     -- sha256 of the raw key
  scopes       text[] not null default '{read,write}',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

-- ── Full-text search across entities + assets ───────────────────────────────
create or replace function search_client_data(
  p_tenant uuid,
  p_query  text,
  p_client uuid default null,
  p_limit  int default 20
) returns table (
  source      text,
  id          uuid,
  client_id   uuid,
  provider    text,
  record_type text,
  title       text,
  snippet     text,
  occurred_at timestamptz,
  rank        real
) language sql stable as $$
  with q as (select websearch_to_tsquery('english', p_query) as tsq)
  (
    select 'entity'::text as source, e.id, e.client_id, e.provider,
           e.entity_type as record_type, e.title,
           left(coalesce(e.summary, ''), 300) as snippet,
           e.occurred_at, ts_rank(e.search, q.tsq) as rank
    from entities e, q
    where e.tenant_id = p_tenant
      and e.search @@ q.tsq
      and (p_client is null or e.client_id = p_client)
  )
  union all
  (
    select 'asset'::text, a.id, a.client_id, a.source_app, a.kind,
           a.title, left(coalesce(a.content_md, ''), 300), a.created_at,
           ts_rank(a.search, q.tsq)
    from assets a, q
    where a.tenant_id = p_tenant
      and a.search @@ q.tsq
      and (p_client is null or a.client_id = p_client)
  )
  order by rank desc
  limit p_limit;
$$;
