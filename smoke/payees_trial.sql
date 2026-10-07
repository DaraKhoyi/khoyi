-- payees_trial.sql — agent accounts and 1099 tracking against the REAL brokerage book, inside a
-- transaction that is ALWAYS rolled back (it ends by raising its results). Run as closings_trial.sql is.
-- Expect: a long account number refused; an agent paid 2,700 with 300 of it by card counts 2,400 and
-- files; a foreign payee never files; a tax ID is stored, seen only by an owner (and logged), and its
-- column cannot be read; an unknown year assumes nothing; charges run once; mary is refused everywhere.
do $$
declare v jsonb; v_out text := ''; v_book uuid := 'a621fc8c-2bb9-4edd-b7ab-d7509eda73b3'; v_id uuid; v_ag uuid; v_cat uuid; v_fee uuid; v_txt text; v_n int;
  dara text := json_build_object('sub','ad06bbc1-a1cb-4716-84d3-36f426ea3187','role','authenticated')::text;
begin
  select id into v_ag from public.agents where name = 'Joshua Maples' limit 1;
  select id into v_cat from public.tax_categories where book_id = v_book and name = 'Agent Commissions Paid';
  select id into v_fee from public.tax_categories where book_id = v_book and name = 'Agent Fees';
  perform set_config('request.jwt.claims', dara, true); set local role authenticated;
  -- account name guard
  begin perform public.set_book_account(v_book, 'Checking 123456789', 0, 'bank'); v_out := concat(v_out, E'\nBAD: long number accepted'); exception when others then v_out := concat(v_out, E'\nlong number: ', sqlerrm); end;
  perform public.set_book_account(v_book, 'Operating 4411', 0, 'bank');
  insert into public.transactions (book_id, date, amount, scope, account, payee, tax_category_id, agent_id) values
    (v_book, '2026-03-02', -1500, 'business', 'Operating 4411', 'Joshua Maples', v_cat, v_ag),
    (v_book, '2026-04-02', -900, 'business', 'Operating 4411', 'Joshua Maples', v_cat, v_ag),
    (v_book, '2026-05-02', -300, 'business', 'X9577', 'Joshua Maples', v_cat, v_ag),
    (v_book, '2026-06-02', 250, 'business', 'Operating 4411', 'Joshua Maples', v_fee, v_ag);
  v := public.book_1099(v_book, 2026);
  v_out := concat(v_out, E'\nfigures ', (v->'figures')::text, E'\npayees ', jsonb_array_length(v->'payees'), E' untracked ', (v->'untracked')::text);
  v_id := public.payee_save(v_book, null, jsonb_build_object('agent_id', v_ag));
  v_id := public.payee_save(v_book, (select id from public.book_payees where book_id = v_book and agent_id = v_ag), '{"tax_status":"us_person"}');
  begin perform public.payee_save(v_book, null, jsonb_build_object('agent_id', v_ag)); v_out := concat(v_out, E'\nBAD: tracked twice'); exception when others then v_out := concat(v_out, E'\ntwice: ', sqlerrm); end;
  perform public.payee_save(v_book, null, '{"name":"Marge Aloyn","tax_status":"foreign"}');
  v := public.book_1099(v_book, 2026);
  v_out := concat(v_out, E'\nafter: ', (select jsonb_agg(jsonb_build_object('n', x->>'name', 'paid', x->'paid', 'card', x->'by_card', 'counts', x->'counts', 'files', x->'files', 'st', x->>'tax_status')) from jsonb_array_elements(v->'payees') x)::text);
  v := public.payee_set_tin(v_id, '123-45-6789', null); v_out := concat(v_out, E'\nset tin ', v::text);
  begin perform public.payee_set_tin(v_id, '12345', null); v_out := concat(v_out, E'\nBAD short tin'); exception when others then v_out := concat(v_out, E'\nshort tin: ', sqlerrm); end;
  v_out := concat(v_out, E'\nreveal ', public.payee_reveal_tin(v_id));
  begin execute 'select tin_enc from public.book_payees limit 1'; v_out := concat(v_out, E'\nBAD: cipher column readable'); exception when others then v_out := concat(v_out, E'\ncipher column: ', sqlerrm); end;
  v := public.book_1099_file(v_book, 2026); v_out := concat(v_out, E'\nfile ', v::text);
  v := public.book_1099(v_book, 2031); v_out := concat(v_out, E'\n2031 figures ', coalesce((v->'figures')::text,'NULL'), ' files ', (v->'payees'->0->'files')::text);
  begin v := public.book_1099_file(v_book, 2031); v_out := concat(v_out, E'\nBAD 2031 file'); exception when others then v_out := concat(v_out, E'\n2031 file: ', sqlerrm); end;
  -- agent accounts
  v_id := public.agent_schedule_save(v_book, null, jsonb_build_object('agent_id', v_ag, 'kind', 'monthly', 'label', 'Monthly fee', 'amount', 99, 'every', 'month', 'starts_on', '2026-07-01'));
  v_n := public.agent_charges_run(v_book); v_out := concat(v_out, E'\nrun1 ', v_n, ' run2 ', public.agent_charges_run(v_book));
  perform public.agent_charge_add(v_book, v_ag, '2026-08-15', 'eo', 'E&O 2026', 300);
  perform public.agent_charge_add(v_book, v_ag, '2026-08-20', 'credit', 'Goodwill', 50);
  v := public.agent_statement(v_book, v_ag, '2026-01-01', '2026-12-31');
  v_out := concat(v_out, E'\nstatement paid_total ', v->>'paid_total', ' owed ', v->>'owed', ' charges ', jsonb_array_length(v->'charges'), ' payments ', jsonb_array_length(v->'payments'), ' closings ', jsonb_array_length(v->'closings'));
  v := public.agent_balances(v_book, 2026); v_out := concat(v_out, E'\nbalances ', (select x::text from jsonb_array_elements(v->'agents') x where x->>'name' = 'Joshua Maples'), ' schedules ', jsonb_array_length(v->'schedules'));
  v := public.my_agent_statement(null, null); v_out := concat(v_out, E'\nmine ', coalesce(left(v::text, 120), 'NULL'));
  reset role;
  v_out := concat(v_out, E'\nlog ', (select string_agg(action, ',') from public.book_log where book_id = v_book and action like 'tax%'));
  perform set_config('request.jwt.claims', json_build_object('sub','88361e86-f538-4d20-951c-a6091637c318','role','authenticated')::text, true); set local role authenticated;
  begin v := public.book_1099(v_book, 2026); v_out := concat(v_out, E'\nBAD mary 1099'); exception when others then v_out := concat(v_out, E'\nmary 1099: ', sqlerrm); end;
  begin v_txt := public.payee_reveal_tin(v_id); v_out := concat(v_out, E'\nBAD mary reveal'); exception when others then v_out := concat(v_out, E'\nmary reveal: ', sqlerrm); end;
  begin v := public.agent_statement(v_book, v_ag, null, null); v_out := concat(v_out, E'\nBAD mary statement'); exception when others then v_out := concat(v_out, E'\nmary statement: ', sqlerrm); end;
  begin v_n := public.agent_charges_run(v_book); v_out := concat(v_out, E'\nBAD mary run'); exception when others then v_out := concat(v_out, E'\nmary run: ', sqlerrm); end;
  v_out := concat(v_out, E'\nmary sees ', (select count(*) from public.book_payees), '/', (select count(*) from public.agent_charges), ' mine: ', coalesce(public.my_agent_statement(null,null)::text, 'NULL'));
  reset role;
  execute 'set constraints all immediate';
  v_out := concat(v_out, E'\nhealth problems: ', (select count(*) from public.ledger_health()));
  raise exception 'RESULTS:%', v_out;
end $$;
