// EntryTags — what a checkbook entry can carry besides its category, and its
// history in the ledger.
//
// Dara, 6 Oct 2026 (build prompt, part 3): "Tags, not more accounts. Each line
// can carry an agent, a team, a property or closing, and a contact" — that is
// what makes profit by agent or cost per closing possible without hundreds of
// accounts. "Contacts are the vendor list ... No second address book."
// And: a correction is a reversing entry plus a new one; "the user experiences
// this as edit; the history keeps all three."
//
// Used by the entry dialog (FinanceLedger TransactionModal). The contact is
// linked without being asked when the payee's name is exactly one contact the
// person can see; everything here is optional and tucked under one line.
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { fmtUSDCents } from '../financeUtils';
import { ledgerLine } from '../books';

// The contact a payee name refers to, when there is exactly one. Never guesses
// between two, and never fails the save: no answer means no link.
export async function findContactId(payee) {
  const name = String(payee || '').trim();
  if (name.length < 3 || /[%*\\"(),]/.test(name)) return null;      // characters that mean something to the search itself
  const { data, error } = await supabase.from('contacts').select('id, name, company').or(`name.ilike."${name}",company.ilike."${name}"`).limit(5);
  if (error || !data) return null;
  const same = (v) => String(v || '').trim().toLowerCase() === name.toLowerCase();
  const hits = data.filter((c) => same(c.name) || same(c.company));
  return hits.length === 1 ? hits[0].id : null;
}

const dayText = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${+m[2]}/${+m[3]}/${m[1]}` : ''; };

export function EntryTags({ book, value, onChange, payee }) {
  const [open, setOpen] = useState(!!(value.transfer_account || value.agent_id || value.closing_id));
  const [contact, setContact] = useState(null);       // { id, name } of the linked contact
  const [agents, setAgents] = useState([]);
  const [closing, setClosing] = useState(null);       // the linked closing, for its label
  const [find, setFind] = useState('');
  const [found, setFound] = useState([]);
  const shared = !!book && !book.is_mine;
  const set = (patch) => onChange({ ...value, ...patch });

  useEffect(() => {
    let live = true;
    (async () => {
      if (!value.contact_id) { setContact(null); return; }
      const { data } = await supabase.from('contacts').select('id, name, company').eq('id', value.contact_id).maybeSingle();
      if (live) setContact(data ? { id: data.id, name: data.name || data.company } : { id: value.contact_id, name: 'a contact you cannot open' });
    })();
    return () => { live = false; };
  }, [value.contact_id]);
  useEffect(() => {
    if (!open || !shared) return undefined;
    let live = true;
    supabase.from('agents').select('id, name, active').order('name').then(({ data }) => { if (live) setAgents((data || []).filter((a) => a.active !== false || a.id === value.agent_id)); });
    return () => { live = false; };
  }, [open, shared, value.agent_id]);
  useEffect(() => {
    let live = true;
    (async () => {
      if (!value.closing_id) { setClosing(null); return; }
      const { data } = await supabase.from('brokerage_transactions').select('id, address, date_paid, date_received').eq('id', value.closing_id).maybeSingle();
      if (live) setClosing(data || { id: value.closing_id, address: 'a closing you cannot open' });
    })();
    return () => { live = false; };
  }, [value.closing_id]);
  useEffect(() => {
    const q = find.trim();
    if (q.length < 3) { setFound([]); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      const { data } = await supabase.from('brokerage_transactions').select('id, address, date_paid, date_received').ilike('address', `%${q.replace(/[%_]/g, '')}%`).order('date_received', { ascending: false }).limit(6);
      if (live) setFound(data || []);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [find]);

  const linkPayee = async () => { const id = await findContactId(payee); if (id) set({ contact_id: id }); else if (window.__notify) window.__notify('No single contact has exactly that name. Check the payee, or add them in Contacts.', 'info'); };

  if (!open) return <button type="button" className="bk-link" onClick={() => setOpen(true)} data-testid="entry-more">More: transfer, contact, agent, closing</button>;
  return (
    <div className="mr-card" data-testid="entry-tags">
      <label className="mr-f">Transfer to account (only when this moved money between these books&rsquo; own accounts)
        <input type="text" autoComplete="off" value={value.transfer_account || ''} onChange={(e) => set({ transfer_account: e.target.value })} placeholder="Leave empty for income or spending" />
      </label>
      <div className="bk-row">
        <span className="n">Contact{contact ? <i>{contact.name}</i> : <i>Not linked</i>}</span>
        {contact ? <button type="button" className="bk-link" onClick={() => set({ contact_id: null })}>Unlink</button>
          : <button type="button" className="bk-link" onClick={linkPayee}>Link the payee</button>}
      </div>
      {shared && agents.length > 0 && (
        <label className="mr-f">Agent this is about
          <select value={value.agent_id || ''} onChange={(e) => set({ agent_id: e.target.value || null })}>
            <option value="">None</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      {closing ? (
        <div className="bk-row"><span className="n">Closing<i>{[closing.address, dayText(closing.date_paid || closing.date_received)].filter(Boolean).join(' · ')}</i></span>
          <button type="button" className="bk-link" onClick={() => set({ closing_id: null })}>Unlink</button></div>
      ) : (<>
        <label className="mr-f">Closing this is about
          <input type="search" autoComplete="off" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type part of the address" />
        </label>
        {found.map((c) => (
          <button type="button" className="bk-pick" key={c.id} onClick={() => { set({ closing_id: c.id }); setFind(''); setFound([]); }}>
            <span className="who"><b>{c.address || 'No address'}</b><i>{dayText(c.date_paid || c.date_received)}</i></span>
          </button>
        ))}
      </>)}
    </div>
  );
}

// What the ledger holds for one entry: entered, taken back, entered again.
export function EntryHistory({ txId }) {
  const [rows, setRows] = useState(null);
  const load = async () => {
    const { data, error } = await supabase.rpc('book_entry_history', { p_tx: txId });
    if (error) { if (window.__notify) window.__notify('The history did not load: ' + error.message, 'error'); return; }
    setRows(data || []);
  };
  if (rows === null) return <button type="button" className="bk-link" onClick={load} data-testid="entry-history-open">Show this entry&rsquo;s history in the ledger</button>;
  return (
    <div className="bk-record" data-testid="entry-history">
      <div className="bk-eye">In the ledger · nothing here can be edited</div>
      {rows.length === 0 ? <p className="bk-help">Nothing is posted for this entry.</p>
        : rows.map((h) => <div className="bk-record-line" key={h.id}><span>{ledgerLine(h, fmtUSDCents)}</span><i>Dated {dayText(h.date)} · by {h.by}</i></div>)}
    </div>
  );
}
