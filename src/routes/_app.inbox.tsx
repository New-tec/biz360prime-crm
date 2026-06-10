import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, canEdit } from "@/lib/auth-context";
import { timeAgo } from "@/lib/format";
import { Mail, MessageCircle, Phone, Send, Instagram, Facebook, Twitter, Linkedin, Globe, ArrowRight, Inbox as InboxIcon, Music2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inbox")({
  component: InboxPage,
});

const CHANNELS = [
  { v: "all", l: "All", Icon: InboxIcon },
  { v: "email", l: "Email", Icon: Mail },
  { v: "whatsapp", l: "WhatsApp", Icon: MessageCircle },
  { v: "sms", l: "SMS", Icon: Phone },
  { v: "telegram", l: "Telegram", Icon: Send },
  { v: "instagram", l: "Instagram", Icon: Instagram },
  { v: "facebook", l: "Facebook", Icon: Facebook },
  { v: "twitter", l: "X / Twitter", Icon: Twitter },
  { v: "linkedin", l: "LinkedIn", Icon: Linkedin },
  { v: "tiktok", l: "TikTok", Icon: Music2 },
  { v: "web_form", l: "Web form", Icon: Globe },
] as const;

function InboxPage() {
  const { user, role } = useAuth();
  const qc = useQueryClient();
  const [channel, setChannel] = useState<string>("all");
  const [selected, setSelected] = useState<any | null>(null);

  const messages = useQuery({
    queryKey: ["inbox", channel],
    queryFn: async () => {
      let q = supabase.from("inbox_messages").select("*").order("received_at", { ascending: false }).limit(100);
      if (channel !== "all") q = q.eq("channel", channel as any);
      const { data } = await q;
      return data ?? [];
    },
  });

  const unreadByChannel = useQuery({
    queryKey: ["inbox-unread"],
    queryFn: async () => {
      const { data } = await supabase.from("inbox_messages").select("channel").is("read_at", null);
      const map: Record<string, number> = {};
      (data ?? []).forEach((m: any) => { map[m.channel] = (map[m.channel] ?? 0) + 1; });
      map.all = (data ?? []).length;
      return map;
    },
  });

  const markRead = async (id: string) => {
    await supabase.from("inbox_messages").update({ read_at: new Date().toISOString() }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["inbox"] });
    qc.invalidateQueries({ queryKey: ["inbox-unread"] });
  };

  const convertToContact = async (m: any) => {
    const { error } = await supabase.from("contacts").insert({
      first_name: m.sender_name?.split(" ")[0] ?? m.sender_handle ?? "Unknown",
      last_name: m.sender_name?.split(" ").slice(1).join(" ") || "—",
      email: m.channel === "email" ? m.sender_handle : null,
      phone: ["whatsapp", "sms"].includes(m.channel) ? m.sender_handle : null,
      owner_id: user!.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Created contact");
  };

  return (
    <div className="space-y-5 max-w-7xl">
      <div>
        <h1 className="text-2xl text-foreground" style={{ fontWeight: 500 }}>Unified Inbox</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inbound messages from email, WhatsApp, social, and web forms in one place. Connect channels in Settings to auto-route messages here.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Channel sidebar */}
        <div className="bg-card border border-border rounded-xl p-2 h-fit">
          {CHANNELS.map((c) => {
            const Icon = c.Icon;
            const count = unreadByChannel.data?.[c.v] ?? 0;
            const active = channel === c.v;
            return (
              <button
                key={c.v}
                onClick={() => { setChannel(c.v); setSelected(null); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                style={{ fontWeight: active ? 500 : 400 }}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1 text-left">{c.l}</span>
                {count > 0 && (
                  <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 min-w-5 h-5 flex items-center justify-center" style={{ fontWeight: 600 }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Messages */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {(messages.data ?? []).length === 0 ? (
            <div className="px-6 py-16 text-center">
              <InboxIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <div className="text-sm text-foreground mb-1" style={{ fontWeight: 500 }}>No messages yet</div>
              <div className="text-xs text-muted-foreground max-w-md mx-auto">
                Once you connect channels (email, WhatsApp via Twilio, Telegram, social DMs), inbound messages will appear here automatically and can be converted to leads.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {(messages.data ?? []).map((m: any) => {
                const Cinfo = CHANNELS.find((c) => c.v === m.channel);
                const Icon = Cinfo?.Icon ?? InboxIcon;
                return (
                  <div
                    key={m.id}
                    onClick={() => { setSelected(m); if (!m.read_at) markRead(m.id); }}
                    className={`px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors ${!m.read_at ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground truncate" style={{ fontWeight: !m.read_at ? 600 : 500 }}>
                            {m.sender_name ?? m.sender_handle ?? "Unknown sender"}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(m.received_at)}</span>
                        </div>
                        {m.subject && <div className="text-sm text-foreground/80 truncate">{m.subject}</div>}
                        <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{m.body}</div>
                      </div>
                      {canEdit(role) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); convertToContact(m); }}
                          className="text-[10px] inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-foreground hover:bg-secondary-hover shrink-0"
                          style={{ fontWeight: 500 }}
                          title="Convert to contact"
                        >
                          Contact <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex" onClick={() => setSelected(null)}>
          <div className="flex-1 bg-foreground/20" />
          <div className="w-full max-w-lg bg-card h-full overflow-y-auto p-6 border-l border-border" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-muted-foreground capitalize mb-1">{selected.channel} · {timeAgo(selected.received_at)}</div>
            <div className="text-base text-foreground mb-1" style={{ fontWeight: 500 }}>{selected.sender_name ?? selected.sender_handle}</div>
            {selected.subject && <div className="text-sm text-foreground mb-3" style={{ fontWeight: 500 }}>{selected.subject}</div>}
            <div className="text-sm text-foreground whitespace-pre-wrap">{selected.body}</div>
          </div>
        </div>
      )}
    </div>
  );
}
