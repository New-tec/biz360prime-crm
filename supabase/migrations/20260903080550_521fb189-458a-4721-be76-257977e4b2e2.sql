REVOKE ALL ON FUNCTION public.route_new_lead() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.after_lead_routed() FROM PUBLIC, anon, authenticated;