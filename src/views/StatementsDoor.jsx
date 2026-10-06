// StatementsDoor — the way into statements from the checkbook: a line that says
// how many statement lines are waiting, and the screen that opens from it (the
// uploads, bringing one in, reviewing one, the rules).
//
// Dara, 6 Oct 2026 (accounting build, part 4): "Nothing imported touches the
// ledger directly. Every line lands in a holding area first." This is the
// holding area's front door. The checkbook itself only changes when a line is
// approved (or filed by a rule a person confirmed), and is read again when
// this screen closes.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { useBackClose } from '../backClose';
import { notify } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { bookTitle, inBook } from '../books';
import { periodText, settleAll, shortDay } from '../statements';

// Used a few times a month, not on every visit to Money.
const StatementImport = React.lazy(() => import('./StatementImport'));
const StatementReview = React.lazy(() => import('./StatementReview'));
const PayeeRules = React.lazy(() => import('./PayeeRules'));

// One upload's state in a few words.
export function uploadStatus(u) {
  const c = u.counts || {};
  if (!u.read_at) return u.read_error ? { tone: 'bad', text: 'Could not be read' } : u.via === 'scan' ? { tone: 'plain', text: 'Being read' } : { tone: 'bad', text: 'Did not finish' };
  if (u.tie && u.tie.blocked) return { tone: 'bad', text: u.tie.off_by != null ? `Off by ${fmtUSDCents(Math.abs(u.tie.off_by))}` : 'Needs its balances' };
  if (c.waiting > 0) return { tone: 'warn', text: `${c.waiting} to review` };
  return { tone: 'good', text: 'All done' };
}

function Hub({ userId, book, categories, readOnly, overview, onChanged, onClose }) {
  const [view, setView] = useState('list');        // 'list' | 'import' | 'rules' | { id }
  useBackClose(() => (view === 'list' ? onClose() : setView('list')));
  const uploads = (overview && overview.imports) || [];
  const back = useCallback(() => setView('list'), []);
  const wait = <div className="loading-screen" style={{ height: '40vh' }}><div className="spinner" /></div>;
  return (
    <div className="st-hub" role="dialog" aria-label="Statements" data-testid="statements-hub">
      <div className="st-hub-in">
        <div className="st-hub-top"><span className="bk-eye">Statements · {bookTitle(book)}</span><button type="button" className="bk-quiet" onClick={onClose} data-testid="statements-close">Close</button></div>
        <React.Suspense fallback={wait}>
          {view === 'import' && <StatementImport book={book} onCancel={back} onDone={(id) => { onChanged(); setView({ id }); }} onOpen={(id) => setView({ id })} />}
          {view === 'rules' && <PayeeRules book={book} categories={categories} canWrite={!readOnly} onBack={back} onChanged={onChanged} />}
          {view && view.id && <StatementReview key={view.id} book={book} importId={view.id} userId={userId} categories={categories} onBack={back} onChanged={onChanged} />}
        </React.Suspense>
        {view === 'list' && (<>
          <div className="mr-head"><h3>Statements</h3><span>{uploads.length ? `${uploads.length} ${uploads.length === 1 ? 'upload' : 'uploads'}` : ''}</span></div>
          <p className="bk-help">Bring in a statement from your bank or card. Every line waits here until you approve it. What you decide for a payee is remembered, so the next statement files it without asking.</p>
          <div className="mr-go">
            {!readOnly && <button type="button" className="save" onClick={() => setView('import')} data-testid="statements-new">Bring in a statement</button>}
            <button type="button" className="clear" onClick={() => setView('rules')} data-testid="statements-rules">Rules</button>
          </div>
          {overview === null ? wait : uploads.length === 0 ? <div className="mr-empty">No statements yet.</div> : (
            <div className="st-uploads">
              {uploads.map((u) => {
                const s = uploadStatus(u), c = u.counts || {};
                return (
                  <button type="button" className="st-upload" key={u.id} onClick={() => setView({ id: u.id })} data-testid="statement-upload">
                    <span className="who"><b>{u.account}</b>
                      <i>{[u.file_name, periodText(u.period_from, u.period_to)].filter(Boolean).join(' · ') || 'No file name'}</i>
                      <i>{shortDay(String(u.created_at).slice(0, 10), true)} · {u.by}{c.lines ? ` · ${c.lines} ${c.lines === 1 ? 'line' : 'lines'}` : ''}{c.done_for_you ? ` · ${c.done_for_you} done for you` : ''}</i></span>
                    <span className={'st-chip ' + s.tone}>{s.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

export default function StatementsDoor({ userId, book, taxCategories, readOnly = false, open, setOpen, setTransactions }) {
  const [overview, setOverview] = useState(null);
  const dirty = useRef(false), settled = useRef(false);
  const bookId = book.id;

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('statement_overview', { p_book: bookId });
    if (error) { setOverview({ waiting: 0, imports: [] }); return null; }
    setOverview(data);
    return data;
  }, [bookId]);
  // The checkbook, read again after statements changed it.
  const refresh = useCallback(async () => {
    dirty.current = false;
    const { data } = await inBook(supabase.from('transactions').select('*'), book, userId).eq('is_archived', false)
      .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
    if (data) setTransactions(data);
  }, [book, userId, setTransactions]);

  // On opening Money: let confirmed rules file what they can from statements
  // that were read while nobody was looking (a scan finishes on its own).
  useEffect(() => {
    let live = true;
    (async () => {
      const o = await load();
      if (!live || !o || readOnly || settled.current) return;
      settled.current = true;
      let total = 0;
      for (const u of o.imports.filter((x) => x.read_at && !(x.tie && x.tie.blocked) && x.counts && x.counts.waiting > 0).slice(0, 4)) total += (await settleAll(u.id)).total;
      if (!live || !total) return;
      notify(`${total} statement ${total === 1 ? 'line was' : 'lines were'} filed for you, the way you filed ${total === 1 ? 'it' : 'them'} before`, 'success');
      await load(); refresh();
    })();
    return () => { live = false; };
  }, [load, readOnly, refresh]);

  const changed = useCallback(() => { dirty.current = true; load(); }, [load]);
  const close = () => { if (dirty.current) refresh(); load(); setOpen(false); };

  const waiting = (overview && overview.waiting) || 0;
  const reading = ((overview && overview.imports) || []).filter((u) => !u.read_at && !u.read_error && u.via === 'scan').length;
  const stuck = ((overview && overview.imports) || []).filter((u) => u.read_at && u.tie && u.tie.blocked).length;
  return (
    <>
      {!open && (waiting > 0 || reading > 0 || stuck > 0) && (
        <p className="mr-note stuck" data-testid="statements-waiting">
          <span>{[waiting ? `${waiting} statement ${waiting === 1 ? 'line is' : 'lines are'} waiting for you` : '', stuck ? `${stuck} ${stuck === 1 ? 'statement does' : 'statements do'} not add up yet` : '', reading ? `${reading} ${reading === 1 ? 'statement is' : 'statements are'} being read` : ''].filter(Boolean).join(' · ')}.</span>
          <button type="button" onClick={() => setOpen(true)}>Open statements</button>
        </p>
      )}
      {open && <Hub userId={userId} book={book} categories={taxCategories} readOnly={readOnly} overview={overview} onChanged={changed} onClose={close} />}
    </>
  );
}
