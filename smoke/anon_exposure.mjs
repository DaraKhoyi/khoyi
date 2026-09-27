// anon_exposure.mjs — what can a stranger read with only the public anon key?
//
// The anon key ships inside the web app, so anyone can hold it. On 27 Sep, by
// calling every database function exactly as a stranger would, five were found
// handing out real data: speed_to_lead (every agent's response record),
// beta_proof_metrics (testers' names, emails and activity), brokerage_metrics
// (YTD commission $2.2M, deals, volume, commission rate), and the company
// average commission rate and sale price. pg_stat_statements since 1 Aug showed
// no legitimate anonymous caller of any of them. All were closed.
//
// This repeats that sweep on every gate run. It lists every function the API
// serves from the OpenAPI description (Supabase only hands that description to
// the service key — it 401s for anon), then calls each AS ANON with
// GET — PostgREST runs every GET inside a READ ONLY transaction, so even a
// function that would update rows cannot write anything here. A function "leaks" when its answer carries data: a
// non-empty string, a non-zero number or a true, anywhere in it. Refusals like
// {"allowed": false} or {"total": 0, "people": []} carry none and pass.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY (the service key
// only reads the list; every call is made with the anon key). BLOCKS.
// Genuinely public data (none today) goes in PUBLIC with the reason.
//
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node smoke/anon_exposure.mjs

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.log('==== ANON EXPOSURE: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY ====');
  process.exit(1);
}
const PUBLIC = {
  // 'function_name': 'why it is fine for anyone on the internet to read this',
  today_ny: "today's date in New York — the same for everyone, no data",
  show_limit: 'a pg_trgm extension setting (similarity threshold), no data',
};
// Status words, not data: a refusal ({"error": "not signed in"}) or a bare
// {"ok": true, "filled": 0} tells a stranger nothing about the business.
const STATUS_KEYS = new Set(['ok', 'error', 'message', 'hint', 'detail', 'code']);

const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };
const spec = await fetch(`${URL}/rest/v1/`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Accept: 'application/openapi+json' },
}).then((r) => r.json()).catch(() => null);
if (!spec || !spec.paths) {
  console.log('==== ANON EXPOSURE: FAILED — could not read the API description ====');
  process.exit(1);
}
const rpcs = Object.keys(spec.paths).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5));

const carriesData = (v) => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v === true;
  if (Array.isArray(v)) return v.some(carriesData);
  if (typeof v === 'object') return Object.entries(v).some(([k, x]) => !STATUS_KEYS.has(k) && carriesData(x));
  return false;
};

const leaks = [];
let called = 0;
const pool = [...rpcs];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (pool.length) {
    const fn = pool.shift();
    let r;
    try { r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { headers: H }); } catch { continue; }
    if (!r.ok) continue;                      // needs arguments, refused, or not read-only
    called++;
    const body = await r.json().catch(() => null);
    if (PUBLIC[fn]) continue;
    if (carriesData(body)) leaks.push(`${fn} -> ${JSON.stringify(body).slice(0, 120)}`);
  }
}));

if (!leaks.length) {
  console.log(`==== ANON EXPOSURE: clean — ${rpcs.length} functions exposed, ${called} callable read-only with no arguments, none hands a stranger any data ====`);
  process.exit(0);
}
console.log(`==== ANON EXPOSURE: ${leaks.length} function(s) hand data to ANYONE with the public key ====`);
for (const l of leaks.sort()) console.log('  ✗ ' + l);
console.log('  Fix: revoke execute from public, anon (and authenticated if agents should not see it), or');
console.log('  gate inside on is_brokerage_staff() / auth.role() = \'service_role\'. Never "auth.uid() is null" —');
console.log('  an anonymous caller satisfies that too. Genuinely public? Add to PUBLIC with the reason.');
process.exit(1);
