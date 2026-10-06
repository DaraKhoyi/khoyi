// BookAccess — who can work in a set of books, and the switch for each of them.
//
// Dara, 6 Oct 2026: a team leader can "have an assistant that could help him
// with it and be able to switch the assistant on and off at the team leader's
// discretion." The same list serves every book: the brokerage's, a team's, a
// person's own (an assistant, an outside CPA).
//
// Off takes effect on the person's next tap, not their next sign-in: the
// database checks the list on every request. Off keeps the seat, the role and
// everything they entered; On gives the same role back. Every change is
// written to a record nobody can edit, shown at the bottom.
//
// Only owners and admins reach this screen, and the database checks again on
// every call: an admin cannot change an owner, a person's own books always
// keep that person as owner, and a book always keeps one owner who can sign in.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { useBackClose } from '../backClose';
import { confirmDialog, notify, notifyError } from '../notify';
import { ROLE_LABEL, ROLE_MEANS, bookTitle, canChangeSeat, historyLine, rolesICanGive, seatStatus } from '../books';

const whenText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function Seat({ seat, myRole, busy, onSwitch, onRole, onRemove, onEmail }) {
  const mine = canChangeSeat(myRole, seat);
  const roles = rolesICanGive(myRole);
  const waiting = !!seat.waiting_for;
  return (
    <div className={'bk-seat' + (seat.is_active && !waiting ? '' : ' off')} data-testid="book-seat">
      <div className="bk-seat-top">
        <div className="who">
          <b>{seat.name || seat.email || 'Unnamed'}{seat.is_you ? ' (you)' : ''}</b>
          <i>{ROLE_LABEL[seat.role]} · {seatStatus(seat)}</i>
          {seat.email && <i className="mail">{seat.email}</i>}
        </div>
        {mine && !seat.is_you && !waiting && (
          <button type="button" role="switch" aria-checked={seat.is_active} aria-label={(seat.is_active ? 'Switch off ' : 'Switch on ') + (seat.name || seat.email)}
            className={'bk-switch' + (seat.is_active ? ' on' : '')} disabled={busy} onClick={() => onSwitch(seat)} data-testid="book-seat-switch">
            <span className="track"><span className="knob" /></span><span className="word">{seat.is_active ? 'On' : 'Off'}</span>
          </button>
        )}
      </div>
      {seat.waiting_for === 'email' && mine && <button type="button" className="bk-link" onClick={() => onEmail(seat)}>Add their email address</button>}
      {seat.waiting_for === 'sign_in' && <p className="bk-help">{seat.role === 'owner' || seat.role === 'admin' ? 'When they first sign in to PrismOS with this email, they appear here switched off. You switch them on.' : 'They get access the first time they sign in to PrismOS with this email.'}</p>}
      {seat.awaiting_ok && <p className="bk-help">They have signed in. Switch them on when you are ready for them to work in these books.</p>}
      {mine && !seat.is_you && (
        <div className="bk-seat-edit">
          <label className="mr-f">What they may do
            <select value={seat.role} disabled={busy || !roles.includes(seat.role)} onChange={(e) => onRole(seat, e.target.value)}>
              {(roles.includes(seat.role) ? roles : [seat.role, ...roles]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <button type="button" className="bk-quiet danger" disabled={busy} onClick={() => onRemove(seat)}>Remove</button>
        </div>
      )}
    </div>
  );
}

export default function BookAccess({ book, onClose, onChanged }) {
  useBackClose(onClose);
  const [seats, setSeats] = useState(null);
  const [history, setHistory] = useState(null);       // null until opened
  const [busy, setBusy] = useState(false);
  const roles = rolesICanGive(book.role);
  const [form, setForm] = useState({ name: '', email: '', role: 'assistant' });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('book_people', { p_book: book.id });
    if (error) { notifyError('The list did not load: ' + error.message); setSeats([]); return; }
    setSeats(data || []);
  }, [book.id]);
  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase.rpc('book_history', { p_book: book.id, p_limit: 60 });
    if (error) { notifyError('The record did not load: ' + error.message); return; }
    setHistory(data || []);
  }, [book.id]);
  useEffect(() => { load(); }, [load]);

  // One way in for every change: do it, say what happened, read the list again.
  async function change(call, said) {
    setBusy(true);
    const { error } = await call();
    setBusy(false);
    if (error) { notifyError(error.message || 'That did not save'); return false; }
    if (said) notify(said, 'success');
    await load(); if (history) loadHistory();
    if (onChanged) onChanged();
    return true;
  }
  const flip = (s) => change(() => supabase.rpc('book_set_active', { p_access: s.id, p_on: !s.is_active }),
    s.is_active ? `${s.name} is switched off. What they entered stays.` : `${s.name} is switched on again as ${ROLE_LABEL[s.role]}.`);
  const setRole = (s, role) => change(() => supabase.rpc('book_set_role', { p_access: s.id, p_role: role }), `${s.name} is now ${ROLE_LABEL[role]}.`);
  const remove = async (s) => {
    if (!await confirmDialog(`Remove ${s.name || s.email} from ${bookTitle(book)}? What they entered stays, with their name on it.`, { confirmLabel: 'Remove', danger: true })) return;
    change(() => supabase.rpc('book_remove', { p_access: s.id }), `${s.name || s.email} was removed.`);
  };
  const emailRef = useRef(null);
  const askEmail = (s) => { set({ name: s.name || '', email: '', role: s.role }); if (emailRef.current) { emailRef.current.scrollIntoView({ block: 'center' }); emailRef.current.focus(); } };

  async function add(e) {
    e.preventDefault();
    const who = form.name.trim() || form.email.trim();
    if (!who) { notifyError('Enter the person’s name or email'); return; }
    let status = null;
    const ok = await change(async () => {
      const res = await supabase.rpc('book_grant', { p_book: book.id, p_email: form.email.trim() || null, p_name: form.name.trim() || null, p_role: form.role });
      status = res.data && res.data.status;
      return res;
    }, null);
    if (!ok) return;
    notify(status === 'active' ? `${who} can open these books now.` : status === 'waiting_sign_in' ? `${who} gets access at their first sign-in.` : `${who} is on the list. Add an email to give them access.`, 'success');
    setForm({ name: '', email: '', role: roles.includes('assistant') ? 'assistant' : roles[0] });
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal bk-sheet" role="dialog" aria-label="Who can work in these books" data-testid="book-access">
        <h3>Who can work in these books</h3>
        <p className="bk-help"><b>{bookTitle(book)}</b>. Only the people listed here can open them. Being the Broker or a Broker Admin does not open anyone else&rsquo;s books.</p>

        {seats === null ? <p className="bk-help">Loading the list.</p> : (
          <div className="bk-seats">
            {seats.map((s) => <Seat key={s.id} seat={s} myRole={book.role} busy={busy} onSwitch={flip} onRole={setRole} onRemove={remove} onEmail={askEmail} />)}
          </div>
        )}

        {roles.length > 0 && (
          <form className="mr-card" onSubmit={add} data-testid="book-add-person">
            <div className="bk-eye">Add someone</div>
            <label className="mr-f">Name
              <input type="text" autoComplete="off" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Myra Torres" />
            </label>
            <label className="mr-f">Email they sign in with
              <input ref={emailRef} type="email" autoComplete="off" inputMode="email" value={form.email} onChange={(e) => set({ email: e.target.value })} placeholder="name@example.com" />
            </label>
            <label className="mr-f">What they may do
              <select value={form.role} onChange={(e) => set({ role: e.target.value })}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <p className="bk-help">{ROLE_LABEL[form.role]}: {ROLE_MEANS[form.role]}</p>
            <div className="mr-go"><button type="submit" className="save" disabled={busy}>{busy ? 'Saving…' : 'Add to these books'}</button></div>
          </form>
        )}

        {history === null
          ? <button type="button" className="bk-link" onClick={loadHistory}>Show the record of changes</button>
          : (
            <div className="bk-record" data-testid="book-record">
              <div className="bk-eye">Record of changes · cannot be edited</div>
              {history.length === 0 ? <p className="bk-help">Nothing has changed yet.</p>
                : history.map((h) => <div className="bk-record-line" key={h.id}><span>{historyLine(h)}</span><i>{whenText(h.at)}</i></div>)}
            </div>
          )}

        <button type="button" className="bk-quiet" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
