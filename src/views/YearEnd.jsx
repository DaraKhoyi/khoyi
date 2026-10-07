// YearEnd — one button for the CPA's bundle, and one for everything.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Year-end package. One button:
// reports, 1099 list, Schedule C mapping and all receipts, as a bundle for the
// CPA." "Full export at any time. Your data stays yours and leaves in standard
// formats."
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { notify, notifyError } from '../notify';
import { bookTitle } from '../books';
import { saveBlob } from '../exportFile';

export default function YearEnd({ book, userId }) {
  const thisYear = Number(todayNY().slice(0, 4));
  const [year, setYear] = useState(todayNY().slice(5, 7) <= '03' ? thisYear - 1 : thisYear);
  const [step, setStep] = useState(null);
  const [done, setDone] = useState(null);
  const run = async (y) => {
    setStep('Starting'); setDone(null);
    try {
      const { buildBundle } = await import('../yearEnd');
      const { data: cats } = await supabase.from('tax_categories').select('id, name, schedule_c_line').eq('book_id', book.id);
      const out = await buildBundle({ book, year: y, categories: cats || [], userId, onStep: setStep });
      saveBlob(out.blob, out.name);
      setDone({ ...out, year: y });
      notify(y ? `The ${y} package is in your downloads` : 'Everything is in your downloads', 'success');
    } catch (e) { notifyError('The bundle could not be made: ' + String((e && e.message) || e)); }
    setStep(null);
  };
  return (
    <div className="mr" data-testid="year-end">
      <div className="mr-card">
        <div className="bk-eye">Year-end package for your CPA</div>
        <p className="bk-help">One file with the year's reports, the 1099 list, the Schedule C mapping, every entry, every receipt and the statements as the bank sent them. Reconcile each account through December first, so the figures are final.</p>
        <div className="mr-chips" role="group" aria-label="Year">
          {[thisYear, thisYear - 1].map((y) => <button type="button" key={y} className={year === y ? 'on' : ''} aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>)}
        </div>
        <div className="mr-go"><button type="button" className="save" disabled={!!step} onClick={() => run(year)} data-testid="year-end-build">{step ? 'Working' : `Make the ${year} package`}</button></div>
      </div>
      <div className="mr-card">
        <div className="bk-eye">Everything, every year</div>
        <p className="bk-help">A full copy of {bookTitle(book)} in plain files any spreadsheet opens: every entry, every report, every receipt and statement. Take it whenever you like. Nothing here is thrown away: an entry you remove stays in the record, and statements and receipts are kept at least seven years.</p>
        <div className="mr-go"><button type="button" className="clear" disabled={!!step} onClick={() => run(null)} data-testid="export-everything">Export everything</button></div>
      </div>
      {step && <p className="st-proof plain" data-testid="year-end-step"><span className="spinner" /><span>{step}. Keep this screen open.</span></p>}
      {done && (
        <p className={'st-proof ' + (done.missing.length ? 'warn' : 'good')} data-testid="year-end-done">
          <span>{done.name}: {done.counts.reports} reports, {done.counts.entries} entries, {done.counts.receipts} receipts, {done.counts.statements} statement files.
            {done.missing.length ? ` ${done.missing.length} thing(s) could not be included; they are listed in the READ ME inside: ${done.missing.slice(0, 3).join('; ')}` : ' Nothing was left out.'}</span>
        </p>
      )}
    </div>
  );
}
