import { google } from "googleapis";
import { getConnectorToken, upsertConnectorToken } from "../lib/supabase.js";
import { decrypt } from "../lib/crypto.js";

/**
 * Build an authenticated Google OAuth2 client for a workspace.
 * Tokens are stored in `connector_tokens` with provider = "google".
 * Access tokens are auto-refreshed and written back to Supabase.
 */
export async function getGoogleClient(workspaceId: string) {
  const row = await getConnectorToken(workspaceId, "google");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set");

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const accessToken = row.access_token_enc
    ? decrypt(row.access_token_enc as string)
    : (row.access_token as string);
  const refreshToken = row.refresh_token_enc
    ? decrypt(row.refresh_token_enc as string)
    : (row.refresh_token as string);

  oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  // Auto-refresh and persist
  oauth2.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await upsertConnectorToken(workspaceId, "google", {
        access_token: tokens.access_token,
        expiry_date: tokens.expiry_date,
      });
    }
  });

  return oauth2;
}

/** Build a Google OAuth URL for initial consent (use in MTOS connector flow). */
export function buildGoogleAuthUrl(scopes: string[], state: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;
  const oauth2 = new google.auth.OAuth2(clientId, undefined, redirectUri);
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
  });
}
