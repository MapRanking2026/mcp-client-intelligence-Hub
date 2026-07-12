import { google } from "googleapis";
import type { Connector, ConnectorContext, MetricPoint, PullResult } from "../types.js";
import { googleAuthFromCredentials } from "./auth.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pulls daily clicks/impressions/CTR/position for every client identity of
 * external_type "site" (a verified GSC property URL, e.g. "sc-domain:example.com").
 * Cursor: { lastDate: "YYYY-MM-DD" }. Backfills 90 days on first run.
 * GSC data lags ~2 days, so each run re-pulls a small trailing window.
 */
export const searchConsoleConnector: Connector = {
  id: "google-search-console",
  displayName: "Google Search Console",
  authMode: "oauth",
  implemented: true,
  capabilities: { pull: true, push: false, webhooks: false },

  async pull(ctx: ConnectorContext): Promise<PullResult> {
    const auth = googleAuthFromCredentials(ctx.credentials);
    const gsc = google.searchconsole({ version: "v1", auth });

    const today = new Date();
    const endDate = isoDate(new Date(today.getTime() - 2 * 86_400_000)); // data lag
    const lastDate = typeof ctx.cursor.lastDate === "string" ? ctx.cursor.lastDate : null;
    const start = lastDate
      ? new Date(new Date(`${lastDate}T00:00:00Z`).getTime() - 3 * 86_400_000) // re-pull trailing window
      : new Date(today.getTime() - 90 * 86_400_000);
    const startDate = isoDate(start);

    const metrics: MetricPoint[] = [];
    const sites = ctx.identities.filter((i) => i.external_type === "site");

    for (const site of sites) {
      const res = await gsc.searchanalytics.query({
        siteUrl: site.external_id,
        requestBody: { startDate, endDate, dimensions: ["date"], rowLimit: 1000 },
      });
      for (const row of res.data.rows ?? []) {
        const date = row.keys?.[0];
        if (!date) continue;
        metrics.push(
          { clientId: site.client_id, metric: "gsc.clicks", date, value: row.clicks ?? 0 },
          { clientId: site.client_id, metric: "gsc.impressions", date, value: row.impressions ?? 0 },
          { clientId: site.client_id, metric: "gsc.ctr", date, value: row.ctr ?? 0 },
          { clientId: site.client_id, metric: "gsc.position", date, value: row.position ?? 0 }
        );
      }
    }

    ctx.log.info(`search-console pull: ${metrics.length} metric points across ${sites.length} sites`);
    return { entities: [], metrics, nextCursor: { lastDate: endDate } };
  },
};
