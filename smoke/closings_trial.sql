-- closings_trial.sql — the proof that closings post correctly, run against the
-- REAL brokerage book and the REAL Gold Report inside a transaction that is
-- ALWAYS rolled back (it ends by raising its results). Nothing is kept.
--
-- Run it before any change to supabase/sql/*closings*.sql ships:
--   (echo "begin;"; cat <the new SQL, if not yet applied>; cat smoke/closings_trial.sql) > /tmp/t.sql
--   then send /tmp/t.sql to the Management API query endpoint (HANDOFF §2).
-- Read the RESULTS text: unknown account and missing start are refused; a
-- second pass enters nothing new; an entry tagged with its closing is taken
-- as the same money; a bare match is held as maybe_in_books; a sheet change is
-- flagged and only then accepted; an entry removed by hand is set aside and
-- comes back when restored; mary (no seat) is refused everywhere; and
-- "health problems: 0".
do $$
declare v jsonb; v_t timestamptz; v_out text := ''; r record; v_book uuid := 'a621fc8c-2bb9-4edd-b7ab-d7509eda73b3'; i int := 0; v_id uuid; v_tx uuid; v_n int; v_n2 int;
  b1 public.brokerage_transactions%rowtype; b2 public.brokerage_transactions%rowtype; b3 public.brokerage_transactions%rowtype; v_cl uuid;
  dara text := json_build_object('sub','ad06bbc1-a1cb-4716-84d3-36f426ea3187','role','authenticated')::text;
begin
  select * into b1 from public.brokerage_transactions where year=2026 and trans_id=100;
  select * into b2 from public.brokerage_transactions where year=2026 and trans_id=105;
  select * into b3 from public.brokerage_transactions where year=2026 and trans_id=106;
  select id into v_cl from public.tax_categories where book_id = v_book and name = 'Contract Labor';
  perform set_config('request.jwt.claims', dara, true); perform set_config('request.jwt.claim.role', 'authenticated', true); set local role authenticated;
  begin v := public.closing_settings_save(v_book, true, 'Nope Bank', null, '2026-01-01'); v_out := concat(v_out, E'\nBAD: unknown account accepted'); exception when others then v_out := concat(v_out, E'\nunknown account: ', sqlerrm); end;
  perform public.set_book_account(v_book, 'Operating Checking 4411', 0, 'bank');
  begin v := public.closing_settings_save(v_book, true, 'operating checking 4411', null, null); v_out := concat(v_out, E'\nBAD: no start accepted'); exception when others then v_out := concat(v_out, E'\nno start: ', sqlerrm); end;
  -- money already in the books: one tagged with its closing (sure), one bare (ask)
  insert into public.transactions (book_id, date, amount, scope, account, payee, closing_id) values (v_book, b1.date_received + 2, b1.gross_commission, 'business', 'Operating Checking 4411', 'DEPOSIT TITLE CO', b1.id);
  insert into public.transactions (book_id, date, amount, scope, account, payee) values (v_book, b2.date_received + 1, b2.gross_commission, 'business', 'Operating Checking 4411', 'DEPOSIT') returning id into v_tx;
  v := public.closing_settings_save(v_book, true, 'operating checking 4411', null, '2026-01-01');
  v_out := concat(v_out, E'\nsettings ', v::text);
  loop v := public.closings_sync(v_book, 500); i := i + 1; exit when (v->>'left')::int = 0 or i > 40; end loop;
  v_out := concat(v_out, E'\nbatches ', i, ' last ', v::text);
  select count(*) into v_n from public.transactions where book_id = v_book and not is_archived;
  v := public.closings_sync(v_book, 60);
  select count(*) into v_n2 from public.transactions where book_id = v_book and not is_archived;
  v_out := concat(v_out, E'\nidempotent: ', v_n, ' -> ', v_n2, ' ', v::text);
  select concat('state=', state, ' adopted=', adopted, ' reasons=', reasons::text) into v_out from (select v_out || E'\ntagged twin: ' || concat('state=', state, ' adopted=', adopted, ' reasons=', reasons::text) as state, adopted, reasons from public.closing_postings where closing_key='2026-100' and part='received') q;
  v_out := split_part(v_out, ' adopted=', 1) ;
  select id into v_id from public.closing_postings where closing_key='2026-105' and part='received';
  v_out := concat(v_out, E'\nbare twin: ', (select concat(state, ' ', reasons::text) from public.closing_postings where id = v_id));
  v := public.closing_decide(v_id, 'same', null, null, null, v_tx);
  v_out := concat(v_out, E'\nsame: ', v::text, ' tx cat=', (select c.name from public.transactions t join public.tax_categories c on c.id=t.tax_category_id where t.id = v_tx));
  v_out := concat(v_out, E'\ncount of 2026-100 deposits: ', (select count(*) from public.transactions where book_id=v_book and amount=b1.gross_commission and not is_archived and date between b1.date_received - 7 and b1.date_received + 7));
  reset role;
  -- the sheet changes a posted row
  update public.brokerage_transactions set amount_to_agent = amount_to_agent - 100, office_fee = office_fee + 100 where id = b3.id;
  perform set_config('request.jwt.claims', dara, true); set local role authenticated;
  v := public.closings_sync(v_book, 60);
  select id, transaction_id into v_id, v_tx from public.closing_postings where closing_key='2026-106' and part='agent';
  v_out := concat(v_out, E'\nchanged: ', (select sheet_changed::text from public.closing_postings where id = v_id), ' tx still ', (select amount from public.transactions where id = v_tx));
  v := public.closing_decide(v_id, 'accept_change');
  v_out := concat(v_out, E'\naccepted: tx now ', (select amount from public.transactions where id = v_tx), ' ', v::text);
  -- removed by hand, then put back
  update public.transactions set is_archived = true where id = v_tx;
  v := public.closings_sync(v_book, 60);
  v_out := concat(v_out, E'\nremoved: ', (select concat(state, ' ', note) from public.closing_postings where id = v_id));
  update public.transactions set is_archived = false where id = v_tx;
  v := public.closings_sync(v_book, 60);
  v_out := concat(v_out, E'\nrestored: ', (select concat(state, ' ', coalesce(note,'-')) from public.closing_postings where id = v_id));
  -- a person posts a held payout, sets one aside and brings it back
  select id into v_id from public.closing_postings where state='held' and part='payout' and reasons = array['what_for'] limit 1;
  v := public.closing_decide(v_id, 'post', null, null, v_cl); v_out := concat(v_out, E'\npayout: ', v::text);
  select id into v_id from public.closing_postings where state='held' and 'does_not_add_up' = any(reasons) limit 1;
  v := public.closing_decide(v_id, 'set_aside'); v := public.closing_decide(v_id, 'bring_back'); v_out := concat(v_out, E'\nbring back: ', v::text);
  v := public.closings_sync(v_book, 60);
  v_out := concat(v_out, E'\nafter bring back: ', (select concat(state, ' ', reasons::text) from public.closing_postings where id = v_id), ' ', v::text);
  v := public.closings_list(v_book, 'held', 5, 0);
  v_out := concat(v_out, E'\nlist: ', (v->'counts')::text, ' unread ', v->>'unread', ' problems ', (v->'problems')::text);
  reset role;
  for r in select state, part, count(*) n, round(sum(amount)) amt from public.closing_postings group by 1,2 order by 1,2 loop v_out := concat(v_out, format(E'\n%s %s n=%s amt=%s', r.state, r.part, r.n, r.amt)); end loop;
  v_out := concat(v_out, E'\narrivals: ', (select count(*) || ' books=' || count(distinct book_id) from public.book_arrivals));
  perform set_config('request.jwt.claims', json_build_object('sub','88361e86-f538-4d20-951c-a6091637c318','role','authenticated')::text, true); set local role authenticated;
  begin v := public.closings_sync(v_book, 5); v_out := concat(v_out, E'\nBAD: mary synced'); exception when others then v_out := concat(v_out, E'\nmary sync: ', sqlerrm); end;
  begin v := public.closing_decide(v_id, 'set_aside'); v_out := concat(v_out, E'\nBAD: mary decided'); exception when others then v_out := concat(v_out, E'\nmary decide: ', sqlerrm); end;
  v_out := concat(v_out, E'\nmary sees ', (select count(*) from public.closing_postings), '/', (select count(*) from public.book_arrivals), '/', (select count(*) from public.closing_settings));
  reset role;
  execute 'set constraints all immediate';
  v_out := concat(v_out, E'\nhealth problems: ', (select count(*) from public.ledger_health()));
  raise exception 'RESULTS:%', v_out;
end $$;
