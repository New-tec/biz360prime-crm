
-- activities: own + admin/sales_manager
DROP POLICY IF EXISTS activities_select ON public.activities;
CREATE POLICY activities_select ON public.activities FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'sales_manager'));

-- leads: owner + admin/sales_manager
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'sales_manager'));

-- inbox: admin/sales_manager/sales_rep (exclude viewer)
DROP POLICY IF EXISTS inbox_select ON public.inbox_messages;
CREATE POLICY inbox_select ON public.inbox_messages FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin')
  OR has_role(auth.uid(), 'sales_manager')
  OR has_role(auth.uid(), 'sales_rep')
);

-- profiles: self + admin/sales_manager (team views)
DROP POLICY IF EXISTS profiles_select_auth ON public.profiles;
CREATE POLICY profiles_select_self_or_mgr ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'sales_manager'));

-- user_roles: self + admin
DROP POLICY IF EXISTS roles_select_auth ON public.user_roles;
CREATE POLICY roles_select_self_or_admin ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

-- storage.objects documents bucket: folder owner or admin
DROP POLICY IF EXISTS documents_storage_select ON storage.objects;
CREATE POLICY documents_storage_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR has_role(auth.uid(), 'admin')
  )
);

-- Revoke EXECUTE on internal trigger SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.track_stage_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
