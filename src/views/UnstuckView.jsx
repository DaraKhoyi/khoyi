// UnstuckView — "Unstuck." Diagnose why a residential listing isn't selling.
//
// Phase 1 (agent-only): intake, analysis run, findings, the three reports.
// Phase 2 adds the seller portal; Phase 3 adds weekly re-runs. See UNSTUCK-SPEC.md.
//
// Deliberately NOT a pricing tool and deliberately NOT "live" — there is no MLS
// feed yet, so nothing here claims realtime.
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

const GOLD = '#C5A95E', CHAMP = '#EBCB82';

const TRIAGE = {
  no_showings:  { label: 'Failing before the house is seen', hint: 'Price band, photos, remarks, exposure, compensation' },
  no_second:    { label: "Reality doesn't match the photos", hint: 'Condition, smell, deferred maintenance, the first ten feet' },
  no_offers:    { label: 'They want it — the math or a defect stops them', hint: 'Payment math, insurance, inspection fear, an uncorrectable' },
  dying_escrow: { label: 'Dying in escrow', hint: 'Appraisal, financing, inspection, insurability' },
};

const KINDS = [
  ['correctable_cheap',  'Fix cheaply',      'Under ~$1,500 and under a week'],
  ['correctable_costly', 'Fix expensively',  'Real money — weigh a credit instead'],
  ['uncorrectable',      "Can't be fixed",   'Cannot be repaired, so it must be priced'],
  ['payment',            'Payment math',     "What the buyer's monthly actually is"],
  ['exposure',           'Exposure',         'Who is even seeing this listing'],
  ['insurability',       'Insurability',     'Pass/fail gates before a contract closes'],
  ['market',             'Market',           'Conditions rather than the listing itself'],
];

const PRIORITIES = ['Seller net proceeds', 'Speed to close', 'Certainty of close',
  'Seller relationship', 'Avoiding a price conversation', 'Agent confidence'];

const money = (n) => (n === null || n === undefined || n === '') ? '—'
  : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

const field = { width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-1)', padding: '10px 11px', fontSize: 14.5, fontFamily: 'inherit', boxSizing: 'border-box' };
const label = { fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.05em', margin: '12px 0 5px', fontWeight: 600 };
const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 11 };
const btn = { background: CHAMP, color: '#100D09', border: 'none', borderRadius: 10, padding: '11px 20px', fontWeight: 800, fontSize: 14, cursor: 'pointer' };
const ghost = { background: 'transparent', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 16px', cursor: 'pointer', fontSize: 14 };

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{children}</div>;
}
function Half({ children }) {
  return <div style={{ flex: '1 1 130px', minWidth: 0 }}>{children}</div>;
}

function Intake({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(() => Object.assign({
    address: '', city: '', county: '', postal_code: '', subdivision: '', mls_number: '',
    list_price: '', original_list_price: '', dom_cumulative: '', dom_current_price: '',
    beds: '', baths: '', sqft: '', lot_sqft: '', year_built: '', property_type: '',
    hoa_amount: '', hoa_period: 'month', cdd_amount: '', flood_zone: '', roof_age: '', hvac_age: '',
    insurance_annual: '', taxes_annual: '', assessments_pending: '',
    showings: '', second_showings: '', offers: '', feedback_notes: '',
    photo_count: '', showing_access: '', showing_restrictions: '', buyer_agent_comp: '',
    zestimate: '', redfin_estimate: '', portal_dom: '',
    priority_1: '', priority_2: '', priority_3: '', seller_constraints: '', agent_notes: '',
  }, initial || {}));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(p => Object.assign({}, p, { [k]: v }));

  const save = async () => {
    if (!f.address.trim()) { alert('Address is required.'); return; }
    setBusy(true);
    try {
      const payload = Object.assign({}, f, { id: initial && initial.id ? initial.id : undefined });
      const { data, error } = await supabase.rpc('unstuck_save_listing', { p: payload });
      if (error) { alert('Could not save: ' + error.message); setBusy(false); return; }
      if (data && data.ok === false) { alert(data.error || 'Could not save.'); setBusy(false); return; }
      onSaved(data.id);
    } catch (e) { alert('Could not save: ' + (e.message || e)); }
    setBusy(false);
  };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.55 }}>
        Leave anything you don't know blank — a gap is more useful than a guess, and the analysis
        will tell you which gaps actually matter.
      </div>

      <div style={label}>Address *</div>
      <input style={field} value={f.address} onChange={e => set('address', e.target.value)} placeholder="1234 Example Dr" />
      <Row>
        <Half><div style={label}>City</div><input style={field} value={f.city} onChange={e => set('city', e.target.value)} /></Half>
        <Half><div style={label}>ZIP</div><input style={field} value={f.postal_code} onChange={e => set('postal_code', e.target.value)} /></Half>
        <Half><div style={label}>County</div><input style={field} value={f.county} onChange={e => set('county', e.target.value)} /></Half>
      </Row>
      <Row>
        <Half><div style={label}>Subdivision</div><input style={field} value={f.subdivision} onChange={e => set('subdivision', e.target.value)} /></Half>
        <Half><div style={label}>MLS #</div><input style={field} value={f.mls_number} onChange={e => set('mls_number', e.target.value)} /></Half>
      </Row>

      <div style={{ ...label, color: GOLD, marginTop: 20 }}>The ask</div>
      <Row>
        <Half><div style={label}>Current price</div><input style={field} type="number" value={f.list_price} onChange={e => set('list_price', e.target.value)} /></Half>
        <Half><div style={label}>Original price</div><input style={field} type="number" value={f.original_list_price} onChange={e => set('original_list_price', e.target.value)} /></Half>
      </Row>
      <Row>
        <Half><div style={label}>Total DOM</div><input style={field} type="number" value={f.dom_cumulative} onChange={e => set('dom_cumulative', e.target.value)} /></Half>
        <Half><div style={label}>DOM at this price</div><input style={field} type="number" value={f.dom_current_price} onChange={e => set('dom_current_price', e.target.value)} /></Half>
      </Row>

      <div style={{ ...label, color: GOLD, marginTop: 20 }}>The diagnostic — the most important box on this page</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4, lineHeight: 1.5 }}>
        No showings, showings without seconds, and seconds without offers point at completely
        different causes. This drives the whole analysis.
      </div>
      <Row>
        <Half><div style={label}>Showings</div><input style={field} type="number" value={f.showings} onChange={e => set('showings', e.target.value)} /></Half>
        <Half><div style={label}>Second showings</div><input style={field} type="number" value={f.second_showings} onChange={e => set('second_showings', e.target.value)} /></Half>
        <Half><div style={label}>Offers</div><input style={field} type="number" value={f.offers} onChange={e => set('offers', e.target.value)} /></Half>
      </Row>
      <div style={label}>Showing feedback — paste it raw, verbatim beats summarised</div>
      <textarea style={{ ...field, minHeight: 70 }} value={f.feedback_notes} onChange={e => set('feedback_notes', e.target.value)} />

      <div style={{ ...label, color: GOLD, marginTop: 20 }}>The house</div>
      <Row>
        <Half><div style={label}>Beds</div><input style={field} type="number" value={f.beds} onChange={e => set('beds', e.target.value)} /></Half>
        <Half><div style={label}>Baths</div><input style={field} type="number" value={f.baths} onChange={e => set('baths', e.target.value)} /></Half>
        <Half><div style={label}>SqFt</div><input style={field} type="number" value={f.sqft} onChange={e => set('sqft', e.target.value)} /></Half>
        <Half><div style={label}>Year built</div><input style={field} type="number" value={f.year_built} onChange={e => set('year_built', e.target.value)} /></Half>
      </Row>

      <div style={{ ...label, color: GOLD, marginTop: 20 }}>Carrying cost &amp; insurability</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4, lineHeight: 1.5 }}>
        In Florida these kill more contracts than price does.
      </div>
      <Row>
        <Half><div style={label}>HOA</div><input style={field} type="number" value={f.hoa_amount} onChange={e => set('hoa_amount', e.target.value)} /></Half>
        <Half><div style={label}>CDD /yr</div><input style={field} type="number" value={f.cdd_amount} onChange={e => set('cdd_amount', e.target.value)} /></Half>
        <Half><div style={label}>Flood zone</div><input style={field} value={f.flood_zone} onChange={e => set('flood_zone', e.target.value)} placeholder="X / AE / …" /></Half>
      </Row>
      <Row>
        <Half><div style={label}>Roof age (yrs)</div><input style={field} type="number" value={f.roof_age} onChange={e => set('roof_age', e.target.value)} /></Half>
        <Half><div style={label}>HVAC age (yrs)</div><input style={field} type="number" value={f.hvac_age} onChange={e => set('hvac_age', e.target.value)} /></Half>
      </Row>
      <Row>
        <Half><div style={label}>Insurance /yr</div><input style={field} type="number" value={f.insurance_annual} onChange={e => set('insurance_annual', e.target.value)} /></Half>
        <Half><div style={label}>Taxes /yr</div><input style={field} type="number" value={f.taxes_annual} onChange={e => set('taxes_annual', e.target.value)} /></Half>
      </Row>

      <div style={{ ...label, color: GOLD, marginTop: 20 }}>Exposure</div>
      <Row>
        <Half><div style={label}>Photo count</div><input style={field} type="number" value={f.photo_count} onChange={e => set('photo_count', e.target.value)} /></Half>
        <Half><div style={label}>Buyer-agent comp</div><input style={field} value={f.buyer_agent_comp} onChange={e => set('buyer_agent_comp', e.target.value)} /></Half>
      </Row>
      <div style={label}>Showing access &amp; restrictions</div>
      <input style={field} value={f.showing_restrictions} onChange={e => set('showing_restrictions', e.target.value)} placeholder="24hr notice, tenant occupied, appointment only…" />

      <div style={{ ...label, color: GOLD, marginTop: 20 }}>What the seller can already see</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4, lineHeight: 1.5 }}>
        They've been staring at these for weeks. The report has to reconcile with them or it
        loses the argument before the evidence is read.
      </div>
      <Row>
        <Half><div style={label}>Zestimate</div><input style={field} type="number" value={f.zestimate} onChange={e => set('zestimate', e.target.value)} /></Half>
        <Half><div style={label}>Redfin est.</div><input style={field} type="number" value={f.redfin_estimate} onChange={e => set('redfin_estimate', e.target.value)} /></Half>
        <Half><div style={label}>DOM shown on portals</div><input style={field} type="number" value={f.portal_dom} onChange={e => set('portal_dom', e.target.value)} /></Half>
      </Row>

      <div style={{ ...label, color: GOLD, marginTop: 20 }}>What are we optimising for?</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4, lineHeight: 1.5 }}>
        "Maximise net" and "close fast" produce opposite recommendations. Rank the top three.
      </div>
      {[1, 2, 3].map(n => (
        <select key={n} style={{ ...field, marginBottom: 8 }} value={f['priority_' + n]} onChange={e => set('priority_' + n, e.target.value)}>
          <option value="">{n === 1 ? 'Most important…' : n === 2 ? 'Second…' : 'Third…'}</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      ))}

      <div style={label}>Seller's real constraints</div>
      <textarea style={{ ...field, minHeight: 60 }} value={f.seller_constraints} onChange={e => set('seller_constraints', e.target.value)} placeholder="Payoff, must-net floor, relocation date, repair budget, emotional attachment…" />
      <div style={label}>Anything else you'd tell a colleague about this file</div>
      <textarea style={{ ...field, minHeight: 60 }} value={f.agent_notes} onChange={e => set('agent_notes', e.target.value)} />

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={save} disabled={busy} style={btn}>{busy ? 'Saving…' : 'Save listing'}</button>
        <button onClick={onCancel} style={ghost}>Cancel</button>
      </div>
    </div>
  );
}

function Detail({ id, onBack, onEdit }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('findings');

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('unstuck_get', { p_id: id });
      setD(data && data.ok ? data : null);
    } catch (_) { setD(null); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // The edge function returns as soon as the run row exists and finishes the work
  // in the background — Claude + web search runs well past the gateway's 150s
  // idle timeout. So we poll the run rather than awaiting the call.
  const analyze = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('unstuck-analyze', { body: { listing_id: id, kind: 'initial' } });
      if (error) { alert('Could not start the analysis: ' + error.message); setBusy(false); return; }
      if (data && data.ok === false) { alert(data.error || 'Could not start the analysis.'); setBusy(false); return; }
      await load();
      // poll up to ~6 minutes
      for (let i = 0; i < 72; i++) {
        await new Promise(r => setTimeout(r, 5000));
        let res = null;
        try { res = await supabase.rpc('unstuck_get', { p_id: id }); } catch (_) { continue; }
        const d2 = res && res.data;
        if (!d2 || !d2.ok) continue;
        setD(d2);
        const r0 = (d2.runs || [])[0];
        if (r0 && r0.status !== 'running') { setBusy(false); return; }
      }
      setBusy(false);
    } catch (e) { alert('Could not start the analysis: ' + (e.message || e)); setBusy(false); }
  };

  const release = async (on) => {
    if (on && !confirm('Share this report with the seller? They will see the seller report and the seller-safe findings — including anything that cannot be fixed. Walk them through it first if you can.')) return;
    try {
      const { data, error } = await supabase.rpc('unstuck_release', { p_id: id, p_release: on });
      if (error) { alert('Could not update sharing: ' + error.message); return; }
      if (data && data.ok === false) { alert(data.error || 'Could not update sharing.'); return; }
      await load();
      if (on && data.url) {
        try { await navigator.clipboard.writeText(data.url); alert('Shared. The link is on your clipboard.'); }
        catch (_) { alert('Shared. Link:\n\n' + data.url); }
      }
    } catch (e) { alert('Could not update sharing: ' + (e.message || e)); }
  };

  const copyLink = async () => {
    const url = 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/unstuck-portal?t=' + (d && d.listing ? d.listing.portal_token : '');
    try { await navigator.clipboard.writeText(url); alert('Link copied.'); }
    catch (_) { alert(url); }
  };

  // Two documents on purpose. The client copy is handed to a homeowner in a
  // listing presentation; the agent copy carries the say-this script, agent-only
  // findings and evidence tags, none of which belong in a seller's hands.
  const openReport = async (audience) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess && sess.session && sess.session.access_token;
      if (!token) { alert('Please sign in again.'); return; }
      const url = 'https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/unstuck-report'
        + '?t=' + encodeURIComponent(id) + '&audience=' + audience;
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      const html = await res.text();
      if (!res.ok) { alert(html.replace(/<[^>]*>/g, '').trim() || 'Could not build the report.'); return; }
      const w = window.open('', '_blank');
      if (!w) { alert('Please allow pop-ups to open the report.'); return; }
      w.document.open(); w.document.write(html); w.document.close();
    } catch (e) { alert('Could not build the report: ' + (e.message || e)); }
  };

  const markFinding = async (fid, status) => {
    try { await supabase.rpc('unstuck_set_finding', { p_id: fid, p_status: status }); load(); } catch (_) {}
  };

  if (!d) return <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 20 }}>Loading…</div>;
  const l = d.listing, runs = d.runs || [], findings = d.findings || [];
  const last = runs[0] || null;
  const tri = last && last.triage_row ? TRIAGE[last.triage_row] : null;

  return (
    <div>
      <button onClick={onBack} style={{ ...ghost, marginBottom: 12, padding: '7px 13px', fontSize: 13 }}>← All listings</button>

      <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--text-1)' }}>{l.address}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>
        {[l.city, l.postal_code].filter(Boolean).join(' ')}
        {l.list_price ? ' · ' + money(l.list_price) : ''}
        {l.dom_cumulative ? ' · ' + l.dom_cumulative + ' DOM' : ''}
      </div>

      {last && last.status === 'done' && last.diagnosis && (
        <div style={{ ...card, marginTop: 14, borderColor: 'rgba(203,163,92,.45)', background: 'rgba(203,163,92,.07)' }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.14em', color: GOLD, fontWeight: 700 }}>Diagnosis</div>
          <div style={{ fontSize: 15.5, color: 'var(--text-1)', marginTop: 6, lineHeight: 1.5 }}>{last.diagnosis}</div>
          {tri && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(203,163,92,.25)' }}>
              <div style={{ fontSize: 13.5, color: CHAMP, fontWeight: 700 }}>{tri.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{tri.hint}</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        <button onClick={analyze} disabled={busy} style={btn}>
          {busy ? 'Analysing…' : runs.length ? 'Re-run analysis' : 'Run the analysis'}
        </button>
        <button onClick={() => onEdit(l)} style={ghost}>Edit</button>
      </div>
      {busy && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.5 }}>
          Searching current rates, insurance conditions and active competition. This runs in the
          background and usually takes two to four minutes — you can leave this screen and come back.
        </div>
      )}

      {last && last.status === 'failed' && (
        <div style={{ ...card, borderColor: 'rgba(239,125,125,.4)' }}>
          <div style={{ fontSize: 13, color: '#ef7d7d' }}>The last run failed: {last.error || 'unknown error'}</div>
        </div>
      )}

      {runs.length > 0 && (
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
          {[['findings', 'Findings'], ['agent', 'Full analysis'], ['seller', 'Seller report'], ['say', 'What to say']].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ background: 'transparent', border: 'none', borderBottom: '2px solid ' + (tab === k ? GOLD : 'transparent'), color: tab === k ? 'var(--text-1)' : 'var(--text-3)', fontSize: 13, fontWeight: tab === k ? 700 : 500, padding: '9px 12px', cursor: 'pointer' }}>{lbl}</button>
          ))}
        </div>
      )}

      {tab === 'findings' && (
        findings.length === 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '18px 0' }}>
              No findings yet. Run the analysis to get them.
            </div>
          : KINDS.map(([kind, title, hint]) => {
            const rows = findings.filter(f => f.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: kind === 'uncorrectable' ? CHAMP : 'var(--text-1)' }}>{title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 8 }}>{hint}</div>
                {rows.map(f => (
                  <div key={f.id} style={Object.assign({}, card, f.status !== 'open' ? { opacity: .5 } : null)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ flex: '1 1 0', minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)' }}>{f.title}</div>
                        {f.detail && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.55 }}>{f.detail}</div>}
                        {f.evidence && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6, fontStyle: 'italic' }}>{f.evidence}</div>}
                        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
                          {f.dollar_impact ? money(f.dollar_impact) + ' impact' : ''}
                          {f.dollar_impact && f.effort ? ' · ' : ''}{f.effort || ''}
                          {!f.seller_safe ? ' · agent eyes only' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {f.status === 'open'
                          ? <>
                              <button onClick={() => markFinding(f.id, 'done')} style={{ ...ghost, padding: '5px 10px', fontSize: 12 }}>Done</button>
                              <button onClick={() => markFinding(f.id, 'dismissed')} style={{ ...ghost, padding: '5px 10px', fontSize: 12 }}>Skip</button>
                            </>
                          : <button onClick={() => markFinding(f.id, 'open')} style={{ ...ghost, padding: '5px 10px', fontSize: 12 }}>Reopen</button>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
      )}

      {runs.length > 0 && last && last.status === 'done' && (
        <div style={Object.assign({}, card, { borderColor: 'rgba(203,163,92,.45)' })}>
          <div style={{ fontSize: 13.5, color: CHAMP, fontWeight: 700 }}>Printable report</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.55 }}>
            The client copy is built for a listing presentation &mdash; it leads with the analysis and
            closes with your actual production numbers. The agent copy adds your script, the
            agent-only findings and the evidence tags. Don't hand the agent copy to a seller.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
            <button onClick={() => openReport('client')} style={btn}>Client report (PDF)</button>
            <button onClick={() => openReport('agent')} style={ghost}>Agent copy</button>
          </div>
        </div>
      )}

      {tab !== 'findings' && last && (
        <div style={Object.assign({}, card, { whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-2)' })}>
          {tab === 'agent' && (last.agent_report || 'Nothing yet.')}
          {tab === 'seller' && (last.seller_report || 'Nothing yet.')}
          {tab === 'say' && (last.say_this || 'Nothing yet.')}
        </div>
      )}

      {tab === 'seller' && last && last.seller_report && (
        <div style={Object.assign({}, card, { borderColor: 'rgba(203,163,92,.45)' })}>
          {l.status === 'released' ? (
            <>
              <div style={{ fontSize: 13.5, color: CHAMP, fontWeight: 700 }}>Shared with the seller</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.55 }}>
                They can open their private page any time. Re-running the analysis updates what they see.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
                <button onClick={copyLink} style={btn}>Copy their link</button>
                <button onClick={() => release(false)} style={ghost}>Stop sharing</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 700 }}>Not shared yet</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.55 }}>
                Read it through first. Sharing gives the seller this report and the seller-safe
                findings — including what can't be fixed. That lands far better in a conversation
                than as a link they open alone on a Sunday morning.
              </div>
              <button onClick={() => release(true)} style={Object.assign({}, btn, { marginTop: 11 })}>
                Share with the seller
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function UnstuckView({ userId }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);      // listing id
  const [editing, setEditing] = useState(null); // 'new' | listing object

  const load = useCallback(async () => {
    try { const { data } = await supabase.rpc('unstuck_my_listings'); setRows(Array.isArray(data) ? data : []); }
    catch (_) { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="ww-unstuck" style={{ minHeight: '100%', padding: '18px 16px 90px' }}>
      <style>{`.ww-unstuck{--bg-base:#100D09;--bg-card:#1B1610;--border:rgba(203,163,92,.20);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;}`}</style>

      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.22em', fontSize: 11, fontWeight: 700, color: GOLD }}>Unstuck.</div>
      <h2 style={{ fontFamily: "'Fraunces',serif", fontWeight: 300, fontSize: 30, margin: '2px 0 4px', color: 'var(--text-1)' }}>Why it isn't selling.</h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16, lineHeight: 1.55 }}>
        Not a price tool. A second opinion on the whole file — exposure, payment math, condition,
        insurability, and the things that can't be fixed and therefore have to be priced.
      </div>

      {editing ? (
        <Intake
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(id) => { setEditing(null); setOpen(id); load(); }}
        />
      ) : open ? (
        <Detail id={open} onBack={() => { setOpen(null); load(); }} onEdit={(l) => setEditing(l)} />
      ) : (
        <>
          <button onClick={() => setEditing('new')} style={{ ...btn, marginBottom: 16 }}>+ Add a stalled listing</button>
          {rows === null ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: '26px 16px' }}>
              <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6 }}>
                Add a listing that's been sitting. You'll get a diagnosis, a ranked list of what to
                fix, and the two or three sentences you can actually say to the seller.
              </div>
            </div>
          ) : rows.map(r => (
            <div key={r.id} onClick={() => setOpen(r.id)} style={Object.assign({}, card, { cursor: 'pointer' })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>
                    {[r.city, r.list_price ? money(r.list_price) : null, r.dom_cumulative ? r.dom_cumulative + ' DOM' : null].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {r.last_run && r.last_run.diagnosis && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 7, lineHeight: 1.5 }}>{r.last_run.diagnosis}</div>
                  )}
                </div>
                {r.open_findings ? (
                  <span style={{ fontSize: 11, borderRadius: 20, padding: '2px 9px', fontWeight: 700, background: 'rgba(203,163,92,.18)', color: CHAMP, whiteSpace: 'nowrap' }}>{r.open_findings} to do</span>
                ) : null}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
