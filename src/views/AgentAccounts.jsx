// AgentAccounts — what the brokerage paid each agent and what each one owes.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Agent statements. What the
// brokerage paid them and what they owe: monthly fees, transaction fees, E&O."
//
// These are cash-basis books, so what an agent owes is kept BESIDE the ledger:
// a charge is not income until the money comes in. What they paid is whatever
// the books show came in from them under "Agent Fees".
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { PERIODS, bookTitle, periodRange } from '../books';
import { rangeText } from '../bookReports';
import { CHARGE_KINDS, EVERY, kindWord, statementTables } from '../payees';
import { ExportBar, ReportTable } from './BookReports';

const toNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };

// One agent's statement. `mine` is the agent reading their own.
export function AgentStatement({ book, agent, mine = false, canWrite = false, onBack, onChanged }) {
  const [period, setPeriod] = useState('year');
  const [d, setD] = useState(undefined);
  const [f, setF] = useState({ kind: 'other', label: '', amount: '', date: todayNY() });
  const [busy, setBusy] = useState(false);
  const today = todayNY();
  const range = periodRange(period, today);
  const load = useCallback(async () => {
    const r = mine ? await supabase.rpc('my_agent_statement', { p_from: range.from, p_to: range.to })
      : await supabase.rpc('agent_statement', { p_book: book.id, p_agent: agent.id, p_from: range.from, p_to: range.to });
    if (r.error) { notifyError('The statement did not load: ' + r.error.message); setD(null); return; }
    setD(r.data);
  }, [mine, book.id, agent && agent.id, range.from, range.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setD(undefined); load(); }, [load]);
  const add = async (e) => {
    e.preventDefault();
    const amt = toNum(f.amount);
    if (!f.label.trim() || Number.isNaN(amt) || !amt) { notifyError('A charge needs a name and an amount.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('agent_charge_add', { p_book: book.id, p_agent: agent.id, p_date: f.date, p_kind: f.kind, p_label: f.label, p_amount: amt });
    setBusy(false);
    if (error) { notifyError(error.message); return; }
    setF({ ...f, label: '', amount: '' }); if (onChanged) onChanged(); load();
  };
  if (d === undefined) return <div className="mr-empty">Adding it up.</div>;
  if (d === null) return <div className="mr-empty">{mine ? 'There is no statement from the brokerage for you yet.' : 'That statement did not load.'}</div>;
  const who = mine ? 'Realty ONE Group Advantage' : bookTitle(book);
  const tables = statementTables(d, { subtitle: `${who} · ${rangeText(range.from, range.to)}` });
  return (
    <div className="mr" data-testid="agent-statement">
      {onBack && <button type="button" className="bk-link" onClick={onBack}>Back to all agents</button>}
      <div className="mr-chips" role="group" aria-label="Period">
        {PERIODS.map(([id, label]) => <button type="button" key={id} className={period === id ? 'on' : ''} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}
      </div>
      <div className="bk-net">
        <div><span>{mine ? 'The brokerage paid you' : 'Paid to them'}</span><b>{fmtUSDCents(d.paid_total)}</b></div>
        <div className="net"><span>{Number(d.owed) < 0 ? 'Paid ahead' : mine ? 'You owe the brokerage' : 'They owe'}</span><b>{fmtUSDCents(Math.abs(d.owed))}</b></div>
      </div>
      {tables.map((t) => <React.Fragment key={t.title}><div className="mr-head"><h3>{(t.title.split(': ')[1] || '').replace(/^./, (c) => c.toUpperCase())}</h3></div>{t.empty ? <div className="mr-empty">Nothing in this period.</div> : <ReportTable table={t} />}</React.Fragment>)}
      <ExportBar name={`${d.agent ? d.agent.name : 'Agent'} statement ${range.to || today}`} heading={who} tables={tables} />
      {canWrite && !mine && (
        <form className="mr-card" onSubmit={add} data-testid="agent-charge-form">
          <div className="bk-eye">Add a charge or a credit</div>
          <label className="mr-f">Kind<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CHARGE_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="mr-f">What it is for<input type="text" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} autoComplete="off" /></label>
          <div className="mr-two">
            <label className="mr-f">Day<input type="date" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label className="mr-f">Amount<input type="text" inputMode="decimal" className="amt" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" autoComplete="off" /></label>
          </div>
          <div className="mr-go"><button type="submit" className="save" disabled={busy}>Add it</button></div>
          <p className="bk-help">A charge is what they owe, not money received. When they pay, enter the money on the Add tab under Agent Fees with their name tagged, and it comes off here.</p>
        </form>
      )}
    </div>
  );
}

export default function AgentAccounts({ book }) {
  const [d, setD] = useState(null);
  const [agent, setAgent] = useState(null);
  const [f, setF] = useState(null);       // a standing charge being added
  const [busy, setBusy] = useState(false);
  const bookId = book.id;
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('agent_balances', { p_book: bookId, p_year: null });
    if (error) { notifyError('Agent accounts did not load: ' + error.message); setD({ agents: [], schedules: [], roster: [] }); return null; }
    setD(data); return data;
  }, [bookId]);
  // Standing charges are brought up to today whenever someone who keeps the books looks.
  useEffect(() => {
    let live = true;
    (async () => {
      const first = await load();
      if (!live || !first || !first.can_write || !(first.schedules || []).length) return;
      const { data } = await supabase.rpc('agent_charges_run', { p_book: bookId });
      if (live && data > 0) load();
    })();
    return () => { live = false; };
  }, [load, bookId]);

  const saveSchedule = async (e) => {
    e.preventDefault();
    const amt = toNum(f.amount);
    if (!f.label.trim() || Number.isNaN(amt) || amt <= 0 || !f.starts_on) { notifyError('A standing charge needs a name, an amount and a first day.'); return; }
    setBusy(true);
    const { error } = await supabase.rpc('agent_schedule_save', { p_book: bookId, p_id: null, p: { ...f, amount: amt } });
    if (!error) await supabase.rpc('agent_charges_run', { p_book: bookId });
    setBusy(false);
    if (error) { notifyError(error.message); return; }
    notify('Standing charge added', 'success'); setF(null); load();
  };
  const endSchedule = async (s) => {
    const { error } = await supabase.rpc('agent_schedule_save', { p_book: bookId, p_id: s.id, p: { ends_on: todayNY() } });
    if (error) notifyError(error.message); else load();
  };

  if (!d) return <div className="mr-empty">Adding it up.</div>;
  if (agent) return <AgentStatement book={book} agent={agent} canWrite={d.can_write} onBack={() => { setAgent(null); load(); }} />;
  const owedAll = d.agents.reduce((s, a) => s + Math.max(0, Number(a.owed)), 0);
  return (
    <div className="mr" data-testid="agent-accounts">
      <p className="bk-help">What each agent was paid this year, from the books, and what each one owes the brokerage. {owedAll > 0 ? `${fmtUSDCents(owedAll)} is owed in all.` : ''}</p>
      {d.agents.length === 0 ? <div className="mr-empty">Nothing yet. Agents appear here once a closing is entered or a charge is added.</div> : (
        <div className="bk-list">
          {d.agents.map((a) => (
            <button type="button" className="bk-row rc-hist" key={a.agent_id} onClick={() => setAgent({ id: a.agent_id, name: a.name })} data-testid="agent-row">
              <span className="n">{a.name}<i>Paid {fmtUSDCents(a.paid_out)} in {d.year}{Number(a.charged) ? ` · charged ${fmtUSDCents(a.charged)}, paid in ${fmtUSDCents(a.paid)}` : ''}</i></span>
              <span className="a">{Number(a.owed) > 0 ? 'Owes ' + fmtUSDCents(a.owed) : Number(a.owed) < 0 ? 'Ahead ' + fmtUSDCents(-a.owed) : ''}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mr-head"><h3>Standing charges</h3><span>{d.schedules.length || ''}</span></div>
      <p className="bk-help">A fee charged on a schedule, such as a monthly fee or E&amp;O. PrismOS adds each one on its day.</p>
      {d.schedules.map((s) => (
        <div className="bk-row" key={s.id}>
          <span className="n">{s.label}<i>{fmtUSDCents(s.amount)} · {(EVERY.find(([id]) => id === s.every) || [])[1]} · {s.agent || 'every active agent'} · {kindWord(s.kind)} · from {s.starts_on}{s.ends_on ? ' to ' + s.ends_on : ''}</i></span>
          {d.can_write && !s.ends_on && <button type="button" className="bk-link" onClick={() => endSchedule(s)}>Stop</button>}
        </div>
      ))}
      {d.can_write && !f && <button type="button" className="bk-link" onClick={() => setF({ agent_id: '', kind: 'monthly', label: '', amount: '', every: 'month', starts_on: todayNY() })} data-testid="agent-schedule-new">Add a standing charge</button>}
      {f && (
        <form className="mr-card" onSubmit={saveSchedule} data-testid="agent-schedule-form">
          <label className="mr-f">Who<select value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })}><option value="">Every active agent</option>{(d.roster || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="mr-f">Kind<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{CHARGE_KINDS.filter(([id]) => ['monthly', 'eo', 'other'].includes(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="mr-f">What it is called<input type="text" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} autoComplete="off" /></label>
          <div className="mr-two">
            <label className="mr-f">Amount<input type="text" inputMode="decimal" className="amt" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" autoComplete="off" /></label>
            <label className="mr-f">How often<select value={f.every} onChange={(e) => setF({ ...f, every: e.target.value })}>{EVERY.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          </div>
          <label className="mr-f">First charged on<input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></label>
          <p className="bk-help">Every charge from that day up to today is added at once.</p>
          <div className="mr-go"><button type="submit" className="save" disabled={busy}>Add it</button><button type="button" className="clear" onClick={() => setF(null)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}
