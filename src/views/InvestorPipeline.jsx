import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

const GOLD = '#CBA35C', CHAMP = '#EBCB82';
const money = (n) => (n || n === 0) ? '$' + Math.round(Number(n)).toLocaleString('en-US') : '—';

const TYPES = [
  ['fix_flip', 'Fix & Flip'], ['wholesaler', 'Wholesaler'], ['rental', 'Buy & Hold'],
  ['multifamily', 'Multifamily'], ['agent_client', 'Agent for client'], ['developer', 'Developer'], ['land', 'Land'],
];
const PROP_TYPES = [
  ['sfr', 'Single-family'], ['condo', 'Condo / Townhome'], ['duplex', 'Duplex/Tri/Quad'],
  ['multi', '5+ Multifamily'], ['manufactured', 'Manufactured'], ['land', 'Land'], ['commercial', 'Commercial'],
];
const CONDITIONS = [['turnkey', 'Turnkey'], ['light', 'Light cosmetic'], ['full_rehab', 'Full rehab'], ['teardown', 'Teardown']];

function Chip({ on, label, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{ border: '1px solid ' + (on ? GOLD : 'var(--border)'), background: on ? 'rgba(203,163,92,.16)' : 'transparent',
        color: on ? CHAMP : 'var(--text-2)', borderRadius: 20, padding: '6px 12px', fontSize: 12.5, fontWeight: on ? 700 : 500, cursor: 'pointer', margin: '0 6px 6px 0' }}>
      {label}
    </button>
  );
}
const field = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '10px 12px', fontSize: 13.5, marginBottom: 10 };
const label = { fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '4px 0 5px', fontWeight: 600 };

// ── Investor buy-box form (the questionnaire) ────────────────────────────────
function BuyerForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({
    id: initial?.id || '', name: initial?.name || '', company: initial?.company || '',
    email: initial?.email || '', phone: initial?.phone || '',
    investor_types: initial?.investor_types || [], markets: (initial?.markets || []).join(', '),
    property_types: initial?.property_types || [], condition_tolerance: initial?.condition_tolerance || [],
    occupancy_ok: initial?.occupancy_ok || 'any',
    price_min: initial?.price_min || '', price_max: initial?.price_max || '',
    beds_min: initial?.beds_min || '', baths_min: initial?.baths_min || '',
    cap_rate_min: initial?.deal_metrics?.cap_rate_min || '', flip_margin_min: initial?.deal_metrics?.flip_margin_min || '',
    rehab_budget_max: initial?.deal_metrics?.rehab_budget_max || '',
    pays_buyer_comp: initial?.pays_buyer_comp ?? null, buyer_comp: initial?.buyer_comp || '',
    exit_strategy: initial?.exit_strategy || '', notes: initial?.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const toggle = (k, v) => setF(o => ({ ...o, [k]: o[k].includes(v) ? o[k].filter(x => x !== v) : [...o[k], v] }));
  const isFlip = f.investor_types.includes('fix_flip') || f.investor_types.includes('wholesaler');
  const isRental = f.investor_types.includes('rental') || f.investor_types.includes('multifamily');

  const save = async () => {
    if (!f.name.trim()) { alert('Give this investor a name.'); return; }
    setBusy(true);
    const deal_metrics = {};
    if (f.cap_rate_min) deal_metrics.cap_rate_min = f.cap_rate_min;
    if (f.flip_margin_min) deal_metrics.flip_margin_min = f.flip_margin_min;
    if (f.rehab_budget_max) deal_metrics.rehab_budget_max = f.rehab_budget_max;
    const payload = {
      id: f.id || undefined, name: f.name, company: f.company, email: f.email, phone: f.phone,
      investor_types: f.investor_types, property_types: f.property_types, condition_tolerance: f.condition_tolerance,
      occupancy_ok: f.occupancy_ok, price_min: f.price_min, price_max: f.price_max,
      beds_min: f.beds_min, baths_min: f.baths_min,
      markets: f.markets.split(',').map(s => s.trim()).filter(Boolean),
      deal_metrics, pays_buyer_comp: f.pays_buyer_comp, buyer_comp: f.buyer_comp,
      exit_strategy: f.exit_strategy, notes: f.notes,
    };
    try { await supabase.rpc('investor_save_buyer', { p: payload }); onSaved(); }
    catch (e) { alert('Could not save: ' + (e.message || e)); }
    setBusy(false);
  };

  return (
    <div>
      <div style={{ background: 'rgba(203,163,92,.06)', border: '1px solid rgba(203,163,92,.25)', borderRadius: 12, padding: '10px 13px', marginBottom: 14, fontSize: 12.5, color: 'var(--text-2)' }}>
        🔒 This investor is <b style={{ color: CHAMP }}>private to you</b>. Other agents can feed properties into the pool, but they never see who your buyers are — matches come back to you.
      </div>

      <div style={label}>Investor name *</div>
      <input style={field} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Marcus Reilly" />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={label}>Email</div><input style={field} value={f.email} onChange={e => set('email', e.target.value)} /></div>
        <div style={{ flex: 1 }}><div style={label}>Phone</div><input style={field} value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
      </div>

      <div style={label}>Investor type</div>
      <div>{TYPES.map(([v, l]) => <Chip key={v} label={l} on={f.investor_types.includes(v)} onClick={() => toggle('investor_types', v)} />)}</div>

      <div style={label}>Markets (cities or ZIPs, comma-separated)</div>
      <input style={field} value={f.markets} onChange={e => set('markets', e.target.value)} placeholder="Wesley Chapel, Lutz, 33543" />

      <div style={label}>Property types</div>
      <div>{PROP_TYPES.map(([v, l]) => <Chip key={v} label={l} on={f.property_types.includes(v)} onClick={() => toggle('property_types', v)} />)}</div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={label}>Price min</div><input style={field} type="number" value={f.price_min} onChange={e => set('price_min', e.target.value)} placeholder="250000" /></div>
        <div style={{ flex: 1 }}><div style={label}>Price max</div><input style={field} type="number" value={f.price_max} onChange={e => set('price_max', e.target.value)} placeholder="450000" /></div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={label}>Beds min</div><input style={field} type="number" value={f.beds_min} onChange={e => set('beds_min', e.target.value)} /></div>
        <div style={{ flex: 1 }}><div style={label}>Baths min</div><input style={field} type="number" value={f.baths_min} onChange={e => set('baths_min', e.target.value)} /></div>
      </div>

      <div style={label}>Condition they'll take</div>
      <div>{CONDITIONS.map(([v, l]) => <Chip key={v} label={l} on={f.condition_tolerance.includes(v)} onClick={() => toggle('condition_tolerance', v)} />)}</div>

      <div style={label}>Tenant-occupied?</div>
      <div>
        {[['any', 'Either is fine'], ['vacant_only', 'Vacant only']].map(([v, l]) =>
          <Chip key={v} label={l} on={f.occupancy_ok === v} onClick={() => set('occupancy_ok', v)} />)}
      </div>

      {isRental && (
        <><div style={label}>Min cap rate (%)</div>
          <input style={field} type="number" value={f.cap_rate_min} onChange={e => set('cap_rate_min', e.target.value)} placeholder="7" /></>
      )}
      {isFlip && (
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><div style={label}>Min flip margin (%)</div><input style={field} type="number" value={f.flip_margin_min} onChange={e => set('flip_margin_min', e.target.value)} placeholder="20" /></div>
          <div style={{ flex: 1 }}><div style={label}>Max rehab ($)</div><input style={field} type="number" value={f.rehab_budget_max} onChange={e => set('rehab_budget_max', e.target.value)} placeholder="60000" /></div>
        </div>
      )}

      <div style={label}>Will they pay a buyer-agent commission?</div>
      <div>
        {[['yes', 'Yes', true], ['no', 'Listing side', false]].map(([k, l, val]) =>
          <Chip key={k} label={l} on={f.pays_buyer_comp === val} onClick={() => set('pays_buyer_comp', val)} />)}
      </div>

      <div style={label}>Notes / anything else</div>
      <textarea style={{ ...field, minHeight: 60 }} value={f.notes} onChange={e => set('notes', e.target.value)} />

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={save} disabled={busy} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>{busy ? 'Saving…' : 'Save investor'}</button>
        <button onClick={onCancel} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 16px', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Property submit form with the live "matches N buyers" hook ───────────────
function PropertyForm({ onSaved, onCancel }) {
  const [f, setF] = useState({
    address: '', city: '', state: 'FL', zip: '', property_type: 'sfr', condition: 'turnkey', occupancy: 'vacant',
    price: '', beds: '', baths: '', sqft: '', arv_estimate: '', rehab_estimate: '', rent_estimate: '', cap_rate: '',
    source: 'off_market', assignable: false, buyer_comp_offered: '', notes: '',
  });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));

  // live match-count preview as they fill in the key fields
  useEffect(() => {
    let go = true;
    const t = setTimeout(async () => {
      if (!f.city && !f.zip) { setPreview(null); return; }
      try {
        const { data } = await supabase.rpc('investor_match_preview', {
          p_city: f.city || null, p_zip: f.zip || null, p_type: f.property_type, p_price: f.price ? Number(f.price) : null,
          p_condition: f.condition, p_occupancy: f.occupancy, p_cap_rate: f.cap_rate ? Number(f.cap_rate) : null,
          p_arv: f.arv_estimate ? Number(f.arv_estimate) : null, p_rehab: f.rehab_estimate ? Number(f.rehab_estimate) : null,
          p_rent: f.rent_estimate ? Number(f.rent_estimate) : null, p_beds: f.beds ? Number(f.beds) : null, p_baths: f.baths ? Number(f.baths) : null,
        });
        if (go) setPreview(data);
      } catch (_) { if (go) setPreview(null); }
    }, 500);
    return () => { go = false; clearTimeout(t); };
  }, [f.city, f.zip, f.property_type, f.price, f.condition, f.occupancy, f.cap_rate, f.arv_estimate, f.rehab_estimate, f.rent_estimate, f.beds, f.baths]);

  const save = async () => {
    if (!f.address.trim()) { alert('Add an address.'); return; }
    setBusy(true);
    try { const { data } = await supabase.rpc('investor_save_property', { p: f }); setResult(data); }
    catch (e) { alert('Could not submit: ' + (e.message || e)); }
    setBusy(false);
  };

  if (result) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 10px' }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>{result.match_count > 0 ? '🎯' : '✓'}</div>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, color: 'var(--text-1)', marginBottom: 6 }}>
          {result.match_count > 0 ? 'Matched ' + result.match_count + ' buyer' + (result.match_count === 1 ? '' : 's') + '!' : 'Property added.'}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 18, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
          {result.match_count > 0
            ? "The agents who own those buyers have been matched — they'll present it to their investor. You keep the listing side."
            : "It's in the pool. If a buyer that fits comes in later, you'll get matched automatically."}
        </div>
        <button onClick={onSaved} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 800, cursor: 'pointer' }}>Done</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: 'rgba(203,163,92,.06)', border: '1px solid rgba(203,163,92,.25)', borderRadius: 12, padding: '10px 13px', marginBottom: 14, fontSize: 12.5, color: 'var(--text-2)' }}>
        Add an off-market, pocket, or coming-soon property. PrismOS matches it against every agent's investor buy-boxes and routes fits to those agents — <b style={{ color: CHAMP }}>you never lose the listing side</b>.
      </div>

      <div style={label}>Address *</div>
      <input style={field} value={f.address} onChange={e => set('address', e.target.value)} placeholder="123 Oak St" />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 2 }}><div style={label}>City</div><input style={field} value={f.city} onChange={e => set('city', e.target.value)} placeholder="Wesley Chapel" /></div>
        <div style={{ flex: 1 }}><div style={label}>ZIP</div><input style={field} value={f.zip} onChange={e => set('zip', e.target.value)} placeholder="33543" /></div>
      </div>

      <div style={label}>Property type</div>
      <div>{PROP_TYPES.map(([v, l]) => <Chip key={v} label={l} on={f.property_type === v} onClick={() => set('property_type', v)} />)}</div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={label}>Price</div><input style={field} type="number" value={f.price} onChange={e => set('price', e.target.value)} placeholder="400000" /></div>
        <div style={{ flex: 1 }}><div style={label}>Beds</div><input style={field} type="number" value={f.beds} onChange={e => set('beds', e.target.value)} /></div>
        <div style={{ flex: 1 }}><div style={label}>Baths</div><input style={field} type="number" value={f.baths} onChange={e => set('baths', e.target.value)} /></div>
      </div>

      <div style={label}>Condition</div>
      <div>{CONDITIONS.map(([v, l]) => <Chip key={v} label={l} on={f.condition === v} onClick={() => set('condition', v)} />)}</div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={label}>Cap rate (%)</div><input style={field} type="number" value={f.cap_rate} onChange={e => set('cap_rate', e.target.value)} placeholder="for rentals" /></div>
        <div style={{ flex: 1 }}><div style={label}>Est. rent /mo</div><input style={field} type="number" value={f.rent_estimate} onChange={e => set('rent_estimate', e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={label}>ARV</div><input style={field} type="number" value={f.arv_estimate} onChange={e => set('arv_estimate', e.target.value)} placeholder="for flips" /></div>
        <div style={{ flex: 1 }}><div style={label}>Est. rehab</div><input style={field} type="number" value={f.rehab_estimate} onChange={e => set('rehab_estimate', e.target.value)} /></div>
      </div>

      <div style={label}>Notes</div>
      <textarea style={{ ...field, minHeight: 54 }} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Off-market, motivated seller, etc." />

      {preview !== null && (
        <div style={{ textAlign: 'center', padding: '10px', marginBottom: 12, borderRadius: 12, background: preview > 0 ? 'rgba(203,163,92,.12)' : 'transparent', border: '1px solid ' + (preview > 0 ? 'rgba(203,163,92,.4)' : 'var(--border)') }}>
          {preview > 0
            ? <span style={{ color: CHAMP, fontWeight: 700, fontSize: 14 }}>🎯 Matches {preview} investor{preview === 1 ? '' : 's'} in the pool right now</span>
            : <span style={{ color: 'var(--text-3)', fontSize: 13 }}>No buyers match yet — it'll still go in the pool for future matches.</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={busy} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>{busy ? 'Submitting…' : 'Submit to pool'}</button>
        <button onClick={onCancel} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 16px', cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function InvestorPipeline({ userId }) {
  const [tab, setTab] = useState('investors');
  const [buyers, setBuyers] = useState(null);
  const [matches, setMatches] = useState(null);
  const [properties, setProperties] = useState(null);
  const [editing, setEditing] = useState(null);   // buyer object or 'new'
  const [adding, setAdding] = useState(false);

  const loadBuyers = useCallback(async () => {
    try { const { data } = await supabase.rpc('investor_my_buyers'); setBuyers(Array.isArray(data) ? data : []); } catch (_) { setBuyers([]); }
  }, []);
  const loadMatches = useCallback(async () => {
    try { const { data } = await supabase.rpc('investor_my_matches'); setMatches(Array.isArray(data) ? data : []); } catch (_) { setMatches([]); }
  }, []);
  const loadProps = useCallback(async () => {
    try { const { data } = await supabase.rpc('investor_my_properties'); setProperties(Array.isArray(data) ? data : []); } catch (_) { setProperties([]); }
  }, []);
  useEffect(() => { loadBuyers(); loadMatches(); loadProps(); }, [loadBuyers, loadMatches, loadProps]);

  const act = async (mid, status) => {
    try { await supabase.rpc('investor_match_status', { p_match_id: mid, p_status: status }); loadMatches(); } catch (_) {}
  };

  const tabBtn = (k, lbl, n) => (
    <button onClick={() => setTab(k)} style={{ background: 'transparent', border: 'none', borderBottom: '2px solid ' + (tab === k ? GOLD : 'transparent'), color: tab === k ? 'var(--text-1)' : 'var(--text-3)', fontSize: 13, fontWeight: tab === k ? 700 : 500, padding: '9px 14px', cursor: 'pointer' }}>
      {lbl}{n ? <span style={{ marginLeft: 6, fontSize: 11, background: 'rgba(203,163,92,.18)', color: CHAMP, borderRadius: 20, padding: '1px 7px' }}>{n}</span> : null}
    </button>
  );

  const newMatchCount = (matches || []).filter(m => m.status === 'new').length;

  return (
    <div className="ww-prism" style={{ minHeight: '100%', padding: '18px 16px 90px' }}>
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--border:rgba(203,163,92,.20);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;}`}</style>

      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: GOLD }}>Investor Pipeline</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30, margin: '2px 0 4px', color: 'var(--text-1)' }}>Match buyers to deals.</h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>Your investors stay private. The whole brokerage feeds the property pool. Fits come back to you.</div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {tabBtn('investors', 'My Investors', (buyers || []).length)}
        {tabBtn('matches', 'Matches', newMatchCount || null)}
        {tabBtn('property', 'Add Property')}
      </div>

      {/* MY INVESTORS */}
      {tab === 'investors' && (
        editing ? (
          <BuyerForm initial={editing === 'new' ? null : editing} onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); loadBuyers(); loadMatches(); }} />
        ) : (
          <div>
            <button onClick={() => setEditing('new')} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', marginBottom: 14 }}>+ Add investor</button>
            {buyers === null ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
              : buyers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-3)' }}>
                  <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, color: 'var(--text-2)', marginBottom: 6 }}>No investors yet.</div>
                  <div style={{ fontSize: 13 }}>Add an investor's buy-box and the whole brokerage starts hunting for their deal — privately, for you.</div>
                </div>
              ) : buyers.map(b => (
                <div key={b.id} onClick={() => setEditing(b)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '13px 15px', marginBottom: 10, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>{b.name || 'Unnamed investor'}</span>
                    {b.match_count > 0 && <span style={{ fontSize: 11.5, background: 'rgba(203,163,92,.18)', color: CHAMP, borderRadius: 20, padding: '2px 9px', fontWeight: 700 }}>{b.match_count} match{b.match_count === 1 ? '' : 'es'}</span>}
                    {b.status === 'paused' && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>paused</span>}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
                    {(b.investor_types || []).map(t => (TYPES.find(x => x[0] === t) || [, t])[1]).join(', ') || '—'}
                    {b.price_max ? ' · up to ' + money(b.price_max) : ''}
                    {(b.markets || []).length ? ' · ' + b.markets.slice(0, 3).join(', ') : ''}
                  </div>
                </div>
              ))}
          </div>
        )
      )}

      {/* MATCHES */}
      {tab === 'matches' && (
        matches === null ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
          : matches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-3)' }}>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, color: 'var(--text-2)', marginBottom: 6 }}>No matches yet.</div>
              <div style={{ fontSize: 13 }}>When any agent adds a property that fits one of your investors, it shows up here for you to present.</div>
            </div>
          ) : matches.map(m => {
            const p = m.property;
            return (
              <div key={m.match_id} style={{ background: 'var(--bg-card)', border: '1px solid ' + (m.status === 'new' ? 'rgba(203,163,92,.5)' : 'var(--border)'), borderRadius: 14, padding: '14px 15px', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  {m.status === 'new' && <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', color: CHAMP, textTransform: 'uppercase' }}>New</span>}
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>{p.address}{p.city ? ', ' + p.city : ''}</span>
                  <span style={{ fontSize: 13, color: CHAMP, fontWeight: 700 }}>{money(p.price)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 4 }}>For <b>{m.buyer_name}</b> · {m.reason}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 10 }}>
                  {(PROP_TYPES.find(x => x[0] === p.type) || [, p.type])[1]}{p.beds ? ' · ' + p.beds + 'bd' : ''}{p.baths ? '/' + p.baths + 'ba' : ''}
                  {p.cap_rate ? ' · ' + p.cap_rate + '% cap' : ''}{p.condition ? ' · ' + (CONDITIONS.find(x => x[0] === p.condition) || [, p.condition])[1] : ''}
                  {p.buyer_comp_offered ? ' · comp: ' + p.buyer_comp_offered : ''}
                </div>
                {m.status === 'new' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => act(m.match_id, 'presented')} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 9, padding: '8px 15px', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Present to my buyer</button>
                    <button onClick={() => act(m.match_id, 'passed')} style={{ background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, cursor: 'pointer' }}>Not a fit</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: m.status === 'interested' ? '#22c55e' : 'var(--text-3)' }}>
                      {m.status === 'presented' ? 'Presented' : m.status === 'interested' ? 'Buyer interested' : m.status === 'passed' ? 'Passed' : m.status}
                    </span>
                    {m.status === 'presented' && <button onClick={() => act(m.match_id, 'interested')} style={{ background: 'transparent', color: '#22c55e', border: '1px solid rgba(34,197,94,.4)', borderRadius: 9, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>Mark interested</button>}
                  </div>
                )}
              </div>
            );
          })
      )}

      {/* ADD PROPERTY */}
      {tab === 'property' && (
        adding ? (
          <PropertyForm onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); loadProps(); }} />
        ) : (
          <div>
            <button onClick={() => setAdding(true)} style={{ background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', marginBottom: 14 }}>+ Add a property to the pool</button>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 14 }}>Off-market, pocket, or coming-soon listings you can move. We match them to the whole brokerage's investors and route fits back to those agents — you keep the listing side.</div>
            {properties === null ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
              : properties.length === 0 ? <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Nothing in the pool from you yet.</div>
              : properties.map(p => (
                <div key={p.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 15px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)', flex: 1 }}>{p.address}{p.city ? ', ' + p.city : ''}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{money(p.price)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                    {p.match_count > 0
                      ? <span style={{ color: CHAMP }}>🎯 matched {p.match_count} investor{p.match_count === 1 ? '' : 's'}</span>
                      : 'in the pool · no matches yet'}
                    {p.status !== 'active' ? ' · ' + p.status : ''}
                  </div>
                </div>
              ))}
          </div>
        )
      )}
    </div>
  );
}
