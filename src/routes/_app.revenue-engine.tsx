import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { generateNurtureDraft } from "@/lib/uroe.functions";
import { useAuth, canManage } from "@/lib/auth-context";
import { formatCurrency, formatDate, timeAgo } from "@/lib/format";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend,
} from "recharts";
import {
  Gauge, Plug, Route as RouteIcon, Sparkles, LibraryBig, Database, Coins, GitBranch,
  Plus, Trash2, Check, X, Send, RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/_app/revenue-engine")({
  component: RevenueEnginePage,
  head: () => ({
    meta: [
      { title: "Revenue Engine — CRM360" },
      { name: "description", content: "Unified ad spend, attribution, instant routing, AI nurture and executive revenue KPIs in one module." },
      { property: "og:title", content: "Revenue Engine — CRM360" },
      { property: "og:description", content: "Ad spend to closed revenue, orchestrated in a single CRM module." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const TABS = [
  { k: "overview", l: "CRO Dashboard", Icon: Gauge, bg: "#ffe4d1", fg: "#c95c47" },
  { k: "connectors", l: "Ad Connectors", Icon: Plug, bg: "#dce9f0", fg: "#3a6680" },
  { k: "attribution", l: "Attribution & ROI", Icon: GitBranch, bg: "#e0ecdc", fg: "#4f7a4a" },
  { k: "cost", l: "Cost Intelligence", Icon: Coins, bg: "#fff0c8", fg: "#9a6a14" },
  { k: "routing", l: "Instant Routing", Icon: RouteIcon, bg: "#fde0e0", fg: "#b8413f" },
  { k: "nurture", l: "AI Nurture", Icon: Sparkles, bg: "#f5e3d0", fg: "#8a5a2a" },
  { k: "templates", l: "Template Library", Icon: LibraryBig, bg: "#e6e2f0", fg: "#5a4f8a" },
  { k: "warehouse", l: "Data Warehouse", Icon: Database, bg: "#f0e6d2", fg: "#7a5e2a" },
] as const;

type TabKey = (typeof TABS)[number]["k"];

const PLATFORMS = ["google_ads", "meta", "linkedin", "tiktok", "web_form", "seo", "other"] as const;
const PLATFORM_LABEL: Record<string, string> = {
  google_ads: "Google Ads", meta: "Meta", linkedin: "LinkedIn", tiktok: "TikTok",
  web_form: "Web form", seo: "SEO / Organic", other: "Other",
};

function RevenueEnginePage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const { role } = useAuth();
  const manage = canManage(role);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["uroe"],
    queryFn: async () => {
      const [connectors, campaigns, touchpoints, rules, templates, drafts, events, targets, deals, stages, contacts, profiles, leads] =
        await Promise.all([
          supabase.from("ad_connectors").select("*").order("platform"),
          supabase.from("ad_campaigns").select("*").order("stat_date", { ascending: false }),
          supabase.from("attribution_touchpoints").select("*").order("occurred_at", { ascending: false }).limit(500),
          supabase.from("routing_rules").select("*").order("priority"),
          supabase.from("nurture_templates").select("*").order("created_at"),
          supabase.from("nurture_drafts").select("*, contacts(first_name, last_name, email)").order("created_at", { ascending: false }).limit(100),
          supabase.from("warehouse_events").select("*").order("occurred_at", { ascending: false }).limit(150),
          supabase.from("revenue_targets").select("*"),
          supabase.from("deals").select("id, title, value, stage_id, contact_id, created_at, stage_changed_at"),
          supabase.from("pipeline_stages").select("id, name, is_won, is_lost"),
          supabase.from("contacts").select("id, first_name, last_name, email, temperature").order("first_name"),
          supabase.from("profiles").select("id, display_name"),
          supabase.from("leads").select("id, first_name, last_name, email, company_name, source, channel, status, owner_id, metadata, created_at").order("created_at", { ascending: false }).limit(50),
        ]);
      return {
        connectors: connectors.data ?? [], campaigns: campaigns.data ?? [], touchpoints: touchpoints.data ?? [],
        rules: rules.data ?? [], templates: templates.data ?? [], drafts: drafts.data ?? [],
        events: events.data ?? [], targets: targets.data ?? [], deals: deals.data ?? [],
        stages: stages.data ?? [], contacts: contacts.data ?? [], profiles: profiles.data ?? [],
        leads: leads.data ?? [],
      };
    },
    // Real-time ad spend lands via /api/public/ad-events; poll so CAC/ROAS stay current.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["uroe"] });

  const metrics = useMemo(() => {
    if (!d) return null;
    const wonIds = new Set(d.stages.filter((s: any) => s.is_won).map((s: any) => s.id));
    const lostIds = new Set(d.stages.filter((s: any) => s.is_lost).map((s: any) => s.id));
    const spend = d.campaigns.reduce((s: number, c: any) => s + Number(c.spend || 0), 0);
    const clicks = d.campaigns.reduce((s: number, c: any) => s + Number(c.clicks || 0), 0);
    const impressions = d.campaigns.reduce((s: number, c: any) => s + Number(c.impressions || 0), 0);
    const wonDeals = d.deals.filter((x: any) => wonIds.has(x.stage_id));
    const lostDeals = d.deals.filter((x: any) => lostIds.has(x.stage_id));
    const revenue = wonDeals.reduce((s: number, x: any) => s + Number(x.value || 0), 0);
    const pipeline = d.deals.filter((x: any) => !wonIds.has(x.stage_id) && !lostIds.has(x.stage_id))
      .reduce((s: number, x: any) => s + Number(x.value || 0), 0);
    const customers = wonDeals.length;
    const cac = customers ? spend / customers : 0;
    const roas = spend ? revenue / spend : 0;
    const closed = wonDeals.length + lostDeals.length;
    const winRate = closed ? (wonDeals.length / closed) * 100 : 0;
    const cycles = wonDeals
      .map((x: any) => (new Date(x.stage_changed_at).getTime() - new Date(x.created_at).getTime()) / 86400000)
      .filter((n: number) => n > 0);
    const cycleDays = cycles.length ? cycles.reduce((a: number, b: number) => a + b, 0) / cycles.length : 0;
    const cpc = clicks ? spend / clicks : 0;
    const cpl = d.touchpoints.filter((t: any) => t.type === "contact_created").length;
    const costPerLead = cpl ? spend / cpl : 0;

    const byPlatform = PLATFORMS.map((p) => {
      const camp = d.campaigns.filter((c: any) => c.platform === p);
      const s = camp.reduce((a: number, c: any) => a + Number(c.spend || 0), 0);
      const campIds = new Set(camp.map((c: any) => c.id));
      const rev = d.touchpoints
        .filter((t: any) => t.type === "deal_won" && (t.platform === p || campIds.has(t.campaign_id)))
        .reduce((a: number, t: any) => a + Number(t.value || 0), 0);
      return { name: PLATFORM_LABEL[p]!, spend: s, revenue: rev };
    }).filter((r) => r.spend > 0 || r.revenue > 0);

    return { spend, clicks, impressions, revenue, pipeline, cac, roas, winRate, cycleDays, cpc, costPerLead, customers, byPlatform, wonIds };
  }, [d]);

  const target = (k: string) => Number(d?.targets.find((t: any) => t.key === k)?.target_value ?? 0);

  if (q.isLoading || !d || !metrics) {
    return <div className="text-sm text-muted-foreground">Loading Revenue Engine…</div>;
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl text-foreground" style={{ fontWeight: 500 }}>Revenue Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">
            One module, eight linked layers — ad spend in, attributed revenue out.
          </p>
        </div>
        <button onClick={refresh} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className="flex items-center gap-2 rounded-full px-3.5 py-2 text-sm border transition-colors"
              style={{
                backgroundColor: active ? t.bg : "var(--color-card)",
                color: active ? t.fg : "var(--color-muted-foreground)",
                borderColor: active ? t.bg : "var(--color-border)",
                fontWeight: active ? 500 : 400,
              }}
            >
              <t.Icon className="h-4 w-4" />
              {t.l}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <Overview m={metrics} target={target} />}
      {tab === "connectors" && <Connectors data={d} manage={manage} refresh={refresh} />}
      {tab === "attribution" && <Attribution data={d} wonIds={metrics.wonIds} />}
      {tab === "cost" && <CostIntel data={d} m={metrics} manage={manage} refresh={refresh} />}
      {tab === "routing" && <Routing data={d} manage={manage} refresh={refresh} />}
      {tab === "nurture" && <Nurture data={d} refresh={refresh} />}
      {tab === "templates" && <Templates data={d} manage={manage} refresh={refresh} />}
      {tab === "warehouse" && <Warehouse data={d} />}
    </div>
  );
}

/* ---------------- 1. CRO DASHBOARD ---------------- */

function Overview({ m, target }: { m: any; target: (k: string) => number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KPI label="Ad spend" value={formatCurrency(m.spend)} tone="#fff0c8" />
        <KPI label="Attributed revenue" value={formatCurrency(m.revenue)} tone="#e0ecdc" />
        <KPI label="ROAS" value={`${m.roas.toFixed(2)}x`} tone="#ffe4d1" />
        <KPI label="CAC" value={formatCurrency(m.cac)} tone="#fde0e0" />
        <KPI label="Win rate" value={`${m.winRate.toFixed(0)}%`} tone="#e6e2f0" />
        <KPI label="Cycle length" value={`${m.cycleDays.toFixed(0)}d`} tone="#dce9f0" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Spend vs attributed revenue by platform">
          {m.byPlatform.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={m.byPlatform}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3d9c4" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#8a6a55", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#8a6a55", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#fff", border: "1px solid #f3d9c4", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="spend" name="Spend" fill="#f5b7a3" radius={[6, 6, 0, 0]} />
                <Bar dataKey="revenue" name="Revenue" fill="#e2725b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>Log campaign spend in Cost Intelligence to populate this chart.</Empty>}
        </Panel>

        <Panel title="Progress against executive targets">
          <div className="space-y-4">
            <Progress label="Revenue" current={m.revenue} goal={target("revenue")} fmt={formatCurrency} />
            <Progress label="Ad spend vs ceiling" current={m.spend} goal={target("ad_cost")} fmt={formatCurrency} invert />
            <Progress label="ROAS" current={m.roas} goal={target("roas")} fmt={(v) => `${Number(v).toFixed(2)}x`} />
            <Progress label="CAC vs threshold" current={m.cac} goal={target("cac")} fmt={formatCurrency} invert />
            <Progress label="Cycle length vs target" current={m.cycleDays} goal={target("cycle_days")} fmt={(v) => `${Number(v).toFixed(0)}d`} invert />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Impressions" value={m.impressions.toLocaleString()} tone="#f0e6d2" />
        <KPI label="Clicks" value={m.clicks.toLocaleString()} tone="#f5e3d0" />
        <KPI label="Cost per click" value={formatCurrency(m.cpc)} tone="#dceadf" />
        <KPI label="Cost per lead" value={formatCurrency(m.costPerLead)} tone="#fce5d8" />
      </div>
    </div>
  );
}

function Progress({ label, current, goal, fmt, invert }: { label: string; current: number; goal: number; fmt: (v: number) => string; invert?: boolean }) {
  const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
  const good = invert ? current <= goal : current >= goal;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-muted-foreground" style={{ fontWeight: 500 }}>{label}</span>
        <span style={{ color: good ? "#4f7a4a" : "#b8413f", fontWeight: 500 }}>
          {fmt(current)} / {fmt(goal)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: good ? "#a8c5b5" : "#e2725b" }} />
      </div>
    </div>
  );
}

/* ---------------- 2. AD CONNECTORS ---------------- */

function Connectors({ data, manage, refresh }: { data: any; manage: boolean; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const setStatus = async (id: string, status: string) => {
    setBusy(id);
    const { error } = await supabase
      .from("ad_connectors")
      .update({ status: status as any, last_synced_at: status === "connected" ? new Date().toISOString() : null })
      .eq("id", id);
    setBusy(null);
    if (error) return toast.error(error.message);
    await supabase.from("warehouse_events").insert({
      source: "uroe", event_type: `connector_${status}`, entity_type: "ad_connector", entity_id: id, payload: { status },
    });
    toast.success(`Connector marked ${status}`);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Note>
        Each connector is the ingestion point for one traffic source. Marking it connected records the sync
        timestamp and writes an event to the warehouse; the campaign rows it owns live in Cost Intelligence.
      </Note>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data.connectors.map((c: any) => {
          const camps = data.campaigns.filter((x: any) => x.connector_id === c.id);
          const spend = camps.reduce((s: number, x: any) => s + Number(x.spend || 0), 0);
          return (
            <div key={c.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm text-foreground" style={{ fontWeight: 500 }}>{c.display_name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{PLATFORM_LABEL[c.platform]}</div>
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Mini label="Campaigns" value={String(camps.length)} />
                <Mini label="Tracked spend" value={formatCurrency(spend)} />
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                Last sync: {c.last_synced_at ? timeAgo(c.last_synced_at) : "never"}
              </div>
              {manage && (
                <div className="flex gap-2 mt-3">
                  <button
                    disabled={busy === c.id}
                    onClick={() => setStatus(c.id, c.status === "connected" ? "disconnected" : "connected")}
                    className="flex-1 rounded-lg px-3 py-1.5 text-xs border border-border hover:bg-muted"
                  >
                    {c.status === "connected" ? "Disconnect" : "Mark connected"}
                  </button>
                  <button
                    disabled={busy === c.id}
                    onClick={() => setStatus(c.id, "error")}
                    className="rounded-lg px-3 py-1.5 text-xs border border-border hover:bg-muted text-muted-foreground"
                  >
                    Flag error
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    connected: { bg: "#e0ecdc", fg: "#4f7a4a" },
    disconnected: { bg: "#ece4d8", fg: "#6a553c" },
    error: { bg: "#fde0e0", fg: "#b8413f" },
    pending: { bg: "#fff0c8", fg: "#9a6a14" },
  };
  const c = map[status] ?? map["pending"]!;
  return <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ backgroundColor: c.bg, color: c.fg, fontWeight: 500 }}>{status}</span>;
}

/* ---------------- 3. ATTRIBUTION & ROI ---------------- */

function Attribution({ data, wonIds }: { data: any; wonIds: Set<string> }) {
  const rows = useMemo(() => {
    const byCampaign = new Map<string, any>();
    data.campaigns.forEach((c: any) => {
      const key = c.external_campaign_id || c.name;
      const prev = byCampaign.get(key) ?? { key, name: c.name, platform: c.platform, spend: 0, clicks: 0, ids: new Set<string>() };
      prev.spend += Number(c.spend || 0);
      prev.clicks += Number(c.clicks || 0);
      prev.ids.add(c.id);
      byCampaign.set(key, prev);
    });
    return Array.from(byCampaign.values()).map((r: any) => {
      const tps = data.touchpoints.filter((t: any) => r.ids.has(t.campaign_id));
      const leads = new Set(tps.filter((t: any) => t.contact_id).map((t: any) => t.contact_id)).size;
      const dealsSet = new Set(tps.filter((t: any) => t.deal_id).map((t: any) => t.deal_id));
      const wonRevenue = data.deals
        .filter((dl: any) => dealsSet.has(dl.id) && wonIds.has(dl.stage_id))
        .reduce((s: number, dl: any) => s + Number(dl.value || 0), 0);
      const directWon = tps.filter((t: any) => t.type === "deal_won").reduce((s: number, t: any) => s + Number(t.value || 0), 0);
      const revenue = Math.max(wonRevenue, directWon);
      return { ...r, leads, deals: dealsSet.size, revenue, roi: r.spend ? ((revenue - r.spend) / r.spend) * 100 : 0 };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [data, wonIds]);

  const stages = ["impression", "click", "contact_created", "deal_created", "deal_won"];
  const funnel = stages.map((s) => ({ name: s.replace("_", " "), value: data.touchpoints.filter((t: any) => t.type === s).length }));

  return (
    <div className="space-y-4">
      <Note>
        Every touchpoint — impression, click, pixel event, contact created, deal created, deal won — is stitched to
        a contact and a campaign, so revenue is credited back to the ad that started the journey.
      </Note>

      <Panel title="Journey funnel">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {funnel.map((f) => (
            <div key={f.name} className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground capitalize">{f.name}</div>
              <div className="text-xl text-foreground mt-1" style={{ fontWeight: 500 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Campaign ROI">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground text-left">
                  {["Campaign", "Platform", "Spend", "Leads", "Deals", "Revenue", "ROI"].map((h) => (
                    <th key={h} className="py-2 pr-4" style={{ fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.key} className="border-t border-border">
                    <td className="py-2 pr-4">{r.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{PLATFORM_LABEL[r.platform]}</td>
                    <td className="py-2 pr-4">{formatCurrency(r.spend)}</td>
                    <td className="py-2 pr-4">{r.leads}</td>
                    <td className="py-2 pr-4">{r.deals}</td>
                    <td className="py-2 pr-4">{formatCurrency(r.revenue)}</td>
                    <td className="py-2 pr-4" style={{ color: r.roi >= 0 ? "#4f7a4a" : "#b8413f", fontWeight: 500 }}>
                      {r.roi.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No campaigns tracked yet.</Empty>}
      </Panel>
    </div>
  );
}

/* ---------------- 4. COST INTELLIGENCE ---------------- */

function CostIntel({ data, m, manage, refresh }: { data: any; m: any; manage: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    connector_id: "", platform: "google_ads", name: "", external_campaign_id: "", adset_id: "", creative_id: "",
    stat_date: new Date().toISOString().slice(0, 10), spend: "", impressions: "", clicks: "",
  });

  const save = async () => {
    if (!f.name.trim()) return toast.error("Campaign name is required");
    const { error } = await supabase.from("ad_campaigns").insert({
      connector_id: f.connector_id || null,
      platform: f.platform as any,
      name: f.name.trim(),
      external_campaign_id: f.external_campaign_id || "",
      adset_id: f.adset_id || "",
      creative_id: f.creative_id || "",
      stat_date: f.stat_date,
      spend: Number(f.spend || 0),
      impressions: Number(f.impressions || 0),
      clicks: Number(f.clicks || 0),
    });
    if (error) return toast.error(error.message);
    await supabase.from("warehouse_events").insert({
      source: "uroe", event_type: "ad_spend_logged", entity_type: "ad_campaign",
      payload: { platform: f.platform, spend: Number(f.spend || 0), date: f.stat_date },
    });
    toast.success("Spend recorded");
    setOpen(false);
    setF({ ...f, name: "", spend: "", impressions: "", clicks: "" });
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this spend row?")) return;
    const { error } = await supabase.from("ad_campaigns").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Note>
        Spend is parsed down to campaign, ad set and creative so cost-per-click, cost-per-lead and
        cost-per-acquisition are calculated on real numbers instead of estimates.
      </Note>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Total spend" value={formatCurrency(m.spend)} tone="#fff0c8" />
        <KPI label="CPC" value={formatCurrency(m.cpc)} tone="#f5e3d0" />
        <KPI label="Cost per lead" value={formatCurrency(m.costPerLead)} tone="#fce5d8" />
        <KPI label="CAC" value={formatCurrency(m.cac)} tone="#fde0e0" />
      </div>

      {manage && (
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm text-white" style={{ backgroundColor: "#e2725b" }}>
          <Plus className="h-4 w-4" /> Log campaign spend
        </button>
      )}

      {open && (
        <Panel title="New spend row">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Connector">
              <select value={f.connector_id} onChange={(e) => setF({ ...f, connector_id: e.target.value })} className={inputCls}>
                <option value="">— none —</option>
                {data.connectors.map((c: any) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </Field>
            <Field label="Platform">
              <select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} className={inputCls}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" value={f.stat_date} onChange={(e) => setF({ ...f, stat_date: e.target.value })} className={inputCls} /></Field>
            <Field label="Campaign name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Ad set"><input value={f.adset_id} onChange={(e) => setF({ ...f, adset_id: e.target.value })} className={inputCls} /></Field>
            <Field label="Creative"><input value={f.creative_id} onChange={(e) => setF({ ...f, creative_id: e.target.value })} className={inputCls} /></Field>
            <Field label="Spend"><input type="number" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} className={inputCls} /></Field>
            <Field label="Impressions"><input type="number" value={f.impressions} onChange={(e) => setF({ ...f, impressions: e.target.value })} className={inputCls} /></Field>
            <Field label="Clicks"><input type="number" value={f.clicks} onChange={(e) => setF({ ...f, clicks: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} className="rounded-lg px-4 py-2 text-sm text-white" style={{ backgroundColor: "#e2725b" }}>Save</button>
            <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm border border-border">Cancel</button>
          </div>
        </Panel>
      )}

      <Panel title="Spend ledger">
        {data.campaigns.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground text-left">
                  {["Date", "Campaign", "Ad set", "Creative", "Platform", "Spend", "Impr.", "Clicks", "CPC", ""].map((h, i) => (
                    <th key={i} className="py-2 pr-4" style={{ fontWeight: 500 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c: any) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2 pr-4 text-muted-foreground">{formatDate(c.stat_date)}</td>
                    <td className="py-2 pr-4">{c.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.adset_id ?? "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.creative_id ?? "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{PLATFORM_LABEL[c.platform]}</td>
                    <td className="py-2 pr-4">{formatCurrency(Number(c.spend))}</td>
                    <td className="py-2 pr-4">{Number(c.impressions).toLocaleString()}</td>
                    <td className="py-2 pr-4">{Number(c.clicks).toLocaleString()}</td>
                    <td className="py-2 pr-4">{Number(c.clicks) ? formatCurrency(Number(c.spend) / Number(c.clicks)) : "—"}</td>
                    <td className="py-2 pr-2">
                      {manage && (
                        <button onClick={() => remove(c.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No spend recorded yet.</Empty>}
      </Panel>
    </div>
  );
}

/* ---------------- 5. INSTANT ROUTING ---------------- */

function Routing({ data, manage, refresh }: { data: any; manage: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", priority: "100", region: "", tier: "", min_intent_score: "0", platform: "", assignee_id: "" });
  const [sim, setSim] = useState({ region: "", tier: "", score: "70", platform: "" });

  const save = async () => {
    if (!f.name.trim()) return toast.error("Rule name is required");
    const { error } = await supabase.from("routing_rules").insert({
      name: f.name.trim(),
      priority: Number(f.priority || 100),
      region: f.region || null,
      tier: f.tier || null,
      min_intent_score: Number(f.min_intent_score || 0),
      platform: (f.platform || null) as any,
      assignee_id: f.assignee_id || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Routing rule created");
    setOpen(false);
    refresh();
  };

  const toggle = async (r: any) => {
    const { error } = await supabase.from("routing_rules").update({ is_active: !r.is_active }).eq("id", r.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    const { error } = await supabase.from("routing_rules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const match = useMemo(() => {
    const score = Number(sim.score || 0);
    return data.rules
      .filter((r: any) => r.is_active)
      .sort((a: any, b: any) => a.priority - b.priority)
      .find((r: any) =>
        (!r.region || r.region.toLowerCase() === sim.region.toLowerCase()) &&
        (!r.tier || r.tier.toLowerCase() === sim.tier.toLowerCase()) &&
        (!r.platform || r.platform === sim.platform) &&
        score >= (r.min_intent_score ?? 0)
      ) ?? null;
  }, [data.rules, sim]);

  const repName = (id: string | null) => data.profiles.find((p: any) => p.id === id)?.display_name ?? "Round robin";

  const routed = (data.leads ?? []).filter((l: any) => l?.metadata?.routed_at);

  return (
    <div className="space-y-4">
      <Note>
        Routing runs automatically in the database the instant a lead row is created — from the web form,
        an ad connector or the API. Rules are evaluated top-down by priority; the first rule whose region,
        tier, source and minimum intent score all match wins. If no rule matches, the lead goes to the
        least-loaded rep. The owner is set, a notification fires and a pending nurture draft is written in
        the same transaction — no manual simulation needed.
      </Note>

      <Panel title="Recently auto-routed leads">
        {routed.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4">Lead</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2 pr-4">Rule</th>
                  <th className="py-2 pr-4">Assigned to</th>
                  <th className="py-2 pr-4">Routed</th>
                </tr>
              </thead>
              <tbody>
                {routed.slice(0, 12).map((l: any) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.company_name || l.email || "—"}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{l.source || l.channel || "—"}</td>
                    <td className="py-2 pr-4">{l.metadata?.intent_score ?? "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {l.metadata?.routed_rule_name ?? (l.metadata?.routing_mode === "balanced" ? "Least loaded" : "—")}
                    </td>
                    <td className="py-2 pr-4">{repName(l.owner_id)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{timeAgo(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No leads routed yet. New leads are assigned automatically the moment they are created.</Empty>
        )}
      </Panel>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {manage && (
            <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm text-white" style={{ backgroundColor: "#e2725b" }}>
              <Plus className="h-4 w-4" /> New rule
            </button>
          )}
          {open && (
            <Panel title="New routing rule">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Rule name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
                <Field label="Priority (lower runs first)"><input type="number" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={inputCls} /></Field>
                <Field label="Region"><input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} placeholder="EMEA" className={inputCls} /></Field>
                <Field label="Tier"><input value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })} placeholder="Enterprise" className={inputCls} /></Field>
                <Field label="Min intent score"><input type="number" value={f.min_intent_score} onChange={(e) => setF({ ...f, min_intent_score: e.target.value })} className={inputCls} /></Field>
                <Field label="Source platform">
                  <select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} className={inputCls}>
                    <option value="">Any</option>
                    {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
                  </select>
                </Field>
                <Field label="Assign to">
                  <select value={f.assignee_id} onChange={(e) => setF({ ...f, assignee_id: e.target.value })} className={inputCls}>
                    <option value="">Round robin</option>
                    {data.profiles.map((p: any) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={save} className="rounded-lg px-4 py-2 text-sm text-white" style={{ backgroundColor: "#e2725b" }}>Save rule</button>
                <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm border border-border">Cancel</button>
              </div>
            </Panel>
          )}

          <Panel title="Rules">
            {data.rules.length ? (
              <div className="space-y-2">
                {data.rules.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <div className="text-sm text-foreground" style={{ fontWeight: 500 }}>
                        <span className="text-muted-foreground mr-2">#{r.priority}</span>{r.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {[r.region && `Region ${r.region}`, r.tier && `Tier ${r.tier}`, r.platform && PLATFORM_LABEL[r.platform], `Score ≥ ${r.min_intent_score}`]
                          .filter(Boolean).join(" · ")} → {repName(r.assignee_id)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggle(r)} className="rounded-full px-2.5 py-1 text-[11px]"
                        style={{ backgroundColor: r.is_active ? "#e0ecdc" : "#ece4d8", color: r.is_active ? "#4f7a4a" : "#6a553c", fontWeight: 500 }}>
                        {r.is_active ? "active" : "paused"}
                      </button>
                      {manage && <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <Empty>No routing rules yet.</Empty>}
          </Panel>
        </div>

        <Panel title="Simulate a lead">
          <div className="space-y-3">
            <Field label="Region"><input value={sim.region} onChange={(e) => setSim({ ...sim, region: e.target.value })} placeholder="EMEA" className={inputCls} /></Field>
            <Field label="Tier"><input value={sim.tier} onChange={(e) => setSim({ ...sim, tier: e.target.value })} placeholder="Enterprise" className={inputCls} /></Field>
            <Field label="Intent score"><input type="number" value={sim.score} onChange={(e) => setSim({ ...sim, score: e.target.value })} className={inputCls} /></Field>
            <Field label="Source">
              <select value={sim.platform} onChange={(e) => setSim({ ...sim, platform: e.target.value })} className={inputCls}>
                <option value="">Any</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </select>
            </Field>
            <div className="rounded-lg p-3" style={{ backgroundColor: match ? "#e0ecdc" : "#fde0e0" }}>
              <div className="text-xs" style={{ color: "#3a2418", fontWeight: 500 }}>
                {match ? `Routed to ${repName(match.assignee_id)} via "${match.name}"` : "No matching rule — lead falls to round robin"}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------- 6. AI NURTURE ---------------- */

function Nurture({ data, refresh }: { data: any; refresh: () => void }) {
  const generate = useServerFn(generateNurtureDraft);
  const [f, setF] = useState({ contactId: "", templateId: "", channel: "email", tone: "Consultative", intentScore: "70", notes: "" });

  const gen = useMutation({
    mutationFn: async () => {
      if (!f.contactId) throw new Error("Pick a contact first");
      return generate({
        data: {
          contactId: f.contactId,
          templateId: f.templateId || null,
          channel: f.channel as "email" | "whatsapp" | "sms",
          tone: f.tone,
          intentScore: Number(f.intentScore || 0),
          notes: f.notes,
        },
      });
    },
    onSuccess: (r: any) => {
      toast.success(`Draft ready in ${r.latency}ms — awaiting your approval`);
      setF({ ...f, notes: "" });
      refresh();
    },
    onError: (e: any) => toast.error(e.message ?? "Generation failed"),
  });

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("nurture_drafts").update({ status: status as any }).eq("id", id);
    if (error) return toast.error(error.message);
    await supabase.from("warehouse_events").insert({
      source: "uroe", event_type: `draft_${status}`, entity_type: "nurture_draft", entity_id: id, payload: { status },
    });
    toast.success(`Draft ${status}`);
    refresh();
  };

  const pending = data.drafts.filter((x: any) => x.status === "pending");
  const avgLatency = data.drafts.length
    ? data.drafts.reduce((s: number, x: any) => s + Number(x.latency_ms || 0), 0) / data.drafts.length
    : 0;

  return (
    <div className="space-y-4">
      <Note>
        The model only ever adapts an approved template, never invents facts, and every draft lands in a
        pending queue. Nothing reaches a lead until a human presses approve.
      </Note>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Pending approval" value={String(pending.length)} tone="#fff0c8" />
        <KPI label="Approved" value={String(data.drafts.filter((x: any) => x.status === "approved").length)} tone="#e0ecdc" />
        <KPI label="Sent" value={String(data.drafts.filter((x: any) => x.status === "sent").length)} tone="#dce9f0" />
        <KPI label="Avg generation" value={`${avgLatency.toFixed(0)}ms`} tone="#f5e3d0" />
      </div>

      <Panel title="Generate a nurture draft">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Contact">
            <select value={f.contactId} onChange={(e) => setF({ ...f, contactId: e.target.value })} className={inputCls}>
              <option value="">— select —</option>
              {data.contacts.map((c: any) => (
                <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Channel">
            <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className={inputCls}>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </select>
          </Field>
          <Field label="Template">
            <select value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })} className={inputCls}>
              <option value="">Auto (best fallback)</option>
              {data.templates.filter((t: any) => t.channel === f.channel).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Tone">
            <select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} className={inputCls}>
              {["Consultative", "Direct", "Friendly", "Formal", "Brief"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Intent score"><input type="number" value={f.intentScore} onChange={(e) => setF({ ...f, intentScore: e.target.value })} className={inputCls} /></Field>
          <Field label="Rep notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What they asked about…" className={inputCls} /></Field>
        </div>
        <button
          onClick={() => gen.mutate()}
          disabled={gen.isPending}
          className="mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-white disabled:opacity-60"
          style={{ backgroundColor: "#e2725b" }}
        >
          <Sparkles className="h-4 w-4" /> {gen.isPending ? "Generating…" : "Generate draft"}
        </button>
      </Panel>

      <Panel title="Approval queue">
        {data.drafts.length ? (
          <div className="space-y-3">
            {data.drafts.map((dr: any) => (
              <div key={dr.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-foreground" style={{ fontWeight: 500 }}>
                      {dr.contacts ? `${dr.contacts.first_name} ${dr.contacts.last_name}` : "Unknown contact"}
                      <span className="text-xs text-muted-foreground ml-2">{dr.channel}</span>
                    </div>
                    {dr.subject && <div className="text-xs text-muted-foreground mt-0.5">Subject: {dr.subject}</div>}
                  </div>
                  <StatusPill status={dr.status} />
                </div>
                <pre className="mt-3 whitespace-pre-wrap text-sm text-foreground bg-muted/40 rounded-lg p-3">{dr.body}</pre>
                <div className="flex items-center justify-between mt-3">
                  <div className="text-[11px] text-muted-foreground">
                    {dr.model} · {dr.latency_ms}ms · intent {dr.intent_score ?? "—"} · {timeAgo(dr.created_at)}
                  </div>
                  <div className="flex gap-2">
                    {dr.status === "pending" && (
                      <>
                        <button onClick={() => setStatus(dr.id, "approved")} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs" style={{ backgroundColor: "#e0ecdc", color: "#4f7a4a" }}>
                          <Check className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button onClick={() => setStatus(dr.id, "rejected")} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs" style={{ backgroundColor: "#fde0e0", color: "#b8413f" }}>
                          <X className="h-3.5 w-3.5" /> Reject
                        </button>
                      </>
                    )}
                    {dr.status === "approved" && (
                      <button onClick={() => setStatus(dr.id, "sent")} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs" style={{ backgroundColor: "#dce9f0", color: "#3a6680" }}>
                        <Send className="h-3.5 w-3.5" /> Mark sent
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>No drafts yet.</Empty>}
      </Panel>
    </div>
  );
}

/* ---------------- 7. TEMPLATE LIBRARY ---------------- */

function Templates({ data, manage, refresh }: { data: any; manage: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", channel: "email", tone: "Consultative", stage: "first_touch", subject: "", body: "", is_fallback: false });

  const save = async () => {
    if (!f.name.trim() || !f.body.trim()) return toast.error("Name and body are required");
    const { error } = await supabase.from("nurture_templates").insert({
      name: f.name.trim(), channel: f.channel as any, tone: f.tone, stage: f.stage,
      subject: f.subject || null, body: f.body, is_fallback: f.is_fallback,
    });
    if (error) return toast.error(error.message);
    toast.success("Template saved");
    setOpen(false);
    setF({ ...f, name: "", subject: "", body: "" });
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    const { error } = await supabase.from("nurture_templates").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Note>
        Fallback templates guarantee a safe, brand-approved message when the model is unavailable or the lead
        context is thin. Merge fields like <code>{"{{first_name}}"}</code> are filled at generation time.
      </Note>

      {manage && (
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm text-white" style={{ backgroundColor: "#e2725b" }}>
          <Plus className="h-4 w-4" /> New template
        </button>
      )}

      {open && (
        <Panel title="New template">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Channel">
              <select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className={inputCls}>
                <option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option>
              </select>
            </Field>
            <Field label="Stage"><input value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} className={inputCls} /></Field>
            <Field label="Tone"><input value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} className={inputCls} /></Field>
            <Field label="Subject"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} className={inputCls} /></Field>
            <Field label="Fallback">
              <label className="flex items-center gap-2 text-sm h-9">
                <input type="checkbox" checked={f.is_fallback} onChange={(e) => setF({ ...f, is_fallback: e.target.checked })} />
                Use when AI is unavailable
              </label>
            </Field>
          </div>
          <Field label="Body">
            <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={6} className={inputCls} />
          </Field>
          <div className="flex gap-2 mt-4">
            <button onClick={save} className="rounded-lg px-4 py-2 text-sm text-white" style={{ backgroundColor: "#e2725b" }}>Save template</button>
            <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm border border-border">Cancel</button>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.templates.map((t: any) => (
          <div key={t.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-foreground" style={{ fontWeight: 500 }}>{t.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t.channel} · {t.tone ?? "—"} · {t.stage ?? "—"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {t.is_fallback && <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ backgroundColor: "#fff0c8", color: "#9a6a14", fontWeight: 500 }}>fallback</span>}
                {manage && <button onClick={() => remove(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
            {t.subject && <div className="text-xs text-muted-foreground mt-2">Subject: {t.subject}</div>}
            <pre className="mt-2 whitespace-pre-wrap text-xs text-foreground bg-muted/40 rounded-lg p-3 max-h-40 overflow-auto">{t.body}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 8. DATA WAREHOUSE ---------------- */

function Warehouse({ data }: { data: any }) {
  const bySource = useMemo(() => {
    const m: Record<string, number> = {};
    data.events.forEach((e: any) => { m[e.event_type] = (m[e.event_type] ?? 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [data.events]);

  return (
    <div className="space-y-4">
      <Note>
        Every ad interaction, AI prompt, routing decision, stage change and approval is written here as an
        immutable event — the single source of truth the CRO dashboard and attribution both read from.
      </Note>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Events logged" value={String(data.events.length)} tone="#f0e6d2" />
        <KPI label="Touchpoints" value={String(data.touchpoints.length)} tone="#e0ecdc" />
        <KPI label="Campaign rows" value={String(data.campaigns.length)} tone="#fff0c8" />
        <KPI label="AI drafts" value={String(data.drafts.length)} tone="#f5e3d0" />
      </div>

      <Panel title="Event mix">
        {bySource.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={bySource} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f3d9c4" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#8a6a55", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={160} tick={{ fill: "#8a6a55", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #f3d9c4", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="value" fill="#e2725b" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty>No events yet.</Empty>}
      </Panel>

      <Panel title="Recent events">
        {data.events.length ? (
          <div className="space-y-1.5 max-h-[420px] overflow-auto">
            {data.events.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: "#f0e6d2", color: "#7a5e2a", fontWeight: 500 }}>{e.source}</span>
                  <span className="text-foreground" style={{ fontWeight: 500 }}>{e.event_type}</span>
                  <span className="text-muted-foreground truncate">{e.entity_type ?? ""}</span>
                </div>
                <span className="text-muted-foreground shrink-0">{timeAgo(e.occurred_at)}</span>
              </div>
            ))}
          </div>
        ) : <Empty>No events yet.</Empty>}
      </Panel>
    </div>
  );
}

/* ---------------- shared bits ---------------- */

const inputCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-secondary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1.5" style={{ fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function KPI({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone }} />
        <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>{label}</span>
      </div>
      <div className="text-xl text-foreground mt-2" style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground" style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-sm text-foreground mb-4" style={{ fontWeight: 500 }}>{title}</h2>
      {children}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground leading-relaxed">
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{children}</div>;
}
