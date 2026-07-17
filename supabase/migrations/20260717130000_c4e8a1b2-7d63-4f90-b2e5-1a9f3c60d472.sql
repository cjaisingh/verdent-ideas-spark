-- #31 — create the `ingested-files` storage bucket.
--
-- The bucket is referenced as a column default (ingested_files.storage_bucket,
-- 20260608110240) and by three storage.objects RLS policies (20260608110307),
-- but was never created in SQL — it only exists because it was made by hand in
-- the live environment. Fresh environments (new project, CI ephemeral DB, DR
-- restore) therefore have no bucket, so every upload fails "bucket not found"
-- and the RLS policies are dead letters. This migration closes that gap.
--
-- Private bucket (operator/admin RLS already gates storage.objects). Idempotent:
-- ON CONFLICT DO NOTHING leaves the existing live bucket untouched.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ingested-files',
  'ingested-files',
  false,
  52428800, -- 50 MiB, matches the ingest contract's size ceiling
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-outlook',
    'message/rfc822',
    'image/png',
    'image/jpeg',
    'image/tiff'
  ]
)
ON CONFLICT (id) DO NOTHING;
