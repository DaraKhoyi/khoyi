-- 2026-10-03b — journal-tidy proofreads a person's own journal note; it is not
-- spend about one contact. Added to the not-about-a-person list so its cost is
-- recorded as such (about = 'no_one') instead of counted as unnamed.
-- Patched in place: other migrations own the rest of the list. Idempotent.
do $$
declare d text;
begin
  select pg_get_functiondef('public.ai_fn_not_about_a_person(text)'::regprocedure) into d;
  if position('''journal-tidy''' in d) = 0 then
    if position('''journal-search'',' in d) = 0 then raise exception 'ai_fn_not_about_a_person has changed shape — add journal-tidy by hand'; end if;
    execute replace(d, '''journal-search'',', '''journal-search'', ''journal-tidy'',');
  end if;
end $$;
