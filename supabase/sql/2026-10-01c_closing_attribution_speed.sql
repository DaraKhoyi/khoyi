-- closing_attribution: 9.9 s -> 0.4 s, same rows.
--
-- Found 1 Oct: the gate's lead_attribution check began failing on PostgREST's
-- 8 s statement_timeout, so Brokerage -> Goals (and the Panel) would time out the
-- same way. Cause: the `touch` CTE is referenced once, so Postgres INLINED it into
-- the join and rebuilt it — 6,355 rows, norm_person_name() on each — once per
-- closing (82 times). lead_concierge passed 6,000 rows; it was fast on 28 Sep.
-- MATERIALIZED builds it once. Patched in place, like 2026-09-30's edits, so the
-- 30 Sep AI-spend matching (address + transaction) is kept — the function is
-- never re-created from an older file.
do $$
declare d text;
begin
  select pg_get_functiondef('public.closing_attribution(date,date)'::regprocedure) into d;
  if position('touch as materialized' in d) = 0 then
    d := replace(d, 'touch as (   -- every record', 'touch as materialized (   -- every record');
    if position('touch as materialized' in d) = 0 then raise exception 'closing_attribution: touch CTE not found'; end if;
    execute d;
  end if;
end $$;
