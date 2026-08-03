import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase, SUPABASE_URL } from '../dataService';
import { conditionFor, buildPresentationHTML, reconcileValuation } from '../listingPresentation';
import { TipFor } from '../App';

const G = '#CBA35C', CHAMP = '#EBCB82', INK = '#100D09';
const money = (n) => (n || n === 0) ? '$' + Number(n).toLocaleString('en-US') : '';

// The list only needs enough to render a row. `html` is a full 25-35KB deck per
// presentation - pulling it into the list made the screen crawl on a phone.
const LIST_COLS = 'id,title,address,subject,tiers,share_enabled,view_count,last_viewed_at,signed_at,signature,updated_at';

/* -- images --------------------------------------------------------------
   A photo straight off an iPhone is 3-8MB and 4032px wide. Uploading that over
   cellular is the slowest thing this screen does, and holding several of them
   decoded in a thumbnail grid is what makes Safari stutter. Shrink on-device
   first: same visual result in the deck, ~10x less to move and hold.        */
async function loadBitmap(file) {
  if (typeof window.createImageBitmap === 'function') {
    try { return await window.createImageBitmap(file); } catch (_) { /* fall through */ }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

async function downscaleImage(file, maxDim = 2400, quality = 0.82) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  if (file.size < 500 * 1024) return file;                 // already light
  let bmp = null;
  try {
    bmp = await loadBitmap(file);
    const iw = bmp.width || bmp.naturalWidth, ih = bmp.height || bmp.naturalHeight;
    if (!iw || !ih) return file;
    const scale = Math.min(1, maxDim / Math.max(iw, ih));
    const w = Math.round(iw * scale), h = Math.round(ih * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    canvas.width = 0; canvas.height = 0;                   // release on iOS immediately
    if (!blob || blob.size >= file.size) return file;
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], base + '.jpg', { type: 'image/jpeg' });
  } catch (_) {
    return file;                                           // never block an upload on this
  } finally {
    try { if (bmp && bmp.close) bmp.close(); } catch (_) {}
  }
}

// Upload an image File to the public listing-photos bucket, return its public URL.
// Path is {user_id}/{uuid}.ext so RLS (own-folder write) holds.
async function uploadListingPhoto(file, userId) {
  if (!file) throw new Error('No file');
  if (!file.type || !file.type.startsWith('image/')) throw new Error('That file isn\u2019t an image');
  const small = await downscaleImage(file);
  if (small.size > 10 * 1024 * 1024) throw new Error('Image is over 10MB \u2014 try a smaller one');
  const ext = ((small.name || '').split('.').pop() || small.type.split('/')[1] || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const key = `${userId}/${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))}.${ext}`;
  const { error } = await supabase.storage.from('listing-photos').upload(key, small, { contentType: small.type, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('listing-photos').getPublicUrl(key);
  return data.publicUrl;
}

/* -- shared styles -------------------------------------------------------
   Module-level constants on purpose: a style object rebuilt inside render is a
   new object every keystroke, which defeats React.memo on every field.      */
const btnGhost = { background:'var(--bg-base)', border:'1px solid var(--border)', color:'var(--text-2)', borderRadius:8, padding:'8px 14px', fontSize:13, fontWeight:700, cursor:'pointer' };
const fld = { width:'100%', boxSizing:'border-box', background:'var(--bg-base)', border:'1px solid var(--border)', borderRadius:9, color:'var(--text-1)', padding:'10px 12px', fontSize:14 };
const fldArea = { ...fld, minHeight:70, resize:'vertical' };
const lab = { display:'block', fontSize:11, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--text-3)', margin:'0 0 6px' };
const labSoft = { textTransform:'none', letterSpacing:0, color:'var(--text-3)', fontWeight:500 };
const eyebrow = { fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.16em', textTransform:'uppercase', color:G, fontSize:12, margin:'22px 0 10px' };
const card = { background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:16 };
const grid = (min) => ({ display:'grid', gridTemplateColumns:`repeat(auto-fit,minmax(${min}px,1fr))`, gap:10 });

/* -- Field ---------------------------------------------------------------
   Memoized so that typing in one input doesn't re-render the other forty.
   Requires a stable `onSet` from the parent (useCallback with no deps).     */
const Field = React.memo(function Field({ label, hint, path, value, onSet, placeholder, inputMode, multiline, wrapStyle }) {
  const onChange = useCallback(e => onSet(path, e.target.value), [onSet, path]);
  return (
    <div style={wrapStyle}>
      {label ? <label style={lab}>{label}{hint ? <span style={labSoft}> {'\u2014'} {hint}</span> : null}</label> : null}
      {multiline
        ? <textarea style={fldArea} value={value == null ? '' : value} onChange={onChange} placeholder={placeholder} />
        : <input style={fld} value={value == null ? '' : value} onChange={onChange} placeholder={placeholder} inputMode={inputMode} />}
    </div>
  );
});

/* -- PhotoUploader -------------------------------------------------------- */
const PhotoUploader = React.memo(function PhotoUploader({ photos, hero, userId, onChange, onSetHero, notify }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const list = useMemo(() => (Array.isArray(photos) ? photos : []), [photos]);

  const addFiles = useCallback(async (files) => {
    const imgs = Array.from(files || []).filter(f => f.type && f.type.startsWith('image/'));
    if (!imgs.length) { if (notify) notify('No images found to add', 'warn'); return; }
    setBusy(true);
    const added = [];
    for (const f of imgs) {
      try { added.push(await uploadListingPhoto(f, userId)); }
      catch (e) { if (notify) notify('Upload failed: ' + (e.message || e), 'error'); }
    }
    if (added.length) {
      onChange([...list, ...added]);
      if (!hero && added[0] && onSetHero) onSetHero(added[0]);   // first photo becomes the cover
      if (notify) notify(`${added.length} photo${added.length > 1 ? 's' : ''} added`, 'success');
    }
    setBusy(false);
  }, [list, hero, userId, onChange, onSetHero, notify]);

  const onPaste = useCallback((e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files = [];
    for (const it of items) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); } }
    if (files.length) { e.preventDefault(); addFiles(files); }
  }, [addFiles]);

  const removeAt = useCallback((i) => {
    const url = list[i];
    const next = list.filter((_, j) => j !== i);
    onChange(next);
    if (hero === url && onSetHero) onSetHero(next[0] || '');
  }, [list, hero, onChange, onSetHero]);

  const btn = { display:'inline-flex', alignItems:'center', gap:6, padding:'9px 15px', borderRadius:999, border:'1px solid var(--border)', background:'var(--bg-base)', color:'var(--text-1)', fontSize:13, fontWeight:700, cursor:'pointer' };

  return (
    <div>
      <label style={lab}>Property photos <span style={labSoft}>{'\u2014'} the first one becomes the cover</span></label>
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer && e.dataTransfer.files); }}
        onPaste={onPaste}
        tabIndex={0}
        style={{ border:`1.5px dashed ${drag ? G : 'var(--border)'}`, borderRadius:12, padding:14, background: drag ? 'rgba(203,163,92,.06)' : 'transparent' }}
      >
        {list.length ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(84px,1fr))', gap:8, marginBottom:12 }}>
            {list.map((url, i) => (
              <div key={url + i} style={{ position:'relative', aspectRatio:'4/3', borderRadius:8, overflow:'hidden', border: hero === url ? `2px solid ${G}` : '1px solid var(--border)', background:'var(--bg-base)' }}>
                <img src={url} alt="" loading="lazy" decoding="async" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                {hero === url && <span style={{ position:'absolute', top:3, left:3, fontSize:9, fontWeight:800, letterSpacing:'.05em', background:G, color:INK, padding:'1px 5px', borderRadius:4 }}>COVER</span>}
                <button type="button" onClick={() => removeAt(i)} title="Remove" style={{ position:'absolute', top:3, right:3, width:22, height:22, borderRadius:'50%', border:'none', background:'rgba(16,13,9,.72)', color:'#fff', fontSize:13, lineHeight:'22px', cursor:'pointer', padding:0 }}>{'\u00D7'}</button>
                {hero !== url && <button type="button" onClick={() => onSetHero && onSetHero(url)} style={{ position:'absolute', bottom:3, left:3, fontSize:9, fontWeight:700, background:'rgba(16,13,9,.72)', color:'#fff', border:'none', borderRadius:4, padding:'2px 5px', cursor:'pointer' }}>Set cover</button>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign:'center', color:'var(--text-3)', fontSize:12.5, padding:'6px 0 12px' }}>Add photos from your camera roll, or take one now.</div>
        )}
        <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          <button type="button" style={btn} disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>{'\uD83D\uDDBC\uFE0F'} Browse</button>
          <button type="button" style={btn} disabled={busy} onClick={() => camRef.current && camRef.current.click()}>{'\uD83D\uDCF7'} Camera</button>
          {busy && <span style={{ alignSelf:'center', color:G, fontSize:12.5, fontWeight:700 }}>Uploading{'\u2026'}</span>}
        </div>
        <div style={{ fontSize:11, color:'var(--text-3)', marginTop:8 }}>Photos are resized on your phone before they upload, so this stays fast on cellular.</div>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display:'none' }} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
});

/* -- CompCard ------------------------------------------------------------
   Memoized: adjusting comp 3's slider must not re-render comps 1, 2 and 4.  */
const CompCard = React.memo(function CompCard({ i, c, canRemove, onSetComp, onRemove }) {
  const base = (c.adjustments || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  const agentAdj = Number(c.agent_adj || 0);
  const sale = Number(c.sale_price) || 0;
  const adjusted = sale + base + agentAdj;
  const sliderMax = Math.max(20000, Math.round(sale * 0.15 / 1000) * 1000) || 50000;
  return (
    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:12, marginBottom:8 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:12, color:'var(--text-3)', fontWeight:700 }}>Comp {i + 1}</span>
        {canRemove && <button onClick={() => onRemove(i)} style={{ background:'none', border:'none', color:'#e0794f', cursor:'pointer', fontSize:12 }}>Remove</button>}
      </div>
      <input style={{ ...fld, marginBottom:8 }} value={c.address == null ? '' : c.address} onChange={e => onSetComp(i, 'address', e.target.value)} placeholder="Comp address" />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
        <input style={fld} value={c.sale_price == null ? '' : c.sale_price} onChange={e => onSetComp(i, 'sale_price', e.target.value)} placeholder="Sale price" inputMode="numeric" />
        <input style={fld} value={c.gla == null ? '' : c.gla} onChange={e => onSetComp(i, 'gla', e.target.value)} placeholder="GLA (sq ft)" inputMode="numeric" />
      </div>
      {(c.adjustments || []).length ? (
        <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:'4px 12px' }}>
          {(c.adjustments || []).filter(a => Number(a.amount) !== 0).map((a, j) => (
            <span key={j} style={{ fontSize:11, whiteSpace:'nowrap' }}><span style={{ color:'var(--text-3)' }}>{a.label}</span> <span style={{ color:Number(a.amount) >= 0 ? '#7fae8f' : '#e0794f', fontWeight:600 }}>{Number(a.amount) >= 0 ? '+' : '\u2212'}${Math.abs(Number(a.amount)).toLocaleString()}</span></span>
          ))}
        </div>
      ) : null}
      {sale > 0 ? (
        <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:11, color:'var(--text-3)', marginBottom:4, gap:8 }}>
            <span>Your adjustment {agentAdj ? <b style={{ color:agentAdj >= 0 ? '#7fae8f' : '#e0794f' }}>{agentAdj >= 0 ? '+' : '\u2212'}${Math.abs(agentAdj).toLocaleString()}</b> : <span style={{ opacity:.6 }}>drag to fine-tune</span>}</span>
            <span style={{ whiteSpace:'nowrap' }}>Adjusted <b style={{ color:G }}>${adjusted.toLocaleString()}</b></span>
          </div>
          <input type="range" min={-sliderMax} max={sliderMax} step={1000} value={agentAdj} onChange={e => onSetComp(i, 'agent_adj', Number(e.target.value))} style={{ width:'100%', accentColor:G }} />
          {agentAdj ? <button onClick={() => onSetComp(i, 'agent_adj', 0)} style={{ background:'none', border:'none', color:'var(--text-3)', cursor:'pointer', fontSize:10.5, marginTop:2, padding:0 }}>reset</button> : null}
        </div>
      ) : null}
    </div>
  );
});

const token = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 22);
const timeAgo = (iso) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};

function Toast({ notify }) {
  return <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', zIndex:5000, background: notify.ok ? '#1a3a2a' : '#3a1a1a', border:`1px solid ${notify.ok ? '#7fae8f' : '#e0794f'}`, color:'#fff', padding:'12px 18px', borderRadius:10, fontSize:14, maxWidth:'90vw' }}>{notify.t}</div>;
}

/* -- list screen ---------------------------------------------------------- */
export default function ListingPresentationView({ userId, agentName }) {
  const [list, setList] = useState(null);
  const [mode, setMode] = useState('list');   // list | edit
  const [editing, setEditing] = useState(null);
  const [opening, setOpening] = useState(null);
  const [notify, setNotify] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('listing_presentations')
      .select(LIST_COLS).eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) { setList([]); return; }
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

  const flash = useCallback((t, ok = true) => { setNotify({ t, ok }); setTimeout(() => setNotify(null), 4000); }, []);

  // The list row is deliberately light. Fetch the full record only when opening.
  const open = async (id) => {
    setOpening(id);
    const { data, error } = await supabase.from('listing_presentations').select('*').eq('id', id).single();
    setOpening(null);
    if (error || !data) { flash('Could not open that presentation.', false); return; }
    setEditing({ ...data, _research: data.research ? { sources: data.research.sources || [], notes:'', confidence: data.research.confidence || null, valuation:null } : undefined });
    setMode('edit');
  };

  if (mode === 'edit') return <Editor initial={editing} userId={userId} agentName={agentName} onExit={() => { setMode('list'); load(); }} flash={flash} notify={notify} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 4px 40px' }}>
      <TipFor screen="listing_presentation" />
      {notify && <Toast notify={notify} />}
      <div style={{ marginBottom: 6 }}><span style={{ fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:G, fontSize:13 }}>Win the listing</span></div>
      <h1 style={{ fontFamily:'Fraunces,serif', fontWeight:400, fontSize:34, color:'var(--text-1)', margin:'0 0 6px' }}>Listing Presentations</h1>
      <p style={{ color:'var(--text-2)', fontSize:15, margin:'0 0 20px', maxWidth:'62ch' }}>Turn an address into an executive, DISC-aware valuation dossier {'\u2014'} pricing, comps, a launch plan, and a live net-sheet {'\u2014'} as a branded web presentation you can present, email, or share with the seller.</p>
      <button onClick={() => { setEditing(blank()); setMode('edit'); }} style={{ background:CHAMP, color:INK, border:'none', borderRadius:10, padding:'13px 22px', fontWeight:800, fontSize:15, cursor:'pointer' }}>+ New Listing Presentation</button>

      <div style={{ marginTop: 28 }}>
        {list === null ? <div style={{ color:'var(--text-3)' }}>Loading{'\u2026'}</div>
         : list.length === 0 ? <div style={{ color:'var(--text-3)', fontSize:14, border:'1px dashed var(--border)', borderRadius:12, padding:'26px', textAlign:'center' }}>No presentations yet. Build your first one {'\u2014'} it takes about five minutes.</div>
         : list.map(p => (
            <div key={p.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px', marginBottom:10 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontWeight:700, color:'var(--text-1)', fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title || p.address || 'Untitled presentation'}</div>
                <div style={{ fontSize:12, color:'var(--text-3)', marginTop:2 }}>
                  {conditionFor(p.subject && p.subject.condition_score).n}/10 {'\u00B7'} {conditionFor(p.subject && p.subject.condition_score).label}
                  {p.tiers && p.tiers.target ? ` \u00B7 target ${money(p.tiers.target)}` : ''}
                  {p.share_enabled ? ' \u00B7 \uD83D\uDD17 shared' : ''}
                  {p.view_count ? ` \u00B7 ${p.view_count} views` : ''}
                </div>
                {p.last_viewed_at && <div style={{ fontSize:12, color:'#7fae8f', marginTop:3, fontWeight:600 }}>{'\uD83D\uDC41'} Seller viewed {timeAgo(p.last_viewed_at)}</div>}
                {p.signed_at && <div style={{ fontSize:12, color:CHAMP, marginTop:3, fontWeight:700 }}>{'\u270D\uFE0F'} Signed {timeAgo(p.signed_at)}{p.signature && p.signature.name ? ` by ${p.signature.name}` : ''}</div>}
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                <button onClick={() => open(p.id)} disabled={!!opening} style={btnGhost}>{opening === p.id ? 'Opening\u2026' : 'Open'}</button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

/* -- editor --------------------------------------------------------------
   Two screens, one at a time. The essentials screen holds only what an agent
   must type to produce a credible deck; everything else lives behind More
   details. That is both the UI simplification and half the performance fix -
   the hidden screen isn't mounted, so it costs nothing to type past it.     */
const filledCount = (o, keys) => keys.filter(k => { const v = o ? o[k] : null; return v !== '' && v != null && Number(v) !== 0; }).length;

function Editor({ initial, userId, agentName, onExit, flash, notify }) {
  // Backfill net-sheet units for presentations saved before the %/$ toggle existed:
  // old flat fields were dollar amounts, commission was always a percent.
  const withUnits = (init) => {
    const ns = init.netsheet || {};
    if (!ns.units) return { ...init, netsheet: { ...ns, units: { commission:'pct', title_fees:'usd', tax_proration:'usd', mortgage_payoff:'usd', other:'usd' } } };
    return init;
  };
  const [p, setP] = useState(() => withUnits(initial));
  const [screen, setScreen] = useState('main');           // main | details
  const [researching, setResearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(initial.id || null);
  const [saveState, setSaveState] = useState(initial.id ? 'saved' : 'idle');
  const [shareUrl, setShareUrl] = useState(null);

  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const firstRun = useRef(true);
  const persistRef = useRef(null);

  /* stable setters - required for React.memo on Field/CompCard to pay off */
  const set = useCallback((path, val) => setP(prev => {
    const n = { ...prev }; const seg = path.split('.');
    if (seg.length === 1) n[seg[0]] = val;
    else n[seg[0]] = { ...n[seg[0]], [seg[1]]: val };
    return n;
  }), []);
  const setUnit = useCallback((field, unit) => setP(prev => ({ ...prev, netsheet: { ...prev.netsheet, units: { ...(prev.netsheet.units || {}), [field]: unit } } })), []);
  const setComp = useCallback((i, key, val) => setP(prev => { const comps = [...prev.comps]; comps[i] = { ...comps[i], [key]: val }; return { ...prev, comps }; }), []);
  const addComp = useCallback(() => setP(prev => ({ ...prev, comps: [...prev.comps, { address:'', sale_price:'', gla:'', adjustments:[] }] })), []);
  const rmComp = useCallback((i) => setP(prev => ({ ...prev, comps: prev.comps.filter((_, x) => x !== i) })), []);
  const setPhotos = useCallback((next) => set('photos', next), [set]);
  const setHero = useCallback((url) => set('hero_image_url', url), [set]);
  const photoNotify = useCallback((m, t) => (window.__notify ? window.__notify(m, t) : null), []);

  const num = (o) => { const r = {}; for (const k in o) { const v = o[k]; r[k] = (v === '' || v == null) ? null : (isNaN(Number(v)) ? v : Number(v)); } return r; };
  const payload = () => ({
    user_id: userId, contact_id: p.contact_id || null, deal_id: p.deal_id || null,
    title: (p.title && p.title.trim()) || ((p.address && p.address.trim()) ? p.address.trim() + ' \u2014 Listing Presentation' : 'Untitled presentation'),
    address: (p.address && p.address.trim()) || null, seller_tone: p.seller_tone,
    seller_name: (p.seller_name && p.seller_name.trim()) || null,
    hero_image_url: (p.hero_image_url && p.hero_image_url.trim()) || null,
    agent_video_url: (p.agent_video_url && p.agent_video_url.trim()) || null,
    subject: num(p.subject), market: num(p.market),
    comps: (p.comps || []).map(c => ({ ...c, sale_price: Number(c.sale_price) || 0, gla: c.gla || null, adjustments: c.adjustments || [] })),
    tiers: num(p.tiers), netsheet: num(p.netsheet),
    photos: (p.photos || []).map(u => String(u).trim()).filter(Boolean),
    research: p._research ? { sources: (p._research.sources || []).slice(0, 8), confidence: p._research.confidence || null } : null,
  });

  const generateHTML = (extra = {}) => buildPresentationHTML({ ...payload(), agent_name: agentName, supabase_url: SUPABASE_URL, research_confidence: (p._research && p._research.confidence) || null, ...extra });

  /* One write path for everything. `withHtml:false` is the autosave path -
     it skips rebuilding the 30KB deck, which is the expensive part.
     `.select()` never asks for `html` back: we already have it locally.     */
  const persist = async ({ withHtml = true, quiet = false } = {}) => {
    if (savingRef.current) return null;
    savingRef.current = true;
    setSaveState('saving');
    let html = null;
    try { html = withHtml ? generateHTML() : null; }
    catch (e) { savingRef.current = false; setSaveState('error'); if (!quiet) flash('Could not build the deck: ' + (e.message || e), false); return null; }
    const row = { ...payload(), updated_at: new Date().toISOString() };
    if (html) row.html = html;
    const cols = 'id,share_token,share_enabled,updated_at';
    let res;
    if (savedId) res = await supabase.from('listing_presentations').update(row).eq('id', savedId).select(cols).single();
    else res = await supabase.from('listing_presentations').insert(row).select(cols).single();
    savingRef.current = false;
    if (res.error) {
      setSaveState('error');
      if (!quiet) flash('Could not save: ' + res.error.message, false);
      return null;
    }
    setSavedId(res.data.id);
    dirtyRef.current = false;
    setSaveState('saved');
    return { ...res.data, html };
  };
  useEffect(() => { persistRef.current = persist; });

  /* Autosave. Nothing typed here should ever be lost because the agent walked
     away, backgrounded the tab, or tapped Preview instead of Save. Address is
     the gate so we never create empty ghost rows. */
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    dirtyRef.current = true;
    setSaveState(s => (s === 'saving' ? s : 'unsaved'));
    if (!(p.address || '').trim()) return;
    const t = setTimeout(() => { if (persistRef.current) persistRef.current({ withHtml: false, quiet: true }); }, 2500);
    return () => clearTimeout(t);
  }, [p]);

  const runResearch = async () => {
    const addr = (p.address || '').trim();
    if (!addr) { flash('Enter the property address first.', false); return; }
    setResearching(true);
    try {
      const hint = [p.subject && p.subject.beds && `${p.subject.beds} bed`, p.subject && p.subject.baths && `${p.subject.baths} bath`, p.subject && p.subject.gla && `${p.subject.gla} sqft`].filter(Boolean).join(', ');
      const { data, error } = await supabase.functions.invoke('property-research', { body: { user_id: userId, address: addr, subject_hint: hint } });
      if (error || !data || !data.ok) { flash('Research came up empty \u2014 try again, or enter the numbers by hand below.', false); setResearching(false); return; }
      const r = data.data;
      setP(prev => {
        const next = { ...prev };
        // Subject: only fill blanks - never overwrite what the agent already typed.
        next.subject = { ...prev.subject };
        for (const k of ['gla','beds','baths','lot_size','year_built']) {
          if ((prev.subject && (prev.subject[k] === '' || prev.subject[k] == null)) && r.subject && r.subject[k] != null) next.subject[k] = r.subject[k];
        }
        next.market = { ...prev.market };
        if (r.market && r.market.speed != null) next.market.speed = r.market.speed;
        for (const k of ['moi','list_to_sale','active','pending','closed']) {
          if ((prev.market && (prev.market[k] === '' || prev.market[k] == null)) && r.market && r.market[k] != null) next.market[k] = r.market[k];
        }
        const found = (r.comps || []).map(c => ({
          address: c.address || '', sale_price: c.sale_price || '', gla: c.gla || '',
          beds: c.beds == null ? '' : c.beds, baths: c.baths == null ? '' : c.baths, year_built: c.year_built == null ? '' : c.year_built,
          sold_date: c.sold_date == null ? null : c.sold_date, lot_size: c.lot_size == null ? null : c.lot_size,
          garage: c.garage == null ? null : c.garage, pool: c.pool == null ? null : c.pool,
          condition: c.condition == null ? null : c.condition, condition_basis: c.condition_basis == null ? null : c.condition_basis,
          adjustments: Array.isArray(c.adjustments) ? c.adjustments.map(a => ({ label: a.label, amount: a.amount })) : [],
        }));
        if (found.length) {
          const hasReal = (prev.comps || []).some(c => (c.address || '').trim() || Number(c.sale_price) > 0);
          next.comps = hasReal ? [...prev.comps, ...found] : found;
        }
        const vt = (r.valuation && r.valuation.tiers) || {};
        next.tiers = { ...prev.tiers };
        for (const k of ['opportunistic','target','fast']) {
          if ((prev.tiers && (prev.tiers[k] === '' || prev.tiers[k] == null || Number(prev.tiers[k]) === 0)) && vt[k] != null) next.tiers[k] = vt[k];
        }
        next._research = { sources: r.sources || [], notes: r.notes || '', confidence: r.confidence || 'low', valuation: r.valuation || null };
        if ((next.subject.last_sold_price == null || next.subject.last_sold_price === '') && r.subject && r.subject.last_sold_price != null) next.subject.last_sold_price = r.subject.last_sold_price;
        if ((next.market.annual_appreciation_pct == null || next.market.annual_appreciation_pct === '') && r.market && r.market.annual_appreciation_pct != null) next.market.annual_appreciation_pct = r.market.annual_appreciation_pct;
        if ((next.market.ppsf == null || next.market.ppsf === '') && r.valuation && r.valuation.ppsf != null) next.market.ppsf = r.valuation.ppsf;
        return next;
      });
      const conf = r.confidence === 'high' ? 'strong' : r.confidence === 'medium' ? 'decent' : 'limited';
      flash(`Pulled ${(r.comps || []).length} comp(s) + market data from public sources (${conf} match). Review the numbers before presenting.`, true);
    } catch (_) { flash('Research failed \u2014 please try again.', false); }
    setResearching(false);
  };

  const save = async () => { setBusy(true); const r = await persist({ withHtml: true }); setBusy(false); if (r) flash('Saved.'); return r; };

  const preview = async () => {
    // iOS Safari blocks window.open() that happens AFTER an await (it no longer
    // counts as a user gesture). Open the tab SYNCHRONOUSLY on the tap, show a
    // loading shell, then fill it once the save + HTML are ready.
    const w = window.open('', '_blank');
    if (w) { try { w.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#100D09;color:#EBCB82;font-family:-apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh"><div>Saving and preparing your presentation\u2026</div></body>'); } catch (_) {} }
    setBusy(true);
    const saved = await persist({ withHtml: true });     // preview always saves first
    setBusy(false);
    if (!saved) { if (w) { try { w.close(); } catch (_) {} } return; }
    const html = saved.html || generateHTML();
    if (w && !w.closed) {
      try { w.document.open(); w.document.write(html); w.document.close(); return; } catch (_) {}
    }
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      flash('Saved. Opened your presentation in a new tab.');
    } catch (_) {
      flash('Saved, but preview was blocked. Use \u201CShare with seller\u201D to get a link instead.', false);
    }
  };

  const enableShare = async () => {
    setBusy(true);
    const saved = await persist({ withHtml: true });
    if (!saved) { setBusy(false); return; }
    const tok = saved.share_token || token();
    // Regenerate the deck in SELLER mode: personalized, with the sign-on-the-spot
    // pad wired to this exact share token so the signature posts back correctly.
    const sellerHtml = generateHTML({ sign_mode: true, share_token: tok });
    const { data, error } = await supabase.from('listing_presentations')
      .update({ share_token: tok, share_enabled: true, html: sellerHtml }).eq('id', saved.id).select('share_token').single();
    setBusy(false);
    if (error) { flash('Could not enable sharing: ' + error.message, false); return; }
    const url = `${SUPABASE_URL}/functions/v1/listing-present?t=${data.share_token}`;
    setShareUrl(url);
    try { await navigator.clipboard.writeText(url); flash('Share link copied \u2014 send it to your seller.'); }
    catch (_) { flash('Share link ready (copy it below).'); }
  };

  const goBack = async () => {
    if (screen === 'details') { setScreen('main'); return; }
    if (dirtyRef.current) {
      if ((p.address || '').trim()) { setBusy(true); await persist({ withHtml: true, quiet: true }); setBusy(false); }
      else if (!window.confirm('This presentation has no address yet, so it can\u2019t be saved. Leave and discard it?')) return;
    }
    onExit();
  };

  const recon = useMemo(
    () => reconcileValuation(p.subject, p.comps, { research_confidence: (p._research && p._research.confidence) || null }),
    [p.subject, p.comps, p._research]
  );
  const cond = conditionFor(p.subject.condition_score);

  const detailStatus = useMemo(() => ([
    { k:'Photos',       on: (p.photos || []).length > 0 || !!p.agent_video_url },
    { k:'Property',     on: filledCount(p.subject, ['lot_size','year_built','upgrades','hidden_changes','motivation']) > 0 },
    { k:'Market',       on: filledCount(p.market, ['moi','list_to_sale','active','pending','closed']) > 0 },
    { k:'Seller style', on: !!p.seller_tone && p.seller_tone !== 'auto' },
    { k:'Net sheet',    on: filledCount(p.netsheet, ['mortgage_payoff','title_fees','tax_proration','other']) > 0 },
  ]), [p.photos, p.agent_video_url, p.subject, p.market, p.seller_tone, p.netsheet]);
  const detailsDone = detailStatus.filter(d => d.on).length;

  const statusChip = saveState === 'saving' ? { t:'Saving\u2026', c:'var(--text-3)' }
    : saveState === 'saved' ? { t:'\u2713 All changes saved', c:'#7fae8f' }
    : saveState === 'error' ? { t:'\u26A0 Not saved \u2014 check your connection', c:'#e0794f' }
    : saveState === 'unsaved' ? { t:(p.address || '').trim() ? 'Unsaved changes\u2026' : 'Add an address to start saving', c:'var(--text-3)' }
    : { t:'', c:'var(--text-3)' };

  return (
    <div style={{ maxWidth: 780, margin:'0 auto', padding:'0 4px 60px' }}>
      {notify && <Toast notify={notify} />}

      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10, marginBottom:14 }}>
        <div style={{ flex:'1 1 0', minWidth:0 }}>
          <div style={{ fontFamily:'Barlow Condensed,sans-serif', fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:G, fontSize:12 }}>
            {screen === 'details' ? 'More details' : savedId ? 'Editing' : 'New'} presentation
          </div>
          <h1 style={{ fontFamily:'Fraunces,serif', fontWeight:400, fontSize:26, color:'var(--text-1)', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.address || 'Listing Presentation'}</h1>
          {statusChip.t ? <div style={{ fontSize:11.5, color:statusChip.c, marginTop:4, fontWeight:600 }}>{statusChip.t}</div> : null}
        </div>
        <button onClick={goBack} style={{ ...btnGhost, flexShrink:0 }}>{screen === 'details' ? '\u2190 Done' : '\u2190 Back'}</button>
      </div>

      {screen === 'details' ? (
        <DetailsScreen
          p={p} set={set} setUnit={setUnit} userId={userId}
          setPhotos={setPhotos} setHero={setHero} photoNotify={photoNotify}
          onDone={() => { setScreen('main'); window.scrollTo(0, 0); }}
        />
      ) : (
        <>
          {/* 1. THE PROPERTY */}
          <div style={eyebrow}>The property</div>
          <div style={{ marginBottom:12 }}>
            <label style={lab}>Property address</label>
            <input style={fld} value={p.address == null ? '' : p.address} onChange={e => set('address', e.target.value)} placeholder="4214 W Virginia Ave, Tampa, FL 33607" />
            <button onClick={runResearch} disabled={researching}
              style={{ marginTop:8, width:'100%', background: researching ? 'transparent' : 'rgba(203,163,92,.12)', border:`1px solid ${G}`, color:G, borderRadius:9, padding:'11px 14px', fontWeight:800, fontSize:14, cursor: researching ? 'wait' : 'pointer', opacity: researching ? .6 : 1 }}>
              {researching ? '\u23F3 Researching\u2026' : '\u2728 Auto-research this address'}
            </button>
            <div style={{ fontSize:11, color:'var(--text-3)', marginTop:6 }}>Fills comps, market numbers and property facts from public records. Always review before presenting.</div>
            {p._research && ((p._research.sources && p._research.sources.length) || p._research.notes) ? (
              <div style={{ fontSize:11, color:'var(--text-3)', marginTop:8, padding:'8px 10px', background:'rgba(203,163,92,.06)', border:'1px solid rgba(203,163,92,.18)', borderRadius:8 }}>
                <b style={{ color:'var(--text-2)' }}>Research match: {p._research.confidence}.</b> {p._research.notes ? p._research.notes.slice(0, 220) : ''}
                {p._research.sources && p._research.sources.length ? <div style={{ marginTop:4 }}>Sources: {p._research.sources.slice(0, 4).map((s, i) => (<a key={i} href={s} target="_blank" rel="noreferrer" style={{ color:G, marginRight:8 }}>[{i + 1}]</a>))}</div> : null}
              </div>
            ) : null}
          </div>

          <Field label="Seller name" hint="personalizes the cover" path="seller_name" value={p.seller_name} onSet={set} placeholder="The Henderson Family" wrapStyle={wrapMb12} />

          <div style={gridBeds}>
            <Field label="Beds" path="subject.beds" value={p.subject.beds} onSet={set} inputMode="numeric" />
            <Field label="Baths" path="subject.baths" value={p.subject.baths} onSet={set} inputMode="decimal" />
            <Field label="GLA (sq ft)" path="subject.gla" value={p.subject.gla} onSet={set} inputMode="numeric" />
          </div>

          {/* 2. CONDITION */}
          <div style={eyebrow}>Property condition</div>
          <div style={card}>
            <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:12, flexWrap:'wrap' }}>
              <div style={{ fontFamily:'Fraunces,serif', fontSize:42, color:G, lineHeight:1 }}>{cond.n}<span style={{ fontSize:20, color:'var(--text-3)' }}>/10</span></div>
              <div style={{ fontFamily:'Fraunces,serif', fontSize:22, color:CHAMP }}>{cond.label}</div>
            </div>
            <input type="range" min="1" max="10" step="1" value={p.subject.condition_score} onChange={e => set('subject.condition_score', Number(e.target.value))} style={{ width:'100%', accentColor:G }} />
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-3)', marginTop:2 }}><span>1 {'\u00B7'} Full rehab</span><span>10 {'\u00B7'} Flawless</span></div>
            <div style={{ marginTop:12, fontSize:14, color:'var(--text-2)', fontStyle:'italic', lineHeight:1.5, borderLeft:`2px solid ${G}`, paddingLeft:12 }}>{cond.say}</div>
          </div>

          {/* 3. COMPS + VALUATION */}
          <div style={eyebrow}>Comparables</div>
          {p.comps.map((c, i) => (
            <CompCard key={i} i={i} c={c} canRemove={p.comps.length > 1} onSetComp={setComp} onRemove={rmComp} />
          ))}
          <button onClick={addComp} style={{ ...btnGhost, marginBottom:4 }}>+ Add comp</button>

          {recon.reconciled ? (
            <div style={{ marginTop:14, padding:'14px 16px', background:'rgba(203,163,92,.06)', border:'1px solid rgba(203,163,92,.22)', borderRadius:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10 }}>
                <div style={{ flex:'1 1 0', minWidth:0 }}>
                  <div style={{ fontSize:10.5, letterSpacing:'.14em', textTransform:'uppercase', color:G, fontWeight:700 }}>Reconciled valuation</div>
                  <div style={{ fontSize:26, fontWeight:800, color:'var(--text-1)', fontFamily:'Fraunces, serif', marginTop:2 }}>${recon.reconciled.toLocaleString()}</div>
                  <div style={{ fontSize:11, color:'var(--text-3)', marginTop:2 }}>{recon.tiers.fast ? `$${recon.tiers.fast.toLocaleString()} \u2013 $${recon.tiers.opportunistic.toLocaleString()}` : ''} {'\u00B7'} {recon.comps_used} of {recon.comps_total} comps used</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:10.5, letterSpacing:'.14em', textTransform:'uppercase', color:G, fontWeight:700 }}>Confidence</div>
                  <div style={{ fontSize:20, letterSpacing:2, marginTop:2 }}>{Array.from({ length:5 }, (_, k) => (<span key={k} style={{ color:k < recon.stars ? G : 'rgba(203,163,92,.25)' }}>{'\u2605'}</span>))}</div>
                </div>
              </div>
              <div style={{ fontSize:12, color:'var(--text-2)', marginTop:8, lineHeight:1.5 }}>{recon.confidence_label}. Tune any comp above and this updates live. Set tier prices below to override.</div>
            </div>
          ) : null}

          {/* 4. PRICING */}
          <div style={eyebrow}>Three-tier pricing</div>
          <div style={gridTiers}>
            <Field label="Opportunistic" path="tiers.opportunistic" value={p.tiers.opportunistic} onSet={set} inputMode="numeric" placeholder="729000" />
            <Field label={'Target \u2605'} path="tiers.target" value={p.tiers.target} onSet={set} inputMode="numeric" placeholder="699000" />
            <Field label="Fast sale" path="tiers.fast" value={p.tiers.fast} onSet={set} inputMode="numeric" placeholder="669000" />
          </div>

          {/* 5. MORE DETAILS */}
          <button onClick={() => { setScreen('details'); window.scrollTo(0, 0); }}
            style={{ display:'flex', alignItems:'center', gap:12, width:'100%', textAlign:'left', marginTop:22, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'14px 16px', cursor:'pointer' }}>
            {p.hero_image_url
              ? <img src={p.hero_image_url} alt="" loading="lazy" decoding="async" style={{ width:44, height:44, borderRadius:8, objectFit:'cover', flexShrink:0 }} />
              : <span style={{ width:44, height:44, borderRadius:8, background:'rgba(203,163,92,.10)', color:G, display:'grid', placeItems:'center', fontSize:19, flexShrink:0 }}>{'\u2699'}</span>}
            <span style={{ flex:'1 1 0', minWidth:0 }}>
              <span style={{ display:'block', fontWeight:800, fontSize:15, color:'var(--text-1)' }}>More details</span>
              <span style={{ display:'block', fontSize:11.5, color:'var(--text-3)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis' }}>
                {detailStatus.map(d => (d.on ? '\u2713 ' : '') + d.k).join(' \u00B7 ')}
              </span>
            </span>
            <span style={{ flexShrink:0, fontSize:11, fontWeight:800, color:G, whiteSpace:'nowrap' }}>{detailsDone}/{detailStatus.length} {'\u203A'}</span>
          </button>
          <div style={{ fontSize:11, color:'var(--text-3)', marginTop:6, paddingLeft:2 }}>Photos, market numbers, seller style and the net sheet. Optional {'\u2014'} the deck builds without them.</div>
        </>
      )}

      {/* ACTIONS */}
      <div style={{ position:'sticky', bottom:0, background:'var(--bg-base)', borderTop:'1px solid var(--border)', padding:'12px 0 max(12px, env(safe-area-inset-bottom))', marginTop:24 }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={save} disabled={busy} style={{ ...btnGhost, flex:'1 1 100px', padding:'11px 14px' }}>{busy ? 'Working\u2026' : 'Save'}</button>
          <button onClick={preview} disabled={busy} style={{ background:CHAMP, color:INK, border:'none', borderRadius:9, padding:'11px 20px', fontWeight:800, fontSize:14, cursor:'pointer', flex:'2 1 160px', opacity:busy ? .6 : 1 }}>{'\u25B6'} Preview presentation</button>
          <button onClick={enableShare} disabled={busy} style={{ ...btnGhost, flex:'1 1 120px', padding:'11px 14px' }}>{'\uD83D\uDD17'} Share with seller</button>
        </div>
        {shareUrl && <div style={{ marginTop:10, background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--text-2)', wordBreak:'break-all' }}>{shareUrl}</div>}
      </div>
    </div>
  );
}

const wrapMb12 = { marginBottom:12 };
const wrapMt12 = { marginTop:12 };
const gridBeds = { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(100px,1fr))', gap:10, marginBottom:4 };
const gridTiers = { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 };
const NEW_ROOF_PH = 'New roof (2024), quartz kitchen, impact windows, renovated primary bath\u2026';
const MOTIV_PH = 'Relocating for work \u2014 needs to close by spring';

/* -- More details screen -------------------------------------------------- */
function DetailsScreen({ p, set, setUnit, userId, setPhotos, setHero, photoNotify, onDone }) {
  return (
    <>
      <div style={{ ...eyebrow, marginTop:0 }}>Photos & video</div>
      <PhotoUploader photos={p.photos} hero={p.hero_image_url} userId={userId} onChange={setPhotos} onSetHero={setHero} notify={photoNotify} />
      <Field label="Agent welcome video" hint="optional" path="agent_video_url" value={p.agent_video_url} onSet={set} placeholder="YouTube / Vimeo / .mp4 link" wrapStyle={wrapMt12} />

      <div style={eyebrow}>Property details</div>
      <div style={grid(120)}>
        <Field label="Lot size" path="subject.lot_size" value={p.subject.lot_size} onSet={set} />
        <Field label="Year built" path="subject.year_built" value={p.subject.year_built} onSet={set} inputMode="numeric" />
      </div>
      <Field label="Upgrades & improvements" path="subject.upgrades" value={p.subject.upgrades} onSet={set} multiline placeholder={NEW_ROOF_PH} wrapStyle={wrapMt12} />
      <Field label="Changes not in public record" path="subject.hidden_changes" value={p.subject.hidden_changes} onSet={set} multiline placeholder="Lanai permitted & converted to a 4th bedroom; garage insulated as flex office; well added for irrigation" wrapStyle={wrapMt12} />
      <Field label="Owner motivation / objective" path="subject.motivation" value={p.subject.motivation} onSet={set} placeholder={MOTIV_PH} wrapStyle={wrapMt12} />

      <div style={eyebrow}>Micro-market</div>
      <div style={grid(120)}>
        <Field label="Months of inventory" path="market.moi" value={p.market.moi} onSet={set} inputMode="decimal" />
        <Field label="List-to-sale %" path="market.list_to_sale" value={p.market.list_to_sale} onSet={set} inputMode="decimal" />
        <Field label="Active" path="market.active" value={p.market.active} onSet={set} inputMode="numeric" />
        <Field label="Pending" path="market.pending" value={p.market.pending} onSet={set} inputMode="numeric" />
        <Field label="Closed (90d)" path="market.closed" value={p.market.closed} onSet={set} inputMode="numeric" />
      </div>
      <div style={wrapMt12}>
        <label style={lab}>Market speed <span style={labSoft}>{'\u2014 buyer\u2019s \u2190 \u2192 seller\u2019s: '}{p.market.speed}</span></label>
        <input type="range" min="0" max="100" value={p.market.speed} onChange={e => set('market.speed', Number(e.target.value))} style={{ width:'100%', accentColor:G }} />
      </div>

      <div style={eyebrow}>Seller{'\u2019'}s style (DISC framing)</div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        {[['auto','Auto'],['analytical','Analytical (C)'],['direct','Direct (D)'],['relational','Relational (I/S)']].map(([v, l]) => (
          <button key={v} onClick={() => set('seller_tone', v)} style={{ padding:'8px 15px', borderRadius:100, cursor:'pointer', fontSize:13, fontWeight:p.seller_tone === v ? 700 : 500, border:`1px solid ${p.seller_tone === v ? G : 'var(--border)'}`, background:p.seller_tone === v ? 'rgba(203,163,92,.15)' : 'transparent', color:p.seller_tone === v ? G : 'var(--text-2)' }}>{l}</button>
        ))}
      </div>

      <div style={eyebrow}>Seller net sheet</div>
      <div style={{ fontSize:11, color:'var(--text-3)', margin:'-4px 0 8px' }}>Tap <b>%</b> or <b>$</b> on each line to set how that number is read. A % is calculated against the sale price; a $ is a flat amount.</div>
      <div style={grid(150)}>
        {[
          ['commission_pct','commission','Commission'],
          ['mortgage_payoff','mortgage_payoff','Mortgage payoff'],
          ['title_fees','title_fees','Title & closing'],
          ['tax_proration','tax_proration','Tax proration'],
          ['other','other','Other'],
        ].map(([valKey, unitKey, label]) => {
          const unit = (p.netsheet.units && p.netsheet.units[unitKey]) || (unitKey === 'commission' ? 'pct' : 'usd');
          const pill = (u) => ({ padding:'2px 9px', fontSize:12, fontWeight:800, cursor:'pointer', border:'1px solid var(--border)', background: unit === u ? G : 'transparent', color: unit === u ? INK : 'var(--text-3)', borderRadius: u === 'pct' ? '7px 0 0 7px' : '0 7px 7px 0', lineHeight:'18px' });
          return (
            <div key={valKey}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4, gap:8 }}>
                <label style={{ ...lab, margin:0, flex:'1 1 0', minWidth:0 }}>{label}</label>
                <div style={{ display:'inline-flex', flexShrink:0 }}>
                  <button type="button" onClick={() => setUnit(unitKey, 'pct')} style={pill('pct')}>%</button>
                  <button type="button" onClick={() => setUnit(unitKey, 'usd')} style={{ ...pill('usd'), borderLeft:'none' }}>$</button>
                </div>
              </div>
              <div style={{ position:'relative' }}>
                <span style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)', fontSize:14, pointerEvents:'none' }}>{unit === 'usd' ? '$' : ''}</span>
                <input style={{ ...fld, paddingLeft: unit === 'usd' ? 22 : 11, paddingRight: unit === 'pct' ? 24 : 11 }} value={p.netsheet[valKey] == null ? '' : p.netsheet[valKey]} onChange={e => set('netsheet.' + valKey, e.target.value)} inputMode="decimal" placeholder={unit === 'pct' ? '2.4' : '9200'} />
                <span style={{ position:'absolute', right:11, top:'50%', transform:'translateY(-50%)', color:'var(--text-3)', fontSize:14, pointerEvents:'none' }}>{unit === 'pct' ? '%' : ''}</span>
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={onDone} style={{ marginTop:22, width:'100%', background:'transparent', border:`1px solid ${G}`, color:G, borderRadius:9, padding:'12px', fontWeight:800, fontSize:14, cursor:'pointer' }}>{'\u2190'} Back to essentials</button>
    </>
  );
}
