import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, initials } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { Trophy, TrendingUp, Target, DollarSign, CheckCircle2, Activity } from "lucide-react";

export const Route = createFileRoute("/_app/sales-scorecard")({
  component: ScorecardPage,
});

const RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "365", label: "Last 12 months" },
  { key: "all", label: "All time" },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function ScorecardPage() {
  const [range, setRange] = useState<RangeKey>("30");

  const since = useMemo(() => {
    if (range === "all") return null;
    return new Date(Date.now() - Number(range) * 86400000);
  }, [range]);

  const q = useQuery({
    queryKey: ["sales-scorecard"],
    queryFn: async () => {
      const [reps, deals, tasks, activities, leads] = await Promise.all([
        supabase.from("profiles").select("id, display_name, email"),
        supabase.from("deals").select("id, value, owner_id, created_at, stage_changed_at, pipeline_stages(is_won, is_lost)"),
        supabase.from("tasks").select("id, owner_id, status, created_at, completed_at"),
        supabase.from("activities").select("id, user_id, type, created_at"),
        supabase.from("leads").select("id, owner_id, status, created_at"),
      ]);
      return {
        reps: reps.data ?? [],
        deals: deals.data ?? [],
        tasks: tasks.data ?? [],
        activities: activities.data ?? [],
        leads: leads.data ?? [],
      };
    },
  });

  const rows = useMemo(() => {
    if (!q.data) return [];
    const cutoff = since?.getTime() ?? 0;
    const inRange = (d?: string | null) => !since || (d ? new Date(d).getTime() >= cutoff : false);

    return q.data.reps
      .map((rep: any) => {
        const myDeals = q.data!.deals.filter((d: any) => d.owner_id === rep.id);
        const won = myDeals.filter((d: any) => d.pipeline_stages?.is_won && inRange(d.stage_changed_at));
        const lost = myDeals.filter((d: any) => d.pipeline_stages?.is_lost && inRange(d.stage_changed_at));
        const open = myDeals.filter((d: any) => !d.pipeline_stages?.is_won && !d.pipeline_stages?.is_lost);
        const closed = won.length + lost.length;
        const wonValue = won.reduce((s: number, d: any) => s + Number(d.value || 0), 0);
        const pipelineValue = open.reduce((s: number, d: any) => s + Number(d.value || 0), 0);
        const winRate = closed > 0 ? (won.length / closed) * 100 : 0;
        const avgDeal = won.length > 0 ? wonValue / won.length : 0;

        const cycleDays = won
          .map((d: any) => (new Date(d.stage_changed_at).getTime() - new Date(d.created_at).getTime()) / 86400000)
          .filter((n: number) => n > 0);
        const avgCycle = cycleDays.length ? cycleDays.reduce((a: number, b: number) => a + b, 0) / cycleDays.length : 0;

        const myTasks = q.data!.tasks.filter((t: any) => t.owner_id === rep.id);
        const tasksDone = myTasks.filter((t: any) => t.status === "completed" && inRange(t.completed_at)).length;
        const tasksOpen = myTasks.filter((t: any) => t.status !== "completed").length;

        const myActs = q.data!.activities.filter((a: any) => a.user_id === rep.id && inRange(a.created_at));
        const myLeads = q.data!.leads.filter((l: any) => l.owner_id === rep.id && inRange(l.created_at));
        const leadsConv = myLeads.filter((l: any) => l.status === "converted").length;
        const leadConvRate = myLeads.length > 0 ? (leadsConv / myLeads.length) * 100 : 0;

        return {
          id: rep.id,
          name: rep.display_name || rep.email || "—",
          email: rep.email,
          wonCount: won.length,
          wonValue,
          pipelineValue,
          openCount: open.length,
          winRate,
          avgDeal,
          avgCycle,
          tasksDone,
          tasksOpen,
          activities: myActs.length,
          leadsCount: myLeads.length,
          leadConvRate,
        };
      })
      .sort((a, b) => b.wonValue - a.wonValue);
  }, [q.data, since]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        wonValue: acc.wonValue + r.wonValue,
        pipelineValue: acc.pipelineValue + r.pipelineValue,
        wonCount: acc.wonCount + r.wonCount,
        tasksDone: acc.tasksDone + r.tasksDone,
        activities: acc.activities + r.activities,
      }),
      { wonValue: 0, pipelineValue: 0, wonCount: 0, tasksDone: 0, activities: 0 },
    );
  }, [rows]);

  const chartData = rows.slice(0, 10).map((r) => ({ name: r.name.split(" ")[0], Won: r.wonValue, Pipeline: r.pipelineValue }));

  if (q.isLoading) return <div className="text-sm text-muted-foreground">Loading scorecard…</div>;

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl text-foreground" style={{ fontWeight: 500 }}>Sales Staff Scorecard</h1>
          <p className="text-sm text-muted-foreground mt-1">Per-rep performance across deals, activity, and conversion.</p>
        </div>
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="px-3 py-1.5 text-xs rounded-md transition-colors"
              style={{
                backgroundColor: range === r.key ? "#e2725b" : "transparent",
                color: range === r.key ? "#fff" : "var(--color-muted-foreground)",
                fontWeight: range === r.key ? 500 : 400,
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Team totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI icon={<DollarSign className="h-4 w-4" />} label="Team won" value={formatCurrency(totals.wonValue)} tone="#e2725b" />
        <KPI icon={<TrendingUp className="h-4 w-4" />} label="Open pipeline" value={formatCurrency(totals.pipelineValue)} tone="#f5b7a3" />
        <KPI icon={<Trophy className="h-4 w-4" />} label="Deals won" value={String(totals.wonCount)} tone="#fde2c0" />
        <KPI icon={<CheckCircle2 className="h-4 w-4" />} label="Tasks done" value={String(totals.tasksDone)} tone="#e0ecdc" />
        <KPI icon={<Activity className="h-4 w-4" />} label="Activities" value={String(totals.activities)} tone="#dce9f0" />
      </div>

      {/* Leaderboard chart */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm text-foreground mb-4" style={{ fontWeight: 500 }}>Leaderboard — won vs pipeline</h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3d9c4" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#8a6a55", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8a6a55", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#fff", border: "1px solid #f3d9c4", borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => formatCurrency(Number(v))}
              />
              <Bar dataKey="Won" fill="#e2725b" radius={[6, 6, 0, 0]} />
              <Bar dataKey="Pipeline" fill="#f5b7a3" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-sm text-muted-foreground py-12 text-center">No sales activity in this range</div>
        )}
      </div>

      {/* Scorecard table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Target className="h-4 w-4" style={{ color: "#e2725b" }} />
          <h2 className="text-sm text-foreground" style={{ fontWeight: 500 }}>Per-rep scorecard</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5" style={{ fontWeight: 500 }}>Rep</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Won $</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Deals won</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Win rate</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Avg deal</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Cycle (d)</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Pipeline $</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Open deals</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Leads conv.</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Tasks done</th>
                <th className="text-right px-3 py-2.5" style={{ fontWeight: 500 }}>Activities</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className="text-center text-muted-foreground py-12">No sales staff yet</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs" style={{ fontWeight: 500 }}>
                        {initials(r.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-foreground flex items-center gap-1.5" style={{ fontWeight: 500 }}>
                          {i === 0 && r.wonValue > 0 && <Trophy className="h-3.5 w-3.5" style={{ color: "#e2725b" }} />}
                          {r.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right text-foreground" style={{ fontWeight: 500 }}>{formatCurrency(r.wonValue)}</td>
                  <td className="px-3 py-3 text-right text-foreground">{r.wonCount}</td>
                  <td className="px-3 py-3 text-right text-foreground">{r.winRate.toFixed(0)}%</td>
                  <td className="px-3 py-3 text-right text-foreground">{formatCurrency(r.avgDeal)}</td>
                  <td className="px-3 py-3 text-right text-foreground">{r.avgCycle.toFixed(0)}</td>
                  <td className="px-3 py-3 text-right text-foreground">{formatCurrency(r.pipelineValue)}</td>
                  <td className="px-3 py-3 text-right text-foreground">{r.openCount}</td>
                  <td className="px-3 py-3 text-right text-foreground">{r.leadsCount > 0 ? `${r.leadConvRate.toFixed(0)}%` : "—"}</td>
                  <td className="px-3 py-3 text-right text-foreground">{r.tasksDone}</td>
                  <td className="px-3 py-3 text-right text-foreground">{r.activities}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPI({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: tone, color: "#3a2418" }}>{icon}</div>
        <span className="text-xs text-muted-foreground" style={{ fontWeight: 500 }}>{label}</span>
      </div>
      <div className="text-xl text-foreground mt-2" style={{ fontWeight: 500 }}>{value}</div>
    </div>
  );
}
