import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';

// ── GoogleContactsView ──────────────────────────────────────────────────────
// Browse the Google address book PrismOS mirrors, and bring people in one at a
// time. STAGING, not contacts: Google holds every airline confirmation address
// an agent ever replied to, and merging that into a curated CRM has no undo.
//
// Design notes that are load-bearing, not decoration:
//   · The three counts ARE the filters. A number you can read but not act on is
//     a dead end; every count here is a destination.
//   · Detail is a bottom sheet, not a new screen. Reviewing a queue means going
//     in and out dozens of times, and a full navigation each way makes that
//     work feel like work.
//   · Type is chosen BEFORE import. Asked afterwards it never gets set, and an
//     untyped contact is invisible to every playbook that follows.

const G = '#CBA35C', CHAMP = '#EBCB82', GREEN = '#7fae8f', INK = '#100D09';
const PAGE = 50;

const eyebrow = { fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:G, fontSize:13 };
const fld = { width:'100%', boxSizing:'border-box', background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:9, color:'var(--text-1)', padding:'10px 12px', fontSize:14 };
const lab = { display:'block', fontSize:10.5, fontWeight:700, letterSpacing:'.09em', textTransform:'uppercase', color:'var(--text-3)', margin:'0 0 5px' };

const initials = (n) => {
  const t = (n || '?').trim().split(/\s+/);
  return ((t[0]?.[0] || '') + (t.length > 1 ? t[t.length - 1][0] : '')).toUpperCase() || '?';
};
const fmtPhone = (d) => {
  const s = (d || '').replace(/[^0-9]/g, '');
  return s.length === 10 ? `(${s.slice(0,3)}) ${s.slice(3,6)}-${s.slice(6)}` : (d || '');
};

/* ── the three counts, which are also the filter ────────────────────────── */
const StatTile = React.memo(function StatTile({ label, value, color, active, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      style={{ flex:'1 1 96px', minWidth:0, textAlign:'left', cursor:'pointer',
        background: active ? 'rgba(203,163,92,.10)' : 'var(--bg-base)',
        border:`1px solid ${active ? G : 'var(--border)'}`, borderRadius:11, padding:'11px 12px',
        transition:'border-color .15s ease, background .15s ease' }}>
      <div style={{ fontFamily:'Fraunces,serif', fontSize:25, lineHeight:1.1, color }}>{(value ?? 0).toLocaleString()}</div>
      <div style={{ fontSize:10, letterSpacing:'.08em', textTransform:'uppercase', color: active ? G : 'var(--text-3)', fontWeight:700, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{label}</div>
    </button>
  );
});

/* ── detail sheet ───────────────────────────────────────────────────────── */
function DetailSheet({ row, types, onClose, onImported, notify }) {
  const [type, setType] = useState('lead');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    setName(row.display_name || '');
    setEmail(row.primary_email || '');
    setPhone(row.primary_phone || '');
    setType('lead');
  }, [row]);

  if (!row) return null;
  const emails = row.emails || [], phones = row.phones || [], orgs = row.organizations || [];

  const doImport = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('import_google_contact', {
      p_gc_id: row.id, p_type: type, p_name: name, p_email: email, p_phone: phone, p_notes: null,
    });
    setBusy(false);
    if (error || !data || !data.ok) { notify && notify(false, 'Could not import: ' + ((error && error.message) || (data && data.error) || 'unknown')); return; }
    notify && notify(true, data.already ? `${name} was already in PrismOS.` : `${name} added to PrismOS.`);
    onImported && onImported(row.id, data.contact_id);
    onClose();
  };

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:6000, background:'rgba(6,6,8,.62)', display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width:'100%', maxWidth:560, maxHeight:'88vh', overflowY:'auto',
          background:'var(--bg-card)', borderTop:`2px solid ${G}`,
          borderRadius:'16px 16px 0 0', padding:'16px 16px max(18px, env(safe-area-inset-bottom))' }}>

        <div style={{ width:38, height:4, borderRadius:2, background:'var(--border)', margin:'0 auto 14px' }} />

        <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:14 }}>
          {row.photo_url
            ? <img src={row.photo_url} alt="" loading="lazy" decoding="async" style={{ width:52, height:52, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
            : <span style={{ width:52, height:52, borderRadius:'50%', background:'rgba(203,163,92,.12)', color:G, display:'grid', placeItems:'center', fontSize:17, fontWeight:800, flexShrink:0 }}>{initials(row.display_name)}</span>}
          <div style={{ flex:'1 1 0', minWidth:0 }}>
            <div style={{ fontFamily:'Fraunces,serif', fontSize:22, color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis' }}>{row.display_name || 'Unnamed'}</div>
            {orgs[0] && <div style={{ fontSize:12.5, color:'var(--text-3)' }}>{[orgs[0].title, orgs[0].name].filter(Boolean).join(' \u00B7 ')}</div>}
          </div>
          {row.in_prism && <span style={{ flexShrink:0, fontSize:10, fontWeight:800, color:GREEN, border:'1px solid #7fae8f', background:'rgba(127,174,143,.10)', borderRadius:999, padding:'3px 9px' }}>IN PRISM</span>}
        </div>

        {/* everything Google holds, not just the primary */}
        <div style={{ borderTop:'1px solid var(--border)', paddingTop:12 }}>
          {emails.length > 0 && <div style={{ marginBottom:10 }}>
            <div style={lab}>Email{emails.length > 1 ? ` (${emails.length})` : ''}</div>
            {emails.map((e, i) => <div key={i} style={{ fontSize:13.5, color:'var(--text-1)', marginBottom:3, wordBreak:'break-all' }}>
              {e.value}{e.type ? <span style={{ color:'var(--text-3)', fontSize:11 }}> {'\u00B7'} {e.type}</span> : null}</div>)}
          </div>}
          {phones.length > 0 && <div style={{ marginBottom:10 }}>
            <div style={lab}>Phone{phones.length > 1 ? ` (${phones.length})` : ''}</div>
            {phones.map((p, i) => <div key={i} style={{ fontSize:13.5, color:'var(--text-1)', marginBottom:3 }}>
              {fmtPhone(p.value)}{p.type ? <span style={{ color:'var(--text-3)', fontSize:11 }}> {'\u00B7'} {p.type}</span> : null}</div>)}
          </div>}
          {!emails.length && !phones.length &&
            <div style={{ fontSize:12.5, color:'var(--text-3)', marginBottom:10 }}>Google has no email or phone for this person.</div>}
          {row.deleted_in_google &&
            <div style={{ fontSize:12, color:'#e0794f', marginBottom:10 }}>Removed in Google. Kept here {'\u2014'} never deleted.</div>}
        </div>

        {row.in_prism ? (
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:2 }}>
            <div style={{ fontSize:13, color:'var(--text-2)', lineHeight:1.5 }}>
              Already in PrismOS as <b style={{ color:'var(--text-1)' }}>{row.prism_name}</b>
              {row.prism_type ? <span style={{ color:'var(--text-3)' }}> {'\u00B7'} {row.prism_type}</span> : null}.
            </div>
            <button onClick={onClose} style={{ marginTop:12, width:'100%', background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:9, padding:'12px', fontSize:14, fontWeight:700, cursor:'pointer' }}>Close</button>
          </div>
        ) : (
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:2 }}>
            <div style={{ ...eyebrow, fontSize:11, marginBottom:10 }}>Bring into PrismOS</div>
            <div style={{ marginBottom:10 }}>
              <label style={lab}>Name</label>
              <input style={fld} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10, marginBottom:10 }}>
              <div><label style={lab}>Email</label>
                <input style={fld} value={email} onChange={e => setEmail(e.target.value)} inputMode="email" /></div>
              <div><label style={lab}>Phone</label>
                <input style={fld} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" /></div>
            </div>
            <label style={lab}>Type</label>
            <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:14 }}>
              {types.map(t => (
                <button key={t.id} onClick={() => setType(t.id)}
                  style={{ padding:'7px 13px', borderRadius:100, cursor:'pointer', fontSize:12.5,
                    fontWeight: type === t.id ? 700 : 500,
                    border:`1px solid ${type === t.id ? G : 'var(--border)'}`,
                    background: type === t.id ? 'rgba(203,163,92,.15)' : 'transparent',
                    color: type === t.id ? G : 'var(--text-2)' }}>
                  {t.icon ? t.icon + ' ' : ''}{t.label}
                </button>
              ))}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={onClose} style={{ flex:'1 1 90px', background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:9, padding:'12px', fontSize:14, cursor:'pointer' }}>Cancel</button>
              <button onClick={doImport} disabled={busy}
                style={{ flex:'2 1 170px', background:CHAMP, color:INK, border:'none', borderRadius:9, padding:'12px', fontSize:14.5, fontWeight:800, cursor:'pointer', opacity:busy ? .6 : 1 }}>
                {busy ? 'Adding\u2026' : 'Add to PrismOS'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── main ───────────────────────────────────────────────────────────────── */
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
  const [types, setTypes] = useState([]);
  const [open, setOpen] = useState(null);
  const [target, setTarget] = useState(5);
  const [savingTarget, setSavingTarget] = useState(false);
  const firstTarget = useRef(true);

  const notify = useCallback((ok, t) => { setMsg({ ok, t }); setTimeout(() => setMsg(null), 5000); }, []);

  const loadMeta = useCallback(async () => {
    const base = () => supabase.from('google_contacts').select('*', { count:'exact', head:true }).eq('user_id', userId);
    const [a, i, g] = await Promise.all([base(), base().not('contact_id','is',null), base().eq('deleted_in_google', true)]);
    setCounts({ all:a.count || 0, in:i.count || 0, gone:g.count || 0 });
    const [ss, ts, us] = await Promise.all([
      supabase.from('google_contacts_sync').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('contact_types').select('id,label,icon,sort_order').eq('is_active', true).order('sort_order'),
      supabase.from('user_settings').select('google_daily_target').eq('user_id', userId).maybeSingle(),
    ]);
    setSyncState(ss.data || null);
    setTypes(ts.data || []);
    if (us.data && us.data.google_daily_target) setTarget(us.data.google_daily_target);
  }, [userId]);

  const load = useCallback(async () => {
    setLoading(true);
    let sel = supabase.from('google_contacts_view').select('*', { count:'exact' })
      .eq('user_id', userId).order('display_name', { ascending:true, nullsFirst:false })
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
    if (error) { notify(false, 'Could not load: ' + error.message); return; }
    setRows(data || []); setTotal(count == null ? null : count);
  }, [userId, page, filter, q, notify]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  useEffect(() => { setPage(0); }, [q, filter]);

  // Debounced so holding the stepper does not write on every increment.
  useEffect(() => {
    if (firstTarget.current) { firstTarget.current = false; return; }
    setSavingTarget(true);
    const t = setTimeout(async () => {
      await supabase.from('user_settings').update({ google_daily_target: target }).eq('user_id', userId);
      setSavingTarget(false);
    }, 700);
    return () => clearTimeout(t);
  }, [target, userId]);

  const sync = async (full) => {
    setSyncing(true); setMsg(null);
    const { data, error } = await supabase.functions.invoke('google-contacts-sync', { body:{ user_id:userId, full: !!full } });
    setSyncing(false);
    if (error) { notify(false, 'Sync failed: ' + error.message); return; }
    if (!data || !data.ok) {
      const known = {
        NO_CONTACTS_ACCOUNT:'No Google account has Contacts access yet. Settings \u2192 Connected Google Accounts \u2192 Connect Contacts.',
        REAUTH_REQUIRED:'That Google account needs reconnecting in Settings.',
        PEOPLE_API_FORBIDDEN:'Google refused the request \u2014 the People API is probably not enabled on the Cloud project yet.',
      };
      notify(false, known[data && data.error] || (data && data.message) || (data && data.error) || 'Sync failed.');
      return;
    }
    notify(true, `${data.seen} read from ${data.account}${data.auto_linked ? ` \u00B7 ${data.auto_linked} matched to people already in PrismOS` : ''}${data.incremental ? ' \u00B7 incremental' : ''}`);
    loadMeta(); load();
  };

  // Optimistic: the row flips to IN PRISM immediately. Reviewing a long queue
  // with a round trip between every tap is what makes people stop reviewing.
  const onImported = useCallback((gcId, contactId) => {
    setRows(rs => rs.map(r => r.id === gcId ? { ...r, contact_id: contactId, in_prism: true } : r));
    setCounts(c => ({ ...c, in: c.in + 1 }));
  }, []);

  const quickImport = async (r) => {
    const { data, error } = await supabase.rpc('import_google_contact', {
      p_gc_id:r.id, p_type:'lead', p_name:r.display_name, p_email:r.primary_email, p_phone:r.primary_phone, p_notes:null,
    });
    if (error || !data || !data.ok) { notify(false, 'Could not import: ' + ((error && error.message) || (data && data.error))); return; }
    notify(true, `${r.display_name || 'Contact'} added as a Lead \u2014 open it to change the type.`);
    onImported(r.id, data.contact_id);
  };

  const pages = total == null ? 1 : Math.ceil(total / PAGE);
  const notYet = Math.max(0, counts.all - counts.in);
  const days = target > 0 ? Math.ceil(notYet / target) : 0;

  return (
    <div style={{ maxWidth:860, margin:'0 auto', padding:'0 4px 40px' }}>
      <div style={{ marginBottom:6 }}><span style={eyebrow}>From Google</span></div>
      <h1 style={{ fontFamily:'Fraunces,serif', fontWeight:400, fontSize:32, color:'var(--text-1)', margin:'0 0 6px' }}>Google Contacts</h1>
      <p style={{ color:'var(--text-2)', fontSize:14.5, margin:'0 0 16px', maxWidth:'62ch', lineHeight:1.5 }}>
        A read-only mirror of your Google address book. Nothing here changes Google, and nothing becomes
        a PrismOS contact until you bring it in.
      </p>

      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:14, marginBottom:14 }}>
        <div style={{ display:'flex', gap:8, marginBottom:12 }}>
          <StatTile label="in Google"        value={counts.all} color="var(--text-1)" active={filter==='all'} onClick={() => setFilter('all')} />
          <StatTile label="already in Prism" value={counts.in}  color={GREEN}         active={filter==='in'}  onClick={() => setFilter('in')} />
          <StatTile label="not yet"          value={notYet}     color={CHAMP}         active={filter==='new'} onClick={() => setFilter('new')} />
        </div>

        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={() => sync(false)} disabled={syncing}
            style={{ background:CHAMP, color:INK, border:'none', borderRadius:9, padding:'10px 18px', fontWeight:800, fontSize:14, cursor:'pointer', opacity:syncing ? .6 : 1 }}>
            {syncing ? 'Syncing\u2026' : counts.all ? 'Sync now' : 'Pull my contacts'}
          </button>
          {counts.all > 0 && (
            <button onClick={() => sync(true)} disabled={syncing}
              style={{ background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:9, padding:'10px 14px', fontSize:13, fontWeight:700, cursor:'pointer' }}>
              Full resync
            </button>
          )}
        </div>

        {/* daily pace — the number and its consequence side by side, because a
            target without its consequence is just a guess */}
        <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:13, color:'var(--text-2)' }}>Review</span>
            <div style={{ display:'inline-flex', alignItems:'center', border:'1px solid var(--border)', borderRadius:9, overflow:'hidden' }}>
              <button onClick={() => setTarget(t => Math.max(1, t - 1))} aria-label="fewer per day"
                style={{ background:'var(--bg-base)', border:'none', color:'var(--text-2)', width:34, height:34, fontSize:17, cursor:'pointer' }}>{'\u2212'}</button>
              <input value={target} inputMode="numeric" aria-label="contacts per day"
                onChange={e => { const n = parseInt(e.target.value.replace(/[^0-9]/g,''), 10); setTarget(isFinite(n) ? Math.min(100, Math.max(1, n)) : 1); }}
                style={{ width:48, textAlign:'center', background:'transparent', border:'none', borderLeft:'1px solid var(--border)', borderRight:'1px solid var(--border)', color:G, fontSize:16, fontWeight:800, padding:'7px 0' }} />
              <button onClick={() => setTarget(t => Math.min(100, t + 1))} aria-label="more per day"
                style={{ background:'var(--bg-base)', border:'none', color:'var(--text-2)', width:34, height:34, fontSize:17, cursor:'pointer' }}>+</button>
            </div>
            <span style={{ fontSize:13, color:'var(--text-2)' }}>a day</span>
            {savingTarget && <span style={{ fontSize:11, color:'var(--text-3)' }}>{'saving\u2026'}</span>}
          </div>
          {notYet > 0 && (
            <div style={{ fontSize:11.5, color:'var(--text-3)', marginTop:7, lineHeight:1.5 }}>
              {notYet.toLocaleString()} left {'\u2192'} <b style={{ color: days > 180 ? '#e0794f' : 'var(--text-2)' }}>
                {days <= 1 ? 'done today' : days < 60 ? `about ${days} days` : days < 400 ? `about ${Math.round(days/30)} months` : `about ${(days/365).toFixed(1)} years`}
              </b> at this pace.
              {days > 180 && <span> That is a long queue {'\u2014'} a bigger daily number, or letting PrismOS rank the highest-value people first, will matter more than working alphabetically.</span>}
            </div>
          )}
        </div>

        <div style={{ fontSize:11, color:'var(--text-3)', marginTop:10 }}>
          {syncState && syncState.last_sync_at ? `Last synced ${new Date(syncState.last_sync_at).toLocaleString()}.` : 'Not synced yet.'}
          {counts.gone ? ` ${counts.gone} removed in Google (kept here).` : ''}
        </div>
        {msg && (
          <div style={{ marginTop:10, fontSize:12.5, lineHeight:1.5, padding:'9px 11px', borderRadius:8,
            background: msg.ok ? 'rgba(127,174,143,.10)' : 'rgba(224,121,79,.10)',
            border:`1px solid ${msg.ok ? '#7fae8f' : '#e0794f'}`, color:'var(--text-1)' }}>{msg.t}</div>
        )}
      </div>

      <input style={{ ...fld, marginBottom:14 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email or phone" />

      {loading && !rows.length ? <div style={{ color:'var(--text-3)' }}>Loading{'\u2026'}</div>
        : !counts.all ? (
          <div style={{ border:'1px dashed var(--border)', borderRadius:12, padding:26, textAlign:'center', color:'var(--text-3)', fontSize:14, lineHeight:1.6 }}>
            Nothing pulled in yet. Tap <b style={{ color:'var(--text-2)' }}>Pull my contacts</b> above.
          </div>
        ) : !rows.length ? <div style={{ color:'var(--text-3)', fontSize:14, padding:'18px 2px' }}>No matches.</div>
        : (
          <>
            {rows.map(r => (
              <div key={r.id} onClick={() => setOpen(r)}
                style={{ display:'flex', alignItems:'center', gap:11, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'10px 12px', marginBottom:8, cursor:'pointer' }}>
                {r.photo_url
                  ? <img src={r.photo_url} alt="" loading="lazy" decoding="async" style={{ width:38, height:38, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
                  : <span style={{ width:38, height:38, borderRadius:'50%', background:'rgba(203,163,92,.12)', color:G, display:'grid', placeItems:'center', fontSize:13, fontWeight:800, flexShrink:0 }}>{initials(r.display_name)}</span>}
                <div style={{ flex:'1 1 0', minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14.5, color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {r.display_name || r.primary_email || 'Unnamed'}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {[r.primary_email, fmtPhone(r.primary_phone), (r.organizations || [])[0] && (r.organizations || [])[0].name].filter(Boolean).join(' \u00B7 ') || 'no email or phone'}
                  </div>
                </div>
                {r.in_prism
                  ? <span style={{ flexShrink:0, fontSize:10, fontWeight:800, color:GREEN, border:'1px solid #7fae8f', background:'rgba(127,174,143,.10)', borderRadius:999, padding:'3px 8px' }}>IN PRISM</span>
                  : <button onClick={e => { e.stopPropagation(); quickImport(r); }}
                      style={{ flexShrink:0, background:'rgba(203,163,92,.12)', border:`1px solid ${G}`, color:G, borderRadius:999, padding:'5px 12px', fontSize:12, fontWeight:800, cursor:'pointer' }}>+ Add</button>}
              </div>
            ))}
            {pages > 1 && (
              <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'center', marginTop:14 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 14px', fontSize:13, cursor:'pointer', opacity:page===0?.4:1 }}>{'\u2039'} Prev</button>
                <span style={{ fontSize:12, color:'var(--text-3)' }}>{page + 1} of {pages}</span>
                <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
                  style={{ background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 14px', fontSize:13, cursor:'pointer', opacity:page>=pages-1?.4:1 }}>Next {'\u203A'}</button>
              </div>
            )}
          </>
        )}

      <DetailSheet row={open} types={types} onClose={() => setOpen(null)} onImported={onImported} notify={notify} />
    </div>
  );
}
