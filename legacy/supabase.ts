import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    _client = createClient(url, key);
  }
  return _client;
}

/** Retrieve a stored OAuth token row from `connector_tokens`. */
export async function getConnectorToken(workspaceId: string, provider: string) {
  const { data, error } = await getSupabase()
    .from("connector_tokens")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .single();

  if (error) throw new Error(`No ${provider} token for workspace ${workspaceId}: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Upsert a token row (used during OAuth callbacks). */
export async function upsertConnectorToken(
  workspaceId: string,
  provider: string,
  fields: Record<string, unknown>
) {
  const { error } = await getSupabase()
    .from("connector_tokens")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert({ workspace_id: workspaceId, provider, ...fields } as any, { onConflict: "workspace_id,provider" });
  if (error) throw new Error(`Failed to save ${provider} token: ${error.message}`);
}
