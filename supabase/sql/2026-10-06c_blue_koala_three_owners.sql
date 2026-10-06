-- Team Blue Koala has three owners with equal access.
--
-- Dara, 6 Oct 2026: "Alex is the owner of Team Blue Koala, as are Dara and Tina.
-- They should have equal access to the team information, perhaps with a switch.
-- Alex is also a broker admin, but Tina is not."
--
-- So Alexander gets an Owner seat on the Blue Koala books, beside Dara's and
-- Tina's. His seat is what opens them: being a Broker Admin opens nothing, here
-- or anywhere, and Tina's seat on these books gives her nothing on the
-- brokerage's. Each owner's seat has the same switch as any other seat.
-- Dara stays the one owner nobody else can switch off or remove (he asked to be
-- able to give and withdraw the others' access).
--
-- Idempotent. Safe to run twice.
do $$
declare v_alex uuid := '122eafc8-37db-41ed-beb6-4cb0c192527d'; v_book uuid;
begin
  select id into v_book from public.books where kind = 'team' and template = 'property_management' and name = 'Team Blue Koala';
  if v_book is null or not exists (select 1 from auth.users where id = v_alex) then return; end if;
  if exists (select 1 from public.book_access where book_id = v_book and user_id = v_alex and role = 'owner' and is_active) then return; end if;
  insert into public.book_access (book_id, user_id, role, granted_by) values (v_book, v_alex, 'owner', null)
  on conflict (book_id, user_id) where user_id is not null do update set role = 'owner', is_active = true, switched_at = now();
  insert into public.book_log (book_id, actor, action, subject_user, subject_label, detail)
  values (v_book, null, 'access_granted', v_alex, public.book_person_label(v_alex),
          jsonb_build_object('role', 'owner', 'because', 'co-owner of the team, on Dara''s instruction of 6 Oct 2026'));
end $$;
