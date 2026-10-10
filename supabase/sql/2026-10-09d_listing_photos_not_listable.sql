-- =====================================================================
-- L3: listing photos stay shareable by link, but nobody can list the bucket (9 Oct 2026)
--
-- Security audit L3. listing-photos is a PUBLIC bucket: its files are served at
-- /storage/v1/object/public/listing-photos/<path>, which never consults RLS, so
-- every photo link already shared keeps working. What the old policy
-- lp_photos_read (bucket_id = 'listing-photos' AND true, role public) added on
-- top was the storage API's list/search: anyone could enumerate every agent's
-- photo filenames.
--
-- New read rule: a signed-in agent can still see (and so update / delete) the
-- files in their own folder <auth.uid()>/..., the same scope as the existing
-- insert/update/delete policies. The app only uploads + getPublicUrl, it never
-- lists (src/views/ListingPresentationView.jsx).
-- Idempotent. Rollback: rollback/2026-10-09d_listing_photos_not_listable.down.sql
-- =====================================================================
set local lock_timeout = '5s';
drop policy if exists lp_photos_read on storage.objects;
drop policy if exists lp_photos_read_own on storage.objects;
create policy lp_photos_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = (auth.uid())::text);
