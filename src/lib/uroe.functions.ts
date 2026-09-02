import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type GenerateInput = {
  contactId: string;
  templateId: string | null;
  channel: "email" | "whatsapp" | "sms";
  tone: string;
  intentScore: number;
  notes: string;
};

/**
 * AI nurture draft generation.
 * Runs on the server, writes a PENDING draft that a rep must approve.
 * Falls back to the approved fallback template if the model is unavailable.
 */
export const generateNurtureDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: GenerateInput) => {
    if (!input?.contactId) throw new Error("contactId is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const started = Date.now();
    const { supabase, userId } = context;

    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, email, role_title, temperature, tags, companies(name, industry)")
      .eq("id", data.contactId)
      .maybeSingle();
    if (contactErr || !contact) throw new Error("Contact not found");

    let template: { id: string; name: string; subject: string | null; body: string } | null = null;
    if (data.templateId) {
      const { data: t } = await supabase
        .from("nurture_templates")
        .select("id, name, subject, body")
        .eq("id", data.templateId)
        .maybeSingle();
      template = t ?? null;
    }
    if (!template) {
      const { data: t } = await supabase
        .from("nurture_templates")
        .select("id, name, subject, body")
        .eq("is_fallback", true)
        .eq("channel", data.channel)
        .limit(1)
        .maybeSingle();
      template = t ?? null;
    }

    const company = (contact as any).companies;
    const prompt = [
      `Channel: ${data.channel}`,
      `Tone: ${data.tone}`,
      `Intent score: ${data.intentScore}/100`,
      `Contact: ${contact.first_name} ${contact.last_name}${contact.role_title ? `, ${contact.role_title}` : ""}`,
      company?.name ? `Company: ${company.name}${company.industry ? ` (${company.industry})` : ""}` : "",
      contact.temperature ? `Lead temperature: ${contact.temperature}` : "",
      contact.tags?.length ? `Tags: ${contact.tags.join(", ")}` : "",
      data.notes ? `Rep notes: ${data.notes}` : "",
      template ? `Approved template to adapt (keep its structure and intent):\n${template.body}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const system =
      data.channel === "email"
        ? `You are a B2B revenue nurture writer. Personalise the approved template for this lead. Never invent facts, prices, or commitments. Output exactly:\nSubject: <subject>\n\n<body>\nKeep the body under 140 words.`
        : `You are a B2B revenue nurture writer. Personalise the approved template for a ${data.channel} message. Never invent facts, prices, or commitments. Output the message text only, under 45 words.`;

    let subject: string | null = null;
    let body = "";
    let model = "google/gemini-3.7-flash";

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      model = "fallback-template";
      body = template?.body ?? "Hi there, thanks for reaching out — when is a good time for a short call?";
      subject = template?.subject ?? null;
    } else {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!res.ok) throw new Error(`AI gateway ${res.status}`);
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = json.choices?.[0]?.message?.content?.trim() ?? "";
        if (!text) throw new Error("Empty completion");
        if (data.channel === "email") {
          const m = text.match(/^Subject:\s*(.+?)\n+([\s\S]+)$/);
          subject = m ? m[1]!.trim() : (template?.subject ?? "Following up");
          body = m ? m[2]!.trim() : text;
        } else {
          body = text;
        }
      } catch {
        model = "fallback-template";
        subject = template?.subject ?? null;
        body = template?.body ?? "Hi there, thanks for reaching out — when is a good time for a short call?";
      }
    }

    const latency = Date.now() - started;

    const { data: draft, error: insertErr } = await supabase
      .from("nurture_drafts")
      .insert({
        contact_id: contact.id,
        template_id: template?.id ?? null,
        assignee_id: userId,
        channel: data.channel,
        subject,
        body,
        status: "pending",
        intent_score: data.intentScore,
        latency_ms: latency,
        prompt_log: prompt,
        model,
      })
      .select("id")
      .maybeSingle();
    if (insertErr) throw new Error(insertErr.message);

    await supabase.from("warehouse_events").insert({
      source: "uroe",
      event_type: "ai_draft_generated",
      entity_type: "nurture_draft",
      entity_id: draft?.id ?? null,
      actor_id: userId,
      payload: { channel: data.channel, model, latency_ms: latency, intent_score: data.intentScore },
    });

    return { id: draft?.id ?? null, subject, body, latency, model };
  });
