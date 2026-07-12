import { db, must } from "../core/db.js";

export interface AssetRow {
  id: string;
  tenant_id: string;
  client_id: string;
  kind: string;
  title: string;
  content_md: string | null;
  content_url: string | null;
  mime_type: string | null;
  source_app: string;
  created_by: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const assetKinds = [
  "note",
  "report",
  "analysis",
  "email_draft",
  "meeting_summary",
  "action_items",
  "document",
] as const;

export async function createAsset(
  tenantId: string,
  fields: {
    client_id: string;
    kind: string;
    title: string;
    content_md?: string;
    content_url?: string;
    mime_type?: string;
    source_app: string;
    created_by?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<AssetRow> {
  const res = await db()
    .from("assets")
    .insert({ tenant_id: tenantId, ...fields })
    .select("*")
    .single();
  return must(res, "createAsset") as unknown as AssetRow;
}

export async function updateAsset(
  tenantId: string,
  assetId: string,
  fields: Partial<Pick<AssetRow, "title" | "content_md" | "tags" | "metadata">>
): Promise<AssetRow> {
  const res = await db()
    .from("assets")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", assetId)
    .select("*")
    .single();
  return must(res, `updateAsset ${assetId}`) as unknown as AssetRow;
}

export async function getAsset(tenantId: string, assetId: string): Promise<AssetRow> {
  const res = await db().from("assets").select("*").eq("tenant_id", tenantId).eq("id", assetId).single();
  return must(res, `getAsset ${assetId}`) as unknown as AssetRow;
}

export async function listAssets(
  tenantId: string,
  filter: { clientId?: string; kind?: string; tag?: string; limit?: number }
): Promise<AssetRow[]> {
  let query = db()
    .from("assets")
    .select("id, tenant_id, client_id, kind, title, source_app, created_by, tags, metadata, created_at, updated_at, content_url, mime_type, content_md")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 50);
  if (filter.clientId) query = query.eq("client_id", filter.clientId);
  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.tag) query = query.contains("tags", [filter.tag]);
  const res = await query;
  return must(res, "listAssets") as unknown as AssetRow[];
}
