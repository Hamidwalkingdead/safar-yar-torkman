-- Ensure the private driver-document bucket exists in every Supabase environment.
-- The browser upload flow accepts image files up to 8 MiB; bucket MIME restrictions
-- provide a second, server-enforced boundary in addition to client-side validation.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-documents',
  'driver-documents',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Keep object access private and scoped to the owning account. The existing
-- storage policies in migration 0003 restrict the first path segment to auth.uid();
-- admin review access is provided by migration 0005.
