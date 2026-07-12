import type { Connector, ProviderId } from "./types.js";

/**
 * Declared-but-not-yet-implemented connectors. They show up in connection/status
 * tooling so the roadmap is visible, but the sync engine skips them.
 * Implementing one = replace the stub with a real module (see clickup.ts as the template).
 */
function stub(
  id: ProviderId,
  displayName: string,
  authMode: Connector["authMode"],
  notes: string
): Connector {
  return {
    id,
    displayName,
    authMode,
    implemented: false,
    capabilities: { pull: true, push: false, webhooks: false },
    async pull() {
      throw new Error(`Connector "${id}" is not implemented yet. ${notes}`);
    },
  };
}

export const stubConnectors: Connector[] = [
  stub("gmail", "Gmail", "oauth", "Pull: threads/messages per client email domain via users.messages.list."),
  stub("google-drive", "Google Drive", "oauth", "Pull: files per client folder identity via files.list(q)."),
  stub("google-ads", "Google Ads", "oauth", "Pull: daily campaign metrics via GAQL; identity external_type 'ads_customer_id'."),
  stub("google-lsa", "Google Local Services Ads", "oauth", "Pull: leads + account reports; identity 'lsa_account_id'."),
  stub("google-analytics", "Google Analytics (GA4)", "oauth", "Pull: daily sessions/conversions via Data API runReport; identity 'ga4_property'."),
  stub("google-business-profile", "Google Business Profile", "oauth", "Pull: reviews, posts, performance metrics; identity 'gbp_location'."),
  stub("google-meet", "Google Meet", "oauth", "Pull: meeting records + transcripts via Meet REST API."),
  stub("google-calendar", "Google Calendar", "oauth", "Pull: events per client attendee domain; identity 'calendar_id'."),
  stub("rank-tracker", "Rank Tracker", "api_key", "Pull: daily keyword positions as metrics; identity 'campaign_id'."),
  stub("map-checkins", "Map Check-Ins", "api_key", "Pull: check-in events as entities; identity 'account_id'."),
];
