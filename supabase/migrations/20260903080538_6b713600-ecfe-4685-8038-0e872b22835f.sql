-- link drafts to leads
ALTER TABLE public.nurture_drafts
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE;

-- dedupe key for real-time ad ingestion upserts
CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_ingest_key
  ON public.ad_campaigns (platform, coalesce(external_campaign_id,''), coalesce(adset_id,''), coalesce(creative_id,''), stat_date);

-- ============ routing: BEFORE INSERT assigns owner ============
CREATE OR REPLACE FUNCTION public.route_new_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score int;
  v_region text;
  v_tier text;
  v_platform ad_platform;
  v_rule public.routing_rules%ROWTYPE;
  v_assignee uuid;
BEGIN
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb);
  v_score  := coalesce(nullif(NEW.metadata->>'intent_score','')::int, 50);
  v_region := nullif(NEW.metadata->>'region','');
  v_tier   := nullif(NEW.metadata->>'tier','');
  BEGIN
    v_platform := nullif(NEW.metadata->>'platform','')::ad_platform;
  EXCEPTION WHEN others THEN
    v_platform := NULL;
  END;

  SELECT r.* INTO v_rule
  FROM public.routing_rules r
  WHERE r.is_active
    AND (r.region   IS NULL OR (v_region   IS NOT NULL AND lower(r.region) = lower(v_region)))
    AND (r.tier     IS NULL OR (v_tier     IS NOT NULL AND lower(r.tier)   = lower(v_tier)))
    AND (r.platform IS NULL OR r.platform = v_platform)
    AND v_score >= coalesce(r.min_intent_score, 0)
  ORDER BY r.priority ASC, r.created_at ASC
  LIMIT 1;

  v_assignee := coalesce(NEW.owner_id, v_rule.assignee_id);

  IF v_assignee IS NULL THEN
    SELECT ur.user_id INTO v_assignee
    FROM public.user_roles ur
    WHERE ur.role IN ('sales_rep','sales_manager','admin')
    ORDER BY (SELECT count(*) FROM public.leads l WHERE l.owner_id = ur.user_id), random()
    LIMIT 1;
  END IF;

  NEW.owner_id := v_assignee;
  NEW.metadata := NEW.metadata || jsonb_build_object(
    'intent_score', v_score,
    'routed_rule_id', v_rule.id,
    'routed_rule_name', v_rule.name,
    'routed_at', now(),
    'routing_mode', CASE WHEN v_rule.id IS NOT NULL THEN 'rule' WHEN v_assignee IS NOT NULL THEN 'balanced' ELSE 'unassigned' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_route ON public.leads;
CREATE TRIGGER trg_leads_route
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.route_new_lead();

-- ============ after insert: notify, log, draft nurture ============
CREATE OR REPLACE FUNCTION public.after_lead_routed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_tpl public.nurture_templates%ROWTYPE;
  v_body text;
  v_subject text;
  v_channel message_channel;
BEGIN
  v_name := coalesce(nullif(trim(coalesce(NEW.first_name,'') || ' ' || coalesce(NEW.last_name,'')),''),
                     NEW.company_name, NEW.email, 'Unknown lead');

  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, metadata)
    VALUES (
      NEW.owner_id, 'lead_new', 'New lead assigned: ' || v_name,
      coalesce(NEW.message, 'Routed automatically by the Revenue Engine.'),
      '/revenue-engine',
      jsonb_build_object('lead_id', NEW.id, 'intent_score', NEW.metadata->>'intent_score', 'rule', NEW.metadata->>'routed_rule_name')
    );
  END IF;

  INSERT INTO public.warehouse_events (source, event_type, entity_type, entity_id, actor_id, payload)
  VALUES ('uroe', 'lead_routed', 'lead', NEW.id, NEW.owner_id,
    jsonb_build_object(
      'rule_id', NEW.metadata->>'routed_rule_id',
      'rule_name', NEW.metadata->>'routed_rule_name',
      'routing_mode', NEW.metadata->>'routing_mode',
      'intent_score', NEW.metadata->>'intent_score',
      'channel', NEW.channel, 'source', NEW.source));

  v_channel := coalesce(NEW.channel, 'email'::message_channel);

  SELECT t.* INTO v_tpl
  FROM public.nurture_templates t
  WHERE t.is_approved AND t.channel = v_channel
  ORDER BY t.is_fallback DESC, t.created_at ASC
  LIMIT 1;

  IF v_tpl.id IS NULL THEN
    SELECT t.* INTO v_tpl
    FROM public.nurture_templates t
    WHERE t.is_approved
    ORDER BY t.is_fallback DESC, t.created_at ASC
    LIMIT 1;
  END IF;

  IF v_tpl.id IS NOT NULL THEN
    v_body := replace(replace(replace(v_tpl.body,
        '{{first_name}}', coalesce(NEW.first_name, 'there')),
        '{{company}}', coalesce(NEW.company_name, 'your team')),
        '{{source}}', coalesce(NEW.source, 'your enquiry'));
    v_subject := replace(replace(coalesce(v_tpl.subject,''),
        '{{first_name}}', coalesce(NEW.first_name, 'there')),
        '{{company}}', coalesce(NEW.company_name, 'your team'));

    INSERT INTO public.nurture_drafts
      (lead_id, template_id, assignee_id, channel, subject, body, status, intent_score, model, prompt_log)
    VALUES (
      NEW.id, v_tpl.id, NEW.owner_id, v_channel,
      nullif(v_subject,''), v_body, 'pending',
      nullif(NEW.metadata->>'intent_score','')::int,
      'auto-route-template',
      'Auto-generated on lead creation from template: ' || v_tpl.name
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_routed_after ON public.leads;
CREATE TRIGGER trg_leads_routed_after
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.after_lead_routed();