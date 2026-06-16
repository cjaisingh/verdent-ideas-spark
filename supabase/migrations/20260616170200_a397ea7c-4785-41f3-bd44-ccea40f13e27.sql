
ALTER TABLE public.deep_audit_runs ADD COLUMN IF NOT EXISTS report_html_path text;
ALTER TABLE public.awip_reviews    ADD COLUMN IF NOT EXISTS report_html_path text;

-- Storage RLS for audit-reports bucket: operator/admin only.
CREATE POLICY "audit-reports: operators read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'audit-reports'
    AND (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  );

CREATE POLICY "audit-reports: operators write"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'audit-reports'
    AND (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  )
  WITH CHECK (
    bucket_id = 'audit-reports'
    AND (public.has_role(auth.uid(), 'operator') OR public.has_role(auth.uid(), 'admin'))
  );
