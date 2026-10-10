-- Rollback L3: anyone can list listing-photos again.
set local lock_timeout = '5s';
drop policy if exists lp_photos_read_own on storage.objects;
drop policy if exists lp_photos_read on storage.objects;
create policy lp_photos_read on storage.objects for select to public using (bucket_id = 'listing-photos' and true);
delete from public._applied_sql where file = '2026-10-09d_listing_photos_not_listable.sql';
