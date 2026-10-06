// StatementImport — getting a statement in: a bank's CSV, an OFX / QFX file,
// or a scanned, photographed or PDF statement.
//
// Dara, 6 Oct 2026 (accounting build, part 4): "CSV from any bank or card. The
// first upload from a bank asks the user to confirm which column is which. The
// layout is remembered, so the second upload asks nothing. OFX and QFX.
// Scanned or photographed statements and PDFs, read by AI. Phone camera as
// well as file upload. Nothing imported touches the ledger directly."
//
// A CSV or OFX file is read here, on the person's own device; a scan is read
// by the statement reader. Either way the lines go to the holding area and the
// original is kept with them. This screen never writes an entry.
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../dataService';
import { notify, notifyError } from '../notify';
import { fmtUSDCents } from '../financeUtils';
import { ACCOUNT_KINDS } from '../books';
import { periodText, settleAll, shortDay } from '../statements';
import { autoMap, balancesFromColumn, dateRange, fileKind, headerSignature, looksFlipped, mapIsComplete, mapLines, parseCSV, parseOFX, safeFileName, sha256Hex, tieOf } from '../statementParse';

const MAX_LINES = 1500;
const toNum = (v) => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; };
const key = (s) => String(s || '').trim().toLowerCase();

// A photo as a JPEG no larger than the reader can use. Also turns an iPhone's
// HEIC into something every browser and the reader can open.
async function asJpeg(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { blob: file, name: safeFileName(file.name), type: 'application/pdf' };
  try {
    const bmp = await window.createImageBitmap(file);
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('no image');
    return { blob, name: safeFileName(file.name.replace(/\.[^.]+$/, '') + '.jpg'), type: 'image/jpeg' };
  } catch (_e) {
    if (/\.(jpe?g|png|webp)$/i.test(file.name)) return { blob: file, name: safeFileName(file.name), type: file.type || 'image/jpeg' };
    throw new Error(`"${file.name}" is a kind of photo this browser cannot open. Use Take a photo, or save it as a JPG or a PDF first.`);
  }
}

export default function StatementImport({ book, onDone, onOpen, onCancel }) {
  const own = book.kind === 'personal';
  const [accounts, setAccounts] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [account, setAccount] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [newKind, setNewKind] = useState('bank');
  const [personal, setPersonal] = useState(false);
  const [files, setFiles] = useState([]);          // scan pages, or the one CSV / OFX file
  const [via, setVia] = useState(null);            // 'csv' | 'ofx' | 'scan'
  const [csv, setCsv] = useState(null);            // { headers, rows }
  const [map, setMap] = useState(null);
  const [known, setKnown] = useState(false);       // a remembered layout: columns are not asked about
  const [ofx, setOfx] = useState(null);
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [working, setWorking] = useState('');
  const [already, setAlready] = useState(null);
  const fileRef = useRef(null), camRef = useRef(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      supabase.from('money_accounts').select('name, kind, is_personal, retired_at').eq('book_id', book.id).order('name'),
      supabase.from('statement_layouts').select('signature, account, mapping, updated_at').eq('book_id', book.id).order('updated_at', { ascending: false }),
    ]).then(([a, l]) => { if (!live) return; setAccounts((a.data || []).filter((x) => !x.retired_at)); setLayouts(l.data || []); if (!(a.data || []).length) setIsNew(true); });
    return () => { live = false; };
  }, [book.id]);

  const acct = accounts.find((a) => key(a.name) === key(account)) || null;
  const kind = acct ? acct.kind : newKind;
  const isCard = kind === 'card';
  const pickAccount = (name) => { setAccount(name); setIsNew(false); const a = accounts.find((x) => key(x.name) === key(name)); if (a) setPersonal(!!a.is_personal); };

  // ── a file was chosen ──
  async function chosen(list, fromCamera) {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setAlready(null);
    const first = picked[0];
    const head = /\.(csv|txt|tsv|ofx|qfx|qbo)$/i.test(first.name) || first.type.startsWith('text/') ? (await first.slice(0, 4000).text()) : '';
    const k = fromCamera ? 'scan' : fileKind(first.name, head) || (first.type.startsWith('image/') ? 'scan' : null);
    if (!k) { notifyError('That is not a file PrismOS can read. Use a CSV, OFX or QFX file from your bank, a PDF statement, or a photo.'); return; }
    if (k === 'scan') {
      const pages = via === 'scan' ? [...files, ...picked] : picked;
      if (pages.length > 12) { notifyError('That is more than 12 pages. Upload one statement at a time.'); return; }
      setVia('scan'); setFiles(pages); setCsv(null); setOfx(null); setMap(null);
      return;
    }
    const text = await first.text();
    setFiles([first]); setVia(k); setOpening(''); setClosing('');
    if (k === 'ofx') {
      const o = parseOFX(text);
      if (!o.lines.length) { notifyError('No transactions were found in that file.'); setVia(null); setFiles([]); return; }
      setOfx(o); setCsv(null); setMap(null);
      if (o.closing != null) setClosing((o.isCard ? -o.closing : o.closing).toFixed(2));
      if (o.isCard && !acct) setNewKind('card');
      return;
    }
    const parsed = parseCSV(text);
    if (!parsed.headers.length || !parsed.rows.length) { notifyError('That file has no rows PrismOS can read.'); setVia(null); setFiles([]); return; }
    const sig = headerSignature(parsed.headers);
    const mine = layouts.filter((l) => l.signature === sig);
    const fit = mine.find((l) => key(l.account) === key(account)) || mine[0] || null;
    setCsv(parsed); setOfx(null);
    if (fit && mapIsComplete(fit.mapping) && [fit.mapping.date, fit.mapping.payee].every((h) => parsed.headers.includes(h))) {
      setMap(fit.mapping); setKnown(true);
      if (!account && fit.account) pickAccount(fit.account);
    } else {
      const guess = autoMap(parsed.headers);
      guess.flip = mapIsComplete(guess) && looksFlipped(mapLines(parsed.rows, guess).lines);
      setMap(guess); setKnown(false);
    }
  }

  // ── what the file says, as lines ──
  const read = via === 'ofx' && ofx ? { lines: ofx.lines, left: 0 } : via === 'csv' && csv && mapIsComplete(map) ? mapLines(csv.rows, map) : null;
  const lines = read ? read.lines : [];
  const range = dateRange(lines);
  const fromColumn = via === 'csv' && lines.length ? balancesFromColumn(lines) : null;
  // Balances as the books count them: money owed on a card is negative.
  const typed = (v) => (v === '' ? null : isCard ? -toNum(v) : toNum(v));
  const open = fromColumn ? fromColumn.opening : typed(opening), close = fromColumn ? fromColumn.closing : typed(closing);
  const tie = tieOf(lines, open, close);
  const undated = lines.filter((l) => !l.date).length;
  const ready = !!account.trim() && !working && (via === 'scan' ? files.length > 0 : lines.length > 0 && lines.length <= MAX_LINES);

  async function begin(v, file) {
    const sha = await sha256Hex(await file.arrayBuffer());
    const { data, error } = await supabase.rpc('statement_begin', { p_book: book.id, p_account: account.trim(), p_via: v, p_file_name: file.name, p_sha: sha,
      p_kind: acct ? null : newKind, p_personal: own ? personal : null });
    if (error) throw new Error(error.message);
    if (data.already) { setAlready(data); return null; }
    return data;
  }
  async function keep(folder, pages) {
    const paths = [];
    for (let i = 0; i < pages.length; i++) {
      const path = `${folder}/${i + 1}-${pages[i].name}`;
      const { error } = await supabase.storage.from('statements').upload(path, pages[i].blob, { contentType: pages[i].type || undefined, upsert: false });
      if (error) throw new Error('The file did not upload: ' + error.message);
      paths.push(path);
    }
    return paths;
  }

  async function go() {
    let started = null;
    try {
      if (via === 'scan') {
        setWorking('Getting the pages ready');
        const pages = [];
        for (const f of files) pages.push(await asJpeg(f));
        if (pages.reduce((s, p) => s + p.blob.size, 0) > 23 * 1024 * 1024) throw new Error('Those pages are too large to read in one go (about 23 MB at most). Upload one statement at a time.');
        started = await begin('scan', files[0]);
        if (!started) { setWorking(''); return; }
        setWorking('Saving the original');
        const paths = await keep(started.folder, pages);
        const { error: fe } = await supabase.rpc('statement_files', { p_import: started.id, p_paths: paths });
        if (fe) throw new Error(fe.message);
        setWorking('Starting the reader');
        const { data, error } = await supabase.functions.invoke('read-statement', { body: { import_id: started.id } });
        if (error || (data && data.error)) throw new Error((data && data.error) || 'The reader could not be started. Open the upload and tap Read it again.');
        onDone(started.id);
        return;
      }
      if ((open == null) !== (close == null)) throw new Error('Type both balances, or leave both empty.');
      if (Number.isNaN(open) || Number.isNaN(close)) throw new Error('Enter each balance as a number, for example 2500.00');
      started = await begin(via, files[0]);
      if (!started) { setWorking(''); return; }
      setWorking('Saving the original');
      const paths = await keep(started.folder, [{ blob: files[0], name: safeFileName(files[0].name), type: files[0].type || 'text/plain' }]);
      const { error: fe } = await supabase.rpc('statement_files', { p_import: started.id, p_paths: paths });
      if (fe) throw new Error(fe.message);
      setWorking(`Bringing in ${lines.length} lines`);
      const { error } = await supabase.rpc('statement_add_lines', { p_import: started.id,
        p_lines: lines.map((l) => ({ date: l.date, amount: l.amount, text: l.text, memo: l.memo, external_id: l.external_id })),
        p_opening: open, p_closing: close, p_from: (ofx && ofx.from) || range.from, p_to: (ofx && ofx.to) || range.to });
      if (error) throw new Error(error.message);
      if (via === 'csv') await supabase.rpc('statement_layout_save', { p_book: book.id, p_signature: headerSignature(csv.headers), p_account: account.trim(), p_mapping: map });
      setWorking('Filing what you have filed before');
      const { total } = await settleAll(started.id);
      if (total > 0) notify(`${total} ${total === 1 ? 'line was' : 'lines were'} filed for you, the way you filed ${total === 1 ? 'it' : 'them'} before`, 'success');
      onDone(started.id);
    } catch (e) {
      // Nothing half-done is left behind: an upload that never got its lines is removed.
      if (started && started.id) { try { await supabase.rpc('statement_take_back', { p_import: started.id }); } catch (_) { /* it shows as unfinished and can be removed there */ } }
      notifyError(String((e && e.message) || e));
      setWorking('');
    }
  }

  const setCol = (k, v) => { setMap({ ...map, [k]: v }); };
  const colPick = (label, k, optional) => (
    <label className="mr-f">{label}
      <select value={map[k] || ''} onChange={(e) => setCol(k, e.target.value)}>
        <option value="">{optional ? 'Not in this file' : 'Choose a column'}</option>
        {csv.headers.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div className="st-import" data-testid="statement-import">
      <button type="button" className="bk-link" onClick={onCancel}>Back to all statements</button>
      <div className="mr-head"><h3>Bring in a statement</h3><span>Nothing reaches your books until you approve it</span></div>

      <div className="bk-eye">1. Which account is it for?</div>
      {accounts.length > 0 && (
        <div className="mr-chips" role="group" aria-label="Account">
          {accounts.map((a) => <button type="button" key={a.name} className={!isNew && key(a.name) === key(account) ? 'on' : ''} onClick={() => pickAccount(a.name)}>{a.name}</button>)}
          <button type="button" className={isNew ? 'on' : ''} onClick={() => { setIsNew(true); setAccount(''); setPersonal(false); }}>A new account</button>
        </div>
      )}
      {isNew && (
        <div className="mr-two">
          <label className="mr-f">Its name<input type="text" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Operating Checking" data-testid="statement-account-name" /></label>
          <label className="mr-f">Kind<select value={newKind} onChange={(e) => setNewKind(e.target.value)}>{ACCOUNT_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        </div>
      )}
      {own && (isNew || acct) && (
        <label className="st-check"><input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
          <span>A personal account. What comes in on it starts as personal, not business.</span></label>
      )}

      <div className="bk-eye">2. The statement</div>
      <div className="mr-go">
        <button type="button" className="clear" onClick={() => fileRef.current && fileRef.current.click()} disabled={!!working} data-testid="statement-choose-file">{files.length && via !== 'scan' ? 'Choose a different file' : 'Choose a file'}</button>
        <button type="button" className="clear" onClick={() => camRef.current && camRef.current.click()} disabled={!!working}>{via === 'scan' && files.length ? 'Add another page' : 'Take a photo'}</button>
      </div>
      <input ref={fileRef} type="file" hidden accept=".csv,.txt,.ofx,.qfx,.qbo,.pdf,image/*" multiple data-testid="statement-file"
        onChange={(e) => { chosen(e.target.files, false); e.target.value = ''; }} />
      <input ref={camRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { chosen(e.target.files, true); e.target.value = ''; }} />
      {!files.length && <p className="bk-help">A CSV, OFX or QFX file downloaded from your bank is exact and quickest. A PDF statement or photos of a paper one work too: PrismOS reads them and you check anything it was unsure of.</p>}

      {via === 'scan' && files.length > 0 && (
        <div className="mr-card">
          <div className="bk-eye">{files.length} {files.length === 1 ? 'page' : 'pages'}, in this order</div>
          {files.map((f, i) => <div className="bk-row" key={i + f.name}><span className="n">{i + 1}. {f.name}</span><button type="button" className="bk-link" onClick={() => setFiles(files.filter((_, n) => n !== i))}>Remove</button></div>)}
          <p className="bk-help">To read a scan, PrismOS sends these pages to its AI reader. The reader sees whatever is printed on them, the account number included. The original stays in your private storage, and no account number is copied into your books.</p>
        </div>
      )}

      {via === 'csv' && csv && map && (known ? (
        <p className="mr-note stuck" data-testid="statement-layout-known"><span>PrismOS knows this bank&rsquo;s layout from last time, so there is nothing to set up.</span><button type="button" onClick={() => setKnown(false)}>Check the columns</button></p>
      ) : (
        <div className="mr-card" data-testid="statement-columns">
          <div className="bk-eye">Which column is which? Asked once for this bank</div>
          <div className="mr-two">{colPick('Date', 'date')}{colPick('Description', 'payee')}</div>
          <div className="mr-dir" role="group" aria-label="How amounts are shown">
            <button type="button" className={map.mode !== 'split' ? 'on' : ''} onClick={() => setCol('mode', 'single')}>One amount column</button>
            <button type="button" className={map.mode === 'split' ? 'on' : ''} onClick={() => setCol('mode', 'split')}>Separate out and in</button>
          </div>
          {map.mode === 'split' ? <div className="mr-two">{colPick('Money out', 'debit')}{colPick('Money in', 'credit')}</div> : colPick('Amount', 'amount')}
          <div className="mr-two">{colPick('Running balance', 'balance', true)}{colPick('Bank reference', 'external_id', true)}</div>
          {map.mode !== 'split' && <label className="st-check"><input type="checkbox" checked={!!map.flip} onChange={(e) => setCol('flip', e.target.checked)} /><span>In this file, money going out is shown as a positive number.</span></label>}
        </div>
      ))}

      {read && lines.length > 0 && (
        <div className="mr-card" data-testid="statement-preview">
          <div className="bk-eye">{lines.length} {lines.length === 1 ? 'line' : 'lines'}{range.from ? ' · ' + periodText(range.from, range.to) : ''}</div>
          {lines.slice(0, 4).map((l, i) => (
            <div className="bk-row" key={i}><span className="n">{l.text || 'No description'}<i>{shortDay(l.date, true) || 'No date'}</i></span>
              <span className={'st-amt' + (l.amount > 0 ? ' in' : '')}>{l.amount > 0 ? 'in ' : 'out '}{fmtUSDCents(Math.abs(l.amount))}</span></div>
          ))}
          {lines.length > 4 && <p className="bk-help">and {lines.length - 4} more. If money out and money in look swapped, {known ? 'tap Check the columns' : 'tick the box above'}.</p>}
          {undated > 0 && <p className="st-flag">{undated} {undated === 1 ? 'line has' : 'lines have'} a date PrismOS could not read. {undated === 1 ? 'It' : 'They'} will wait for you in review.</p>}
          {lines.length > MAX_LINES && <p className="st-flag">That is more than {MAX_LINES.toLocaleString()} lines. Download it from the bank a few months at a time.</p>}
          {fromColumn ? <p className="st-proof good"><span>Adds up against the bank&rsquo;s own running balance: {fmtUSDCents(fromColumn.opening)} at the start, {fmtUSDCents(fromColumn.closing)} at the end.</span></p> : (<>
            <div className="mr-two">
              <label className="mr-f">{isCard ? 'Owed at the start' : 'Balance at the start'}<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="Optional" /></label>
              <label className="mr-f">{isCard ? 'Owed at the end' : 'Balance at the end'}<input type="text" inputMode="decimal" autoComplete="off" className="amt" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="Optional" /></label>
            </div>
            {open != null && close != null && !Number.isNaN(open) && !Number.isNaN(close) ? (
              tie.proven ? <p className="st-proof good"><span>Adds up.</span></p>
                : <p className="st-proof bad"><span>Off by {fmtUSDCents(Math.abs(tie.offBy))}. You can bring it in, but nothing will reach your books until the balances are right or an owner lets it through.</span></p>
            ) : <p className="bk-help">With both balances from the statement, PrismOS can prove nothing is missing or doubled. You can add them later.</p>}
          </>)}
        </div>
      )}

      {already && (
        <div className="st-proof warn" data-testid="statement-already"><span>This exact file was already uploaded on {shortDay(String(already.uploaded_at).slice(0, 10), true)} for {already.account}. It was not read again.</span>
          <div className="st-go"><button type="button" className="main" onClick={() => onOpen(already.already)}>Open that upload</button></div></div>
      )}

      <div className="mr-go">
        <button type="button" className="save" disabled={!ready} onClick={go} data-testid="statement-go">
          {working || (via === 'scan' ? 'Read this statement' : lines.length ? `Bring ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} in for review` : 'Bring it in for review')}</button>
      </div>
      {!account.trim() && (files.length > 0) && <p className="bk-help">Say which account it is for, above.</p>}
    </div>
  );
}
