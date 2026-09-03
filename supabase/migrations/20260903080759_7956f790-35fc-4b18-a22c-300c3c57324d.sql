ALTER TABLE public.ad_campaigns DROP COLUMN IF EXISTS ingest_key;

UPDATE public.ad_campaigns SET
  external_campaign_id = coalesce(external_campaign_id, ''),
  adset_id = coalesce(adset_id, ''),
  creative_id = coalesce(creative_id, '');

ALTER TABLE public.ad_campaigns
  ALTER COLUMN external_campaign_id SET DEFAULT '',
  ALTER COLUMN adset_id SET DEFAULT '',
  ALTER COLUMN creative_id SET DEFAULT '',
  ALTER COLUMN external_campaign_id SET NOT NULL,
  ALTER COLUMN adset_id SET NOT NULL,
  ALTER COLUMN creative_id SET NOT NULL;

DROP INDEX IF EXISTS public.ad_campaigns_ingest_key;

CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_ingest_key_uidx
  ON public.ad_campaigns (platform, external_campaign_id, adset_id, creative_id, stat_date);