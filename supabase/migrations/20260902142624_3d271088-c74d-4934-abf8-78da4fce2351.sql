-- ENUMS
CREATE TYPE public.ad_platform AS ENUM ('google_ads','meta','linkedin','tiktok','web_form','seo','other');
CREATE TYPE public.connector_status AS ENUM ('connected','disconnected','error','pending');
CREATE TYPE public.touchpoint_type AS ENUM ('impression','click','pixel_event','contact_created','deal_created','deal_won','deal_lost','message_sent','message_reply');
CREATE TYPE public.draft_status AS ENUM ('pending','approved','rejected','sent');

-- 1. AD CONNECTORS
CREATE TABLE public.ad_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform public.ad_platform NOT NULL,
  display_name text NOT NULL,
  account_ref text,
  status public.connector_status NOT NULL DEFAULT 'pending',
  last_synced_at timestamptz,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_connectors TO authenticated;
GRANT ALL ON public.ad_connectors TO service_role;
ALTER TABLE public.ad_connectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "connectors_select" ON public.ad_connectors FOR SELECT TO authenticated USING (true);
CREATE POLICY "connectors_write" ON public.ad_connectors FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "connectors_update" ON public.ad_connectors FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "connectors_delete" ON public.ad_connectors FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ad_connectors_u BEFORE UPDATE ON public.ad_connectors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. AD CAMPAIGNS
CREATE TABLE public.ad_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_id uuid REFERENCES public.ad_connectors(id) ON DELETE CASCADE,
  platform public.ad_platform NOT NULL,
  external_campaign_id text,
  adset_id text,
  creative_id text,
  name text NOT NULL,
  stat_date date NOT NULL DEFAULT CURRENT_DATE,
  spend numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ad_campaigns_date ON public.ad_campaigns(stat_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_campaigns TO authenticated;
GRANT ALL ON public.ad_campaigns TO service_role;
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_select" ON public.ad_campaigns FOR SELECT TO authenticated USING (true);
CREATE POLICY "campaigns_insert" ON public.ad_campaigns FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "campaigns_update" ON public.ad_campaigns FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "campaigns_delete" ON public.ad_campaigns FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_ad_campaigns_u BEFORE UPDATE ON public.ad_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 3. ATTRIBUTION TOUCHPOINTS
CREATE TABLE public.attribution_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.ad_campaigns(id) ON DELETE SET NULL,
  platform public.ad_platform,
  type public.touchpoint_type NOT NULL,
  value numeric,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_touchpoints_contact ON public.attribution_touchpoints(contact_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attribution_touchpoints TO authenticated;
GRANT ALL ON public.attribution_touchpoints TO service_role;
ALTER TABLE public.attribution_touchpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "touchpoints_select" ON public.attribution_touchpoints FOR SELECT TO authenticated USING (true);
CREATE POLICY "touchpoints_insert" ON public.attribution_touchpoints FOR INSERT TO authenticated WITH CHECK (NOT public.has_role(auth.uid(),'viewer'));
CREATE POLICY "touchpoints_update" ON public.attribution_touchpoints FOR UPDATE TO authenticated USING (NOT public.has_role(auth.uid(),'viewer'));
CREATE POLICY "touchpoints_delete" ON public.attribution_touchpoints FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 4. ROUTING RULES
CREATE TABLE public.routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  region text,
  tier text,
  min_intent_score integer NOT NULL DEFAULT 0,
  platform public.ad_platform,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routing_rules TO authenticated;
GRANT ALL ON public.routing_rules TO service_role;
ALTER TABLE public.routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "routing_select" ON public.routing_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "routing_insert" ON public.routing_rules FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "routing_update" ON public.routing_rules FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "routing_delete" ON public.routing_rules FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_routing_rules_u BEFORE UPDATE ON public.routing_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 5. NURTURE TEMPLATES
CREATE TABLE public.nurture_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel public.message_channel NOT NULL DEFAULT 'email',
  tone text,
  stage text,
  subject text,
  body text NOT NULL,
  is_fallback boolean NOT NULL DEFAULT false,
  is_approved boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurture_templates TO authenticated;
GRANT ALL ON public.nurture_templates TO service_role;
ALTER TABLE public.nurture_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ntemplates_select" ON public.nurture_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "ntemplates_insert" ON public.nurture_templates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "ntemplates_update" ON public.nurture_templates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "ntemplates_delete" ON public.nurture_templates FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_nurture_templates_u BEFORE UPDATE ON public.nurture_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 6. NURTURE DRAFTS
CREATE TABLE public.nurture_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.nurture_templates(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  channel public.message_channel NOT NULL DEFAULT 'email',
  subject text,
  body text NOT NULL,
  status public.draft_status NOT NULL DEFAULT 'pending',
  intent_score integer,
  latency_ms integer,
  prompt_log text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nurture_drafts_status ON public.nurture_drafts(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nurture_drafts TO authenticated;
GRANT ALL ON public.nurture_drafts TO service_role;
ALTER TABLE public.nurture_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ndrafts_select" ON public.nurture_drafts FOR SELECT TO authenticated USING (true);
CREATE POLICY "ndrafts_insert" ON public.nurture_drafts FOR INSERT TO authenticated WITH CHECK (NOT public.has_role(auth.uid(),'viewer'));
CREATE POLICY "ndrafts_update" ON public.nurture_drafts FOR UPDATE TO authenticated USING (NOT public.has_role(auth.uid(),'viewer'));
CREATE POLICY "ndrafts_delete" ON public.nurture_drafts FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE TRIGGER trg_nurture_drafts_u BEFORE UPDATE ON public.nurture_drafts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 7. WAREHOUSE EVENTS
CREATE TABLE public.warehouse_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_warehouse_events_time ON public.warehouse_events(occurred_at DESC);
GRANT SELECT, INSERT ON public.warehouse_events TO authenticated;
GRANT ALL ON public.warehouse_events TO service_role;
ALTER TABLE public.warehouse_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wevents_select" ON public.warehouse_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "wevents_insert" ON public.warehouse_events FOR INSERT TO authenticated WITH CHECK (NOT public.has_role(auth.uid(),'viewer'));

-- 8. REVENUE TARGETS
CREATE TABLE public.revenue_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  target_value numeric NOT NULL,
  unit text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_targets TO authenticated;
GRANT ALL ON public.revenue_targets TO service_role;
ALTER TABLE public.revenue_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "targets_select" ON public.revenue_targets FOR SELECT TO authenticated USING (true);
CREATE POLICY "targets_write" ON public.revenue_targets FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "targets_update" ON public.revenue_targets FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
CREATE POLICY "targets_delete" ON public.revenue_targets FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_revenue_targets_u BEFORE UPDATE ON public.revenue_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- SEED: KPI targets
INSERT INTO public.revenue_targets (key, label, target_value, unit) VALUES
  ('ad_cost','Ad cost ceiling',50000,'EUR'),
  ('revenue','Revenue target',5000000,'EUR'),
  ('roas','Return on ad spend',100,'x'),
  ('cac','CAC threshold',150000,'EUR'),
  ('cycle_days','Pipeline velocity target',45,'days');

-- SEED: connectors
INSERT INTO public.ad_connectors (platform, display_name, status) VALUES
  ('google_ads','Google Ads','pending'),
  ('meta','Meta Graph','pending'),
  ('linkedin','LinkedIn Marketing','pending'),
  ('tiktok','TikTok Ads','pending'),
  ('web_form','Website Web Form','connected'),
  ('seo','SEO / Organic Search','connected');

-- SEED: templates
INSERT INTO public.nurture_templates (name, channel, tone, stage, subject, body, is_fallback) VALUES
  ('Ad-click first touch','email','Consultative','first_touch','Quick note on {{pain_point}}','Hi {{first_name}},

I noticed you came through our {{campaign_name}} campaign. Teams in {{industry}} usually reach out to us about {{pain_point}}.

Worth a 15-minute call this week?

{{rep_name}}',false),
  ('High-intent demo push','email','Direct','qualification','{{company}} + a 15-min walkthrough','Hi {{first_name}},

Based on what you looked at, a short walkthrough would answer most of it faster than email. I have slots {{slot_1}} or {{slot_2}}.

{{rep_name}}',false),
  ('WhatsApp instant reply','whatsapp','Friendly','first_touch',NULL,'Hi {{first_name}}, {{rep_name}} here from {{our_company}} — saw your enquiry about {{pain_point}}. Happy to send a quick summary. What works better, a call or a short doc?',false),
  ('SMS speed-to-lead','sms','Brief','first_touch',NULL,'Hi {{first_name}}, {{rep_name}} from {{our_company}}. Got your request — can I call you in the next 10 minutes?',false),
  ('Generic safe fallback','email','Neutral','fallback','Following up on your enquiry','Hi {{first_name}},

Thanks for reaching out to {{our_company}}. I would like to understand what you are trying to solve so I can point you to the right thing.

Do you have 15 minutes this week?

{{rep_name}}',true),
  ('WhatsApp fallback','whatsapp','Neutral','fallback',NULL,'Hi {{first_name}}, thanks for contacting {{our_company}}. When is a good time for a short call?',true);