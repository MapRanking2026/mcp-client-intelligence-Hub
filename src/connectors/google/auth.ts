import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { env } from "../../core/env.js";

/**
 * Build an OAuth2 client from a stored connection credential.
 * Credentials must contain a `refresh_token`; access tokens are refreshed on demand
 * by googleapis and never persisted.
 */
export function googleAuthFromCredentials(credentials: Record<string, unknown>): OAuth2Client {
  const refreshToken = String(credentials.refresh_token ?? "");
  if (!refreshToken) throw new Error("Google connection has no refresh_token");
  const client = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
