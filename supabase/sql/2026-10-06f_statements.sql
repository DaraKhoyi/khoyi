-- Statements in: import, review, and rules that stick.
--
-- Dara, 6 Oct 2026 (build prompt, part 4). In his words: "Nothing imported
-- touches the ledger directly. Every line lands in a holding area first."
--
-- WHAT IS HERE
--   * statement_imports - one row per upload (a CSV, an OFX/QFX file, or a
--     scanned / photographed / PDF statement). The original file is kept in the
--     private "statements" bucket and every line points back to it.
--   * statement_lines   - THE HOLDING AREA. A line here is not in the books. It
--     becomes one (or, split, several) rows of public.transactions only when it
--     is posted, and the ledger posts from those exactly as it does for an
--     entry typed by hand.
--   * payee_rules       - what a person decided for a payee in a set of books.
--   * clean_payee()     - the ONE place raw bank text becomes a payee name.
--
-- THE PROMISES, AND WHERE EACH IS KEPT
--   * A statement must add up (opening + lines = closing). statement_blocked()
--     is asked by the only function that posts, statement_post_line(); a
--     statement that is off posts nothing, by hand or by rule.
--   * Possible duplicates are found against the books and against other lines
--     still waiting (statement_find_twins). They are shown, never dropped: a
--     line with a twin cannot be posted until a person says same or different.
--   * A line the reader was unsure of carries the reason in "unsure" and cannot
--     be posted until a person has looked. Nothing here corrects a line.
--   * Only a rule a person confirmed posts on its own. An AI suggestion is
--     marked proposed_by 'ai' and waits (statement_line_needs says 'new').
--   * Correcting teaches (rule_learn); leaving a line out does not judge.
--
-- A split entry is several rows of public.transactions sharing a split_group,
-- so every report that already reads entries by category stays right.
--
-- Writes go only through the functions below; the tables are read-only to the
-- app. Idempotent. Safe to run twice.

-- ── 1. What existing tables gain ────────────────────────────────────────────
alter table public.money_accounts add column if not exists is_personal boolean not null default false;   -- a personal account: what comes in on it starts as "personal, not business"
alter table public.transactions   add column if not exists statement_line_id uuid;   -- the statement line this entry was posted from
alter table public.transactions   add column if not exists rule_id uuid;             -- the rule that filed it, if one did
alter table public.transactions   add column if not exists split_group uuid;         -- entries that are parts of one payment share this

alter table public.transactions drop constraint if exists transactions_entered_via_check;
alter table public.transactions add constraint transactions_entered_via_check
  check (entered_via = any (array['manual', 'photo', 'csv', 'ofx', 'scan', 'email', 'recurring', 'deal', 'deal_close', 'ari']));

-- ── 2. The tables ───────────────────────────────────────────────────────────
create table if not exists public.statement_imports (
  id                   uuid primary key default gen_random_uuid(),
  book_id              uuid not null references public.books(id) on delete cascade,
  account              text not null,                     -- the money account, by the name entries use
  via                  text not null check (via in ('csv', 'ofx', 'scan')),
  file_name            text,
  file_paths           text[] not null default '{}',      -- in the private "statements" bucket
  file_sha256          text,
  opening_balance      numeric(14,2),                     -- as the books count it: money owed on a card is negative
  closing_balance      numeric(14,2),
  period_from          date,
  period_to            date,
  read_at              timestamptz,                       -- its lines are in the holding area
  read_error           text,
  read_started_at      timestamptz,                       -- the reader was last asked to read it
  suggested_at         timestamptz,                       -- the model has been asked about its undecided payees
  accepted_unproven_at timestamptz,                       -- an owner or admin let it through without adding up
  accepted_unproven_by uuid,
  accepted_off_by      numeric(14,2),                     -- how far off it was when accepted; a different gap needs a new yes
  taken_back_at        timestamptz,
  taken_back_by        uuid,
  uploaded_by          uuid,
  created_at           timestamptz not null default now()
);
create index if not exists statement_imports_by_book on public.statement_imports (book_id, created_at desc);
create index if not exists statement_imports_by_file on public.statement_imports (book_id, file_sha256) where file_sha256 is not null;

create table if not exists public.payee_rules (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid not null references public.books(id) on delete cascade,
  payee_key          text not null,                       -- lower(clean_payee(raw bank text))
  payee              text not null,                       -- the name people see
  account_key        text,                                -- only for this account (lower name), when narrowed
  amount             numeric(14,2),                       -- only for this exact amount, when narrowed
  tax_category_id    uuid references public.tax_categories(id) on delete set null,
  is_personal        boolean not null default false,
  transfer_account   text,
  contact_id         uuid references public.contacts(id) on delete set null,
  agent_id           uuid references public.agents(id) on delete set null,
  team_id            uuid references public.teams(id) on delete set null,
  memo               text,
  parts              jsonb,                               -- a split: [{category_id, pct, memo}]
  always_ask         boolean not null default false,
  suggest_always_ask boolean not null default false,      -- PrismOS proposes "always ask" after two conflicting corrections
  ask_declined       boolean not null default false,
  trusted            boolean not null default false,      -- a person confirmed it in review: it may post on its own
  money_in           boolean,                             -- learned from money coming in (true) or going out (false)
  agreements         integer not null default 0,
  changes            integer not null default 0,
  fix_pending        boolean not null default false,      -- changed, and earlier entries still read the old way: ask once
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists payee_rules_one on public.payee_rules (book_id, payee_key, coalesce(account_key, ''), coalesce(amount, -999999999.99));

create table if not exists public.statement_lines (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references public.statement_imports(id) on delete cascade,
  book_id             uuid not null references public.books(id) on delete cascade,
  line_no             integer not null,
  line_date           date,
  amount              numeric(14,2) not null default 0,   -- money into the account is positive, out is negative
  raw_text            text,                               -- exactly what the bank printed
  payee_key           text not null default '',
  payee               text,
  memo                text,
  external_id         text,
  tax_category_id     uuid references public.tax_categories(id) on delete set null,
  is_personal         boolean not null default false,
  transfer_account    text,
  contact_id          uuid references public.contacts(id) on delete set null,
  agent_id            uuid references public.agents(id) on delete set null,
  closing_id          uuid references public.brokerage_transactions(id) on delete set null,
  property_id         uuid references public.properties(id) on delete set null,
  team_id             uuid references public.teams(id) on delete set null,
  parts               jsonb,                              -- a split: [{category_id, amount, memo}]
  receipt_path        text,
  remember            text check (remember in ('payee', 'amount', 'account', 'ask')),
  proposed_by         text check (proposed_by in ('rule', 'ai', 'person', 'account')),
  rule_id             uuid references public.payee_rules(id) on delete set null,
  ai_confidence       numeric,
  unsure              text[] not null default '{}',       -- why a person must look: date, amount, payee, reader
  unsure_note         text,
  twin_transaction_id uuid references public.transactions(id) on delete set null,
  twin_line_id        uuid references public.statement_lines(id) on delete set null,
  twin_answer         text check (twin_answer in ('different')),
  result              text check (result in ('posted', 'skipped', 'duplicate', 'dropped')),   -- null = waiting
  auto_posted         boolean not null default false,
  hold                boolean not null default false,     -- a person undid it: never post it again without them
  added_by            uuid,                               -- typed in by a person (a line the reader missed), not read from the file
  touched_by          uuid,
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  unique (import_id, line_no)
);
create index if not exists statement_lines_by_book    on public.statement_lines (book_id) where result is null;
create index if not exists statement_lines_by_key     on public.statement_lines (book_id, payee_key) where result is null;
create index if not exists statement_lines_by_twin_tx on public.statement_lines (twin_transaction_id) where twin_transaction_id is not null;
create index if not exists statement_lines_by_twin_ln on public.statement_lines (twin_line_id) where twin_line_id is not null;
create index if not exists statement_lines_by_rule    on public.statement_lines (rule_id) where rule_id is not null;
create index if not exists statement_lines_by_import  on public.statement_lines (import_id);
create index if not exists statement_lines_by_amount  on public.statement_lines (book_id, amount) where result is null;
create index if not exists statement_lines_by_cat     on public.statement_lines (tax_category_id) where tax_category_id is not null;
create index if not exists statement_lines_by_contact on public.statement_lines (contact_id) where contact_id is not null;
create index if not exists statement_lines_by_agent   on public.statement_lines (agent_id) where agent_id is not null;
create index if not exists statement_lines_by_closing on public.statement_lines (closing_id) where closing_id is not null;
create index if not exists statement_lines_by_prop    on public.statement_lines (property_id) where property_id is not null;
create index if not exists statement_lines_by_team    on public.statement_lines (team_id) where team_id is not null;
create index if not exists payee_rules_by_cat         on public.payee_rules (tax_category_id) where tax_category_id is not null;
create index if not exists payee_rules_by_contact     on public.payee_rules (contact_id) where contact_id is not null;
create index if not exists payee_rules_by_agent       on public.payee_rules (agent_id) where agent_id is not null;
create index if not exists payee_rules_by_team        on public.payee_rules (team_id) where team_id is not null;

-- No foreign keys from entries back to lines or rules: a line is never deleted
-- on its own, and a rule that is deleted simply stops being found.
create index if not exists transactions_by_statement_line on public.transactions (statement_line_id) where statement_line_id is not null;
create index if not exists transactions_by_rule           on public.transactions (rule_id) where rule_id is not null;
create index if not exists transactions_by_split          on public.transactions (split_group) where split_group is not null;
create index if not exists transactions_by_external       on public.transactions (book_id, external_id) where external_id is not null;

alter table public.statement_imports enable row level security;
alter table public.statement_lines   enable row level security;
alter table public.payee_rules       enable row level security;
revoke all on public.statement_imports, public.statement_lines, public.payee_rules from public, anon, authenticated;
grant select on public.statement_imports, public.statement_lines, public.payee_rules to authenticated;
drop policy if exists statement_imports_read on public.statement_imports;
create policy statement_imports_read on public.statement_imports for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists statement_lines_read on public.statement_lines;
create policy statement_lines_read on public.statement_lines for select to authenticated using (book_id in (select public.my_books_readable()));
drop policy if exists payee_rules_read on public.payee_rules;
create policy payee_rules_read on public.payee_rules for select to authenticated using (book_id in (select public.my_books_readable()));

-- The originals. Private; filed under the book they belong to, so the same
-- people who may read the book may read its statements. Nobody may replace or
-- delete one.
insert into storage.buckets (id, name, public, file_size_limit)
values ('statements', 'statements', false, 26214400) on conflict (id) do nothing;
drop policy if exists statements_read on storage.objects;
create policy statements_read on storage.objects for select to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] in (select b::text from public.my_books_readable() b));
drop policy if exists statements_add on storage.objects;
create policy statements_add on storage.objects for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] in (select b::text from public.my_books_writable() b));

-- ── 3. One function turns bank text into a payee ────────────────────────────
-- "SQ *HOME DEPOT #6341 TAMPA FL" -> "Home Depot". What matters most is that
-- the same merchant always comes out the same, because rules are keyed on it.
create or replace function public.clean_payee(p_raw text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare s text := upper(btrim(regexp_replace(coalesce(p_raw, ''), '\s+', ' ', 'g'))); b text; n integer := 0; v_first text;
begin
  if s = '' then return ''; end if;
  v_first := s;
  -- 1. What the bank or the card processor put in front.
  loop
    b := regexp_replace(s, '^(POS (DEBIT|PURCHASE|WITHDRAWAL)|DEBIT CARD PURCHASE|CHECK ?CARD( PURCHASE)?|CARD PURCHASE|PURCHASE AUTHORIZED ON|RECURRING PAYMENT AUTHORIZED ON|RECURRING (PAYMENT|DEBIT|PURCHASE)|PURCHASE|DEBIT|ACH (DEBIT|CREDIT|WITHDRAWAL|DEPOSIT|PMT)|ELECTRONIC (PAYMENT|WITHDRAWAL|DEPOSIT)|ONLINE PAYMENT( TO)?|BILL ?PAY(MENT)?( TO)?|PREAUTHORIZED (DEBIT|CREDIT)|EXTERNAL WITHDRAWAL|WITHDRAWAL|PENDING)\s*[-:]?\s+', '');
    b := regexp_replace(b, '^\d{1,2}/\d{1,2}(/\d{2,4})?\s+', '');
    if n > 0 then b := regexp_replace(b, '^\d{4}\s+(?=\D)', ''); end if;   -- the card's date code, only behind a bank prefix
    b := regexp_replace(b, '^(SQ|TST|SP|PP|PY|IN|DD|FS|CKE|ZSK|WPY|BT|EB|GDP|SQU|PAYPAL|GOOGLE|APL ?PAY|APLPAY|GPAY)\s*\*\s*', '');
    exit when b = s or n > 4;
    s := b; n := n + 1;
  end loop;
  if btrim(s) = '' then s := v_first; end if;
  -- A paper check is its own payee: the number is all the bank gives.
  if s ~ '^CHECK\s*#?\s*\d+$' then return 'Check ' || regexp_replace(s, '\D', '', 'g'); end if;
  -- 2. Names everyone knows, however the bank spells them today. (One test
  --    first: most lines are none of these, and that keeps a long statement quick.)
  b := null;
  if s ~ '^(AMAZON|AMZN|AMZ\*|PRIME VIDEO|WAL-?MART|WM SUPERCENTER|COSTCO|SAM''?S ?CLUB|VENMO|ZELLE|CASH APP|UBER|LYFT|(THE )?HOME DEPOT|LOWE''?S|PUBLIX|TARGET|STARBUCKS|MCDONALD|CHICK-?FIL-?A|SHELL |CHEVRON|EXXON|WAWA|RACETRAC|7-?ELEVEN|CVS|WALGREENS|APPLE|APL\*|NETFLIX|SPOTIFY|FACEBK|FACEBOOK|META PLATFORMS|ZILLOW|REALTOR\.COM|DOCUSIGN|DOTLOOP|CANVA|ZOOM|USPS|UPS|THE UPS STORE|FEDEX|AT&T|ATT\*|VERIZON|VZW|T-?MOBILE|SPECTRUM|DUKE ?ENERGY|TAMPA ELECTRIC|TECO|GEICO|STATE FARM|SUNPASS|OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|SUPRA|OFFICE DEPOT|OFFICEMAX|STAPLES|BEST ?BUY|DOORDASH)' then
  select x.name into b from (values
    (1,  '^(AMAZON|AMZN|AMZ\*)',              'Amazon'),
    (2,  '^PRIME VIDEO',                      'Amazon'),
    (3,  '^(WAL-?MART|WM SUPERCENTER|WALMART)', 'Walmart'),
    (4,  '^COSTCO\M',                         'Costco'),
    (5,  '^SAMS ?CLUB|^SAM''S CLUB',          'Sam''s Club'),
    (6,  '^VENMO\M',                          'Venmo'),
    (7,  '^ZELLE\M',                          'Zelle'),
    (8,  '^CASH APP',                         'Cash App'),
    (9,  '^UBER\s*\*?\s*EATS',                'Uber Eats'),
    (10, '^UBER\M',                           'Uber'),
    (11, '^LYFT\M',                           'Lyft'),
    (12, '^(THE )?HOME DEPOT',                'Home Depot'),
    (13, '^LOWE''?S',                         'Lowe''s'),
    (14, '^PUBLIX',                           'Publix'),
    (15, '^TARGET( T-?\d| \d|\.COM| STORE|\s*$)', 'Target'),
    (16, '^STARBUCKS',                        'Starbucks'),
    (17, '^MCDONALD',                         'McDonald''s'),
    (18, '^CHICK-?FIL-?A',                    'Chick-fil-A'),
    (19, '^(SHELL OIL|SHELL SERVICE|SHELL )', 'Shell'),
    (20, '^CHEVRON\M',                       'Chevron'),
    (21, '^EXXON',                            'Exxon'),
    (22, '^WAWA\M',                           'Wawa'),
    (23, '^RACETRAC',                         'RaceTrac'),
    (24, '^7-?ELEVEN',                        '7-Eleven'),
    (25, '^CVS\M',                             'CVS'),
    (26, '^WALGREENS',                        'Walgreens'),
    (27, '^APPLE\.COM|^APPLE STORE|^APL\*',   'Apple'),
    (28, '^NETFLIX',                          'Netflix'),
    (29, '^SPOTIFY',                          'Spotify'),
    (30, '^(FACEBK|FACEBOOK|META PLATFORMS)', 'Facebook'),
    (31, '^ZILLOW',                           'Zillow'),
    (32, '^REALTOR\.COM',                     'Realtor.com'),
    (33, '^DOCUSIGN',                         'DocuSign'),
    (34, '^DOTLOOP',                          'Dotloop'),
    (35, '^CANVA\M',                         'Canva'),
    (36, '^ZOOM(\.US|\.COM| VIDEO)',          'Zoom'),
    (37, '^USPS\M',                           'USPS'),
    (38, '^(UPS STORE|THE UPS STORE|UPS\*)',  'UPS'),
    (39, '^FEDEX',                            'FedEx'),
    (40, '^(AT&T|ATT\*)',                     'AT&T'),
    (41, '^(VERIZON|VZW)',                    'Verizon'),
    (42, '^T-?MOBILE',                        'T-Mobile'),
    (43, '^SPECTRUM( \d| MOBILE| TV| INTERNET|\.NET|\s*$)', 'Spectrum'),
    (44, '^DUKE ?ENERGY',                     'Duke Energy'),
    (45, '^(TAMPA ELECTRIC|TECO\M)',          'TECO'),
    (46, '^GEICO',                            'GEICO'),
    (47, '^STATE FARM',                       'State Farm'),
    (48, '^SUNPASS',                          'SunPass'),
    (49, '^OPENAI|^CHATGPT',                  'OpenAI'),
    (50, '^ANTHROPIC|^CLAUDE\.AI',            'Anthropic'),
    (51, '^SUPRA\M',                         'Supra'),
    (52, '^(OFFICE DEPOT|OFFICEMAX)',         'Office Depot'),
    (53, '^STAPLES\M',                       'Staples'),
    (54, '^BEST ?BUY',                        'Best Buy'),
    (55, '^DOORDASH',                         'DoorDash')
  ) x(ord, pat, name) where s ~ x.pat order by x.ord limit 1;
  end if;
  if b is not null then return b; end if;
  -- 3. Everything after the name: web address, store number, phone, long
  --    reference numbers, the processor's code, and the city and state.
  s := regexp_replace(s, '\s+(HTTPS?://|WWW\.)\S+.*$', '');
  s := regexp_replace(s, '\s*#\s*\d+.*$', '');
  s := regexp_replace(s, '\s+\(?\d{3}\)?[-. ]\d{3}[-.]\d{4}.*$', '');
  s := regexp_replace(s, '\s+\S*\d{4,}\S*.*$', '');
  s := regexp_replace(s, '^(.{3,}?)\s*\*.*$', '\1');
  s := regexp_replace(s, '^(\S+(?: \S+)*?) \S+ (AL|AK|AZ|AR|CA|CT|DC|FL|GA|IA|IL|KS|KY|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$', '\1');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'), ' -*.,:;/');
  if s = '' then s := btrim(left(v_first, 40)); end if;
  -- 4. Written the way a person writes a name.
  s := initcap(s);
  s := regexp_replace(s, '''S\M', '''s', 'g');
  s := replace(replace(replace(replace(replace(s, ' Llc', ' LLC'), ' Usa', ' USA'), ' Hoa', ' HOA'), ' Mls', ' MLS'), ' Cpa', ' CPA');
  return left(s, 60);
end $$;
revoke all on function public.clean_payee(text) from public, anon;
grant execute on function public.clean_payee(text) to authenticated, service_role;

-- ── 4. Small helpers ────────────────────────────────────────────────────────
-- One set of books at a time: staging, posting, undoing and taking back never
-- overlap for the same books, so two uploads cannot both miss each other.
create or replace function public.statement_lock(p_book uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended('prism.statements:' || p_book::text, 0))
$$;
revoke all on function public.statement_lock(uuid) from public, anon, authenticated, service_role;

-- "Personal, not business" exists only in a person's own books. Shared books
-- hold business money only: there, money an owner took is filed under one of
-- the owners' categories, chosen by a person, never guessed.
create or replace function public.book_is_personal(p_book uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select b.kind in ('personal') from public.books b where b.id = p_book), false)
$$;
revoke all on function public.book_is_personal(uuid) from public, anon, authenticated, service_role;

-- Payees that are really a way of paying, not who was paid. A rule for one of
-- these starts as "always ask".
create or replace function public.payee_is_generic(p_key text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_key in ('venmo', 'zelle', 'cash app', 'paypal') or p_key ~ '^check( \d+)?$'
$$;
revoke all on function public.payee_is_generic(text) from public, anon, authenticated, service_role;

-- A rule's split (shares) laid over one amount; the last part takes the odd cent.
create or replace function public.rule_parts_for(p_parts jsonb, p_amount numeric) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare e jsonb; v_out jsonb := '[]'::jsonb; v_left numeric := p_amount; v_n integer := jsonb_array_length(p_parts); i integer := 0; v_amt numeric;
begin
  for e in select * from jsonb_array_elements(p_parts) loop
    i := i + 1;
    v_amt := case when i = v_n then v_left else round(p_amount * (e ->> 'pct')::numeric, 2) end;
    v_left := v_left - v_amt;
    if v_amt = 0 then return null; end if;
    v_out := v_out || jsonb_build_object('category_id', e ->> 'category_id', 'amount', v_amt, 'memo', e ->> 'memo');
  end loop;
  return v_out;
end $$;
revoke all on function public.rule_parts_for(jsonb, numeric) from public, anon, authenticated, service_role;

-- Two splits are the same when they name the same categories in the same
-- order with the same shares, to within half a percent (shares are worked
-- back from rounded dollar amounts, so they never match to the last digit).
create or replace function public.rule_parts_same(a jsonb, b jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case when a is null and b is null then true
              when a is null or b is null then false
              when jsonb_array_length(a) <> jsonb_array_length(b) then false
              else not exists (
                select 1 from jsonb_array_elements(a) with ordinality x(e, n)
                  join jsonb_array_elements(b) with ordinality y(e, n) using (n)
                 where (x.e ->> 'category_id') is distinct from (y.e ->> 'category_id')
                    or abs(coalesce((x.e ->> 'pct')::numeric, 0) - coalesce((y.e ->> 'pct')::numeric, 0)) > 0.005) end
$$;
revoke all on function public.rule_parts_same(jsonb, jsonb) from public, anon, authenticated, service_role;

-- A split a person typed: two or more parts, each in a category of this book,
-- adding up to the whole. Returns it tidied, or refuses.
create or replace function public.statement_parts_ok(p_book uuid, p_parts jsonb, p_amount numeric) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare e jsonb; v_out jsonb := '[]'::jsonb; v_sum numeric := 0; v_amt numeric; v_cat uuid;
begin
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then return null; end if;
  if jsonb_array_length(p_parts) < 2 or jsonb_array_length(p_parts) > 12 then raise exception 'A split needs between two and twelve parts' using errcode = '23514'; end if;
  for e in select * from jsonb_array_elements(p_parts) loop
    v_amt := round((e ->> 'amount')::numeric, 2); v_cat := (e ->> 'category_id')::uuid;
    if v_amt is null or v_amt = 0 then raise exception 'Each part of a split needs an amount' using errcode = '23514'; end if;
    if v_cat is null or not exists (select 1 from public.tax_categories c where c.id = v_cat and c.book_id = p_book and not c.is_archived) then
      raise exception 'Each part of a split needs a category from these books' using errcode = '23514';
    end if;
    v_sum := v_sum + v_amt;
    v_out := v_out || jsonb_build_object('category_id', v_cat, 'amount', v_amt, 'memo', nullif(left(btrim(coalesce(e ->> 'memo', '')), 200), ''));
  end loop;
  if v_sum <> p_amount then raise exception 'The parts add up to %, but the line is %', v_sum, p_amount using errcode = '23514'; end if;
  return v_out;
end $$;
revoke all on function public.statement_parts_ok(uuid, jsonb, numeric) from public, anon, authenticated, service_role;

-- Does the statement add up?
create or replace function public.statement_tie(p_import uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'lines_total', s.total, 'opening', i.opening_balance, 'closing', i.closing_balance,
    'has_balances', (i.opening_balance is not null and i.closing_balance is not null),
    'off_by', x.off_by,
    'proven', coalesce(x.off_by = 0, false),
    'accepted', x.accepted,
    'added_waiting', (select count(*) from public.statement_lines l where l.import_id = i.id and l.added_by is not null and l.result is null),
    'blocked', not x.accepted and ((i.via in ('scan') and not coalesce(x.off_by = 0, false)) or coalesce(x.off_by <> 0, false)))
    from public.statement_imports i
    cross join lateral (select coalesce(sum(l.amount), 0) as total from public.statement_lines l
                         where l.import_id = i.id and coalesce(l.result, '') not in ('dropped')) s   -- (leaving out a hand-added line drops it)
    cross join lateral (select o.off_by, (i.accepted_unproven_at is not null and o.off_by is not distinct from i.accepted_off_by) as accepted
                          from (select i.opening_balance + s.total - i.closing_balance as off_by) o) x
   where i.id = p_import
$$;
revoke all on function public.statement_tie(uuid) from public, anon, authenticated, service_role;

create or replace function public.statement_blocked(p_import uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((public.statement_tie(p_import) ->> 'blocked')::boolean, true)
$$;
revoke all on function public.statement_blocked(uuid) from public, anon, authenticated, service_role;

-- Why a waiting line needs a person. Empty means it needs nothing.
--   check  - the reader was unsure, or there is no date or amount
--   twin   - it may already be in the books, or in another upload
--   ask    - its payee is one the person asked always to be asked about
--   direction - the rule was learned from money going the other way (a refund?)
--   new    - nobody has said what it is (an AI suggestion counts as nobody)
--   held   - a person undid it once: it posts again only by their own tap
--   closed - its date is in a closed period
create or replace function public.statement_line_needs(l public.statement_lines) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select array_remove(array[
    case when cardinality(l.unsure) > 0 or l.line_date is null or l.amount = 0 then 'check' end,
    case when (l.twin_transaction_id is not null or l.twin_line_id is not null) and l.twin_answer is null then 'twin' end,
    case when l.proposed_by in ('rule') and exists (select 1 from public.payee_rules r
                                                    where r.book_id = l.book_id and r.payee_key = l.payee_key and r.always_ask) then 'ask' end,
    case when l.proposed_by in ('rule') and l.transfer_account is null and not l.is_personal
          and exists (select 1 from public.payee_rules r where r.id = l.rule_id and r.money_in is not null and r.money_in is distinct from (l.amount > 0)) then 'direction' end,
    case when coalesce(l.proposed_by, '') not in ('rule', 'person', 'account')
           or not (l.tax_category_id is not null or l.is_personal or l.transfer_account is not null or l.parts is not null) then 'new' end,
    case when l.hold then 'held' end,
    case when l.line_date <= (select b.closed_through from public.books b where b.id = l.book_id) then 'closed' end
  ], null)
$$;
revoke all on function public.statement_line_needs(public.statement_lines) from public, anon, authenticated, service_role;

-- ── 5. Rules ────────────────────────────────────────────────────────────────
-- The rule for a payee here: the narrowest one that fits wins.
create or replace function public.rule_for(p_book uuid, p_key text, p_account text, p_amount numeric) returns public.payee_rules
language sql stable security definer set search_path = public, pg_temp as $$
  select r from public.payee_rules r
   where r.book_id = p_book and r.payee_key = p_key and p_key <> ''
     and (r.amount is null or r.amount = p_amount)
     and (r.account_key is null or r.account_key = lower(btrim(coalesce(p_account, ''))))
   order by (r.amount is not null)::int + (r.account_key is not null)::int desc, (r.amount is not null) desc limit 1
$$;
revoke all on function public.rule_for(uuid, text, text, numeric) from public, anon, authenticated, service_role;

-- Entries a rule filed that no longer read the way the rule does now. Split
-- entries and closed periods are left alone, and so is any entry a person has
-- since corrected by hand (correcting one unhooks it from the rule).
create or replace function public.rule_past(p_rule uuid) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id
    from public.payee_rules r
    join public.books b on b.id = r.book_id
    join public.transactions t on t.rule_id = r.id and t.book_id = r.book_id
   where r.id = p_rule and r.parts is null and not t.is_archived and t.split_group is null
     and (r.tax_category_id is not null or r.is_personal or nullif(btrim(coalesce(r.transfer_account, '')), '') is not null)
     and (b.closed_through is null or t.date > b.closed_through)
     and case when nullif(btrim(coalesce(r.transfer_account, '')), '') is not null
              then lower(btrim(coalesce(t.transfer_account, ''))) is distinct from lower(btrim(r.transfer_account))
                   and lower(btrim(coalesce(t.account, ''))) is distinct from lower(btrim(r.transfer_account))
              when r.is_personal then t.transfer_account is not null or t.scope is distinct from 'personal'
              else t.transfer_account is not null or t.scope is distinct from 'business' or t.tax_category_id is distinct from r.tax_category_id end
$$;
revoke all on function public.rule_past(uuid) from public, anon, authenticated, service_role;

-- A person decided something about a payee. Make the rule, agree with it, or
-- change it: the latest correction wins.
--   p_narrow: null = the rule that proposed it, else the payee's general rule;
--             'payee' = the general rule; 'amount' / 'account' = a narrower one;
--             'ask' = always ask about this payee.
create or replace function public.rule_learn(
  p_book uuid, p_key text, p_payee text, p_account text, p_amount numeric, p_narrow text, p_rule uuid,
  p_category uuid, p_personal boolean, p_transfer text, p_contact uuid, p_agent uuid, p_team uuid, p_memo text, p_parts jsonb,
  p_trust boolean, p_by uuid, p_only_new boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payee_rules%rowtype; v_acct text := nullif(lower(btrim(coalesce(p_account, ''))), '');
        v_transfer text := nullif(btrim(coalesce(p_transfer, '')), '');
        v_personal boolean := coalesce(p_personal, false) and v_transfer is null and public.book_is_personal(p_book);
        v_cat uuid; v_has boolean; v_same boolean; v_new boolean := false; v_past integer := 0; v_parts jsonb; v_by uuid := coalesce(auth.uid(), p_by);
        v_name text := nullif(left(btrim(coalesce(p_payee, '')), 80), ''); v_trust boolean := coalesce(p_trust, false);
begin
  if coalesce(p_key, '') = '' then return null; end if;
  if p_parts is not null and v_transfer is null and not v_personal and p_amount <> 0 then
    select jsonb_agg(jsonb_build_object('category_id', e ->> 'category_id', 'pct', round((e ->> 'amount')::numeric / p_amount, 6), 'memo', e ->> 'memo')) into v_parts
      from jsonb_array_elements(p_parts) e;
  end if;
  v_cat := case when v_transfer is null and not v_personal and v_parts is null then p_category end;
  v_has := v_cat is not null or v_personal or v_transfer is not null or v_parts is not null;
  if not v_has and p_narrow is distinct from 'ask' then return null; end if;

  -- A typed entry can start a rule but never touches one that exists: no lock taken.
  if p_only_new and exists (select 1 from public.payee_rules x where x.book_id = p_book and x.payee_key = p_key and x.account_key is null and x.amount is null) then
    return null;
  end if;
  for attempt in 1..2 loop
    r := null;
    if p_narrow = 'amount' then
      select * into r from public.payee_rules where book_id = p_book and payee_key = p_key and amount = p_amount and account_key is null for update;
    elsif p_narrow = 'account' and v_acct is not null then
      select * into r from public.payee_rules where book_id = p_book and payee_key = p_key and account_key = v_acct and amount is null for update;
    else
      if p_rule is not null and p_narrow is null then
        select * into r from public.payee_rules where id = p_rule and book_id = p_book and payee_key = p_key for update;
      end if;
      if r.id is null then
        select * into r from public.payee_rules where book_id = p_book and payee_key = p_key and account_key is null and amount is null for update;
      end if;
    end if;
    exit when r.id is not null;
    insert into public.payee_rules (book_id, payee_key, payee, account_key, amount, tax_category_id, is_personal, transfer_account,
                                    contact_id, agent_id, team_id, memo, parts, always_ask, trusted, money_in, created_by, updated_by)
    values (p_book, p_key, coalesce(v_name, initcap(p_key)),
            case when p_narrow = 'account' then v_acct end, case when p_narrow = 'amount' then p_amount end,
            v_cat, v_personal, v_transfer, p_contact, p_agent, p_team, nullif(left(btrim(coalesce(p_memo, '')), 200), ''), v_parts,
            p_narrow is not distinct from 'ask' or (public.payee_is_generic(p_key) and p_narrow is null),
            v_trust, case when v_has then p_amount > 0 end, v_by, v_by)
    on conflict do nothing
    returning * into r;
    if r.id is not null then v_new := true; exit; end if;   -- else someone made it this instant: go round and take theirs
  end loop;
  if r.id is null then return null; end if;

  if v_new then
    v_same := false;
  elsif p_only_new then
    return jsonb_build_object('rule_id', r.id, 'payee', r.payee, 'is_new', false, 'changed', false, 'past', 0, 'suggest_always_ask', false);
  else
    v_same := not v_has or (r.tax_category_id is not distinct from v_cat and r.is_personal = v_personal
                            and lower(coalesce(r.transfer_account, '')) = lower(coalesce(v_transfer, '')) and public.rule_parts_same(r.parts, v_parts));
    update public.payee_rules set
           payee = coalesce(v_name, payee),
           tax_category_id = case when v_has then v_cat else tax_category_id end,
           is_personal = case when v_has then v_personal else is_personal end,
           transfer_account = case when v_has then v_transfer else transfer_account end,
           parts = case when v_has then v_parts else parts end,
           contact_id = case when v_has then p_contact else contact_id end,
           agent_id = case when v_has then p_agent else agent_id end,
           team_id = case when v_has then p_team else team_id end,
           memo = coalesce(nullif(left(btrim(coalesce(p_memo, '')), 200), ''), memo),
           money_in = case when v_has and not v_same then p_amount > 0 else coalesce(money_in, case when v_has then p_amount > 0 end) end,
           agreements = agreements + case when v_same then 1 else 0 end,
           changes = changes + case when v_same or always_ask then 0 else 1 end,
           -- Confirmed in review: trusted. Changed from the checkbook: it proposes
           -- again until someone confirms it in review.
           trusted = case when v_trust then true when not v_same then false else trusted end,
           always_ask = always_ask or p_narrow is not distinct from 'ask',
           suggest_always_ask = case when always_ask or p_narrow is not distinct from 'ask' or ask_declined then false
                                     when not v_same and changes + 1 >= 2 then true else suggest_always_ask end,
           updated_by = v_by, updated_at = now()
     where id = r.id returning * into r;
    if not v_same then
      select count(*) into v_past from public.rule_past(r.id);
      update public.payee_rules set fix_pending = v_past > 0 where id = r.id and fix_pending is distinct from (v_past > 0);
    end if;
  end if;
  return jsonb_build_object('rule_id', r.id, 'payee', r.payee, 'is_new', v_new, 'changed', not v_same, 'past', v_past,
                            'suggest_always_ask', r.suggest_always_ask and not r.always_ask, 'always_ask', r.always_ask);
end $$;
revoke all on function public.rule_learn(uuid, text, text, text, numeric, text, uuid, uuid, boolean, text, uuid, uuid, uuid, text, jsonb, boolean, uuid, boolean) from public, anon, authenticated, service_role;

-- An entry typed or corrected in the checkbook teaches too, with care:
--   * only when ONE entry is saved (moving a whole category's entries at once
--     says nothing about any one payee);
--   * a typed entry can start a rule but never changes one;
--   * a rule learned or changed this way only PROPOSES until a person confirms
--     it in review;
--   * whatever goes wrong in here, the entry itself is saved.
create or replace function public.rule_learn_from_entry() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.transactions%rowtype; o public.transactions%rowtype; v_key text; v jsonb; v_wait text := current_setting('lock_timeout', true);
begin
  if current_setting('prism.learning', true) is not distinct from 'off' or auth.uid() is null or pg_trigger_depth() > 1 then return null; end if;
  begin
    if (select count(*) from changed) <> 1 then return null; end if;
    select * into n from changed;
    if n.is_archived or n.split_group is not null or btrim(coalesce(n.payee, '')) = '' or n.amount = 0 then return null; end if;
    if tg_op = 'INSERT' then
      if n.entered_via not in ('manual') then return null; end if;
    else
      select * into o from was;
      if row(o.tax_category_id, o.scope, coalesce(o.transfer_account, '')) is not distinct from row(n.tax_category_id, n.scope, coalesce(n.transfer_account, '')) then return null; end if;
    end if;
    if public.book_is_going(n.book_id) then return null; end if;
    -- If a statement is being posted for this payee right now, the lesson is
    -- skipped rather than making the person's save wait for it.
    perform set_config('lock_timeout', '250ms', true);
    v_key := coalesce((select l.payee_key from public.statement_lines l where l.id = n.statement_line_id and l.book_id = n.book_id), lower(public.clean_payee(n.payee)));
    -- Only an entry a rule filed changes that rule when it is corrected. An
    -- entry typed by hand (and given its category later) can start one, no more.
    v := public.rule_learn(n.book_id, v_key, n.payee, n.account, n.amount, null, o.rule_id,
                           n.tax_category_id, n.scope is distinct from 'business', n.transfer_account,
                           n.contact_id, n.agent_id, n.team_id, null, null, false, auth.uid(), tg_op = 'INSERT' or o.rule_id is null);
    -- Lines still waiting for this payee now have something to propose.
    if v is not null and coalesce((v ->> 'changed')::boolean, false)
       and exists (select 1 from public.statement_lines l where l.book_id = n.book_id and l.payee_key = v_key and l.result is null) then
      perform public.statement_propose(n.book_id, null, v_key);
    end if;
    perform set_config('lock_timeout', coalesce(nullif(v_wait, ''), '0'), true);
  exception when others then
    perform set_config('lock_timeout', coalesce(nullif(v_wait, ''), '0'), true);
    raise warning 'rule_learn_from_entry: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.rule_learn_from_entry() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_95_learn on public.transactions;
drop trigger if exists trg_book_95_learn_new on public.transactions;
create trigger trg_book_95_learn_new after insert on public.transactions
  referencing new table as changed for each statement execute function public.rule_learn_from_entry();
drop trigger if exists trg_book_95_learn_fix on public.transactions;
create trigger trg_book_95_learn_fix after update on public.transactions
  referencing old table as was new table as changed for each statement execute function public.rule_learn_from_entry();

-- A person re-filing an entry by hand unhooks it from the rule that filed it,
-- so a later "fix the earlier ones" never undoes a deliberate correction. And
-- an entry that leaves the books reopens any statement line that was set aside
-- as a duplicate OF it: that money would otherwise be in the books zero times.
create or replace function public.rule_unhook_entry() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_leaving boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.rule_id is not null and new.rule_id is not distinct from old.rule_id and auth.uid() is not null and pg_trigger_depth() = 1
       and current_setting('prism.learning', true) is distinct from 'off'
       and row(old.tax_category_id, old.scope, coalesce(old.transfer_account, '')) is distinct from row(new.tax_category_id, new.scope, coalesce(new.transfer_account, '')) then
      new.rule_id := null;
    end if;
    v_leaving := new.is_archived and not old.is_archived;
  else
    v_leaving := not public.book_is_going(old.book_id);
  end if;
  if v_leaving and exists (select 1 from public.statement_lines x where x.twin_transaction_id = old.id
                              or (old.statement_line_id is not null and x.twin_line_id = old.statement_line_id)) then
    -- Lines waiting with this as their possible twin: the question is moot.
    update public.statement_lines set twin_transaction_id = null where twin_transaction_id = old.id and result is null;
    -- Lines set aside as a duplicate of this entry, or of the line it was posted from.
    update public.statement_lines set result = null, hold = true, decided_by = null, decided_at = null, twin_transaction_id = null
     where result in ('duplicate') and twin_transaction_id = old.id;
    if old.statement_line_id is not null then
      update public.statement_lines set result = null, hold = true, decided_by = null, decided_at = null
       where result in ('duplicate') and twin_line_id = old.statement_line_id and book_id = old.book_id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.rule_unhook_entry() from public, anon, authenticated, service_role;
drop trigger if exists trg_book_4_unhook on public.transactions;
create trigger trg_book_4_unhook before update or delete on public.transactions for each row execute function public.rule_unhook_entry();

-- ── 6. Proposing: what the rules say about lines still waiting ──────────────
create or replace function public.statement_propose(p_book uuid, p_import uuid default null, p_key text default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare l record; r public.payee_rules%rowtype; v_n integer := 0; v_parts jsonb; v_ok boolean;
begin
  for l in select x.*, i.account, (coalesce(m.is_personal, false) and public.book_is_personal(p_book)) as account_personal
             from public.statement_lines x
             join public.statement_imports i on i.id = x.import_id
             left join public.money_accounts m on m.book_id = x.book_id and lower(btrim(m.name)) = lower(btrim(i.account))
            where x.book_id = p_book and x.result is null and x.touched_by is null and i.taken_back_at is null
              and (p_import is null or x.import_id = p_import) and (p_key is null or x.payee_key = p_key)
              and (x.proposed_by in ('rule') or exists (select 1 from public.payee_rules pr where pr.book_id = p_book and pr.payee_key = x.payee_key))
  loop
    r := public.rule_for(p_book, l.payee_key, l.account, l.amount);
    v_ok := r.id is not null;
    if v_ok and r.tax_category_id is not null
       and not exists (select 1 from public.tax_categories c where c.id = r.tax_category_id and c.book_id = p_book and not c.is_archived) then v_ok := false; end if;
    v_parts := null;
    if v_ok and r.parts is not null then
      v_parts := public.rule_parts_for(r.parts, l.amount);
      if v_parts is null or exists (select 1 from jsonb_array_elements(v_parts) e
                                     where not exists (select 1 from public.tax_categories c where c.id = (e ->> 'category_id')::uuid and c.book_id = p_book and not c.is_archived)) then v_ok := false; end if;
    end if;
    if v_ok and not (r.tax_category_id is not null or r.is_personal or r.transfer_account is not null or v_parts is not null) then
      -- An "always ask" rule with nothing remembered: it only makes the line wait.
      update public.statement_lines set rule_id = r.id, proposed_by = 'rule', payee = r.payee, tax_category_id = null, transfer_account = null,
             parts = null, is_personal = l.account_personal, ai_confidence = null
       where id = l.id and (rule_id is distinct from r.id or proposed_by is distinct from 'rule' or tax_category_id is not null or parts is not null or transfer_account is not null);
      v_n := v_n + 1;
    elsif v_ok and lower(coalesce(r.transfer_account, '')) is distinct from lower(btrim(l.account)) then
      update public.statement_lines set
             payee = r.payee, tax_category_id = r.tax_category_id, is_personal = r.is_personal and public.book_is_personal(p_book), transfer_account = r.transfer_account,
             contact_id = r.contact_id, agent_id = r.agent_id, team_id = r.team_id, memo = coalesce(memo, r.memo), parts = v_parts,
             proposed_by = 'rule', rule_id = r.id, ai_confidence = null
       where id = l.id
         and row(payee, tax_category_id, is_personal, coalesce(transfer_account, ''), contact_id, agent_id, team_id, parts, proposed_by, rule_id)
             is distinct from row(r.payee, r.tax_category_id, r.is_personal and public.book_is_personal(p_book), coalesce(r.transfer_account, ''),
                                  r.contact_id, r.agent_id, r.team_id, v_parts, 'rule', r.id);
      v_n := v_n + 1;
    elsif l.proposed_by in ('rule') then
      -- The rule that proposed this is gone or no longer fits.
      update public.statement_lines set
             tax_category_id = null, transfer_account = null, parts = null, rule_id = null, contact_id = null, agent_id = null, team_id = null,
             is_personal = l.account_personal, proposed_by = case when l.account_personal then 'account' end,
             payee = public.clean_payee(coalesce(raw_text, payee))
       where id = l.id;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.statement_propose(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ── 7. Possible duplicates ──────────────────────────────────────────────────
-- For each waiting line: an entry already in the books carrying the bank's own
-- id for it; or one for the same amount within three days on the same account
-- (or on no account, or under another account but the same payee); or the
-- other side of a transfer already entered; failing that, a line still waiting
-- in another upload. One line claims one twin, so two real $5.00 coffees are
-- not both called duplicates of one.
create or replace function public.statement_find_twins(p_import uuid, p_line uuid default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype; l record; v_acct text; v_tx uuid; v_ln uuid; v_n integer := 0;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found then return 0; end if;
  v_acct := lower(btrim(i.account));
  if p_line is not null then   -- its date or amount changed: look again from nothing
    update public.statement_lines set twin_transaction_id = null, twin_line_id = null, twin_answer = null where id = p_line and import_id = p_import and result is null;
  end if;
  -- The bank's own id for a line, if it gave one, settles it on any date. The
  -- nth line carrying an id is paired with the nth entry carrying it.
  with mine as (
    select x.id, x.external_id, x.amount, row_number() over (partition by x.external_id, x.amount order by x.line_no) as rn
      from public.statement_lines x
     where x.import_id = p_import and x.result is null and x.twin_answer is null and (p_line is null or x.id = p_line)
       and x.twin_transaction_id is null and x.twin_line_id is null and x.external_id is not null and x.amount <> 0),
  theirs as (
    select g.id, g.external_id, g.amount, row_number() over (partition by g.external_id, g.amount order by g.id) as rn
      from (select (array_agg(t.id order by t.created_at, t.id))[1] as id, t.external_id, sum(t.amount) as amount,
                   min(lower(btrim(coalesce(t.account, '')))) as account
              from public.transactions t
             where t.book_id = i.book_id and not t.is_archived and t.external_id in (select m.external_id from mine m)
               and not exists (select 1 from public.statement_lines s where s.id = t.statement_line_id and s.import_id = p_import)
             group by coalesce(t.split_group, t.id), t.external_id) g
     where g.account in (v_acct, '')      -- a bank's id means something only within one account
       and not exists (select 1 from public.statement_lines o where o.import_id = p_import and o.twin_transaction_id = g.id)),
  hit as (
    update public.statement_lines x set twin_transaction_id = t.id
      from mine m join theirs t on t.external_id = m.external_id and t.amount = m.amount and t.rn = m.rn
     where x.id = m.id returning 1)
  select count(*) into v_n from hit;
  -- The same, against lines still waiting in other uploads for this account.
  with mine as (
    select x.id, x.external_id, x.amount, row_number() over (partition by x.external_id, x.amount order by x.line_no) as rn
      from public.statement_lines x
     where x.import_id = p_import and x.result is null and x.twin_answer is null and (p_line is null or x.id = p_line)
       and x.twin_transaction_id is null and x.twin_line_id is null and x.external_id is not null and x.amount <> 0),
  theirs as (
    select o.id, o.external_id, o.amount, row_number() over (partition by o.external_id, o.amount order by oi.created_at, o.line_no) as rn
      from public.statement_lines o join public.statement_imports oi on oi.id = o.import_id
     where o.book_id = i.book_id and o.import_id <> p_import and o.result is null and oi.taken_back_at is null
       and lower(btrim(oi.account)) = v_acct and o.external_id in (select m.external_id from mine m)
       and not exists (select 1 from public.statement_lines c where c.import_id = p_import and c.twin_line_id = o.id)),
  hit as (
    update public.statement_lines x set twin_line_id = t.id
      from mine m join theirs t on t.external_id = m.external_id and t.amount = m.amount and t.rn = m.rn
     where x.id = m.id returning 1)
  select v_n + count(*) into v_n from hit;
  for l in select * from public.statement_lines x
            where x.import_id = p_import and x.result is null and x.twin_answer is null and (p_line is null or x.id = p_line)
              and x.twin_transaction_id is null and x.twin_line_id is null and x.line_date is not null and x.amount <> 0
            order by x.line_no
  loop
    v_tx := null; v_ln := null;
    if true then
      with items as (
        select (array_agg(t.id order by t.created_at, t.id))[1] as id, min(t.date) as date, sum(t.amount) as amount,
               min(lower(btrim(coalesce(t.account, '')))) as account, min(lower(btrim(coalesce(t.transfer_account, '')))) as other,
               min(t.payee) as payee, bool_or(coalesce(s.import_id = p_import, false)) as same_import
          from public.transactions t
          left join public.statement_lines s on s.id = t.statement_line_id
         where t.book_id = i.book_id and not t.is_archived and t.date between l.line_date - 3 and l.line_date + 3
         group by coalesce(t.split_group, t.id))
      select x.id into v_tx from items x
       where not x.same_import
         and ((x.amount = l.amount and (x.account in (v_acct, '') or (l.payee_key <> '' and lower(public.clean_payee(x.payee)) = l.payee_key)))
              or (x.other = v_acct and x.amount = -l.amount))
         and not exists (select 1 from public.statement_lines o where o.import_id = p_import and o.twin_transaction_id = x.id)
       order by (x.account = v_acct) desc, abs(x.date - l.line_date), x.id limit 1;
    end if;
    if v_tx is null then
      select o.id into v_ln from public.statement_lines o join public.statement_imports oi on oi.id = o.import_id
       where o.book_id = i.book_id and o.import_id <> p_import and o.result is null and oi.taken_back_at is null
         and lower(btrim(oi.account)) = v_acct and o.amount = l.amount
         and (o.line_date between l.line_date - 3 and l.line_date + 3 or (l.external_id is not null and o.external_id = l.external_id))
         and not exists (select 1 from public.statement_lines c where c.import_id = p_import and c.twin_line_id = o.id)
       order by abs(o.line_date - l.line_date), o.line_no limit 1;
    end if;
    if v_tx is not null or v_ln is not null then
      update public.statement_lines set twin_transaction_id = v_tx, twin_line_id = v_ln where id = l.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.statement_find_twins(uuid, uuid) from public, anon, authenticated, service_role;

-- ── 8. Posting: the only door from the holding area into the books ──────────
-- Asked just before a line is posted: has something like it reached the books
-- since the statement was read in (typed by hand, or from another upload)?
-- If so the line now carries that possible twin and waits for a person.
create or replace function public.statement_twin_now(p_line uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.statement_lines%rowtype;
begin
  select * into l from public.statement_lines where id = p_line;
  if not found or l.result is not null or l.twin_answer is not null then return false; end if;
  if l.twin_transaction_id is null and l.twin_line_id is null then
    perform public.statement_find_twins(l.import_id, p_line);
    select * into l from public.statement_lines where id = p_line;
  end if;
  return l.twin_transaction_id is not null or l.twin_line_id is not null;
end $$;
revoke all on function public.statement_twin_now(uuid) from public, anon, authenticated, service_role;

create or replace function public.statement_post_line(p_line uuid, p_by uuid, p_auto boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.statement_lines%rowtype; i public.statement_imports%rowtype; v_personal boolean; v_group uuid; p jsonb; v_needs text[];
        v_was text := coalesce(current_setting('prism.learning', true), 'on'); v_ext text; v_first boolean := true;
begin
  select * into l from public.statement_lines where id = p_line for update;
  if not found or l.result is not null then return; end if;
  select * into i from public.statement_imports where id = l.import_id;
  if i.taken_back_at is not null or i.read_at is null then raise exception 'That statement is not in review' using errcode = 'P0001'; end if;
  if public.statement_blocked(i.id) then
    raise exception 'This statement does not add up yet. Nothing from it can be posted until that is settled.' using errcode = 'P0001';
  end if;
  v_needs := public.statement_line_needs(l);
  if 'check' = any (v_needs) then raise exception 'This line needs a look first: check it against the statement' using errcode = 'P0001'; end if;
  if 'twin' = any (v_needs) then raise exception 'This line may already be in the books. Say whether it is the same one first.' using errcode = 'P0001'; end if;
  if l.added_by is null and exists (select 1 from public.statement_lines x where x.import_id = l.import_id and x.added_by is not null and x.result is null) then
    raise exception 'A line was added to this statement by hand. Approve that line first (or remove it); then the rest can go in.' using errcode = 'P0001';
  end if;
  if lower(btrim(coalesce(l.transfer_account, ''))) = lower(btrim(i.account)) then raise exception 'A transfer needs two different accounts' using errcode = '23514'; end if;
  if l.parts is not null and exists (select 1 from jsonb_array_elements(l.parts) e
                                      where not exists (select 1 from public.tax_categories c where c.id = (e ->> 'category_id')::uuid and c.book_id = l.book_id)) then
    raise exception 'One of the categories in this split is gone. Open the line and choose again.' using errcode = 'P0001';
  end if;
  v_personal := l.is_personal and l.transfer_account is null and public.book_is_personal(l.book_id);
  -- The bank's id for a line is carried by ONE entry in the books (an older
  -- rule of the table keeps it unique per person): the first part of a split,
  -- and not at all when an entry already carries it (the person has said this
  -- line is a different payment).
  v_ext := case when l.external_id is not null and not exists (select 1 from public.transactions t where t.book_id = l.book_id and t.external_id = l.external_id) then l.external_id end;
  perform set_config('prism.learning', 'off', true);
  if l.parts is not null and l.transfer_account is null and not v_personal then
    v_group := gen_random_uuid();
    for p in select * from jsonb_array_elements(l.parts) loop
      insert into public.transactions (book_id, date, amount, scope, tax_category_id, account, payee, description, entered_via, external_id,
                                       import_batch_id, import_source, imported_at, statement_line_id, rule_id, contact_id, agent_id, closing_id,
                                       property_id, team_id, receipt_url, split_group, entered_by, ai_confidence)
      values (l.book_id, l.line_date, (p ->> 'amount')::numeric, 'business', (p ->> 'category_id')::uuid, i.account, l.payee,
              coalesce(nullif(p ->> 'memo', ''), l.memo), i.via, case when v_first then v_ext end, i.id, i.file_name, now(), l.id, l.rule_id, l.contact_id, l.agent_id,
              l.closing_id, l.property_id, l.team_id, l.receipt_path, v_group, p_by, l.ai_confidence);
      v_first := false;
    end loop;
  else
    insert into public.transactions (book_id, date, amount, scope, tax_category_id, account, transfer_account, payee, description, entered_via, external_id,
                                     import_batch_id, import_source, imported_at, statement_line_id, rule_id, contact_id, agent_id, closing_id,
                                     property_id, team_id, receipt_url, entered_by, ai_confidence)
    values (l.book_id, l.line_date, l.amount, case when v_personal then 'personal' else 'business' end,
            case when v_personal or l.transfer_account is not null then null else l.tax_category_id end,
            i.account, nullif(btrim(coalesce(l.transfer_account, '')), ''), l.payee, l.memo, i.via, v_ext,
            i.id, i.file_name, now(), l.id, l.rule_id, l.contact_id, l.agent_id, l.closing_id, l.property_id, l.team_id, l.receipt_path, p_by, l.ai_confidence);
  end if;
  perform set_config('prism.learning', v_was, true);
  update public.statement_lines set result = 'posted', auto_posted = coalesce(p_auto, false), decided_by = p_by, decided_at = now() where id = p_line;
end $$;
revoke all on function public.statement_post_line(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- Post what a confirmed rule covers and nothing else stands in the way of.
-- These are the lines that show under "Done for you".
create or replace function public.statement_settle(p_import uuid, p_by uuid, p_limit integer default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.statement_lines%rowtype; v_n integer := 0; v_book uuid;
begin
  select i.book_id into v_book from public.statement_imports i where i.id = p_import and i.read_at is not null and i.taken_back_at is null;
  if v_book is null then return 0; end if;
  perform public.statement_lock(v_book);
  if public.statement_blocked(p_import) then return 0; end if;
  if exists (select 1 from public.statement_lines x where x.import_id = p_import and x.added_by is not null and x.result is null) then return 0; end if;
  -- What each untouched line says is taken afresh from the rules as they are
  -- NOW, so nothing posts on the strength of a rule that has since changed.
  perform public.statement_propose(v_book, p_import, null);
  for l in select x.* from public.statement_lines x join public.payee_rules r on r.id = x.rule_id
            where x.import_id = p_import and x.result is null and not x.hold and x.touched_by is null
              and x.proposed_by in ('rule') and r.trusted and not r.always_ask
            order by x.line_no
  loop
    if cardinality(public.statement_line_needs(l)) = 0 and not public.statement_twin_now(l.id) then
      begin
        perform public.statement_post_line(l.id, p_by, true);
        v_n := v_n + 1;
      exception when others then
        raise warning 'statement_settle: line % was left waiting: %', l.id, sqlerrm;   -- it stays in review, where its own message will show
      end;
      exit when p_limit is not null and v_n >= p_limit;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.statement_settle(uuid, uuid, integer) from public, anon, authenticated, service_role;

-- The screen asks for the next batch until there is no more. A signed-in
-- person's request may run for eight seconds, so nothing here posts a whole
-- long statement in one go.
create or replace function public.statement_settle_next(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype; v_n integer;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found or auth.uid() is null or i.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  v_n := public.statement_settle(p_import, auth.uid(), 120);
  return jsonb_build_object('posted', v_n, 'more', v_n >= 120);
end $$;
revoke all on function public.statement_settle_next(uuid) from public, anon;
grant execute on function public.statement_settle_next(uuid) to authenticated;

-- A date as a statement can carry it: YYYY-MM-DD, real, 1990 to a month from
-- now. Anything else is no date at all (the line is then flagged for a person).
create or replace function public.statement_date(p_text text) returns date
language plpgsql immutable set search_path = public, pg_temp as $$
declare y integer; m integer; d integer;
begin
  if p_text is null or p_text !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  y := substr(p_text, 1, 4)::integer; m := substr(p_text, 6, 2)::integer; d := substr(p_text, 9, 2)::integer;
  if y < 1990 or y > 2200 or m < 1 or m > 12 or d < 1 or d > extract(day from (make_date(y, m, 1) + interval '1 month' - interval '1 day'))::integer then return null; end if;
  return make_date(y, m, d);
end $$;
revoke all on function public.statement_date(text) from public, anon, authenticated, service_role;

-- ── 9. Lines arrive ─────────────────────────────────────────────────────────
-- Into the holding area and no further. p_lines: [{date, amount, text, memo,
-- external_id, unsure:[...], note}].
create or replace function public.statement_stage(p_import uuid, p_lines jsonb, p_by uuid, p_settle boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype; e jsonb; n integer := 0; v_date date; v_amt numeric; v_unsure text[]; v_text text;
        v_personal boolean; v_twins integer; v_auto integer := 0; v_payee text;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found then raise exception 'That upload does not exist' using errcode = 'P0002'; end if;
  perform public.statement_lock(i.book_id);
  select * into i from public.statement_imports where id = p_import for update;
  if i.read_at is not null then raise exception 'That statement has already been read in' using errcode = 'P0001'; end if;
  if i.taken_back_at is not null then raise exception 'That upload was taken back' using errcode = 'P0001'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'No lines were found on that statement' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 1500 then raise exception 'That is more than 1,500 lines. Upload it a few months at a time.' using errcode = 'P0001'; end if;
  select coalesce(m.is_personal, false) and public.book_is_personal(i.book_id) into v_personal from public.money_accounts m
   where m.book_id = i.book_id and lower(btrim(m.name)) = lower(btrim(i.account));
  v_personal := coalesce(v_personal, false);
  for e in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    continue when jsonb_typeof(e) <> 'object';
    v_unsure := coalesce((select array_agg(distinct u) from jsonb_array_elements_text(case when jsonb_typeof(e -> 'unsure') = 'array' then e -> 'unsure' else '[]'::jsonb end) u
                           where u in ('date', 'amount', 'payee', 'reader')), '{}');
    v_date := public.statement_date(e ->> 'date');
    v_amt := case when (e ->> 'amount') ~ '^-?\d{1,9}(\.\d{1,6})?$' then round((e ->> 'amount')::numeric, 2) end;
    if v_date > current_date + 31 then v_date := null; end if;
    if v_date is null or (i.period_from is not null and v_date < i.period_from - 7) or (i.period_to is not null and v_date > i.period_to + 7) then
      v_unsure := array(select distinct u from unnest(v_unsure || array['date']) u);
    end if;
    if v_amt is null or v_amt = 0 or abs(v_amt) >= 100000000 then
      v_unsure := array(select distinct u from unnest(v_unsure || array['amount']) u);
      if v_amt is null or abs(v_amt) >= 100000000 then v_amt := 0; end if;
    end if;
    v_text := nullif(left(btrim(regexp_replace(coalesce(e ->> 'text', ''), '\s+', ' ', 'g')), 300), '');
    v_payee := public.clean_payee(v_text);
    insert into public.statement_lines (import_id, book_id, line_no, line_date, amount, raw_text, payee_key, payee, memo, external_id,
                                        is_personal, proposed_by, unsure, unsure_note)
    values (i.id, i.book_id, n, v_date, v_amt, v_text, lower(v_payee), nullif(v_payee, ''),
            nullif(left(btrim(coalesce(e ->> 'memo', '')), 200), ''), nullif(left(btrim(coalesce(e ->> 'external_id', '')), 120), ''),
            v_personal, case when v_personal then 'account' end, v_unsure, nullif(left(btrim(coalesce(e ->> 'note', '')), 300), ''));
  end loop;
  update public.statement_imports set read_at = now(), read_error = null where id = i.id;
  v_twins := public.statement_find_twins(i.id);
  perform public.statement_propose(i.book_id, i.id, null);
  if coalesce(p_settle, false) then v_auto := public.statement_settle(i.id, p_by); end if;
  insert into public.book_log (book_id, actor, action, subject_label, detail)
  values (i.book_id, coalesce(auth.uid(), p_by), 'statement_uploaded', i.account,
          jsonb_build_object('import', i.id, 'file', i.file_name, 'via', i.via, 'lines', n, 'possible_duplicates', v_twins, 'tie', public.statement_tie(i.id)));
  return jsonb_build_object('id', i.id, 'lines', n, 'possible_duplicates', v_twins, 'done_for_you', v_auto, 'tie', public.statement_tie(i.id));
end $$;
revoke all on function public.statement_stage(uuid, jsonb, uuid, boolean) from public, anon, authenticated, service_role;

-- Start an upload: names the account and makes the row the file hangs from.
-- The same file twice is not read twice: the earlier upload is handed back.
create or replace function public.statement_begin(p_book uuid, p_account text, p_via text, p_file_name text default null, p_sha text default null,
                                                  p_kind text default null, p_personal boolean default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_account text := btrim(coalesce(p_account, '')); m public.money_accounts%rowtype; v_id uuid; o public.statement_imports%rowtype;
        v_manage boolean; v_personal_book boolean;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_book is null or p_book not in (select public.my_books_writable()) then raise exception 'You cannot add to these books' using errcode = '42501'; end if;
  -- A person's own books take statements this way only once accounting is
  -- switched on for them (Dara: agents' books are released to the Broker and
  -- Broker Admins first).
  if public.book_is_personal(p_book) and not exists (
       select 1 from public.accounting_access x join public.books b on b.id = p_book where x.user_id in (v_uid, b.owner_user_id)) then
    raise exception 'Statement import is not switched on for these books yet' using errcode = '42501';
  end if;
  if v_account = '' then raise exception 'Say which account this statement is for' using errcode = '23514'; end if;
  if p_via is null or p_via not in ('csv', 'ofx', 'scan') then raise exception 'unknown kind of upload' using errcode = '23514'; end if;
  if nullif(p_sha, '') is not null then
    select * into o from public.statement_imports
     where book_id = p_book and file_sha256 = p_sha and taken_back_at is null and read_at is not null order by created_at desc limit 1;
    if found then
      return jsonb_build_object('already', o.id, 'uploaded_at', o.created_at, 'file_name', o.file_name, 'account', o.account);
    end if;
  end if;
  v_manage := p_book in (select public.my_books_manageable());
  select b.kind in ('personal') into v_personal_book from public.books b where b.id = p_book;
  select * into m from public.money_accounts where book_id = p_book and lower(btrim(name)) = lower(v_account);
  if not found then
    insert into public.money_accounts (book_id, name, kind, is_personal)
    values (p_book, v_account,
            case when p_kind in ('bank', 'card', 'escrow', 'cash', 'other') then p_kind
                 when v_account ~* '(credit|visa|amex|american express|master ?card|\mcard\M)' and v_account !~* '(debit|checking|savings|bank)' then 'card' else 'bank' end,
            coalesce(p_personal, false) and v_personal_book)
    on conflict do nothing;
  elsif v_manage and p_personal is not null and v_personal_book and m.is_personal is distinct from p_personal then
    update public.money_accounts set is_personal = p_personal, updated_at = now() where id = m.id;
  end if;
  if m.id is not null then v_account := btrim(m.name); end if;
  insert into public.statement_imports (book_id, account, via, file_name, file_sha256, uploaded_by)
  values (p_book, v_account, p_via, nullif(left(btrim(coalesce(p_file_name, '')), 200), ''), nullif(p_sha, ''), v_uid) returning id into v_id;
  return jsonb_build_object('id', v_id, 'folder', p_book::text || '/' || v_id::text);
end $$;
revoke all on function public.statement_begin(uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.statement_begin(uuid, text, text, text, text, text, boolean) to authenticated;

-- Where the original was put.
create or replace function public.statement_files(p_import uuid, p_paths text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype; p text;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found or auth.uid() is null or i.book_id not in (select public.my_books_writable()) then raise exception 'You cannot add to these books' using errcode = '42501'; end if;
  if i.read_at is not null and cardinality(i.file_paths) > 0 then raise exception 'That statement already has its original' using errcode = 'P0001'; end if;
  if p_paths is null or cardinality(p_paths) = 0 or cardinality(p_paths) > 20 then raise exception 'Between one and twenty files' using errcode = '23514'; end if;
  foreach p in array p_paths loop
    if position(i.book_id::text || '/' || i.id::text || '/' in p) <> 1 or p ~ '\.\.' then raise exception 'That file is not in this statement''s folder' using errcode = '23514'; end if;
  end loop;
  update public.statement_imports set file_paths = p_paths where id = p_import;
end $$;
revoke all on function public.statement_files(uuid, text[]) from public, anon;
grant execute on function public.statement_files(uuid, text[]) to authenticated;

-- A CSV or OFX file, read on the person's own device.
create or replace function public.statement_add_lines(p_import uuid, p_lines jsonb, p_opening numeric default null, p_closing numeric default null,
                                                      p_from date default null, p_to date default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found or auth.uid() is null or i.book_id not in (select public.my_books_writable()) then raise exception 'You cannot add to these books' using errcode = '42501'; end if;
  if i.via not in ('csv', 'ofx') then raise exception 'A scanned statement is read by PrismOS, not sent in as lines' using errcode = '42501'; end if;
  perform public.statement_lock(i.book_id);
  update public.statement_imports set opening_balance = round(p_opening, 2), closing_balance = round(p_closing, 2), period_from = p_from, period_to = p_to where id = p_import;
  return public.statement_stage(p_import, p_lines, auth.uid(), false);
end $$;
revoke all on function public.statement_add_lines(uuid, jsonb, numeric, numeric, date, date) from public, anon;
grant execute on function public.statement_add_lines(uuid, jsonb, numeric, numeric, date, date) to authenticated;

-- What the statement reader needs to know before it reads; refuses anyone who
-- may not add to the books, and a second read while one is under way.
create or replace function public.statement_for_reading(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found or auth.uid() is null or i.book_id not in (select public.my_books_writable()) then raise exception 'You cannot add to these books' using errcode = '42501'; end if;
  if i.via not in ('scan') or i.read_at is not null or i.taken_back_at is not null then raise exception 'That statement is not waiting to be read' using errcode = 'P0001'; end if;
  if i.read_started_at > now() - interval '4 minutes' and i.read_error is null then
    raise exception 'That statement is being read right now. Give it a minute.' using errcode = 'P0001';
  end if;
  update public.statement_imports set read_started_at = now(), read_error = null where id = p_import;
  return jsonb_build_object('id', i.id, 'book_id', i.book_id, 'account', i.account, 'file_paths', to_jsonb(i.file_paths),
    'account_kind', (select m.kind from public.money_accounts m where m.book_id = i.book_id and lower(btrim(m.name)) = lower(btrim(i.account))));
end $$;
revoke all on function public.statement_for_reading(uuid) from public, anon;
grant execute on function public.statement_for_reading(uuid) to authenticated;

-- The reader hands back what it read (or that it could not). Service only.
create or replace function public.statement_stage_scan(p_import uuid, p_payload jsonb, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype; v_from date; v_to date;
begin
  if auth.role() is distinct from 'service_role' and session_user <> 'postgres' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into i from public.statement_imports where id = p_import;
  if not found or i.via not in ('scan') or i.read_at is not null then raise exception 'That statement is not waiting to be read' using errcode = 'P0001'; end if;
  perform public.statement_lock(i.book_id);
  if nullif(p_payload ->> 'error', '') is not null then
    update public.statement_imports set read_error = left(p_payload ->> 'error', 300) where id = p_import;
    return jsonb_build_object('id', p_import, 'error', left(p_payload ->> 'error', 300));
  end if;
  v_from := public.statement_date(p_payload ->> 'period_from'); v_to := public.statement_date(p_payload ->> 'period_to');
  update public.statement_imports set period_from = v_from, period_to = v_to,
         opening_balance = case when (p_payload ->> 'opening_balance') ~ '^-?\d{1,9}(\.\d{1,6})?$' then round((p_payload ->> 'opening_balance')::numeric, 2) end,
         closing_balance = case when (p_payload ->> 'closing_balance') ~ '^-?\d{1,9}(\.\d{1,6})?$' then round((p_payload ->> 'closing_balance')::numeric, 2) end
   where id = p_import;
  return public.statement_stage(p_import, p_payload -> 'lines', p_user, false);
end $$;
revoke all on function public.statement_stage_scan(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.statement_stage_scan(uuid, jsonb, uuid) to service_role;

-- Once lines from a statement are in the books, a line that was typed in by
-- hand (and so helped it add up) is taken out again only by an owner or admin.
create or replace function public.statement_added_guard(l public.statement_lines) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if l.added_by is not null and l.book_id not in (select public.my_books_manageable())
     and exists (select 1 from public.statement_lines x where x.import_id = l.import_id and x.id <> l.id and x.result in ('posted')) then
    raise exception 'This line was added by hand and the statement has been posted with it. Only an owner or admin can take it out.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.statement_added_guard(public.statement_lines) from public, anon, authenticated, service_role;

-- ── 10. Review ──────────────────────────────────────────────────────────────
-- Who is asking, and may they work on this line / upload?
create or replace function public.statement_guard(p_import uuid, p_line uuid, out o_import public.statement_imports, out o_line public.statement_lines)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_import uuid := p_import;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_line is not null then
    select l.import_id into v_import from public.statement_lines l where l.id = p_line;
    -- One answer for "no such line" and "not yours": nothing is learned by asking.
    if v_import is null or (p_import is not null and p_import <> v_import) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  end if;
  select * into o_import from public.statement_imports where id = v_import;
  if not found or o_import.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if o_import.taken_back_at is not null then raise exception 'That upload was taken back' using errcode = 'P0001'; end if;
  perform public.statement_lock(o_import.book_id);
  select * into o_import from public.statement_imports where id = v_import;
  if o_import.taken_back_at is not null then raise exception 'That upload was taken back' using errcode = 'P0001'; end if;
  if p_line is not null then select * into o_line from public.statement_lines where id = p_line for update; end if;
end $$;
revoke all on function public.statement_guard(uuid, uuid) from public, anon, authenticated, service_role;

-- Change a waiting line. p_patch holds only what is changing:
--   payee, memo, category (uuid or null), personal (bool), transfer_account,
--   contact_id, agent_id, closing_id, property_id, team_id, parts, receipt_path,
--   remember, checked (true = "I looked, it is right"), mine (true = "what is
--   proposed is my choice"), and for a scanned line date and amount.
create or replace function public.statement_line_set(p_line uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; l public.statement_lines%rowtype; i public.statement_imports%rowtype; v_decides boolean; v_touched boolean; v_moved boolean := false; v_cat uuid;
begin
  g := public.statement_guard(null, p_line); l := g.o_line; i := g.o_import;
  if l.result is not null then raise exception 'That line is already decided. Undo it first.' using errcode = 'P0001'; end if;
  if p_patch ? 'amount' or (p_patch ? 'date' and l.line_date is not null) then
    if i.via not in ('scan') then raise exception 'The date and amount come from the bank''s own file and cannot be changed here' using errcode = '42501'; end if;
  end if;
  if p_patch ? 'date' then
    l.line_date := (p_patch ->> 'date')::date;
    if l.line_date is null or l.line_date < date '1990-01-01' or l.line_date > current_date + 31 then raise exception 'That date cannot be right' using errcode = '23514'; end if;
    l.unsure := array_remove(l.unsure, 'date');
  end if;
  if p_patch ? 'amount' then
    l.amount := round((p_patch ->> 'amount')::numeric, 2);
    if l.amount is null or abs(l.amount) >= 100000000 then raise exception 'That amount cannot be right' using errcode = '23514'; end if;
    l.unsure := array_remove(l.unsure, 'amount');
    if l.parts is not null and not p_patch ? 'parts' then l.parts := null; end if;
  end if;
  if p_patch ? 'payee' then l.payee := nullif(left(btrim(coalesce(p_patch ->> 'payee', '')), 80), ''); l.unsure := array_remove(l.unsure, 'payee'); end if;
  if p_patch ? 'memo' then l.memo := nullif(left(btrim(coalesce(p_patch ->> 'memo', '')), 200), ''); end if;
  if p_patch ? 'category' then
    v_cat := nullif(p_patch ->> 'category', '')::uuid;
    if v_cat is not null and not exists (select 1 from public.tax_categories c where c.id = v_cat and c.book_id = l.book_id) then
      raise exception 'That category belongs to a different set of books' using errcode = '23514';
    end if;
    l.tax_category_id := v_cat;
    if v_cat is not null and not p_patch ? 'parts' then l.parts := null; end if;
    if v_cat is not null and not p_patch ? 'personal' then l.is_personal := false; end if;
  end if;
  if p_patch ? 'personal' then
    l.is_personal := coalesce((p_patch ->> 'personal')::boolean, false);
    if l.is_personal and not public.book_is_personal(l.book_id) then
      raise exception 'Shared books hold business money only. File it under one of the owners'' categories instead.' using errcode = '23514';
    end if;
  end if;
  if p_patch ? 'transfer_account' then
    l.transfer_account := nullif(btrim(coalesce(p_patch ->> 'transfer_account', '')), '');
    if lower(coalesce(l.transfer_account, '')) = lower(btrim(i.account)) then raise exception 'A transfer needs two different accounts' using errcode = '23514'; end if;
  end if;
  if p_patch ? 'parts' then l.parts := public.statement_parts_ok(l.book_id, p_patch -> 'parts', l.amount); end if;
  if l.transfer_account is not null or l.is_personal then l.parts := null; end if;
  if l.transfer_account is not null or l.parts is not null or l.is_personal then l.tax_category_id := null; end if;
  if l.transfer_account is not null then l.is_personal := false; end if;
  if p_patch ? 'contact_id'  then l.contact_id  := nullif(p_patch ->> 'contact_id', '')::uuid; end if;
  if p_patch ? 'agent_id'    then l.agent_id    := nullif(p_patch ->> 'agent_id', '')::uuid; end if;
  if p_patch ? 'closing_id'  then l.closing_id  := nullif(p_patch ->> 'closing_id', '')::uuid; end if;
  if p_patch ? 'property_id' then l.property_id := nullif(p_patch ->> 'property_id', '')::uuid; end if;
  if p_patch ? 'team_id'     then l.team_id     := nullif(p_patch ->> 'team_id', '')::uuid; end if;
  if p_patch ? 'receipt_path' then
    l.receipt_path := nullif(p_patch ->> 'receipt_path', '');
    if l.receipt_path is not null and (position(l.book_id::text || '/receipts/' in l.receipt_path) <> 1 or l.receipt_path ~ '\.\.') then
      raise exception 'That receipt is not in these books'' folder' using errcode = '23514';
    end if;
  end if;
  if p_patch ? 'remember' then l.remember := nullif(p_patch ->> 'remember', ''); end if;
  if coalesce((p_patch ->> 'checked')::boolean, false) then l.unsure := '{}'; end if;
  -- "Yes, that suggestion is right": the person's own word for what is already there.
  if coalesce((p_patch ->> 'mine')::boolean, false) and (l.tax_category_id is not null or l.is_personal or l.transfer_account is not null or l.parts is not null) then
    l.proposed_by := 'person';
  end if;
  -- Saying what the line IS makes it the person's decision. Renaming the payee
  -- or tagging a contact does not: a category the model suggested stays a
  -- suggestion until a person chooses or approves it.
  v_decides := row(l.tax_category_id, l.is_personal, coalesce(l.transfer_account, ''), l.parts)
               is distinct from row((g.o_line).tax_category_id, (g.o_line).is_personal, coalesce((g.o_line).transfer_account, ''), (g.o_line).parts);
  v_touched := v_decides or p_patch ?| array['payee', 'memo', 'contact_id', 'agent_id', 'team_id', 'remember'];
  v_moved := l.line_date is distinct from (g.o_line).line_date or l.amount is distinct from (g.o_line).amount;
  update public.statement_lines set
         line_date = l.line_date, amount = l.amount, payee = l.payee, memo = l.memo, tax_category_id = l.tax_category_id, is_personal = l.is_personal,
         transfer_account = l.transfer_account, parts = l.parts, contact_id = l.contact_id, agent_id = l.agent_id, closing_id = l.closing_id,
         property_id = l.property_id, team_id = l.team_id, receipt_path = l.receipt_path, remember = l.remember, unsure = l.unsure,
         proposed_by = case when v_decides then 'person' else l.proposed_by end,
         touched_by = case when v_touched then auth.uid() else touched_by end
   where id = p_line;
  if v_moved and (l.amount is distinct from (g.o_line).amount or (g.o_line).line_date is not null) then
    perform public.book_log_add(l.book_id, 'statement_line_changed', null, i.account, null,
                                jsonb_build_object('import', i.id, 'file', i.file_name, 'text', l.raw_text,
                                                   'from', jsonb_build_object('date', (g.o_line).line_date, 'amount', (g.o_line).amount),
                                                   'to', jsonb_build_object('date', l.line_date, 'amount', l.amount)));
  end if;
  if v_moved then
    -- A new date or amount is a new question: is it already in the books, and
    -- does the same rule still fit?
    perform public.statement_find_twins(i.id, p_line);
    perform public.statement_propose(l.book_id, i.id, l.payee_key);
  end if;
  return jsonb_build_object('ok', true, 'tie', public.statement_tie(i.id));
end $$;
revoke all on function public.statement_line_set(uuid, jsonb) from public, anon;
grant execute on function public.statement_line_set(uuid, jsonb) to authenticated;

-- What a line teaches when a person approves it.
create or replace function public.statement_learn(p_line uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.statement_lines%rowtype; i public.statement_imports%rowtype; v jsonb;
begin
  select * into l from public.statement_lines where id = p_line;
  if l.proposed_by is null or l.proposed_by in ('account') then return null; end if;
  if l.proposed_by in ('rule') and l.touched_by is null and l.remember is null then
    -- Nothing was changed: the person agreed with the rule. That confirms it.
    update public.payee_rules set agreements = agreements + 1, trusted = true, updated_at = now()
     where id = l.rule_id and book_id = l.book_id and not (trusted and agreements > 50);
    return null;
  end if;
  select * into i from public.statement_imports where id = l.import_id;
  v := public.rule_learn(l.book_id, l.payee_key, l.payee, i.account, l.amount, l.remember, l.rule_id,
                         l.tax_category_id, l.is_personal, l.transfer_account, l.contact_id, l.agent_id, l.team_id, l.memo, l.parts, true, auth.uid());
  if v is not null then
    update public.statement_lines set rule_id = (v ->> 'rule_id')::uuid where id = p_line;
  end if;
  return v;
end $$;
revoke all on function public.statement_learn(uuid) from public, anon, authenticated, service_role;

-- One tap: this line is right. Posts it, and remembers it for next time.
create or replace function public.statement_line_approve(p_line uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; l public.statement_lines%rowtype; v jsonb;
begin
  g := public.statement_guard(null, p_line); l := g.o_line;
  if l.result is not null then return jsonb_build_object('ok', true); end if;
  if public.statement_blocked(l.import_id) then
    raise exception 'This statement does not add up yet. Nothing from it can be posted until that is settled.' using errcode = 'P0001';
  end if;
  if 'closed' = any (public.statement_line_needs(l)) then raise exception 'That date is in a closed period. An owner or admin can reopen the books.' using errcode = 'P0001'; end if;
  -- Something like it reached the books since this was read in: show it, post nothing.
  if public.statement_twin_now(p_line) then return jsonb_build_object('ok', false, 'twin', true); end if;
  v := public.statement_learn(p_line);
  perform public.statement_post_line(p_line, auth.uid(), false);
  -- The same payee, still waiting elsewhere in these books, now has an answer.
  if v is not null then perform public.statement_propose(l.book_id, null, l.payee_key); end if;
  return jsonb_build_object('ok', true, 'rule', v);
end $$;
revoke all on function public.statement_line_approve(uuid) from public, anon;
grant execute on function public.statement_line_approve(uuid) to authenticated;

-- One tap: everything in this upload that needs no attention.
create or replace function public.statement_approve_ready(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; l public.statement_lines%rowtype; v_n integer := 0; v_bad integer := 0; v_twins integer := 0; v_keys text[] := '{}'; v jsonb; k text;
begin
  g := public.statement_guard(p_import, null);
  if public.statement_blocked(p_import) then
    raise exception 'This statement does not add up yet. Nothing from it can be posted until that is settled.' using errcode = 'P0001';
  end if;
  -- Lines typed in by hand go first: the rest wait for them (statement_post_line).
  for l in select * from public.statement_lines x where x.import_id = p_import and x.result is null order by (x.added_by is null), x.line_no loop
    if cardinality(public.statement_line_needs(l)) = 0 then
      if public.statement_twin_now(l.id) then v_twins := v_twins + 1; continue; end if;
      begin   -- one line that cannot post must not hold back the rest
        v := public.statement_learn(l.id);
        perform public.statement_post_line(l.id, auth.uid(), false);
        if v is not null and coalesce((v ->> 'changed')::boolean, false) then v_keys := v_keys || l.payee_key; end if;
        v_n := v_n + 1;
      exception when others then
        v_bad := v_bad + 1;
        update public.statement_lines set hold = true where id = l.id;   -- it now needs a person's own tap, which will say why
      end;
      exit when v_n >= 120;
    end if;
  end loop;
  v_keys := array(select distinct x from unnest(v_keys) x);
  foreach k in array v_keys loop
    perform public.statement_propose((g.o_import).book_id, null, k);
  end loop;
  return jsonb_build_object('posted', v_n, 'more', v_n >= 120, 'could_not', v_bad, 'possible_duplicates', v_twins);
end $$;
revoke all on function public.statement_approve_ready(uuid) from public, anon;
grant execute on function public.statement_approve_ready(uuid) to authenticated;

-- Leave a line out of the books. Says nothing about the payee.
create or replace function public.statement_line_skip(p_line uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record;
begin
  g := public.statement_guard(null, p_line);
  if (g.o_line).result is not null then return; end if;
  perform public.statement_added_guard(g.o_line);
  update public.statement_lines set result = case when added_by is not null then 'dropped' else 'skipped' end, decided_by = auth.uid(), decided_at = now() where id = p_line;
  -- A line set aside as a duplicate OF this one has lost its other half.
  update public.statement_lines set result = null, hold = true, decided_by = null, decided_at = null where twin_line_id = p_line and result in ('duplicate');
end $$;
revoke all on function public.statement_line_skip(uuid) from public, anon;
grant execute on function public.statement_line_skip(uuid) to authenticated;

-- A possible duplicate: the same one (do not add it again) or a different one.
-- p_line null with p_import: every open one in the upload is the same.
create or replace function public.statement_resolve_twin(p_line uuid, p_same boolean, p_import uuid default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; v_n integer;
begin
  g := public.statement_guard(p_import, p_line);
  -- A twin that has since left the books, or was itself left out, is no twin.
  update public.statement_lines x set twin_transaction_id = null, twin_line_id = null
   where x.import_id = (g.o_import).id and x.result is null and (p_line is null or x.id = p_line)
     and (x.twin_transaction_id is not null or x.twin_line_id is not null)
     and not exists (select 1 from public.transactions t where t.id = x.twin_transaction_id and not t.is_archived)
     and not exists (select 1 from public.statement_lines o join public.statement_imports oi on oi.id = o.import_id
                      where o.id = x.twin_line_id and oi.taken_back_at is null and coalesce(o.result, 'posted') in ('posted'));
  if p_line is null then
    update public.statement_lines set result = 'duplicate', decided_by = auth.uid(), decided_at = now()
     where import_id = (g.o_import).id and result is null and twin_answer is null and (twin_transaction_id is not null or twin_line_id is not null);
    get diagnostics v_n = row_count; return v_n;
  end if;
  if (g.o_line).result is not null then return 0; end if;
  if not exists (select 1 from public.statement_lines where id = p_line and (twin_transaction_id is not null or twin_line_id is not null)) then return 0; end if;
  if coalesce(p_same, false) then
    update public.statement_lines set result = 'duplicate', decided_by = auth.uid(), decided_at = now() where id = p_line;
  else
    update public.statement_lines set twin_answer = 'different' where id = p_line;
  end if;
  return 1;
end $$;
revoke all on function public.statement_resolve_twin(uuid, boolean, uuid) from public, anon;
grant execute on function public.statement_resolve_twin(uuid, boolean, uuid) to authenticated;

-- Undo. A posted line comes out of the books and waits again (and is never
-- posted again without a person); a line left out or called a duplicate waits
-- again.
create or replace function public.statement_line_undo(p_line uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; l public.statement_lines%rowtype; v_was text := coalesce(current_setting('prism.learning', true), 'on');
begin
  g := public.statement_guard(null, p_line); l := g.o_line;
  if l.result is null then return; end if;
  if l.result in ('posted') then perform public.statement_added_guard(l); end if;
  if l.result in ('posted') then
    perform set_config('prism.learning', 'off', true);
    delete from public.transactions where statement_line_id = p_line and book_id = l.book_id;
    perform set_config('prism.learning', v_was, true);
  end if;
  update public.statement_lines set result = null, auto_posted = false, hold = true, decided_by = null, decided_at = null,
         twin_answer = case when l.result in ('duplicate') then null else twin_answer end
   where id = p_line;
  if l.result in ('dropped') then
    perform public.book_log_add(l.book_id, 'statement_line_restored', null, (g.o_import).account, null,
                                jsonb_build_object('import', (g.o_import).id, 'file', (g.o_import).file_name, 'date', l.line_date, 'amount', l.amount, 'text', l.raw_text));
  end if;
end $$;
revoke all on function public.statement_line_undo(uuid) from public, anon;
grant execute on function public.statement_line_undo(uuid) to authenticated;

-- A scanned statement only: a line the reader missed, or one that is not on
-- the statement at all.
create or replace function public.statement_line_add(p_import uuid, p_date date, p_amount numeric, p_text text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; v_id uuid; v_text text := nullif(left(btrim(coalesce(p_text, '')), 300), '');
begin
  g := public.statement_guard(p_import, null);
  if (g.o_import).via not in ('scan') or (g.o_import).read_at is null then raise exception 'Lines can only be added to a scanned statement' using errcode = '42501'; end if;
  if p_date is null or p_date < date '1990-01-01' or p_date > current_date + 31 or p_amount is null or round(p_amount, 2) = 0 or abs(p_amount) >= 100000000 then
    raise exception 'A line needs a date and an amount' using errcode = '23514';
  end if;
  insert into public.statement_lines (import_id, book_id, line_no, line_date, amount, raw_text, payee_key, payee, added_by)
  values (p_import, (g.o_import).book_id, (select coalesce(max(line_no), 0) + 1 from public.statement_lines where import_id = p_import),
          p_date, round(p_amount, 2), v_text, lower(public.clean_payee(v_text)), nullif(public.clean_payee(v_text), ''), auth.uid())
  returning id into v_id;
  perform public.statement_find_twins(p_import, v_id);
  perform public.statement_propose((g.o_import).book_id, p_import, null);
  perform public.book_log_add((g.o_import).book_id, 'statement_line_added', null, (g.o_import).account, null,
                              jsonb_build_object('import', p_import, 'file', (g.o_import).file_name, 'date', p_date, 'amount', round(p_amount, 2), 'text', v_text));
  return v_id;
end $$;
revoke all on function public.statement_line_add(uuid, date, numeric, text) from public, anon;
grant execute on function public.statement_line_add(uuid, date, numeric, text) to authenticated;

create or replace function public.statement_line_drop(p_line uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record;
begin
  g := public.statement_guard(null, p_line);
  if (g.o_import).via not in ('scan') then raise exception 'Only a line on a scanned statement can be removed' using errcode = '42501'; end if;
  if (g.o_line).result is not null then raise exception 'That line is already decided. Undo it first.' using errcode = 'P0001'; end if;
  perform public.statement_added_guard(g.o_line);
  update public.statement_lines set result = 'dropped', decided_by = auth.uid(), decided_at = now() where id = p_line;
  update public.statement_lines set result = null, hold = true, decided_by = null, decided_at = null where twin_line_id = p_line and result in ('duplicate');
  perform public.book_log_add((g.o_import).book_id, 'statement_line_removed', null, (g.o_import).account, null,
                              jsonb_build_object('import', (g.o_import).id, 'file', (g.o_import).file_name, 'date', (g.o_line).line_date,
                                                 'amount', (g.o_line).amount, 'text', (g.o_line).raw_text));
end $$;
revoke all on function public.statement_line_drop(uuid) from public, anon;
grant execute on function public.statement_line_drop(uuid) to authenticated;

-- The balances printed on the statement.
create or replace function public.statement_set_balances(p_import uuid, p_opening numeric, p_closing numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record;
begin
  g := public.statement_guard(p_import, null);
  -- Taking the balances off a statement that was given them is how a failed
  -- proof would be made to go away: an owner or admin only.
  if (g.o_import).opening_balance is not null and (g.o_import).closing_balance is not null
     and (p_opening is null or p_closing is null or (g.o_import).via in ('scan'))
     and (round(p_opening, 2) is distinct from (g.o_import).opening_balance or round(p_closing, 2) is distinct from (g.o_import).closing_balance)
     and (g.o_import).book_id not in (select public.my_books_manageable()) then
    raise exception 'Only an owner or admin can change the balances read off a statement, or remove them' using errcode = '42501';
  end if;
  update public.statement_imports set opening_balance = round(p_opening, 2), closing_balance = round(p_closing, 2) where id = p_import;
  perform public.book_log_add((g.o_import).book_id, 'statement_balances_set', null, (g.o_import).account, null,
                              jsonb_build_object('import', p_import, 'file', (g.o_import).file_name,
                                                 'from', jsonb_build_object('opening', (g.o_import).opening_balance, 'closing', (g.o_import).closing_balance),
                                                 'to', jsonb_build_object('opening', round(p_opening, 2), 'closing', round(p_closing, 2)),
                                                 'tie', public.statement_tie(p_import)));
  return jsonb_build_object('tie', public.statement_tie(p_import));
end $$;
revoke all on function public.statement_set_balances(uuid, numeric, numeric) from public, anon;
grant execute on function public.statement_set_balances(uuid, numeric, numeric) to authenticated;

-- An owner or admin lets a statement through that does not add up. Signed
-- into the record with how far off it was.
create or replace function public.statement_accept_unproven(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record;
begin
  g := public.statement_guard(p_import, null);
  if (g.o_import).book_id not in (select public.my_books_manageable()) then raise exception 'Only an owner or admin can let through a statement that does not add up' using errcode = '42501'; end if;
  if (g.o_import).read_at is null then raise exception 'That statement has not been read in yet' using errcode = 'P0001'; end if;
  if not public.statement_blocked(p_import) then return jsonb_build_object('tie', public.statement_tie(p_import)); end if;
  perform public.book_log_add((g.o_import).book_id, 'statement_accepted_unproven', null, (g.o_import).account, null,
                              jsonb_build_object('import', p_import, 'file', (g.o_import).file_name, 'tie', public.statement_tie(p_import)));
  -- The yes is for THIS gap. If the lines or balances change and the gap with
  -- them, the statement is held again until someone says yes to the new one.
  update public.statement_imports set accepted_unproven_at = now(), accepted_unproven_by = auth.uid(),
         accepted_off_by = (public.statement_tie(p_import) ->> 'off_by')::numeric where id = p_import;
  return jsonb_build_object('tie', public.statement_tie(p_import));
end $$;
revoke all on function public.statement_accept_unproven(uuid) from public, anon;
grant execute on function public.statement_accept_unproven(uuid) to authenticated;

-- Take a whole upload back: every entry it posted comes out of the books.
create or replace function public.statement_take_back(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; v_n integer; v_left integer; v_closed date; v_lines uuid[]; v_was text := coalesce(current_setting('prism.learning', true), 'on');
begin
  g := public.statement_guard(p_import, null);
  if (g.o_import).uploaded_by is distinct from auth.uid() and (g.o_import).book_id not in (select public.my_books_manageable()) then
    raise exception 'Only the person who uploaded it, or an owner or admin, can take an upload back' using errcode = '42501';
  end if;
  select b.closed_through into v_closed from public.books b where b.id = (g.o_import).book_id;
  if v_closed is not null and exists (select 1 from public.transactions x join public.statement_lines l on l.id = x.statement_line_id and l.book_id = x.book_id
                                       where l.import_id = p_import and x.date <= v_closed) then
    raise exception 'Some of this upload is in a closed period (through %). Reopen the books to take it back.', to_char(v_closed, 'FMMonth FMDD, YYYY') using errcode = 'P0001';
  end if;
  -- A hundred lines at a time (the screen asks again until none are left).
  -- From the first call on, nothing from this upload posts again by itself.
  update public.statement_lines set hold = true where import_id = p_import and result is null and not hold;
  select array_agg(q.id) into v_lines from (select l.id from public.statement_lines l where l.import_id = p_import and l.result in ('posted') order by l.line_no limit 100) q;
  perform set_config('prism.learning', 'off', true);
  delete from public.transactions t using public.statement_lines l
   where l.id = any (coalesce(v_lines, '{}')) and t.statement_line_id = l.id and t.book_id = l.book_id;
  get diagnostics v_n = row_count;
  perform set_config('prism.learning', v_was, true);
  update public.statement_lines set result = null, hold = true, auto_posted = false, decided_by = null, decided_at = null where id = any (coalesce(v_lines, '{}'));
  select count(*) into v_left from public.statement_lines l where l.import_id = p_import and l.result in ('posted');
  if v_left > 0 then return jsonb_build_object('removed', v_n, 'more', true); end if;
  update public.statement_lines set result = null, hold = true, decided_by = null, decided_at = null
   where result in ('duplicate') and twin_line_id in (select l.id from public.statement_lines l where l.import_id = p_import);
  update public.statement_imports set taken_back_at = now(), taken_back_by = auth.uid() where id = p_import;
  perform public.book_log_add((g.o_import).book_id, 'statement_taken_back', null, (g.o_import).account, null,
                              jsonb_build_object('import', p_import, 'file', (g.o_import).file_name));
  return jsonb_build_object('removed', v_n, 'more', false);
end $$;
revoke all on function public.statement_take_back(uuid) from public, anon;
grant execute on function public.statement_take_back(uuid) to authenticated;

-- ── 11. What the screens read ───────────────────────────────────────────────
create or replace function public.statement_overview(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_book not in (select public.my_books_readable()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return (
    select jsonb_build_object(
      'waiting', coalesce(sum((x.c ->> 'waiting')::int), 0),
      'imports', coalesce(jsonb_agg(x.info || jsonb_build_object('counts', x.c) order by x.created_at desc), '[]'::jsonb))
      from (
        select i.created_at,
               jsonb_build_object('id', i.id, 'account', i.account, 'via', i.via, 'file_name', i.file_name, 'created_at', i.created_at,
                                  'by', public.book_person_label(i.uploaded_by), 'read_at', i.read_at, 'read_error', i.read_error,
                                  'period_from', i.period_from, 'period_to', i.period_to, 'tie', public.statement_tie(i.id)) as info,
               (select jsonb_build_object(
                         'lines', count(*) filter (where coalesce(l.result, '') not in ('dropped')),
                         'waiting', count(*) filter (where l.result is null),
                         'ready', count(*) filter (where l.result is null and cardinality(public.statement_line_needs(l)) = 0),
                         'done_for_you', count(*) filter (where l.result in ('posted') and l.auto_posted),
                         'posted', count(*) filter (where l.result in ('posted')),
                         'left_out', count(*) filter (where l.result in ('skipped', 'duplicate')))
                  from public.statement_lines l where l.import_id = i.id) as c
          from public.statement_imports i
         where i.book_id = p_book and i.taken_back_at is null
         order by i.created_at desc limit 60) x);
end $$;
revoke all on function public.statement_overview(uuid) from public, anon;
grant execute on function public.statement_overview(uuid) to authenticated;

create or replace function public.statement_detail(p_import uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found or auth.uid() is null or i.book_id not in (select public.my_books_readable()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'import', to_jsonb(i) || jsonb_build_object('by', public.book_person_label(i.uploaded_by)),
    'tie', public.statement_tie(i.id),
    'can_manage', i.book_id in (select public.my_books_manageable()),
    'can_write', i.book_id in (select public.my_books_writable()),
    'lines', coalesce((
      select jsonb_agg(jsonb_strip_nulls(to_jsonb(l) - 'book_id' - 'import_id' - 'created_at') || jsonb_build_object(
               'needs', to_jsonb(public.statement_line_needs(l)),
               'rule', (select jsonb_build_object('payee', r.payee, 'always_ask', r.always_ask, 'trusted', r.trusted, 'narrowed', r.amount is not null or r.account_key is not null)
                          from public.payee_rules r where r.id = l.rule_id),
               'twin', case
                 when l.twin_transaction_id is not null then (
                   select jsonb_build_object('where', 'books', 'date', g.date, 'amount', g.amount, 'payee', g.payee, 'account', g.account,
                                             'other_account', g.other, 'how', g.how, 'parts', g.parts,
                                             'file', (select oi.file_name from public.statement_lines ol join public.statement_imports oi on oi.id = ol.import_id
                                                       where ol.id = g.line))
                     from (select min(t.date) as date, sum(t.amount) as amount, min(t.payee) as payee, min(t.account) as account,
                                  min(t.transfer_account) as other, min(t.entered_via) as how, count(*) as parts, min(t.statement_line_id::text)::uuid as line
                             from public.transactions t, public.transactions k
                            where k.id = l.twin_transaction_id and t.book_id = k.book_id and not t.is_archived
                              and coalesce(t.split_group, t.id) = coalesce(k.split_group, k.id)) g where g.parts > 0)
                 when l.twin_line_id is not null then (
                   select jsonb_build_object('where', 'upload', 'date', o.line_date, 'amount', o.amount, 'payee', coalesce(o.payee, o.raw_text),
                                             'account', oi.account, 'file', oi.file_name, 'uploaded_at', oi.created_at, 'now', coalesce(o.result, 'waiting'))
                     from public.statement_lines o join public.statement_imports oi on oi.id = o.import_id where o.id = l.twin_line_id) end)
             order by l.line_no)
        from public.statement_lines l where l.import_id = i.id), '[]'::jsonb));
end $$;
revoke all on function public.statement_detail(uuid) from public, anon;
grant execute on function public.statement_detail(uuid) to authenticated;

-- ── 12. The Rules screen ────────────────────────────────────────────────────
-- p_patch: payee, category, personal, transfer_account, memo, always_ask,
-- amount (number or null), account (name or null), dismiss_suggestion.
create or replace function public.rule_save(p_rule uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payee_rules%rowtype; v_cat uuid; v_shape boolean := false; v_past integer := 0;
begin
  select * into r from public.payee_rules where id = p_rule;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  perform public.statement_lock(r.book_id);
  select * into r from public.payee_rules where id = p_rule for update;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if p_patch ? 'payee' and nullif(btrim(coalesce(p_patch ->> 'payee', '')), '') is not null then r.payee := left(btrim(p_patch ->> 'payee'), 80); end if;
  if p_patch ? 'memo' then r.memo := nullif(left(btrim(coalesce(p_patch ->> 'memo', '')), 200), ''); end if;
  if p_patch ? 'category' then
    v_cat := nullif(p_patch ->> 'category', '')::uuid;
    if v_cat is not null and not exists (select 1 from public.tax_categories c where c.id = v_cat and c.book_id = r.book_id) then
      raise exception 'That category belongs to a different set of books' using errcode = '23514';
    end if;
    r.tax_category_id := v_cat; v_shape := true;
    if v_cat is not null then r.parts := null; r.is_personal := false; r.transfer_account := null; end if;
  end if;
  if p_patch ? 'personal' then
    r.is_personal := coalesce((p_patch ->> 'personal')::boolean, false); v_shape := true;
    if r.is_personal and not public.book_is_personal(r.book_id) then
      raise exception 'Shared books hold business money only. File it under one of the owners'' categories instead.' using errcode = '23514';
    end if;
    if r.is_personal then r.tax_category_id := null; r.parts := null; r.transfer_account := null; end if;
  end if;
  if p_patch ? 'transfer_account' then
    r.transfer_account := nullif(btrim(coalesce(p_patch ->> 'transfer_account', '')), ''); v_shape := true;
    if r.transfer_account is not null then r.tax_category_id := null; r.parts := null; r.is_personal := false; end if;
  end if;
  if p_patch ? 'always_ask' then
    r.always_ask := coalesce((p_patch ->> 'always_ask')::boolean, false); r.suggest_always_ask := false;
    if not r.always_ask then r.ask_declined := true; r.changes := 0; end if;
  end if;
  if coalesce((p_patch ->> 'dismiss_suggestion')::boolean, false) then r.suggest_always_ask := false; r.ask_declined := true; end if;
  if p_patch ? 'amount' then r.amount := round(nullif(p_patch ->> 'amount', '')::numeric, 2); end if;
  if p_patch ? 'account' then r.account_key := nullif(lower(btrim(coalesce(p_patch ->> 'account', ''))), ''); end if;
  begin
    update public.payee_rules set payee = r.payee, memo = r.memo, tax_category_id = r.tax_category_id, parts = r.parts, is_personal = r.is_personal,
           transfer_account = r.transfer_account, always_ask = r.always_ask, suggest_always_ask = r.suggest_always_ask, ask_declined = r.ask_declined,
           changes = r.changes, amount = r.amount, account_key = r.account_key, trusted = trusted or v_shape, updated_by = auth.uid(), updated_at = now()
     where id = p_rule;
  exception when unique_violation then
    raise exception 'There is already a rule for that payee with the same account and amount' using errcode = 'P0001';
  end;
  if v_shape then
    select count(*) into v_past from public.rule_past(p_rule);
    update public.payee_rules set fix_pending = v_past > 0 where id = p_rule;
  end if;
  perform public.statement_propose(r.book_id, null, r.payee_key);
  return jsonb_build_object('rule_id', p_rule, 'payee', r.payee, 'past', v_past);
end $$;
revoke all on function public.rule_save(uuid, jsonb) from public, anon;
grant execute on function public.rule_save(uuid, jsonb) to authenticated;

create or replace function public.rule_delete(p_rule uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payee_rules%rowtype;
begin
  select * into r from public.payee_rules where id = p_rule;
  if not found then return; end if;
  if auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  perform public.statement_lock(r.book_id);
  delete from public.payee_rules where id = p_rule;
  perform public.statement_propose(r.book_id, null, r.payee_key);
end $$;
revoke all on function public.rule_delete(uuid) from public, anon;
grant execute on function public.rule_delete(uuid) to authenticated;

-- Every rule in a set of books, with how many entries each has filed.
create or replace function public.rule_list(p_book uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_readable()) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) || jsonb_build_object('used', u.n, 'last_used', u.last) order by lower(r.payee), r.amount nulls first, r.account_key nulls first)
      from public.payee_rules r
      left join lateral (select count(*) as n, max(t.date) as last from public.transactions t
                          where t.rule_id = r.id and t.book_id = r.book_id and not t.is_archived) u on true
     where r.book_id = p_book), '[]'::jsonb);
end $$;
revoke all on function public.rule_list(uuid) from public, anon;
grant execute on function public.rule_list(uuid) to authenticated;

-- "Fix the earlier ones too?" Asked once: yes or no, the question is closed.
create or replace function public.rule_fix_past(p_rule uuid, p_do boolean) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payee_rules%rowtype; v_n integer := 0; v_transfer text; v_was text := coalesce(current_setting('prism.learning', true), 'on');
begin
  select * into r from public.payee_rules where id = p_rule;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  perform public.statement_lock(r.book_id);
  select * into r from public.payee_rules where id = p_rule for update;
  if not found or auth.uid() is null or r.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if coalesce(p_do, false) then
    v_transfer := nullif(btrim(coalesce(r.transfer_account, '')), '');
    perform set_config('prism.learning', 'off', true);
    update public.transactions t set
           transfer_account = v_transfer,
           scope = case when r.is_personal and v_transfer is null then 'personal' else 'business' end,
           tax_category_id = case when r.is_personal or v_transfer is not null then null else r.tax_category_id end
     where t.book_id = r.book_id and t.id in (select x from public.rule_past(p_rule) x limit 400);
    get diagnostics v_n = row_count;
    perform set_config('prism.learning', v_was, true);
  end if;
  update public.payee_rules set fix_pending = coalesce(p_do, false) and exists (select 1 from public.rule_past(p_rule)) where id = p_rule;
  return v_n;
end $$;
revoke all on function public.rule_fix_past(uuid, boolean) from public, anon;
grant execute on function public.rule_fix_past(uuid, boolean) to authenticated;

-- After an entry is corrected in the checkbook: is there a question to ask?
create or replace function public.rule_offer(p_tx uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t public.transactions%rowtype; r public.payee_rules%rowtype; v_key text; v_n integer;
begin
  select * into t from public.transactions where id = p_tx;
  if not found or auth.uid() is null or t.book_id not in (select public.my_books_writable()) then return null; end if;
  v_key := coalesce((select l.payee_key from public.statement_lines l where l.id = t.statement_line_id and l.book_id = t.book_id), lower(public.clean_payee(t.payee)));
  select * into r from public.payee_rules where id = t.rule_id and book_id = t.book_id;
  if r.id is null then r := public.rule_for(t.book_id, v_key, t.account, t.amount); end if;
  if r.id is null then return null; end if;
  select count(*) into v_n from public.rule_past(r.id);
  return jsonb_build_object('rule_id', r.id, 'payee', r.payee, 'past', case when r.fix_pending then v_n else 0 end,
                            'suggest_always_ask', r.suggest_always_ask and not r.always_ask);
end $$;
revoke all on function public.rule_offer(uuid) from public, anon;
grant execute on function public.rule_offer(uuid) to authenticated;

-- ── 13. Suggestions from the model: proposals only ──────────────────────────
-- What the model is shown: payees nobody has decided, and this book's
-- categories. Bank text only; no account numbers are kept in these tables.
create or replace function public.statement_ai_context(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype;
begin
  select * into i from public.statement_imports where id = p_import;
  if not found or auth.uid() is null or i.book_id not in (select public.my_books_writable()) then raise exception 'You cannot add to these books' using errcode = '42501'; end if;
  if i.read_at is null or i.taken_back_at is not null then raise exception 'That statement is not in review' using errcode = 'P0001'; end if;
  -- Asked now. Whatever happens next, the screen does not wait on it again.
  update public.statement_imports set suggested_at = now() where id = p_import;
  return jsonb_build_object(
    'book_id', i.book_id,
    'personal_book', public.book_is_personal(i.book_id),
    'payees', coalesce((select jsonb_agg(jsonb_build_object('key', x.payee_key, 'payee', x.payee, 'text', x.sample, 'money_in', x.money_in, 'typical', x.typical))
                          from (select l.payee_key, min(l.payee) as payee, min(l.raw_text) as sample, bool_and(l.amount > 0) as money_in,
                                       round(avg(abs(l.amount)), 2) as typical
                                  from public.statement_lines l
                                 where l.import_id = i.id and l.result is null and l.proposed_by is null and l.payee_key <> ''
                                 group by l.payee_key order by l.payee_key limit 200) x), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'about', c.description) order by c.sort_order)
                              from public.tax_categories c where c.book_id = i.book_id and not c.is_archived and c.kind not in ('transfer')), '[]'::jsonb));
end $$;
revoke all on function public.statement_ai_context(uuid) from public, anon;
grant execute on function public.statement_ai_context(uuid) to authenticated;

-- p_items: [{key, category_id, personal, confidence}]. Touches only lines
-- nobody and no rule has spoken for, and only ever as a suggestion.
create or replace function public.statement_ai_propose(p_import uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.statement_imports%rowtype; e jsonb; v_cat uuid; v_personal boolean; v_n integer := 0; v_c integer; v_personal_book boolean;
begin
  if auth.role() is distinct from 'service_role' and session_user <> 'postgres' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into i from public.statement_imports where id = p_import;
  if not found then return 0; end if;
  perform public.statement_lock(i.book_id);
  update public.statement_imports set suggested_at = now() where id = p_import;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return 0; end if;
  select b.kind in ('personal') into v_personal_book from public.books b where b.id = i.book_id;
  for e in select * from jsonb_array_elements(p_items) loop
    begin v_cat := nullif(e ->> 'category_id', '')::uuid; exception when others then v_cat := null; end;
    v_personal := v_personal_book and coalesce((e ->> 'personal') in ('true'), false);
    if v_cat is not null and not exists (select 1 from public.tax_categories c where c.id = v_cat and c.book_id = i.book_id and not c.is_archived) then v_cat := null; end if;
    continue when v_cat is null and not v_personal;
    update public.statement_lines set tax_category_id = case when v_personal then null else v_cat end, is_personal = v_personal, proposed_by = 'ai',
           ai_confidence = least(greatest(coalesce(nullif(e ->> 'confidence', '')::numeric, 0.5), 0), 1)
     where import_id = p_import and result is null and proposed_by is null and touched_by is null and payee_key = (e ->> 'key');
    get diagnostics v_c = row_count; v_n := v_n + v_c;
  end loop;
  return v_n;
end $$;
revoke all on function public.statement_ai_propose(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.statement_ai_propose(uuid, jsonb) to service_role;

-- ── 14. Splitting an entry already in the checkbook ─────────────────────────
-- p_parts: [{category_id, amount, memo}] adding up to the entry (or, for an
-- entry that is already split, to the whole payment). The entry becomes the
-- first part; the others are entered beside it.
create or replace function public.entry_split(p_tx uuid, p_parts jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transactions%rowtype; v_total numeric; v_parts jsonb; v_group uuid; e jsonb; n integer := 0; v_was text;
begin
  select * into t from public.transactions where id = p_tx for update;
  if not found or auth.uid() is null or t.book_id not in (select public.my_books_writable()) then raise exception 'You cannot change these books' using errcode = '42501'; end if;
  if t.is_archived then raise exception 'That entry has been removed' using errcode = 'P0001'; end if;
  if t.transfer_account is not null or t.scope is distinct from 'business' then raise exception 'A transfer or a personal entry cannot be split' using errcode = 'P0001'; end if;
  select sum(x.amount) into v_total from public.transactions x
   where x.book_id = t.book_id and not x.is_archived and coalesce(x.split_group, x.id) = coalesce(t.split_group, t.id);
  v_parts := public.statement_parts_ok(t.book_id, p_parts, v_total);
  if v_parts is null then raise exception 'A split needs between two and twelve parts' using errcode = '23514'; end if;
  v_was := coalesce(current_setting('prism.learning', true), 'on');
  perform set_config('prism.learning', 'off', true);
  v_group := coalesce(t.split_group, gen_random_uuid());
  if t.split_group is not null then
    delete from public.transactions x where x.book_id = t.book_id and x.split_group = t.split_group and x.id <> t.id;
  end if;
  for e in select * from jsonb_array_elements(v_parts) loop
    n := n + 1;
    if n = 1 then
      update public.transactions set amount = (e ->> 'amount')::numeric, tax_category_id = (e ->> 'category_id')::uuid, split_group = v_group,
             description = coalesce(nullif(e ->> 'memo', ''), description)
       where id = t.id;
    else
      insert into public.transactions (book_id, date, amount, scope, tax_category_id, account, payee, description, entered_via, external_id, import_batch_id,
                                       import_source, imported_at, statement_line_id, rule_id, contact_id, agent_id, closing_id, property_id, team_id,
                                       receipt_url, split_group)
      values (t.book_id, t.date, (e ->> 'amount')::numeric, 'business', (e ->> 'category_id')::uuid, t.account, t.payee, coalesce(nullif(e ->> 'memo', ''), t.description),
              t.entered_via, null, t.import_batch_id, t.import_source, t.imported_at, t.statement_line_id, t.rule_id, t.contact_id, t.agent_id,
              t.closing_id, t.property_id, t.team_id, t.receipt_url, v_group);
    end if;
  end loop;
  perform set_config('prism.learning', v_was, true);
  return v_group;
end $$;
revoke all on function public.entry_split(uuid, jsonb) from public, anon;
grant execute on function public.entry_split(uuid, jsonb) to authenticated;

-- ── 14b. A bank's file layout, remembered per set of books ──────────────────
-- "The first upload from a bank asks the user to confirm which column is
-- which. The layout is remembered, so the second upload asks nothing."
-- signature = the file's header row, tidied; mapping = which column is which.
create table if not exists public.statement_layouts (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books(id) on delete cascade,
  signature  text not null,
  account    text not null default '',
  mapping    jsonb not null,
  times_used integer not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists statement_layouts_one on public.statement_layouts (book_id, signature, lower(account));
alter table public.statement_layouts enable row level security;
revoke all on public.statement_layouts from public, anon, authenticated;
grant select on public.statement_layouts to authenticated;
drop policy if exists statement_layouts_read on public.statement_layouts;
create policy statement_layouts_read on public.statement_layouts for select to authenticated using (book_id in (select public.my_books_readable()));

create or replace function public.statement_layout_save(p_book uuid, p_signature text, p_account text, p_mapping jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or p_book is null or p_book not in (select public.my_books_writable()) then raise exception 'You cannot add to these books' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_signature, '')), '') is null or p_mapping is null or jsonb_typeof(p_mapping) <> 'object' or length(p_mapping::text) > 4000 then return; end if;
  insert into public.statement_layouts (book_id, signature, account, mapping, updated_by)
  values (p_book, left(btrim(p_signature), 1000), left(btrim(coalesce(p_account, '')), 120), p_mapping, auth.uid())
  on conflict (book_id, signature, lower(account)) do update
    set mapping = excluded.mapping, times_used = public.statement_layouts.times_used + 1, updated_by = auth.uid(), updated_at = now();
end $$;
revoke all on function public.statement_layout_save(uuid, text, text, jsonb) from public, anon;
grant execute on function public.statement_layout_save(uuid, text, text, jsonb) to authenticated;

-- ── 15. The model's spend on these is not about one client ──────────────────
do $$
declare d text;
begin
  select pg_get_functiondef('public.ai_fn_not_about_a_person(text)'::regprocedure) into d;
  if position('''read-statement''' in d) = 0 then
    if position('''parse-receipt'',' in d) = 0 then raise exception 'ai_fn_not_about_a_person has changed shape — add read-statement and suggest-categories by hand'; end if;
    execute replace(d, '''parse-receipt'',', '''parse-receipt'', ''read-statement'', ''suggest-categories'',');
  end if;
end $$;

-- ── 16. Two accounts Dara named (6 Oct 2026) ────────────────────────────────
-- "The Chase Sapphire card is a personal card; the x9577 card is the Realty ONE
-- Group Advantage card." Both were opened as bank accounts when first named on
-- an entry. Once: after this the kind is the person's own choice.
do $$ begin
  if to_regclass('public._applied_sql') is null or not exists (select 1 from public._applied_sql where file = '2026-10-06f_statements.sql') then
    begin
      update public.money_accounts m set kind = 'card', is_personal = (lower(btrim(m.name)) = 'chase sapphire'), updated_at = now()
       where m.book_id = 'a52f2330-04be-4900-af61-d9b83ca1e7b3'      -- Dara's own books
         and lower(btrim(m.name)) in ('chase sapphire', 'x9577');
    exception when others then
      raise notice 'The two cards were left as they are: %', sqlerrm;   -- e.g. the books are closed; set under Setup instead
    end;
  end if;
end $$;
