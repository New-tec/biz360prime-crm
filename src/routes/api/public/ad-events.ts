import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Real-time ad spend / campaign event ingestion.
 *
 * POST /api/public/ad-events
 * Headers: x-ingest-secret: <AD_INGEST_SECRET>
 * Body: { events: [ { platform, campaign_id, name, date, spend, impressions, clicks, ... } ] }
 *
 * Rows are upserted on (platform, campaign_id, adset_id, creative_id, date) so a
 * platform can push the same day's stats repeatedly without duplicating spend.
 * The CRO dashboard recomputes CAC / ROAS from these rows on its next poll.
 */

const PLATFORMS = ["google_ads", "meta", "linkedin", "tiktok", "web_form", "seo", "other"] as const;

const eventSchema = z.object({
  platform: z.enum(PLATFORMS),
  campaign_id: z.string().min(1).max(200).optional(),
  adset_id: z.string().max(200).optional(),
  creative_id: z.string().max(200).optional(),
  name: z.string().min(1).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.number().min(0).max(100_000_000).default(0),
  impressions: z.number().int().min(0).max(1_000_000_000).default(0),
  clicks: z.number().int().min(0).max(1_000_000_000).default(0),
  currency: z.string().length(3).default("USD"),
  connector_id: z.string().uuid().optional(),
});

const payloadSchema = z.object({
  events: z.array(eventSchema).min(1).max(500),
});

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export const Route = createFileRoute("/api/public/ad-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["AD_INGEST_SECRET"];
        if (!secret) return new Response("Ingestion not configured", { status: 503 });

        const provided = request.headers.get("x-ingest-secret") ?? "";
        if (!provided || !timingSafeEqual(provided, secret)) {
          return new Response("Invalid credentials", { status: 401 });
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = payloadSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Map connectors by platform so ingested rows attach to the right connector.
        const { data: connectors } = await supabaseAdmin
          .from("ad_connectors")
          .select("id, platform");
        const connectorByPlatform = new Map<string, string>();
        for (const c of connectors ?? []) {
          if (!connectorByPlatform.has(c.platform)) connectorByPlatform.set(c.platform, c.id);
        }

        const rows = parsed.data.events.map((e) => ({
          connector_id: e.connector_id ?? connectorByPlatform.get(e.platform) ?? null,
          platform: e.platform,
          external_campaign_id: e.campaign_id ?? null,
          adset_id: e.adset_id ?? null,
          creative_id: e.creative_id ?? null,
          name: e.name,
          stat_date: e.date,
          spend: e.spend,
          impressions: e.impressions,
          clicks: e.clicks,
          currency: e.currency.toUpperCase(),
        }));

        const { error } = await supabaseAdmin.from("ad_campaigns").upsert(rows, {
          onConflict: "platform,external_campaign_id,adset_id,creative_id,stat_date",
          ignoreDuplicates: false,
        });

        if (error) {
          return Response.json({ error: "Ingestion failed", detail: error.message }, { status: 500 });
        }

        const totalSpend = rows.reduce((s, r) => s + r.spend, 0);

        // Touch the connectors so the UI shows a fresh sync timestamp.
        const platforms = [...new Set(rows.map((r) => r.platform))];
        await supabaseAdmin
          .from("ad_connectors")
          .update({ last_synced_at: new Date().toISOString(), status: "connected" })
          .in("platform", platforms);

        await supabaseAdmin.from("warehouse_events").insert({
          source: "ad_ingest_api",
          event_type: "ad_spend_ingested",
          entity_type: "ad_campaign",
          payload: { rows: rows.length, spend: totalSpend, platforms },
        });

        return Response.json({ ok: true, ingested: rows.length, spend: totalSpend, platforms });
      },

      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "content-type, x-ingest-secret",
          },
        }),
    },
  },
});
