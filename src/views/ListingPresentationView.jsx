import React, { useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '../dataService';
import { CONDITION_SCALE, conditionFor, buildPresentationHTML } from '../listingPresentation';

const G = '#CBA35C', CHAMP = '#EBCB82', INK = '#100D09';
const money = (n) => (n || n === 0) ? '$' + Number(n).toLocaleString('en-US') : '';
const token = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 22);

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
    subject: { gla:'', beds:'', baths:'', lot_size:'', year_built:'', condition_score:7, upgrades:'', hidden_changes:'', motivation:'' },
    market: { speed:55, moi:'', list_to_sale:'', active:'', pending:'', closed:'' },
    comps: [{ address:'', sale_price:'', gla:'', adjustments:[] }],
    tiers: { opportunistic:'', target:'', fast:'' },
    netsheet: { commission_pct:6, mortgage_payoff:'', title_fees:'', tax_proration:'', other:'' },
  });

  const flash = (t, ok=true) => { setNotify({ t, ok }); setTimeout(()=>setNotify(null), 4000); };

  if (mode === 'edit') return <Editor initial={editing} userId={userId} agentName={agentName} onDone={()=>{setMode('list');load();}} onCancel={()=>setMode('list')} flash={flash} notify={notify} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 4px 40px' }}>
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
  const [p, setP] = useState(initial);
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
    subject: num(p.subject), market: num(p.market),
    comps: (p.comps||[]).map(c=>({ ...c, sale_price:Number(c.sale_price)||0, gla:c.gla||null, adjustments:c.adjustments||[] })),
    tiers: num(p.tiers), netsheet: num(p.netsheet),
  });

  const generateHTML = () => buildPresentationHTML({ ...payload(), agent_name: agentName });

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
    const saved = await save(); if (!saved) return;
    const w = window.open('', '_blank');
    if (w) { w.document.write(saved.html || generateHTML()); w.document.close(); }
    else flash('Allow pop-ups to preview, or use Share/Email.', false);
  };

  const enableShare = async () => {
    const saved = await save(); if (!saved) return;
    let tok = saved.share_token;
    if (!tok) { tok = token(); }
    const { data, error } = await supabase.from('listing_presentations').update({ share_token: tok, share_enabled: true }).eq('id', saved.id).select().single();
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
      <div style={{ marginBottom:12 }}><label style={lab}>Property address</label><input style={fld} value={p.address} onChange={e=>set('address',e.target.value)} placeholder="4214 W Virginia Ave, Tampa, FL 33607" /></div>
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
      {p.comps.map((c,i)=>(
        <div key={i} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:12, marginBottom:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}><span style={{ fontSize:12, color:'var(--text-3)', fontWeight:700 }}>Comp {i+1}</span>{p.comps.length>1 && <button onClick={()=>rmComp(i)} style={{ background:'none', border:'none', color:'#e0794f', cursor:'pointer', fontSize:12 }}>Remove</button>}</div>
          <input style={{...fld, marginBottom:8}} value={c.address} onChange={e=>setComp(i,'address',e.target.value)} placeholder="Comp address" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
            <input style={fld} value={c.sale_price} onChange={e=>setComp(i,'sale_price',e.target.value)} placeholder="Sale price" inputMode="numeric" />
            <input style={fld} value={c.gla} onChange={e=>setComp(i,'gla',e.target.value)} placeholder="GLA (sq ft)" inputMode="numeric" />
          </div>
        </div>
      ))}
      <button onClick={addComp} style={{...btnGhost, marginBottom:4}}>+ Add comp</button>

      {/* TIERS */}
      <div style={eyebrow}>Three-tier pricing</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
        <div><label style={lab}>Opportunistic</label><input style={fld} value={p.tiers.opportunistic} onChange={e=>set('tiers.opportunistic',e.target.value)} inputMode="numeric" placeholder="729000" /></div>
        <div><label style={lab}>Target ★</label><input style={fld} value={p.tiers.target} onChange={e=>set('tiers.target',e.target.value)} inputMode="numeric" placeholder="699000" /></div>
        <div><label style={lab}>Fast sale</label><input style={fld} value={p.tiers.fast} onChange={e=>set('tiers.fast',e.target.value)} inputMode="numeric" placeholder="669000" /></div>
      </div>

      {/* NET SHEET */}
      <div style={eyebrow}>Seller net sheet</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))', gap:10 }}>
        <div><label style={lab}>Commission %</label><input style={fld} value={p.netsheet.commission_pct} onChange={e=>set('netsheet.commission_pct',e.target.value)} inputMode="numeric" /></div>
        <div><label style={lab}>Mortgage payoff</label><input style={fld} value={p.netsheet.mortgage_payoff} onChange={e=>set('netsheet.mortgage_payoff',e.target.value)} inputMode="numeric" /></div>
        <div><label style={lab}>Title & closing</label><input style={fld} value={p.netsheet.title_fees} onChange={e=>set('netsheet.title_fees',e.target.value)} inputMode="numeric" /></div>
        <div><label style={lab}>Tax proration</label><input style={fld} value={p.netsheet.tax_proration} onChange={e=>set('netsheet.tax_proration',e.target.value)} inputMode="numeric" /></div>
        <div><label style={lab}>Other</label><input style={fld} value={p.netsheet.other} onChange={e=>set('netsheet.other',e.target.value)} inputMode="numeric" /></div>
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
