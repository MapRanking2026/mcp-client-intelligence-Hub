import { db, must } from "../core/db.js";
import type { ClientIdentity } from "../connectors/types.js";

export interface ClientRow {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: Record<string, unknown> | null;
  profile: Record<string, unknown>;
  health: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export async function listClients(tenantId: string, status?: string): Promise<ClientRow[]> {
  let query = db().from("clients").select("*").eq("tenant_id", tenantId).order("name");
  if (status) query = query.eq("status", status);
  const res = await query;
  return must(res, "listClients") as unknown as ClientRow[];
}

export async function getClient(tenantId: string, clientId: string): Promise<ClientRow> {
  const res = await db().from("clients").select("*").eq("tenant_id", tenantId).eq("id", clientId).single();
  return must(res, `getClient ${clientId}`) as unknown as ClientRow;
}

export async function createClient(
  tenantId: string,
  fields: { name: string } & Partial<Pick<ClientRow, "status" | "website" | "phone" | "email" | "profile">>
): Promise<ClientRow> {
  const res = await db()
    .from("clients")
    .insert({ tenant_id: tenantId, ...fields })
    .select("*")
    .single();
  return must(res, "createClient") as unknown as ClientRow;
}

export async function updateClient(
  tenantId: string,
  clientId: string,
  fields: Partial<Pick<ClientRow, "name" | "status" | "website" | "phone" | "email" | "address" | "profile" | "health">>
): Promise<ClientRow> {
  const res = await db()
    .from("clients")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", clientId)
    .select("*")
    .single();
  return must(res, `updateClient ${clientId}`) as unknown as ClientRow;
}

export async function listIdentities(tenantId: string, provider?: string, clientId?: string): Promise<ClientIdentity[]> {
  let query = db().from("client_identities").select("*").eq("tenant_id", tenantId);
  if (provider) query = query.eq("provider", provider);
  if (clientId) query = query.eq("client_id", clientId);
  const res = await query;
  return must(res, "listIdentities") as unknown as ClientIdentity[];
}

export async function linkIdentity(
  tenantId: string,
  clientId: string,
  identity: { provider: string; external_type: string; external_id: string; display_name?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const res = await db()
    .from("client_identities")
    .upsert(
      { tenant_id: tenantId, client_id: clientId, ...identity },
      { onConflict: "tenant_id,provider,external_type,external_id" }
    );
  if (res.error) throw new Error(`linkIdentity: ${res.error.message}`);
}

export async function unlinkIdentity(tenantId: string, identityId: string): Promise<void> {
  const res = await db().from("client_identities").delete().eq("tenant_id", tenantId).eq("id", identityId);
  if (res.error) throw new Error(`unlinkIdentity: ${res.error.message}`);
}
