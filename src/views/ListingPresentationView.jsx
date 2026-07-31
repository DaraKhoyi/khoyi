import React, { useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '../dataService';
import { CONDITION_SCALE, conditionFor, buildPresentationHTML, reconcileValuation } from '../listingPresentation';
import { TipFor } from '../App';

const G = '#CBA35C', CHAMP = '#EBCB82', INK = '#100D09';
const money = (n) => (n || n === 0) ? '$' + Number(n).toLocaleString('en-US') : '';

// Upload an image File to the public listing-photos bucket, return its public URL.
// Path is {user_id}/{presentation-ish}/{uuid}.ext so RLS (own-folder write) holds.
async function uploadListingPhoto(file, userId) {
  if (!file) throw new Error('No file');
  if (!file.type?.startsWith('image/')) throw new Error('That file isn’t an image');
  if (file.size > 10 * 1024 * 1024) throw new Error('Image is over 10MB — try a smaller one');
  const ext = (file.name?.split('.').pop() || file.type.split('/')[1] || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const key = `${userId}/${(crypto.randomUUID?.() || Math.random().toString(36).slice(2))}.${ext}`;
  const { error } = await supabase.storage.from('listing-photos').upload(key, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('listing-photos').getPublicUrl(key);
  return data.publicUrl;
}

// Natural photo management: thumbnails + Browse / Camera / Paste. No URL typing.
function PhotoUploader({ photos, hero, userId, onChange, onSetHero, notify }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = React.useRef(null);
  const camRef = React.useRef(null);
  const list = Array.isArray(photos) ? photos : [];

  const addFiles = useCallback(async (files) => {
    const imgs = Array.from(files || []).filter(f => f.type?.startsWith('image/'));
    if (!imgs.length) { notify?.('No images found to add', 'warn'); return; }
    setBusy(true);
    const added = [];
    for (const f of imgs) {
      try { added.push(await uploadListingPhoto(f, userId)); }
      catch (e) { notify?.('Upload failed: ' + (e.message || e), 'error'); }
    }
    if (added.length) {
      const next = [...list, ...added];
      onChange(next);
      if (!hero && added[0]) onSetHero?.(added[0]);   // first photo becomes the hero
      notify?.(`${added.length} photo${added.length > 1 ? 's' : ''} added`, 'success');
    }
    setBusy(false);
  }, [list, hero, userId, onChange, onSetHero, notify]);

  // Paste an image straight from the clipboard.
  const onPaste = useCallback((e) => {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items) { if (it.type?.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); } }
    if (files.length) { e.preventDefault(); addFiles(files); }
  }, [addFiles]);

  const removeAt = (i) => {
    const url = list[i];
    const next = list.filter((_, j) => j !== i);
    onChange(next);
    if (hero === url) onSetHero?.(next[0] || '');
  };

  const btn = { display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:999, border:'1px solid var(--border)', background:'var(--bg-1,#100D09)', color:'var(--text-1)', fontSize:13, fontWeight:700, cursor:'pointer' };

  return (
    <div>
      <label style={lab}>Property photos <span style={{ textTransform:'none', letterSpacing:0, color:'var(--text-3)', fontWeight:500 }}>— optional. The first photo becomes the cover.</span></label>
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer?.files); }}
        onPaste={onPaste}
        tabIndex={0}
        style={{ border:`1.5px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`, borderRadius:12, padding:14, background: drag ? 'rgba(203,163,92,.06)' : 'transparent', transition:'all .15s' }}
      >
        {list.length ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(84px,1fr))', gap:8, marginBottom:12 }}>
            {list.map((url, i) => (
              <div key={url + i} style={{ position:'relative', aspectRatio:'4/3', borderRadius:8, overflow:'hidden', border: hero === url ? '2px solid var(--accent)' : '1px solid var(--border)', backgroundImage:`url('${url}')`, backgroundSize:'cover', backgroundPosition:'center' }}>
                {hero === url && <span style={{ position:'absolute', top:3, left:3, fontSize:9, fontWeight:800, letterSpacing:'.05em', background:'var(--accent)', color:'#100D09', padding:'1px 5px', borderRadius:4 }}>COVER</span>}
                <button type="button" onClick={() => removeAt(i)} title="Remove" style={{ position:'absolute', top:3, right:3, width:20, height:20, borderRadius:'50%', border:'none', background:'rgba(16,13,9,.72)', color:'#fff', fontSize:13, lineHeight:'20px', cursor:'pointer', padding:0 }}>×</button>
                {hero !== url && <button type="button" onClick={() => onSetHero?.(url)} title="Make cover" style={{ position:'absolute', bottom:3, left:3, fontSize:9, fontWeight:700, background:'rgba(16,13,9,.72)', color:'#fff', border:'none', borderRadius:4, padding:'2px 5px', cursor:'pointer' }}>Set cover</button>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign:'center', color:'var(--text-3)', fontSize:12.5, padding:'6px 0 12px' }}>Drag photos here, paste from clipboard, or use the buttons below.</div>
        )}
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          <button type="button" style={btn} disabled={busy} onClick={() => fileRef.current?.click()}>🖼️ Browse</button>
          <button type="button" style={btn} disabled={busy} onClick={() => camRef.current?.click()}>📷 Camera</button>
          <span style={{ ...btn, cursor:'default', color:'var(--text-3)', fontWeight:500 }}>⌘/Ctrl+V to paste</span>
          {busy && <span style={{ alignSelf:'center', color:'var(--accent)', fontSize:12.5, fontWeight:700 }}>Uploading…</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}
const token = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 22);
const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
};

export default function ListingPresentationView({ userId, agentName }) {
  const [list, setList] = useState(null);
  const [mode, setMode] = useState('list');   // list | edit
  const [editing, setEditing] = useState(null);
  const [notify, setNotify] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('listing_presentations').select('*').eq('user_id', userId).order('updated_at', { ascending: false });
    setList(data || []);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const blank = () => ({
    title: '', address: '', contact_id: null, deal_id: null, seller_tone: 'auto',
    seller_name: '', hero_image_url: '', agent_video_url: '', photos: [],
    subject: { gla:'', beds:'', baths:'', lot_size:'', year_built:'', condition_score:7, upgrades:'', hidden_changes:'', motivation:'', last_sold_price:'' },
    market: { speed:55, moi:'', list_to_sale:'', active:'', pending:'', closed:'', annual_appreciation_pct:'', ppsf:'' },
    comps: [{ address:'', sale_price:'', gla:'', adjustments:[] }],
    tiers: { opportunistic:'', target:'', fast:'' },
    netsheet: { commission_pct:6, mortgage_payoff:'', title_fees:'', tax_proration:'', other:'',
      units: { commission:'pct', title_fees:'pct', tax_proration:'usd', mortgage_payoff:'usd', other:'usd' } },
  });

  const flash = (t, ok=true) => { setNotify({ t, ok }); setTimeout(()=>setNotify(null), 4000); };

  if (mode === 'edit') return <Editor initial={editing} userId={userId} agentName={agentName} onDone={()=>{setMode('list');load();}} onCancel={()=>setMode('list')} flash={flash} notify={notify} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 4px 40px' }}>
      <TipFor screen="listing_presentation" />
      {notify && <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', zIndex:5000, background: notify.ok?'#1a3a2a':'#3a1a1a', border:`1px solid ${notify.ok?'#7fae8f':'#e0794f'}`, color:'#fff', padding:'12px 18px', borderRadius:10, fontSize:14, maxWidth:'90vw' }}>{notify.t}</div>}
      <div style={{ marginBottom: 6 }}><span style={{ fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:G, fontSize:13 }}>Win the listing</span></div>
      <h1 style={{ fontFamily:'Fraunces,serif', fontWeight:400, fontSize:34, color:'var(--text-1)', margin:'0 0 6px' }}>Listing Presentations</h1>
      <p style={{ color:'var(--text-2)', fontSize:15, margin:'0 0 20px', maxWidth:'62ch' }}>Turn an address into an executive, DISC-aware valuation dossier — pricing, comps, a launch plan, and a live net-sheet — as a branded web presentation you can present, email, or share with the seller.</p>
      <button onClick={()=>{ setEditing(blank()); setMode('edit'); }} style={{ background:CHAMP, color:INK, border:'none', borderRadius:10, padding:'13px 22px', fontWeight:800, fontSize:15, cursor:'pointer' }}>+ New Listing Presentation</button>

      <div style={{ marginTop: 28 }}>
        {list === null ? <div style={{ color:'var(--text-3)' }}>Loading…</div>
         : list.length === 0 ? <div style={{ color:'var(--text-3)', fontSize:14, border:'1px dashed var(--border)', borderRadius:12, padding:'26px', textAlign:'center' }}>No presentations yet. Build your first one — it takes about five minutes.</div>
         : list.map(p => (
            <div key={p.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px', marginBottom:10 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontWeight:700, color:'var(--text-1)', fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title || p.address || 'Untitled presentation'}</div>
                <div style={{ fontSize:12, color:'var(--text-3)', marginTop:2 }}>
                  {conditionFor(p.subject?.condition_score).n}/10 · {conditionFor(p.subject?.condition_score).label}
                  {p.tiers?.target ? ` · target ${money(p.tiers.target)}` : ''}
                  {p.share_enabled ? ' · 🔗 shared' : ''}
                  {p.view_count ? ` · ${p.view_count} views` : ''}
                </div>
                {p.last_viewed_at && <div style={{ fontSize:12, color:'#7fae8f', marginTop:3, fontWeight:600 }}>👁 Seller viewed {timeAgo(p.last_viewed_at)}</div>}
                {p.signed_at && <div style={{ fontSize:12, color:CHAMP, marginTop:3, fontWeight:700 }}>✍️ Signed {timeAgo(p.signed_at)}{p.signature?.name ? ` by ${p.signature.name}` : ''}</div>}
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                <button onClick={()=>{ setEditing(p); setMode('edit'); }} style={btnGhost}>Open</button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

const btnGhost = { background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' };
const fld = { width:'100%', boxSizing:'border-box', background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:9, color:'var(--text-1)', padding:'10px 12px', fontSize:14 };
const lab = { display:'block', fontSize:11, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-3)', margin:'0 0 6px' };
const eyebrow = { fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.16em', textTransform:'uppercase', color:G, fontSize:12, margin:'22px 0 10px' };

function Editor({ initial, userId, agentName, onDone, onCancel, flash, notify }) {
  // Backfill net-sheet units for presentations saved before the %/$ toggle existed:
  // old flat fields were dollar amounts, commission was always a percent.
  const withUnits = (init) => {
    const ns = init.netsheet || {};
    if (!ns.units) return { ...init, netsheet: { ...ns, units: { commission:'pct', title_fees:'usd', tax_proration:'usd', mortgage_payoff:'usd', other:'usd' } } };
    return init;
  };
  const [p, setP] = useState(() => withUnits(initial));
  const setUnit = (field, unit) => setP(prev => ({ ...prev, netsheet: { ...prev.netsheet, units: { ...(prev.netsheet.units||{}), [field]: unit } } }));
  const [researching, setResearching] = useState(false);
  const runResearch = async () => {
    const addr = (p.address || '').trim();
    if (!addr) { flash('Enter the property address first.', false); return; }
    setResearching(true);
    try {
      const hint = [p.subject?.beds && `${p.subject.beds} bed`, p.subject?.baths && `${p.subject.baths} bath`, p.subject?.gla && `${p.subject.gla} sqft`].filter(Boolean).join(', ');
      const { data, error } = await supabase.functions.invoke('property-research', { body: { user_id: userId, address: addr, subject_hint: hint } });
      if (error || !data?.ok) { flash('Research came up empty — try again, or enter the numbers by hand below.', false); setResearching(false); return; }
      const r = data.data;
      setP(prev => {
        const next = { ...prev };
        // Subject: only fill blanks — never overwrite what the agent already typed.
        next.subject = { ...prev.subject };
        for (const k of ['gla','beds','baths','lot_size','year_built']) {
          if ((prev.subject?.[k] === '' || prev.subject?.[k] == null) && r.subject?.[k] != null) next.subject[k] = r.subject[k];
        }
        // Market: fill blanks + set speed.
        next.market = { ...prev.market };
        if (r.market?.speed != null) next.market.speed = r.market.speed;
        for (const [k, src] of [['moi','moi'],['list_to_sale','list_to_sale'],['active','active'],['pending','pending'],['closed','closed']]) {
          if ((prev.market?.[k] === '' || prev.market?.[k] == null) && r.market?.[src] != null) next.market[k] = r.market[src];
        }
        // Comps: replace the empty starter row; otherwise append researched comps.
        const found = (r.comps || []).map(c => ({
          address: c.address || '', sale_price: c.sale_price || '', gla: c.gla || '',
          beds: c.beds ?? '', baths: c.baths ?? '', year_built: c.year_built ?? '',
          sold_date: c.sold_date ?? null, lot_size: c.lot_size ?? null, garage: c.garage ?? null, pool: c.pool ?? null,
          condition: c.condition ?? null, condition_basis: c.condition_basis ?? null,
          adjustments: Array.isArray(c.adjustments) ? c.adjustments.map(a => ({ label: a.label, amount: a.amount })) : [],
        }));
        if (found.length) {
          const hasReal = (prev.comps || []).some(c => (c.address || '').trim() || Number(c.sale_price) > 0);
          next.comps = hasReal ? [...prev.comps, ...found] : found;
        }
        // Valuation → pricing tiers. Fill any blank tier with the researched value so
        // the presentation never renders $0.
        const vt = r.valuation?.tiers || {};
        next.tiers = { ...prev.tiers };
        for (const k of ['opportunistic','target','fast']) {
          if ((prev.tiers?.[k] === '' || prev.tiers?.[k] == null || Number(prev.tiers?.[k]) === 0) && vt[k] != null) next.tiers[k] = vt[k];
        }
        next._research = { sources: r.sources || [], notes: r.notes || '', confidence: r.confidence || 'low', valuation: r.valuation || null };
        // Carry the extra researched signals into subject/market (fill blanks only) so
        // the deck can surface them: last sale, market appreciation, price/sf.
        next.subject = { ...next.subject };
        if ((next.subject.last_sold_price == null || next.subject.last_sold_price === '') && r.subject?.last_sold_price != null) next.subject.last_sold_price = r.subject.last_sold_price;
        next.market = { ...next.market };
        if ((next.market.annual_appreciation_pct == null || next.market.annual_appreciation_pct === '') && r.market?.annual_appreciation_pct != null) next.market.annual_appreciation_pct = r.market.annual_appreciation_pct;
        if ((next.market.ppsf == null || next.market.ppsf === '') && r.valuation?.ppsf != null) next.market.ppsf = r.valuation.ppsf;
        return next;
      });
      const conf = r.confidence === 'high' ? 'strong' : r.confidence === 'medium' ? 'decent' : 'limited';
      flash(`Pulled ${(r.comps||[]).length} comp(s) + market data from public sources (${conf} match). Review and adjust the numbers below before presenting.`, true);
    } catch (_) { flash('Research failed — please try again.', false); }
    setResearching(false);
  };
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(initial.id || null);
  const [shareUrl, setShareUrl] = useState(null);

  const set = (path, val) => setP(prev => {
    const n = { ...prev }; const seg = path.split('.');
    if (seg.length === 1) n[seg[0]] = val;
    else { n[seg[0]] = { ...n[seg[0]], [seg[1]]: val }; }
    return n;
  });
  const setComp = (i, key, val) => setP(prev => { const comps=[...prev.comps]; comps[i]={...comps[i],[key]:val}; return {...prev,comps}; });
  const addComp = () => setP(prev => ({ ...prev, comps:[...prev.comps, { address:'', sale_price:'', gla:'', adjustments:[] }] }));
  const rmComp = (i) => setP(prev => ({ ...prev, comps: prev.comps.filter((_,x)=>x!==i) }));

  const cond = conditionFor(p.subject.condition_score);

  const num = (o) => { const r={}; for (const k in o){ const v=o[k]; r[k] = (v===''||v==null)?null:(isNaN(Number(v))?v:Number(v)); } return r; };
  const payload = () => ({
    user_id: userId, contact_id: p.contact_id||null, deal_id: p.deal_id||null,
    title: p.title?.trim() || (p.address?.trim() ? p.address.trim()+' — Listing Presentation' : 'Untitled presentation'),
    address: p.address?.trim()||null, seller_tone: p.seller_tone,
    seller_name: p.seller_name?.trim()||null, hero_image_url: p.hero_image_url?.trim()||null, agent_video_url: p.agent_video_url?.trim()||null,
    subject: num(p.subject), market: num(p.market),
    comps: (p.comps||[]).map(c=>({ ...c, sale_price:Number(c.sale_price)||0, gla:c.gla||null, adjustments:c.adjustments||[] })),
    tiers: num(p.tiers), netsheet: num(p.netsheet),
    photos: (p.photos || []).map(u => String(u).trim()).filter(Boolean),
    research: p._research ? { sources: (p._research.sources||[]).slice(0,8), confidence: p._research.confidence || null } : null,
  });

  const generateHTML = (extra={}) => buildPresentationHTML({ ...payload(), agent_name: agentName, supabase_url: SUPABASE_URL, research_confidence: p._research?.confidence || null, ...extra });

  const save = async () => {
    setBusy(true);
    const row = { ...payload(), html: generateHTML(), updated_at: new Date().toISOString() };
    let res;
    if (savedId) res = await supabase.from('listing_presentations').update(row).eq('id', savedId).select().single();
    else res = await supabase.from('listing_presentations').insert(row).select().single();
    if (res.error) { flash('Could not save: ' + res.error.message, false); setBusy(false); return null; }
    setSavedId(res.data.id); setBusy(false); flash('Saved.'); return res.data;
  };

  const preview = async () => {
    // iOS Safari blocks window.open() that happens AFTER an await (it no longer counts
    // as a user gesture). So open the tab SYNCHRONOUSLY on the tap, show a tiny loading
    // shell, then fill it once the save + HTML are ready. If the browser still blocks it
    // (hardened pop-up settings), fall back to rendering in-place via a blob download.
    const w = window.open('', '_blank');
    if (w) { try { w.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#100D09;color:#EBCB82;font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh"><div>Preparing your presentation…</div></body>'); } catch (_) {} }
    const saved = await save();
    if (!saved) { if (w) { try { w.close(); } catch (_) {} } return; }
    const html = saved.html || generateHTML();
    if (w && !w.closed) {
      try { w.document.open(); w.document.write(html); w.document.close(); return; } catch (_) {}
    }
    // Pop-up was blocked or lost — hand them the deck without a pop-up: open a blob URL
    // in this tab's context (works on iOS), which the OS renders or offers to open.
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      flash('Opened your presentation in a new tab.');
    } catch (_) {
      flash('Preview was blocked. Use “Share with seller” to get a link instead.', false);
    }
  };

  const enableShare = async () => {
    const saved = await save(); if (!saved) return;
    const tok = saved.share_token || token();
    // Regenerate the deck in SELLER mode: personalized, with the sign-on-the-spot
    // pad wired to this exact share token so the signature posts back correctly.
    const sellerHtml = generateHTML({ sign_mode: true, share_token: tok });
    const { data, error } = await supabase.from('listing_presentations')
      .update({ share_token: tok, share_enabled: true, html: sellerHtml }).eq('id', saved.id).select().single();
    if (error) { flash('Could not enable sharing: ' + error.message, false); return; }
    const url = `${SUPABASE_URL}/functions/v1/listing-present?t=${data.share_token}`;
    setShareUrl(url);
    try { await navigator.clipboard.writeText(url); flash('Share link copied — send it to your seller.'); }
    catch { flash('Share link ready (copy it below).'); }
  };

  return (
    <div style={{ maxWidth: 780, margin:'0 auto', padding:'0 4px 60px' }}>
      {notify && <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', zIndex:5000, background: notify.ok?'#1a3a2a':'#3a1a1a', border:`1px solid ${notify.ok?'#7fae8f':'#e0794f'}`, color:'#fff', padding:'12px 18px', borderRadius:10, fontSize:14, maxWidth:'90vw' }}>{notify.t}</div>}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:16 }}>
        <div>
          <div style={{ fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:G, fontSize:12 }}>{savedId ? 'Editing' : 'New'} presentation</div>
          <h1 style={{ fontFamily:'Fraunces,serif', fontWeight:400, fontSize:26, color:'var(--text-1)', margin:'2px 0 0' }}>{p.address || 'Listing Presentation'}</h1>
        </div>
        <button onClick={onCancel} style={btnGhost}>← Back</button>
      </div>

      {/* PROPERTY */}
      <div style={eyebrow}>The property</div>
      <div style={{ marginBottom:12 }}><label style={lab}>Property address</label>
        <div style={{ display:'flex', gap:8 }}>
          <input style={{...fld, flex:1}} value={p.address} onChange={e=>set('address',e.target.value)} placeholder="4214 W Virginia Ave, Tampa, FL 33607" />
          <button onClick={runResearch} disabled={researching} title="Research comps, market data & property facts from public sources (Zillow, Realtor, Redfin, county records)"
            style={{ ...btnGhost, whiteSpace:'nowrap', opacity: researching ? 0.6 : 1, cursor: researching ? 'wait' : 'pointer' }}>{researching ? '⏳ Researching…' : '✨ Auto-research'}</button>
        </div>
        <div style={{ fontSize:11, color:'var(--text-3)', marginTop:5 }}>Pulls comparable sales, market speed and property facts from public sources (Zillow, Realtor.com, Redfin, county records) — a stand-in until your IDX feed is connected. Always review the numbers before presenting.</div>
        {p._research && (p._research.sources?.length || p._research.notes) ? (
          <div style={{ fontSize:11, color:'var(--text-3)', marginTop:6, padding:'8px 10px', background:'rgba(203,163,92,.06)', border:'1px solid rgba(203,163,92,.18)', borderRadius:8 }}>
            <b style={{color:'var(--text-2)'}}>Research match: {p._research.confidence}.</b> {p._research.notes ? p._research.notes.slice(0,220) : ''}
            {p._research.sources?.length ? <div style={{marginTop:4}}>Sources: {p._research.sources.slice(0,4).map((s,i)=>(<a key={i} href={s} target="_blank" rel="noreferrer" style={{color:'var(--accent)',marginRight:8}}>[{i+1}]</a>))}</div> : null}
          </div>
        ) : null}
      </div>
      <div style={{ marginBottom:12 }}><label style={lab}>Seller name (personalizes the cover)</label><input style={fld} value={p.seller_name} onChange={e=>set('seller_name',e.target.value)} placeholder="The Henderson Family" /></div>
      <div style={{ marginBottom:12 }}>
        <PhotoUploader
          photos={p.photos}
          hero={p.hero_image_url}
          userId={userId}
          onChange={(next) => set('photos', next)}
          onSetHero={(url) => set('hero_image_url', url)}
          notify={(m, t) => (window.__notify ? window.__notify(m, t) : null)}
        />
      </div>
      <div style={{ marginBottom:12 }}>
        <label style={lab}>Agent welcome video <span style={{ textTransform:'none', letterSpacing:0, color:'var(--text-3)', fontWeight:500 }}>— optional</span></label>
        <input style={fld} value={p.agent_video_url} onChange={e=>set('agent_video_url',e.target.value)} placeholder="YouTube / Vimeo / .mp4 link" />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:10, marginBottom:12 }}>
        <div><label style={lab}>GLA (sq ft)</label><input style={fld} value={p.subject.gla} onChange={e=>set('subject.gla',e.target.value)} /></div>
        <div><label style={lab}>Beds</label><input style={fld} value={p.subject.beds} onChange={e=>set('subject.beds',e.target.value)} /></div>
        <div><label style={lab}>Baths</label><input style={fld} value={p.subject.baths} onChange={e=>set('subject.baths',e.target.value)} /></div>
        <div><label style={lab}>Lot</label><input style={fld} value={p.subject.lot_size} onChange={e=>set('subject.lot_size',e.target.value)} /></div>
        <div><label style={lab}>Year built</label><input style={fld} value={p.subject.year_built} onChange={e=>set('subject.year_built',e.target.value)} /></div>
      </div>

      {/* CONDITION SLIDER */}
      <div style={eyebrow}>Property condition — 1 to 10</div>
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'18px' }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:12 }}>
          <div style={{ fontFamily:'Fraunces,serif', fontSize:42, color:G, lineHeight:1 }}>{cond.n}<span style={{ fontSize:20, color:'var(--text-3)' }}>/10</span></div>
          <div style={{ fontFamily:'Fraunces,serif', fontSize:22, color:CHAMP }}>{cond.label}</div>
        </div>
        <input type="range" min="1" max="10" step="1" value={p.subject.condition_score} onChange={e=>set('subject.condition_score', Number(e.target.value))} style={{ width:'100%', accentColor:G }} />
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-3)', marginTop:2 }}><span>1 · Full rehab</span><span>10 · Flawless</span></div>
        <div style={{ marginTop:12, fontSize:14, color:'var(--text-2)', fontStyle:'italic', lineHeight:1.5, borderLeft:`2px solid ${G}`, paddingLeft:12 }}>{cond.say}</div>
      </div>

      {/* UPGRADES + HIDDEN */}
      <div style={{ marginTop:12 }}><label style={lab}>Upgrades & improvements</label><textarea style={{...fld, minHeight:70, resize:'vertical'}} value={p.subject.upgrades} onChange={e=>set('subject.upgrades',e.target.value)} placeholder="New roof (2024), quartz kitchen, impact windows, renovated primary bath…" /></div>
      <div style={{ marginTop:12 }}><label style={lab}>Changes not in public record</label><textarea style={{...fld, minHeight:70, resize:'vertical'}} value={p.subject.hidden_changes} onChange={e=>set('subject.hidden_changes',e.target.value)} placeholder="Lanai permitted & converted to a 4th bedroom; garage insulated as flex office; well added for irrigation…" /></div>
      <div style={{ marginTop:12 }}><label style={lab}>Owner motivation / objective</label><input style={fld} value={p.subject.motivation} onChange={e=>set('subject.motivation',e.target.value)} placeholder="Relocating for work — needs to close by spring" /></div>

      {/* TONE */}
      <div style={eyebrow}>Seller’s style (DISC framing)</div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {[['auto','Auto'],['analytical','Analytical (C)'],['direct','Direct (D)'],['relational','Relational (I/S)']].map(([v,l])=>(
          <button key={v} onClick={()=>set('seller_tone',v)} style={{ padding:'7px 14px', borderRadius:100, cursor:'pointer', fontSize:13, fontWeight:p.seller_tone===v?700:500, border:`1px solid ${p.seller_tone===v?G:'var(--border)'}`, background:p.seller_tone===v?'rgba(203,163,92,.15)':'transparent', color:p.seller_tone===v?G:'var(--text-2)' }}>{l}</button>
        ))}
      </div>

      {/* MARKET */}
      <div style={eyebrow}>Micro-market</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10 }}>
        <div><label style={lab}>Months of inventory</label><input style={fld} value={p.market.moi} onChange={e=>set('market.moi',e.target.value)} /></div>
        <div><label style={lab}>List-to-sale %</label><input style={fld} value={p.market.list_to_sale} onChange={e=>set('market.list_to_sale',e.target.value)} /></div>
        <div><label style={lab}>Active</label><input style={fld} value={p.market.active} onChange={e=>set('market.active',e.target.value)} /></div>
        <div><label style={lab}>Pending</label><input style={fld} value={p.market.pending} onChange={e=>set('market.pending',e.target.value)} /></div>
        <div><label style={lab}>Closed (90d)</label><input style={fld} value={p.market.closed} onChange={e=>set('market.closed',e.target.value)} /></div>
      </div>
      <div style={{ marginTop:10 }}><label style={lab}>Market speed (buyer’s ← → seller’s): {p.market.speed}</label><input type="range" min="0" max="100" value={p.market.speed} onChange={e=>set('market.speed',Number(e.target.value))} style={{ width:'100%', accentColor:G }} /></div>

      {/* COMPS */}
      <div style={eyebrow}>Comparables</div>
      {(() => { const recon = reconcileValuation(p.subject, p.comps, { research_confidence: p._research?.confidence }); return (
      <>
      {p.comps.map((c,i)=>{
        const base = (c.adjustments||[]).reduce((s,a)=>s+Number(a.amount||0),0);
        const agentAdj = Number(c.agent_adj||0);
        const total = base + agentAdj;
        const sale = Number(c.sale_price)||0;
        const adjusted = sale + total;
        const sliderMax = Math.max(20000, Math.round(sale*0.15/1000)*1000) || 50000;
        return (
        <div key={i} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:12, marginBottom:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}><span style={{ fontSize:12, color:'var(--text-3)', fontWeight:700 }}>Comp {i+1}</span>{p.comps.length>1 && <button onClick={()=>rmComp(i)} style={{ background:'none', border:'none', color:'#e0794f', cursor:'pointer', fontSize:12 }}>Remove</button>}</div>
          <input style={{...fld, marginBottom:8}} value={c.address} onChange={e=>setComp(i,'address',e.target.value)} placeholder="Comp address" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <input style={fld} value={c.sale_price} onChange={e=>setComp(i,'sale_price',e.target.value)} placeholder="Sale price" inputMode="numeric" />
            <input style={fld} value={c.gla} onChange={e=>setComp(i,'gla',e.target.value)} placeholder="GLA (sq ft)" inputMode="numeric" />
          </div>
          {(c.adjustments||[]).length ? (
            <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:'4px 12px' }}>
              {(c.adjustments||[]).filter(a=>Number(a.amount)!==0).map((a,j)=>(
                <span key={j} style={{ fontSize:11, whiteSpace:'nowrap' }}><span style={{color:'var(--text-3)'}}>{a.label}</span> <span style={{color:Number(a.amount)>=0?'#7fae8f':'#e0794f',fontWeight:600}}>{Number(a.amount)>=0?'+':'−'}${Math.abs(Number(a.amount)).toLocaleString()}</span></span>
              ))}
            </div>
          ) : null}
          {sale>0 ? (
          <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11, color:'var(--text-3)', marginBottom:4 }}>
              <span>Your adjustment {agentAdj?<b style={{color:agentAdj>=0?'#7fae8f':'#e0794f'}}>{agentAdj>=0?'+':'−'}${Math.abs(agentAdj).toLocaleString()}</b>:<span style={{opacity:.6}}>drag to fine-tune</span>}</span>
              <span>Adjusted <b style={{color:'var(--accent)'}}>${adjusted.toLocaleString()}</b></span>
            </div>
            <input type="range" min={-sliderMax} max={sliderMax} step={1000} value={agentAdj} onChange={e=>setComp(i,'agent_adj',Number(e.target.value))} style={{ width:'100%', accentColor:G }} />
            {agentAdj ? <button onClick={()=>setComp(i,'agent_adj',0)} style={{ background:'none', border:'none', color:'var(--text-3)', cursor:'pointer', fontSize:10.5, marginTop:2, padding:0 }}>reset</button> : null}
          </div>
          ) : null}
        </div>
      );})}
      <button onClick={addComp} style={{...btnGhost, marginBottom:4}}>+ Add comp</button>

      {/* LIVE VALUATION + CONFIDENCE */}
      {recon.reconciled ? (
        <div style={{ marginTop:14, padding:'14px 16px', background:'rgba(203,163,92,.06)', border:'1px solid rgba(203,163,92,.22)', borderRadius:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ fontSize:10.5, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--accent)', fontWeight:700 }}>Reconciled valuation</div>
              <div style={{ fontSize:26, fontWeight:800, color:'var(--text-1)', fontFamily:'Fraunces, serif', marginTop:2 }}>${recon.reconciled.toLocaleString()}</div>
              <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>{recon.tiers.fast?`$${recon.tiers.fast.toLocaleString()} – $${recon.tiers.opportunistic.toLocaleString()}`:''} · {recon.comps_used} of {recon.comps_total} comps used</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10.5, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--accent)', fontWeight:700 }}>Confidence</div>
              <div style={{ fontSize:20, letterSpacing:2, marginTop:2 }}>{Array.from({length:5},(_,k)=>(<span key={k} style={{color:k<recon.stars?G:'rgba(203,163,92,.25)'}}>★</span>))}</div>
            </div>
          </div>
          <div style={{ fontSize:12, color:'var(--text-2)', marginTop:8, lineHeight:1.5 }}>{recon.confidence_label}. Tune any comp above and this updates live. Set explicit tier prices below to override.</div>
        </div>
      ) : null}
      </>
      );})()}

      {/* TIERS */}
      <div style={eyebrow}>Three-tier pricing</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
        <div><label style={lab}>Opportunistic</label><input style={fld} value={p.tiers.opportunistic} onChange={e=>set('tiers.opportunistic',e.target.value)} inputMode="numeric" placeholder="729000" /></div>
        <div><label style={lab}>Target ★</label><input style={fld} value={p.tiers.target} onChange={e=>set('tiers.target',e.target.value)} inputMode="numeric" placeholder="699000" /></div>
        <div><label style={lab}>Fast sale</label><input style={fld} value={p.tiers.fast} onChange={e=>set('tiers.fast',e.target.value)} inputMode="numeric" placeholder="669000" /></div>
      </div>

      {/* NET SHEET */}
      <div style={eyebrow}>Seller net sheet</div>
      <div style={{ fontSize:11, color:'var(--text-3)', margin:'-4px 0 8px' }}>Tap <b>%</b> or <b>$</b> on each line to set how that number is read. A % is calculated against the sale price; a $ is a flat amount.</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
        {[
          ['commission_pct','commission','Commission'],
          ['mortgage_payoff','mortgage_payoff','Mortgage payoff'],
          ['title_fees','title_fees','Title & closing'],
          ['tax_proration','tax_proration','Tax proration'],
          ['other','other','Other'],
        ].map(([valKey, unitKey, label]) => {
          const unit = (p.netsheet.units && p.netsheet.units[unitKey]) || (unitKey==='commission' ? 'pct' : 'usd');
          const pill = (u) => ({ padding:'2px 9px', fontSize:12, fontWeight:800, cursor:'pointer', border:'1px solid var(--border)', background: unit===u ? G : 'transparent', color: unit===u ? '#100D09' : 'var(--text-3)', borderRadius: u==='pct'?'7px 0 0 7px':'0 7px 7px 0', lineHeight:'18px' });
          return (
            <div key={valKey}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                <label style={{ ...lab, margin:0 }}>{label}</label>
                <div style={{ display:'inline-flex' }}>
                  <button type="button" onClick={()=>setUnit(unitKey,'pct')} style={pill('pct')}>%</button>
                  <button type="button" onClick={()=>setUnit(unitKey,'usd')} style={{ ...pill('usd'), borderLeft:'none' }}>$</button>
                </div>
              </div>
              <div style={{ position:'relative' }}>
                <span style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)', fontSize:14, pointerEvents:'none' }}>{unit==='usd'?'$':''}</span>
                <input style={{ ...fld, paddingLeft: unit==='usd'?22:11, paddingRight: unit==='pct'?24:11 }} value={p.netsheet[valKey]} onChange={e=>set('netsheet.'+valKey,e.target.value)} inputMode="decimal" placeholder={unit==='pct'?'2.4':'9200'} />
                <span style={{ position:'absolute', right:11, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)', fontSize:14, pointerEvents:'none' }}>{unit==='pct'?'%':''}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ACTIONS */}
      <div style={{ position:'sticky', bottom:0, background:'linear-gradient(180deg,transparent,var(--bg-base) 30%)', paddingTop:20, marginTop:24 }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={save} disabled={busy} style={{ ...btnGhost, flex:'1 1 100px' }}>{busy?'Saving…':'Save'}</button>
          <button onClick={preview} disabled={busy} style={{ background:CHAMP, color:INK, border:'none', borderRadius:9, padding:'11px 20px', fontWeight:800, fontSize:14, cursor:'pointer', flex:'2 1 160px' }}>▶ Preview presentation</button>
          <button onClick={enableShare} disabled={busy} style={{ ...btnGhost, flex:'1 1 120px' }}>🔗 Share with seller</button>
        </div>
        {shareUrl && <div style={{ marginTop:10, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--text-2)', wordBreak:'break-all' }}>{shareUrl}</div>}
      </div>
    </div>
  );
}
