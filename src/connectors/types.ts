import type { Logger } from "../core/logger.js";

/** Every provider the hub knows about. Adding one = new module in src/connectors + registry entry. */
export type ProviderId =
  | "clickup"
  | "gohighlevel"
  | "gmail"
  | "google-drive"
  | "google-ads"
  | "google-lsa"
  | "google-analytics"
  | "google-search-console"
  | "google-business-profile"
  | "google-meet"
  | "google-calendar"
  | "rank-tracker"
  | "map-checkins";

/** A link between a hub client and an object in an external system. */
export interface ClientIdentity {
  id: string;
  client_id: string;
  provider: string;
  external_type: string;
  external_id: string;
  display_name: string | null;
  metadata: Record<string, unknown>;
}

/** Normalized record produced by a connector pull. */
export interface NormalizedEntity {
  entityType: string;
  externalId: string;
  /** Resolved hub client, when the connector can attribute the record. */
  clientId?: string | null;
  title?: string;
  summary?: string;
  data: Record<string, unknown>;
  raw?: Record<string, unknown>;
  /** ISO timestamp of when this happened in the source system. */
  occurredAt?: string;
}

/** One point in a daily time series. */
export interface MetricPoint {
  clientId?: string | null;
  metric: string;
  /** YYYY-MM-DD */
  date: string;
  value: number;
  dimensions?: Record<string, string>;
}

export interface PullResult {
  entities: NormalizedEntity[];
  metrics?: MetricPoint[];
  /** Persisted and handed back on the next pull — connector-defined shape. */
  nextCursor: Record<string, unknown>;
  /** True if the connector wants to be called again immediately (pagination). */
  hasMore?: boolean;
}

export interface OutboundChangeRecord {
  id: string;
  client_id: string | null;
  entity_type: string;
  external_id: string | null;
  operation: "create" | "update";
  payload: Record<string, unknown>;
}

export interface ConnectorContext {
  tenantId: string;
  /** Decrypted credentials from the connections table. */
  credentials: Record<string, unknown>;
  /** Identity links for this provider — connectors iterate these to know what to pull. */
  identities: ClientIdentity[];
  cursor: Record<string, unknown>;
  log: Logger;
}

export interface Connector {
  id: ProviderId;
  displayName: string;
  authMode: "oauth" | "api_key" | "service_account";
  /** Stubs are registered (they appear in status tools) but skipped by the sync engine. */
  implemented: boolean;
  capabilities: { pull: boolean; push: boolean; webhooks: boolean };
  /** Incremental pull. Must be idempotent — the engine upserts by (provider, entity_type, external_id). */
  pull(ctx: ConnectorContext): Promise<PullResult>;
  /** Push a hub-originated change to the provider. Returns the external id for creates. */
  push?(ctx: ConnectorContext, change: OutboundChangeRecord): Promise<{ externalId?: string }>;
  /** Optional credential/connection check. Throws on failure. */
  validate?(ctx: ConnectorContext): Promise<void>;
}
