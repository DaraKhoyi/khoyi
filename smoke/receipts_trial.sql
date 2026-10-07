-- receipts_trial.sql — receipts finding their entry and the recurring watch, in Dara's own book, inside a
-- transaction that is ALWAYS rolled back. Run as closings_trial.sql is.
do $$
declare v jsonb; v_out text := ''; v_book uuid := 'a52f2330-04be-4900-af61-d9b83ca1e7b3'; v_a uuid; v_b uuid; v_cat uuid;
  dara text := json_build_object('sub','ad06bbc1-a1cb-4716-84d3-36f426ea3187','role','authenticated')::text;
begin
  perform set_config('request.jwt.claims', dara, true); set local role authenticated;
  insert into public.transactions (book_id, date, amount, scope, account, payee) values (v_book, '2026-09-27', -212.40, 'business', 'Trial Visa', 'Home Depot') returning id into v_a;
  v := public.receipt_attach(v_book, v_book::text || '/receipts/a.jpg', 212.40, '2026-09-26'); v_out := concat(v_out, E'\none: ', v::text);
  begin v := public.receipt_attach(v_book, v_book::text || '/receipts/b.jpg', 212.40, '2026-09-26', v_a); v_out := concat(v_out, E'\nBAD second receipt'); exception when others then v_out := concat(v_out, E'\nsecond: ', sqlerrm); end;
  insert into public.transactions (book_id, date, amount, scope, account, payee) values (v_book, '2026-09-20', -45, 'business', 'Trial Visa', 'Shell'), (v_book, '2026-09-21', -45, 'business', 'Trial Visa', 'Shell');
  v := public.receipt_attach(v_book, v_book::text || '/receipts/c.jpg', 45, '2026-09-20'); v_out := concat(v_out, E'\ntwo: ', v::text);
  v := public.receipt_attach(v_book, v_book::text || '/receipts/d.jpg', 9999.99, '2026-09-20'); v_out := concat(v_out, E'\nnone: ', v::text);
  begin v := public.receipt_attach(v_book, 'a621fc8c-2bb9-4edd-b7ab-d7509eda73b3/receipts/x.jpg', 45, '2026-09-20'); v_out := concat(v_out, E'\nBAD foreign path'); exception when others then v_out := concat(v_out, E'\nforeign path: ', sqlerrm); end;
  v := public.receipt_attach(v_book, 'ad06bbc1-a1cb-4716-84d3-36f426ea3187/old.jpg', 9999.99, '2026-09-20'); v_out := concat(v_out, E'\nown legacy path ok: ', v::text);
  -- recurring
  insert into public.transactions (book_id, date, amount, scope, account, payee) values
    (v_book, '2026-07-02', -1800, 'business', 'Trial Chk', 'Trial Landlord'), (v_book, '2026-08-01', -1800, 'business', 'Trial Chk', 'Trial Landlord'), (v_book, '2026-09-03', -1800, 'business', 'Trial Chk', 'trial landlord'),
    (v_book, '2026-07-10', -389.5, 'business', 'Trial Chk', 'Trial Soft'), (v_book, '2026-08-09', -389.5, 'business', 'Trial Chk', 'Trial Soft'), (v_book, '2026-09-10', -389.5, 'business', 'Trial Chk', 'Trial Soft'), (v_book, '2026-10-09', -429.5, 'business', 'Trial Chk', 'Trial Soft'),
    (v_book, '2026-08-09', -20, 'business', 'Trial Chk', 'Trial Twice'), (v_book, '2026-09-10', -20, 'business', 'Trial Chk', 'Trial Twice');
  v := public.book_recurring_watch(v_book, '2026-10-12'); v_out := concat(v_out, E'\nwatch oct 12: ', (select jsonb_agg(x) from jsonb_array_elements(v) x where x->>'payee' ilike 'trial%')::text);
  v := public.book_recurring_watch(v_book, '2026-10-04'); v_out := concat(v_out, E'\nwatch oct 4: ', coalesce((select jsonb_agg(x->>'kind') from jsonb_array_elements(v) x where x->>'payee' ilike 'trial%')::text, 'none'));
  perform public.recurring_watch_dismiss(v_book, 'Trial Landlord', '2026-10-12');
  v := public.book_recurring_watch(v_book, '2026-10-12'); v_out := concat(v_out, E'\nafter dismiss: ', (select jsonb_agg(x->>'payee') from jsonb_array_elements(v) x where x->>'payee' ilike 'trial%')::text);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub','88361e86-f538-4d20-951c-a6091637c318','role','authenticated')::text, true); set local role authenticated;
  begin v := public.receipt_attach(v_book, v_book::text || '/receipts/z.jpg', 45, '2026-09-20'); v_out := concat(v_out, E'\nBAD mary attach'); exception when others then v_out := concat(v_out, E'\nmary attach: ', sqlerrm); end;
  v_out := concat(v_out, E'\nmary watch: ', public.book_recurring_watch(v_book, '2026-10-12')::text);
  begin perform public.recurring_watch_dismiss(v_book, 'x', '2026-10-01'); v_out := concat(v_out, E'\nBAD mary dismiss'); exception when others then v_out := concat(v_out, E'\nmary dismiss: ', sqlerrm); end;
  reset role;
  v_out := concat(v_out, E'\nrate ', (select business_rate from public.mileage_rates where year = 2026));
  raise exception 'RESULTS:%', v_out;
end $$;
