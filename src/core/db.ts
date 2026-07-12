import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let _client: SupabaseClient | null = null;

/** Service-role Supabase client. All access control happens in this service layer. */
export function db(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

/** Throw a readable error when a Supabase call fails. */
export function must<T>(result: { data: T | null; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${context}: no data returned`);
  return result.data;
}
