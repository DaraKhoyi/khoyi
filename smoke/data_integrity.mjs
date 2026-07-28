// Cross-table data-integrity sweep. Run anytime against live data to confirm no
// crash-shaped or orphaned records exist (the classes that broke the beta):
// string-where-array, null-where-required, orphaned refs, broken mirrors, stuck
// DISC folds. Read-only. Requires SUPABASE_URL + a management PAT via SUPA_PAT.
//
// Usage: SUPA_PAT=sbp_... node smoke/data_integrity.mjs
const PAT = process.env.SUPA_PAT;
const REF = process.env.SUPA_REF || 'xlgfspnojjgvkuitcoaf';
if (!PAT) { console.error('Set SUPA_PAT'); process.exit(2); }

const CHECKS = {
  'profiles stuck pending/0 (broken DISC)': "select count(*) n from public.profiles where analysis_status='pending' and coalesce(d_score,0)=0 and research_d_score is not null",
  'profiles non-array crash shapes': "select count(*) n from public.profiles where (research_overlaps is not null and jsonb_typeof(research_overlaps)!='array') or (research_sources is not null and jsonb_typeof(research_sources)!='array')",
  'contacts null name': "select count(*) n from public.contacts where name is null or name=''",
  'orphaned our_agent (not in roster)': "select count(*) n from public.contacts c where c.type='our_agent' and c.name not ilike '%dara khoyi%' and not exists (select 1 from public.agents a where a.user_id=c.user_id and (lower(a.email)=lower(c.email) or lower(a.name)=lower(c.name)))",
  'tasks null status': "select count(*) n from public.tasks where status is null",
  'notes null body': "select count(*) n from public.notes where body is null",
  'journal not mirrored': "select count(*) n from public.journal_entries j where not exists (select 1 from public.notes n where n.kind='journal' and n.id=j.id)",
  'recordings not mirrored': "select count(*) n from public.recordings r where not exists (select 1 from public.notes n where n.kind='recording' and n.id=r.id)",
  'transactions null amount': "select count(*) n from public.transactions where amount is null",
  'events null start_at': "select count(*) n from public.events where start_at is null",
};

async function run() {
  let dirty = 0;
  for (const [label, sql] of Object.entries(CHECKS)) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' },
      body: JSON.stringify({ query: sql }),
    });
    const j = await res.json().catch(() => null);
    const n = Array.isArray(j) && j[0] && 'n' in j[0] ? Number(j[0].n) : -1;
    if (n === 0) console.log(`  ✓ clean      ${label}`);
    else { console.log(`  ⚠️  ${n}        ${label}`); dirty++; }
  }
  console.log(dirty === 0 ? '\n✅ ALL CLEAN — no crash-shaped or orphaned data.' : `\n⚠️  ${dirty} issue(s) need attention.`);
  process.exit(dirty === 0 ? 0 : 1);
}
run();
