import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../dataService';

// ── GoogleContactsView ──────────────────────────────────────────────────────
// Browse the Google address book PrismOS has mirrored. This is a STAGING view:
// nothing here is a PrismOS contact until it is deliberately brought in. Google
// holds every airline confirmation address an agent ever replied to, and mixing
// that into a curated CRM has no clean undo.
//
// The job of this screen is to answer one question honestly — "what is in my
// Google contacts, and which of them does PrismOS already know?"

const G = '#CBA35C', CHAMP = '#EBCB82', GREEN = '#7fae8f';
const PAGE = 50;

const card = { background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:14 };
const eyebrow = { fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:G, fontSize:13 };
const fld = { width:'100%', boxSizing:'border-box', background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:9, color:'var(--text-1)', padding:'10px 12px', fontSize:14 };

const FILTERS = [
  { id:'all',     label:'All' },
  { id:'new',     label:'Not in PrismOS' },
  { id:'in',      label:'Already in PrismOS' },
];

function initials(n) {
  const t = (n || '?').trim().split(/\s+/);
  return ((t[0]?.[0] || '') + (t.length > 1 ? t[t.length - 1][0] : '')).toUpperCase() || '?';
}

export default function GoogleContactsView({ userId }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  const [counts, setCounts] = useState({ all:0, in:0, gone:0 });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState(null);
  const [syncState, setSyncState] = useState(null);

  const loadCounts = useCallback(async () => {
    const base = () => supabase.from('google_contacts').select('*', { count:'exact', head:true }).eq('user_id', userId);
    const [a, i, g] = await Promise.all([
      base(),
      base().not('contact_id', 'is', null),
      base().eq('deleted_in_google', true),
    ]);
    setCounts({ all: a.count || 0, in: i.count || 0, gone: g.count || 0 });
    const { data } = await supabase.from('google_contacts_sync').select('*').eq('user_id', userId).maybeSingle();
    setSyncState(data || null);
  }, [userId]);

  const load = useCallback(async () => {
    setLoading(true);
    let sel = supabase.from('google_contacts_view')
      .select('*', { count:'exact' })
      .eq('user_id', userId)
      .order('display_name', { ascending:true, nullsFirst:false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (filter === 'new') sel = sel.is('contact_id', null).eq('deleted_in_google', false);
    if (filter === 'in')  sel = sel.not('contact_id', 'is', null);
    const term = q.trim();
    if (term) {
      const esc = term.replace(/[%,]/g, ' ');
      sel = sel.or(`display_name.ilike.%${esc}%,primary_email.ilike.%${esc}%,primary_phone.ilike.%${esc}%`);
    }
    const { data, count, error } = await sel;
    setLoading(false);
    if (error) { setMsg({ ok:false, t:'Could not load: ' + error.message }); return; }
    setRows(data || []); setTotal(count ?? null);
  }, [userId, page, filter, q]);

  useEffect(() => { loadCounts(); }, [loadCounts]);
  // Debounced so typing does not fire a query per keystroke on a phone.
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(0); }, [q, filter]);

  const sync = async (full = false) => {
    setSyncing(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke('google-contacts-sync', {
      body: { user_id: userId, full },
    });
    setSyncing(false);
    if (error) { setMsg({ ok:false, t:'Sync failed: ' + error.message }); return; }
    if (!data?.ok) {
      // Named errors get a human sentence; anything else shows what Google said.
      const known = {
        NO_CONTACTS_ACCOUNT: 'No Google account has Contacts access yet. Settings → Connected Google Accounts → Connect Contacts.',
        REAUTH_REQUIRED: 'That Google account needs reconnecting in Settings.',
        PEOPLE_API_FORBIDDEN: 'Google refused the request — the People API is probably not enabled on the Cloud project yet.',
      };
      setMsg({ ok:false, t: known[data?.error] || data?.message || data?.error || 'Sync failed.' });
      return;
    }
    setMsg({ ok:true, t:`${data.seen} contact${data.seen === 1 ? '' : 's'} read from ${data.account}${data.auto_linked ? ` · ${data.auto_linked} matched to people already in PrismOS` : ''}${data.incremental ? ' · incremental' : ''}` });
    loadCounts(); load();
  };

  const pages = total != null ? Math.ceil(total / PAGE) : 1;
  const pct = counts.all ? Math.round((counts.in / counts.all) * 100) : 0;

  return (
    <div style={{ maxWidth: 860, margin:'0 auto', padding:'0 4px 40px' }}>
      <div style={{ marginBottom:6 }}><span style={eyebrow}>From Google</span></div>
      <h1 style={{ fontFamily:'Fraunces,serif', fontWeight:400, fontSize:32, color:'var(--text-1)', margin:'0 0 6px' }}>Google Contacts</h1>
      <p style={{ color:'var(--text-2)', fontSize:14.5, margin:'0 0 16px', maxWidth:'62ch', lineHeight:1.5 }}>
        A read-only mirror of your Google address book. Nothing here changes Google, and nothing
        becomes a PrismOS contact until you bring it in deliberately.
      </p>

      {/* status */}
      <div style={{ ...card, marginBottom:14 }}>
        <div style={{ display:'flex', flexWrap:'wrap', gap:14, alignItems:'baseline' }}>
          <div><div style={{ fontFamily:'Fraunces,serif', fontSize:26, color:'var(--text-1)' }}>{counts.all.toLocaleString()}</div>
            <div style={{ fontSize:10.5, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-3)', fontWeight:700 }}>in Google</div></div>
          <div><div style={{ fontFamily:'Fraunces,serif', fontSize:26, color:GREEN }}>{counts.in.toLocaleString()}</div>
            <div style={{ fontSize:10.5, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-3)', fontWeight:700 }}>already in Prism</div></div>
          <div><div style={{ fontFamily:'Fraunces,serif', fontSize:26, color:CHAMP }}>{Math.max(0, counts.all - counts.in).toLocaleString()}</div>
            <div style={{ fontSize:10.5, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-3)', fontWeight:700 }}>not yet</div></div>
          <span style={{ flex:1 }} />
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={() => sync(false)} disabled={syncing}
              style={{ background:CHAMP, color:'#100D09', border:'none', borderRadius:9, padding:'10px 18px', fontWeight:800, fontSize:14, cursor:'pointer', opacity:syncing?.6:1 }}>
              {syncing ? 'Syncing…' : counts.all ? 'Sync now' : 'Pull my contacts'}
            </button>
            {counts.all > 0 && (
              <button onClick={() => sync(true)} disabled={syncing}
                style={{ background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:9, padding:'10px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
                Full resync
              </button>
            )}
          </div>
        </div>
        {counts.all > 0 && (
          <div style={{ height:8, borderRadius:999, background:'var(--bg-base)', border:'1px solid var(--border)', marginTop:12, overflow:'hidden' }}>
            <div style={{ width:pct + '%', height:'100%', background:`linear-gradient(90deg, ${G}, ${CHAMP})` }} />
          </div>
        )}
        <div style={{ fontSize:11, color:'var(--text-3)', marginTop:8 }}>
          {syncState?.last_sync_at ? `Last synced ${new Date(syncState.last_sync_at).toLocaleString()}.` : 'Not synced yet.'}
          {counts.gone ? ` ${counts.gone} removed in Google (kept here, never deleted).` : ''}
        </div>
        {msg && (
          <div style={{ marginTop:10, fontSize:12.5, lineHeight:1.5, padding:'9px 11px', borderRadius:8,
            background: msg.ok ? 'rgba(127,174,143,.10)' : 'rgba(224,121,79,.10)',
            border: `1px solid ${msg.ok ? '#7fae8f' : '#e0794f'}`, color:'var(--text-1)' }}>{msg.t}</div>
        )}
      </div>

      {/* search + filter */}
      <input style={{ ...fld, marginBottom:10 }} value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search name, email or phone" />
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            style={{ padding:'7px 14px', borderRadius:100, cursor:'pointer', fontSize:13,
              fontWeight: filter === f.id ? 700 : 500,
              border:`1px solid ${filter === f.id ? G : 'var(--border)'}`,
              background: filter === f.id ? 'rgba(203,163,92,.15)' : 'transparent',
              color: filter === f.id ? G : 'var(--text-2)' }}>{f.label}</button>
        ))}
      </div>

      {/* list */}
      {loading && !rows.length ? <div style={{ color:'var(--text-3)' }}>Loading…</div>
        : !counts.all ? (
          <div style={{ border:'1px dashed var(--border)', borderRadius:12, padding:26, textAlign:'center', color:'var(--text-3)', fontSize:14, lineHeight:1.6 }}>
            Nothing pulled in yet. Connect Contacts in Settings, then tap <b style={{ color:'var(--text-2)' }}>Pull my contacts</b> above.
          </div>
        ) : !rows.length ? (
          <div style={{ color:'var(--text-3)', fontSize:14, padding:'18px 2px' }}>No matches.</div>
        ) : (
          <>
            {rows.map(r => (
              <div key={r.id} style={{ display:'flex', alignItems:'center', gap:12, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'11px 13px', marginBottom:8 }}>
                {r.photo_url
                  ? <img src={r.photo_url} alt="" loading="lazy" decoding="async" style={{ width:38, height:38, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
                  : <span style={{ width:38, height:38, borderRadius:'50%', background:'rgba(203,163,92,.12)', color:G, display:'grid', placeItems:'center', fontSize:13, fontWeight:800, flexShrink:0 }}>{initials(r.display_name)}</span>}
                <div style={{ flex:'1 1 0', minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14.5, color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {r.display_name || r.primary_email || 'Unnamed'}
                    {r.deleted_in_google && <span style={{ fontSize:10, color:'var(--text-3)', marginLeft:6 }}>· removed in Google</span>}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {[r.primary_email, r.primary_phone, (r.organizations || [])[0]?.name].filter(Boolean).join(' · ') || 'no email or phone'}
                  </div>
                </div>
                {r.in_prism
                  ? <span style={{ flexShrink:0, fontSize:10.5, fontWeight:800, letterSpacing:'.05em', color:GREEN, border:'1px solid #7fae8f', background:'rgba(127,174,143,.10)', borderRadius:999, padding:'3px 9px' }}>IN PRISM</span>
                  : <span style={{ flexShrink:0, fontSize:10.5, color:'var(--text-3)' }}>—</span>}
              </div>
            ))}
            {pages > 1 && (
              <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'center', marginTop:14 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 14px', fontSize:13, cursor:'pointer', opacity:page===0?.4:1 }}>‹ Prev</button>
                <span style={{ fontSize:12, color:'var(--text-3)' }}>{page + 1} of {pages}</span>
                <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
                  style={{ background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 14px', fontSize:13, cursor:'pointer', opacity:page>=pages-1?.4:1 }}>Next ›</button>
              </div>
            )}
          </>
        )}
    </div>
  );
}
