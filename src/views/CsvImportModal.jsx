// CSV import — the bank/CSV statement importer and its parsing helpers.
//
// CsvImportModal alone is ~870 lines, the largest single component in the app,
// and importing a statement is something an agent does a handful of times a year.
// It has no business in the default finance bundle: its own lazy chunk means the
// Finance screen no longer pays for it on every open.
// Extracted from AccountingViews.jsx.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../icons';
import { modal, money, num, todayISO, today_ymd, ymd } from '../helpers';
import { useBackClose } from '../backClose';
import { confirmDialog, notify, notifyError } from '../notify';
import { fmtUSD, fmtUSDCents, fmtPct } from '../financeUtils';
import { normalizePayee, buildSuggester } from '../financeUtils';

export function parseCSV(text) {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], cell = '', i = 0, inQuotes = false;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  // Drop blank trailing rows
  while (rows.length && rows[rows.length-1].every(c => c.trim() === '')) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    return obj;
  });
  return { headers, rows: dataRows };
}

// Best-effort date parser. Banks use MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD,
// MM-DD-YY, etc. We try a few patterns in order of US-bank prevalence
// and return ISO YYYY-MM-DD or null.

export function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  let s = String(raw).trim();
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

// Heuristic to auto-pick a column when first opening the modal.
// Looks for header strings that commonly mean date/payee/amount across
// banks (BofA, Chase, Wells Fargo, Capital One, Amex, Citi, etc.).

export function parseFlexibleDate(raw, formatHint) {
  if (!raw) return null;
  const s = String(raw).trim();
  // ISO already (YYYY-MM-DD)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // US format MM/DD/YYYY or MM/DD/YY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m && formatHint !== 'dmy') {
    let yr = m[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return `${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  // DD/MM/YYYY (European)
  if (m && formatHint === 'dmy') {
    let yr = m[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return `${yr}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  }
  // MM-DD-YYYY with dashes
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (m) {
    let yr = m[3]; if (yr.length === 2) yr = (parseInt(yr) > 50 ? '19' : '20') + yr;
    return `${yr}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  // Last resort: native Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Parse a money string ($, commas, parens-for-negative). Returns a Number.

export function guessColumn(headers, kind) {
  const lc = headers.map(h => h.toLowerCase());
  const patterns = {
    date: [/^date$/, /trans.*date/, /posting.*date/, /^post.*date/, /eff.*date/, /trade.*date/],
    payee: [/^description$/, /^payee$/, /^merchant$/, /^name$/, /^detail/, /^memo$/, /transaction/],
    amount: [/^amount$/, /^total$/, /^debit.*credit/, /^transaction.*amount/],
    debit: [/^debit$/, /^withdraw/, /^charges$/, /^outflow/, /^paid out/, /^payments$/],
    credit: [/^credit$/, /^deposit/, /^inflow/, /^paid in/, /^payments rec/],
    description: [/^memo$/, /^note$/, /^category$/, /^description$/],
    external_id: [/^reference/, /^transaction.*id$/, /^txn.*id$/, /^id$/, /^check.*number/],
  };
  for (const re of (patterns[kind] || [])) {
    for (let i = 0; i < lc.length; i++) if (re.test(lc[i])) return headers[i];
  }
  return '';
}

export function CsvImportModal({ userId, existingTransactions, taxCategories, trackPersonal, onClose, onImported, onBatchRevoked }) {


  useBackClose(onClose);
  const [tab, setTab] = useState('new');        // 'new' | 'recent' — top-level toggle
  const [step, setStep] = useState('upload');   // 'upload' | 'map' | 'preview' | 'importing' | 'done'
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [error, setError] = useState('');

  // Mapping state — what user has chosen for each column
  const [dateCol, setDateCol] = useState('');
  const [dateFormat, setDateFormat] = useState('mdy'); // 'mdy' | 'dmy' | 'auto'
  const [payeeCol, setPayeeCol] = useState('');
  const [amountMode, setAmountMode] = useState('single'); // 'single' | 'debit_credit'
  const [amountCol, setAmountCol] = useState('');
  const [debitCol, setDebitCol] = useState('');
  const [creditCol, setCreditCol] = useState('');
  const [amountSign, setAmountSign] = useState('standard'); // 'standard' | 'inverted'
  const [descCol, setDescCol] = useState('');
  const [extIdCol, setExtIdCol] = useState('');
  const [defaultScope, setDefaultScope] = useState('business');
  const [defaultAccount, setDefaultAccount] = useState('');

  // Preview state
  const [parsedRows, setParsedRows] = useState([]);
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [importResult, setImportResult] = useState(null);

  // Saved bank profiles (csv_import_profiles) — reusable column mappings.
  // Loaded once on mount; used both for auto-detect (after upload) and as
  // a manual picker if the user wants to apply a different one.
  const [profiles, setProfiles] = useState([]);
  const [appliedProfileId, setAppliedProfileId] = useState(null);
  const [showSaveProfile, setShowSaveProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Recent import batches — surface in the 'Recent' tab so user can
  // revoke (archive) a batch that imported wrong.
  const [recentBatches, setRecentBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [revokingBatchId, setRevokingBatchId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase.from('csv_import_profiles').select('*')
        .eq('user_id', userId).order('last_used_at', { ascending: false, nullsFirst: false }).order('name');
      if (!cancelled) setProfiles(data || []);
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Load recent import batches by aggregating transactions with import_batch_id
  async function loadRecentBatches() {
    setLoadingBatches(true);
    const { data } = await supabase.from('transactions')
      .select('import_batch_id, import_source, imported_at, amount, is_archived')
      .eq('user_id', userId)
      .not('import_batch_id', 'is', null)
      .order('imported_at', { ascending: false })
      .limit(500);
    // Group by batch
    const map = new Map();
    for (const t of (data || [])) {
      if (!map.has(t.import_batch_id)) {
        map.set(t.import_batch_id, {
          id: t.import_batch_id, source: t.import_source, importedAt: t.imported_at,
          rowCount: 0, activeRowCount: 0, archivedRowCount: 0,
          totalAmount: 0, activeTotal: 0,
        });
      }
      const b = map.get(t.import_batch_id);
      b.rowCount++;
      b.totalAmount += Number(t.amount) || 0;
      if (t.is_archived) b.archivedRowCount++;
      else { b.activeRowCount++; b.activeTotal += Number(t.amount) || 0; }
    }
    setRecentBatches(Array.from(map.values()).slice(0, 20));
    setLoadingBatches(false);
  }

  useEffect(() => {
    if (tab === 'recent') loadRecentBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Apply a saved profile to the current mapping state. Mostly a state
  // assignment — does not auto-advance, lets the user verify on /map.
  function applyProfile(p) {
    if (!p) return;
    setDateCol(p.date_column || '');
    setDateFormat(p.date_format === 'dmy' ? 'dmy' : p.date_format === 'auto' ? 'auto' : 'mdy');
    setPayeeCol(p.payee_column || '');
    setAmountMode(p.amount_mode || 'single');
    setAmountCol(p.amount_column || '');
    setDebitCol(p.debit_column || '');
    setCreditCol(p.credit_column || '');
    setAmountSign(p.amount_sign === 'inverted' ? 'inverted' : 'standard');
    setDescCol(p.description_column || '');
    setExtIdCol(p.external_id_column || '');
    setDefaultScope(p.default_scope || 'business');
    if (p.default_account) setDefaultAccount(p.default_account);
    setAppliedProfileId(p.id);
  }

  // Detect a profile that matches the current file's headers (all the
  // profile's referenced columns must exist in the uploaded file). Returns
  // the best match or null.
  function findMatchingProfile(headerList) {
    const headerSet = new Set(headerList);
    for (const p of profiles) {
      const needed = [p.date_column, p.payee_column];
      if (p.amount_mode === 'single') needed.push(p.amount_column);
      else needed.push(p.debit_column, p.credit_column);
      const allPresent = needed.every(c => c && headerSet.has(c));
      if (allPresent) return p;
    }
    return null;
  }

  // Drag-and-drop state for the upload step
  const [isDragOver, setIsDragOver] = useState(false);

  // Process a File object (from input or drop). Validates that it's a
  // CSV, then parses + advances to the map step.
  function processFile(file) {
    if (!file) return;
    // Validate MIME / extension — browsers don't always set type for CSV
    // (especially on drag from Finder), so fall back to extension check.
    const isCsv = (file.type === 'text/csv' || file.type === 'application/vnd.ms-excel' || /\.csv$/i.test(file.name));
    if (!isCsv) {
      setError(`Not a CSV file (${file.name}). Drop a .csv exported from your bank or credit card.`);
      return;
    }
    setFileName(file.name);
    setError('');
    setAppliedProfileId(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { headers: h, rows: r } = parseCSV(ev.target.result);
        if (h.length === 0) { setError('File appears empty or has no header row.'); return; }
        if (r.length === 0) { setError('Header row found but no data rows.'); return; }
        setHeaders(h); setRawRows(r);
        // Account default = filename stem (without extension) — always set
        // first so a profile's default_account can override.
        setDefaultAccount(file.name.replace(/\.[^.]+$/, ''));
        // Tier 1: try to match a saved profile against the file's headers
        const matchingProfile = findMatchingProfile(h);
        if (matchingProfile) {
          applyProfile(matchingProfile);
        } else {
          // Tier 2: header-pattern heuristic for known bank formats
          const guessedDate = guessColumn(h, 'date');
          const guessedPayee = guessColumn(h, 'payee');
          const guessedAmt = guessColumn(h, 'amount');
          const guessedDebit = guessColumn(h, 'debit');
          const guessedCredit = guessColumn(h, 'credit');
          const guessedExtId = guessColumn(h, 'external_id');
          setDateCol(guessedDate);
          setPayeeCol(guessedPayee);
          if (guessedAmt) {
            setAmountMode('single'); setAmountCol(guessedAmt);
          } else if (guessedDebit && guessedCredit) {
            setAmountMode('debit_credit'); setDebitCol(guessedDebit); setCreditCol(guessedCredit);
          }
          setExtIdCol(guessedExtId);
        }
        setStep('map');
      } catch (err) {
        setError('Could not parse CSV: ' + err.message);
      }
    };
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(file);
  }

  function onFile(e) {
    processFile(e.target.files?.[0]);
  }

  // Drag handlers — onDragOver must call preventDefault for drop to fire
  function onDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  }
  function onDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear if leaving the drop zone entirely (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragOver(false);
  }
  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  // Persist current mapping as a reusable profile
  async function saveAsProfile() {
    if (!newProfileName.trim()) return;
    setSavingProfile(true);
    const payload = {
      user_id: userId,
      name: newProfileName.trim(),
      date_column: dateCol,
      date_format: dateFormat,
      payee_column: payeeCol,
      amount_mode: amountMode,
      amount_column: amountMode === 'single' ? amountCol : null,
      debit_column: amountMode === 'debit_credit' ? debitCol : null,
      credit_column: amountMode === 'debit_credit' ? creditCol : null,
      amount_sign: amountSign,
      description_column: descCol || null,
      external_id_column: extIdCol || null,
      default_scope: defaultScope,
      default_account: defaultAccount || null,
      use_count: 1,
      last_used_at: new Date().toISOString(),
    };
    const { data, error: err } = await supabase.from('csv_import_profiles').insert(payload).select().single();
    setSavingProfile(false);
    if (err) {
      if (window.__notify) window.__notify('Save failed: ' + err.message, 'error');
      return;
    }
    setProfiles(prev => [data, ...prev]);
    setAppliedProfileId(data.id);
    setShowSaveProfile(false);
    setNewProfileName('');
    if (window.__notify) window.__notify(`Saved profile "${data.name}"`, 'success');
  }

  // Bump the use_count + last_used_at when a profile is actually used in
  // an import. Fire-and-forget — don't block the import flow on the update.
  async function bumpProfileUsage(profileId) {
    if (!profileId) return;
    const p = profiles.find(x => x.id === profileId);
    if (!p) return;
    await supabase.from('csv_import_profiles')
      .update({ use_count: (Number(p.use_count) || 0) + 1, last_used_at: new Date().toISOString() })
      .eq('id', profileId);
  }

  // Revoke (archive) every transaction in a given import batch. Soft delete
  // via is_archived=true — no hard delete. User can dig the rows back out
  // by un-archiving in Supabase if needed.
  async function revokeBatch(batchId) {
    if (!batchId) return;
    const batch = recentBatches.find(b => b.id === batchId);
    if (!batch) return;
    const confirmMsg = `Archive all ${batch.activeRowCount} active transactions from "${batch.source || 'this import'}"? They'll disappear from the Ledger but can be restored from Supabase if needed.`;
    if (!await confirmDialog(confirmMsg)) return;
    setRevokingBatchId(batchId);
    const { error: err } = await supabase.from('transactions')
      .update({ is_archived: true })
      .eq('user_id', userId).eq('import_batch_id', batchId).eq('is_archived', false);
    setRevokingBatchId(null);
    if (err) {
      if (window.__notify) window.__notify('Revoke failed: ' + err.message, 'error');
      return;
    }
    // Mirror into local batch state
    setRecentBatches(prev => prev.map(b => b.id === batchId
      ? { ...b, archivedRowCount: b.archivedRowCount + b.activeRowCount, activeRowCount: 0, activeTotal: 0 }
      : b));
    // Tell parent so the Ledger drops the archived rows from view
    if (onBatchRevoked) onBatchRevoked(batchId);
    if (window.__notify) window.__notify(`Archived ${batch.activeRowCount} row${batch.activeRowCount===1?'':'s'} from this batch`, 'success');
  }

  // Build the parsed rows from current mapping
  function generatePreview() {
    const out = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rawDate = row[dateCol];
      const date = parseFlexibleDate(rawDate, dateFormat === 'dmy' ? 'dmy' : 'mdy');
      let amount = 0;
      if (amountMode === 'single') {
        amount = parseAmount(row[amountCol]);
        if (amountSign === 'inverted') amount = -amount;
      } else {
        const debit = parseAmount(row[debitCol]);
        const credit = parseAmount(row[creditCol]);
        // Debit reduces balance (outflow = negative), credit adds (inflow = positive)
        amount = credit - Math.abs(debit);
      }
      const payee = (row[payeeCol] || '').trim();
      const description = descCol ? (row[descCol] || '').trim() : '';
      const externalId = extIdCol ? (row[extIdCol] || '').trim() : '';
      out.push({
        rowIndex: i,
        date, amount, payee, description, externalId,
        valid: !!date && !!payee && amount !== 0,
        warnings: [
          !date ? 'invalid date' : null,
          !payee ? 'missing payee' : null,
          amount === 0 ? 'amount is zero' : null,
        ].filter(Boolean),
      });
    }
    return out;
  }

  // Dedup vs existing transactions. Match strategy (in priority order):
  //   1. external_id match (if both have one) — strongest signal
  //   2. date + abs(amount) + payee fuzzy match (date and amount must
  //      match exactly; payee match is case-insensitive substring either
  //      direction) — catches the common case of "DRY ATB" vs "ATB Dry
  //      Cleaners" while accepting occasional false negatives.
  function findDuplicate(parsed) {
    if (parsed.externalId) {
      const m = existingTransactions.find(t => t.external_id === parsed.externalId);
      if (m) return { match: m, reason: 'matched external_id' };
    }
    const ap = (parsed.payee || '').toLowerCase();
    for (const t of existingTransactions) {
      if (t.date !== parsed.date) continue;
      if (Math.abs(Number(t.amount) - parsed.amount) > 0.005) continue;
      const tp = (t.payee || '').toLowerCase();
      if (tp === ap || (ap && tp.includes(ap)) || (tp && ap.includes(tp))) {
        return { match: t, reason: 'matched date + amount + payee' };
      }
    }
    return null;
  }

  function proceedToPreview() {
    if (!dateCol || !payeeCol) { setError('Date and payee columns are required.'); return; }
    if (amountMode === 'single' && !amountCol) { setError('Pick an amount column.'); return; }
    if (amountMode === 'debit_credit' && (!debitCol || !creditCol)) { setError('Pick both debit and credit columns.'); return; }
    setError('');
    const out = generatePreview();
    setParsedRows(out);
    // Pre-select rows that are valid AND not duplicates
    const sel = new Set();
    out.forEach(p => {
      if (p.valid && !findDuplicate(p)) sel.add(p.rowIndex);
    });
    setSelectedRowIds(sel);
    setStep('preview');
  }

  function toggleRow(rowIndex) {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  async function doImport() {
    setStep('importing');
    const batchId = crypto.randomUUID();
    const now = new Date().toISOString();
    const toInsert = parsedRows
      .filter(p => selectedRowIds.has(p.rowIndex) && p.valid)
      .map(p => ({
        user_id: userId,
        date: p.date,
        amount: p.amount,
        payee: p.payee,
        description: p.description || null,
        external_id: p.externalId || null,
        scope: defaultScope,
        account: defaultAccount || null,
        imported_at: now,
        import_source: fileName,
        import_batch_id: batchId,
      }));
    if (toInsert.length === 0) {
      setImportResult({ inserted: 0, errors: [] });
      setStep('done');
      return;
    }
    // Batch insert in chunks of 100 to avoid request-size limits
    const inserted = [];
    const errors = [];
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100);
      const { data, error } = await supabase.from('transactions').insert(chunk).select();
      if (error) {
        errors.push(error.message);
      } else if (data) {
        inserted.push(...data);
      }
    }
    setImportResult({ inserted: inserted.length, errors, rows: inserted });
    // Bump profile use count (fire-and-forget, doesn't block UI)
    if (appliedProfileId && inserted.length > 0) bumpProfileUsage(appliedProfileId);
    setStep('done');
  }

  function finishUp() {
    if (importResult && importResult.rows) onImported(importResult.rows);
    else onClose();
  }

  const validCount = parsedRows.filter(p => p.valid).length;
  const dupCount = parsedRows.filter(p => p.valid && findDuplicate(p)).length;
  const selectedCount = selectedRowIds.size;

  const sel = (val, set, opts) => (
    <select value={val} onChange={e => set(e.target.value)}
      style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
      <option value="">— none —</option>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{maxWidth:'720px',maxHeight:'92vh',overflowY:'auto'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
          <h3 style={{margin:0,fontSize:'15px'}}>
            Import CSV
            {tab === 'new' && (
              <span style={{fontSize:'11px',color:'var(--text-3)',fontWeight:400,marginLeft:'8px'}}>
                · {step === 'upload' ? 'Pick a file' : step === 'map' ? 'Map columns' : step === 'preview' ? 'Review' : step === 'importing' ? 'Importing…' : 'Done'}
              </span>
            )}
          </h3>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'20px',color:'var(--text-3)',cursor:'pointer',padding:'0 4px'}}>×</button>
        </div>

        {/* Top-level tab toggle: New import vs Recent batches */}
        <div style={{display:'flex',gap:'4px',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px',marginBottom:'12px',width:'fit-content'}}>
          <button onClick={() => setTab('new')}
            style={{padding:'5px 12px',border:'none',borderRadius:'6px',fontSize:'11.5px',fontWeight:700,cursor:'pointer',
              background:tab==='new'?'var(--accent)':'transparent', color:tab==='new'?'var(--bg-base)':'var(--text-2)'}}>
            New import
          </button>
          <button onClick={() => setTab('recent')}
            style={{padding:'5px 12px',border:'none',borderRadius:'6px',fontSize:'11.5px',fontWeight:700,cursor:'pointer',
              background:tab==='recent'?'var(--accent)':'transparent', color:tab==='recent'?'var(--bg-base)':'var(--text-2)'}}>
            Recent imports
          </button>
        </div>

        {/* ── RECENT IMPORTS TAB ── */}
        {tab === 'recent' && (
          <div>
            {loadingBatches ? (
              <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Loading…</div>
            ) : recentBatches.length === 0 ? (
              <div style={{padding:'30px',textAlign:'center',color:'var(--text-3)',fontStyle:'italic',fontSize:'12px'}}>
                No previous CSV imports yet. Switch to "New import" to bring in your first file.
              </div>
            ) : (
              <>
                <div style={{fontSize:'10.5px',color:'var(--text-3)',marginBottom:'10px',lineHeight:1.5}}>
                  Click revoke to archive every transaction from that batch. They'll disappear from the Ledger but stay in the database (un-archive in Supabase if needed).
                </div>
                {recentBatches.map(b => {
                  const allRevoked = b.activeRowCount === 0 && b.rowCount > 0;
                  const dateStr = b.importedAt ? new Date(b.importedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
                  return (
                    <div key={b.id} style={{padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',marginBottom:'8px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px'}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:'12.5px',fontWeight:700,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {b.source || '(unlabeled batch)'}
                          </div>
                          <div style={{fontSize:'10.5px',color:'var(--text-3)',marginTop:'2px'}}>
                            {dateStr} · {b.activeRowCount} active / {b.rowCount} total{b.archivedRowCount > 0 ? ` (${b.archivedRowCount} archived)` : ''}
                          </div>
                          {b.activeRowCount > 0 && (
                            <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'4px',fontVariantNumeric:'tabular-nums'}}>
                              net <span style={{color: b.activeTotal >= 0 ? 'var(--green)' : 'var(--red)',fontWeight:700}}>
                                {b.activeTotal >= 0 ? '+' : '−'}${Math.abs(Math.round(b.activeTotal)).toLocaleString()}
                              </span>
                            </div>
                          )}
                        </div>
                        {allRevoked ? (
                          <span style={{fontSize:'10px',color:'var(--text-3)',padding:'4px 10px',background:'var(--bg-hover)',borderRadius:'5px',fontWeight:700,flexShrink:0}}>
                            archived
                          </span>
                        ) : (
                          <button onClick={() => revokeBatch(b.id)} disabled={revokingBatchId === b.id}
                            style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--red)',borderRadius:'5px',color:'var(--red)',cursor:'pointer',fontSize:'10.5px',fontWeight:700,flexShrink:0}}>
                            {revokingBatchId === b.id ? 'Revoking…' : 'Revoke batch'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'10px',fontStyle:'italic',textAlign:'center'}}>
                  Showing the {recentBatches.length} most recent batch{recentBatches.length===1?'':'es'}. Older batches still exist in the database; this view caps display.
                </div>
              </>
            )}
          </div>
        )}

        {/* ── NEW IMPORT TAB ── */}
        {tab === 'new' && (<>

        {/* ── STEP 1: upload ── */}
        {step === 'upload' && (
          <div>
            {profiles.length > 0 && (
              <div style={{marginBottom:'14px',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'6px'}}>Saved bank profiles</div>
                <div style={{fontSize:'10.5px',color:'var(--text-3)',marginBottom:'8px',lineHeight:1.5}}>
                  Auto-detected on upload when headers match. Or pick to pre-fill the mapping.
                </div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                  {profiles.slice(0, 6).map(p => (
                    <span key={p.id} style={{padding:'3px 8px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'5px',fontSize:'10.5px',color:'var(--text-2)',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="save" size={12} /> {p.name}</span>
                      {p.use_count > 0 && <span style={{color:'var(--text-3)',fontSize:'9px'}}>·{p.use_count}×</span>}
                    </span>
                  ))}
                  {profiles.length > 6 && <span style={{fontSize:'10px',color:'var(--text-3)',alignSelf:'center'}}>+{profiles.length - 6} more</span>}
                </div>
              </div>
            )}
            <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              style={{
                padding:'30px 20px',
                border:`2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius:'10px',textAlign:'center',
                background: isDragOver ? 'rgba(197,169,94,0.06)' : 'transparent',
                transition: 'border-color 0.12s, background 0.12s',
              }}>
              <div style={{fontSize:'32px',marginBottom:'10px',transition:'transform 0.12s',transform: isDragOver ? 'scale(1.1)' : 'scale(1)'}}>
                {isDragOver ? <Icon name="archive" size={34} /> : <Icon name="file" size={34} />}
              </div>
              <p style={{fontSize:'13px',color:isDragOver?'var(--accent)':'var(--text-1)',marginBottom:'4px',fontWeight:600}}>
                {isDragOver ? 'Drop to import' : 'Drag a CSV file here, or pick one'}
              </p>
              <p style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'16px'}}>From your bank, credit card, or any financial source.</p>
              <input type="file" accept=".csv,text/csv" onChange={onFile}
                style={{display:'inline-block',padding:'6px 12px',background:'var(--accent)',color:'var(--bg-base)',border:'none',borderRadius:'6px',fontWeight:700,cursor:'pointer',fontSize:'12px'}}/>
            </div>
            {error && (
              <div style={{marginTop:'10px',padding:'8px 10px',background:'rgba(239,68,68,0.10)',border:'1px solid var(--red)',borderRadius:'6px',fontSize:'11px',color:'var(--red)'}}>
                {error}
              </div>
            )}
            <div style={{marginTop:'14px',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.6}}>
              <strong style={{color:'var(--text-2)',display:'block',marginBottom:'4px'}}>What works:</strong>
              Standard CSV with a header row. Handles bank exports from BofA, Chase, Wells Fargo, Capital One, Amex, Citi, and most credit unions. Date can be MM/DD/YYYY or YYYY-MM-DD. Amount can be one column (negative = expense) or two columns (Debit + Credit).
            </div>
          </div>
        )}

        {/* ── STEP 2: map ── */}
        {step === 'map' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px',gap:'8px',flexWrap:'wrap'}}>
              <div style={{fontSize:'11px',color:'var(--text-3)'}}>
                {fileName} · {rawRows.length} rows
              </div>
              {profiles.length > 0 && (
                <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  {appliedProfileId && (
                    <span style={{fontSize:'10px',color:'var(--accent)',padding:'2px 7px',background:'rgba(197,169,94,0.10)',border:'1px solid var(--accent)',borderRadius:'4px',fontWeight:700}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:'5px'}}><Icon name="save" size={12} /> {profiles.find(p => p.id === appliedProfileId)?.name || 'profile'}</span>
                    </span>
                  )}
                  <select value={appliedProfileId || ''} onChange={e => {
                      const p = profiles.find(x => x.id === e.target.value);
                      if (p) applyProfile(p);
                    }}
                    style={{padding:'4px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',fontSize:'10.5px',cursor:'pointer'}}>
                    <option value="">{appliedProfileId ? 'change profile…' : 'apply saved profile…'}</option>
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Sample rows */}
            <div style={{padding:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'14px',overflowX:'auto'}}>
              <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'4px'}}>Sample (first 3 rows)</div>
              <table style={{width:'100%',fontSize:'10.5px',color:'var(--text-2)',borderCollapse:'collapse'}}>
                <thead>
                  <tr>{headers.map(h => <th key={h} style={{textAlign:'left',padding:'2px 6px',color:'var(--text-3)',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 3).map((r, i) => (
                    <tr key={i}>{headers.map(h => <td key={h} style={{padding:'2px 6px',whiteSpace:'nowrap',maxWidth:'160px',overflow:'hidden',textOverflow:'ellipsis'}}>{r[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Date column*</label>
                {sel(dateCol, setDateCol, headers)}
              </div>
              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Date format</label>
                <select value={dateFormat} onChange={e => setDateFormat(e.target.value)}
                  style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
                  <option value="mdy">MM/DD/YYYY (US)</option>
                  <option value="dmy">DD/MM/YYYY (EU)</option>
                  <option value="auto">YYYY-MM-DD (ISO)</option>
                </select>
              </div>
              <div style={{gridColumn:'1 / -1'}}>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Payee / description column*</label>
                {sel(payeeCol, setPayeeCol, headers)}
              </div>

              <div style={{gridColumn:'1 / -1',padding:'10px',background:'var(--bg-base)',borderRadius:'6px'}}>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'6px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Amount</div>
                <div style={{display:'flex',gap:'4px',marginBottom:'8px'}}>
                  <button onClick={() => setAmountMode('single')}
                    style={{flex:1,padding:'5px',border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:700,cursor:'pointer',
                      background: amountMode==='single' ? 'var(--accent)' : 'var(--bg-hover)',
                      color: amountMode==='single' ? 'var(--bg-base)' : 'var(--text-2)'}}>Single column (±)</button>
                  <button onClick={() => setAmountMode('debit_credit')}
                    style={{flex:1,padding:'5px',border:'none',borderRadius:'5px',fontSize:'11px',fontWeight:700,cursor:'pointer',
                      background: amountMode==='debit_credit' ? 'var(--accent)' : 'var(--bg-hover)',
                      color: amountMode==='debit_credit' ? 'var(--bg-base)' : 'var(--text-2)'}}>Debit + Credit columns</button>
                </div>
                {amountMode === 'single' ? (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Amount column*</label>
                      {sel(amountCol, setAmountCol, headers)}
                    </div>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Sign convention</label>
                      <select value={amountSign} onChange={e => setAmountSign(e.target.value)}
                        style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
                        <option value="standard">Negative = expense (default)</option>
                        <option value="inverted">Positive = expense (flip)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Debit column*</label>
                      {sel(debitCol, setDebitCol, headers)}
                    </div>
                    <div>
                      <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Credit column*</label>
                      {sel(creditCol, setCreditCol, headers)}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:600}}>Memo / description (optional)</label>
                {sel(descCol, setDescCol, headers)}
              </div>
              <div>
                <label style={{fontSize:'11px',color:'var(--text-3)',display:'block',marginBottom:'3px',fontWeight:600}}>Bank ref / ID (optional)</label>
                {sel(extIdCol, setExtIdCol, headers)}
              </div>
            </div>

            <div style={{marginTop:'10px',padding:'10px',background:'var(--bg-base)',borderRadius:'6px'}}>
              <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'8px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em'}}>Defaults for imported rows</div>
              <div style={{display:'grid',gridTemplateColumns:trackPersonal ? '1fr 1fr' : '1fr',gap:'8px'}}>
                {trackPersonal && (
                  <div>
                    <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Scope</label>
                    <select value={defaultScope} onChange={e => setDefaultScope(e.target.value)}
                      style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}>
                      <option value="business">Business</option>
                      <option value="personal">Personal</option>
                    </select>
                  </div>
                )}
                <div>
                  <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Account label</label>
                  <input value={defaultAccount} onChange={e => setDefaultAccount(e.target.value)}
                    placeholder="e.g. Chase Business Checking"
                    style={{padding:'5px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',width:'100%'}}/>
                </div>
              </div>
              <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'6px',lineHeight:1.5,fontStyle:'italic'}}>
                These apply to all imported rows. You can re-categorize after import using bulk-edit (planned) or per-row.
              </div>
            </div>

            {error && (
              <div style={{padding:'8px 10px',background:'rgba(239,68,68,0.10)',border:'1px solid var(--red)',borderRadius:'6px',fontSize:'11px',color:'var(--red)',marginTop:'10px'}}>
                {error}
              </div>
            )}

            <div className="modal-actions" style={{display:'flex',justifyContent:'space-between',gap:'8px',marginTop:'14px'}}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('upload')}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={proceedToPreview}>Preview →</button>
            </div>
          </div>
        )}

        {/* ── STEP 3: preview ── */}
        {step === 'preview' && (
          <div>
            <div style={{display:'flex',gap:'8px',marginBottom:'10px',flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Parsed</div>
                <div style={{fontSize:'17px',fontWeight:800,color:'var(--text-1)'}}>{parsedRows.length}</div>
              </div>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Valid</div>
                <div style={{fontSize:'17px',fontWeight:800,color:'var(--green)'}}>{validCount}</div>
              </div>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Duplicates</div>
                <div style={{fontSize:'17px',fontWeight:800,color: dupCount > 0 ? '#f59e0b' : 'var(--text-3)'}}>{dupCount}</div>
              </div>
              <div style={{flex:1,minWidth:'100px',padding:'8px 10px',background:'var(--bg-hover)',border:'1px solid var(--accent)',borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700}}>Selected</div>
                <div style={{fontSize:'17px',fontWeight:800,color:'var(--accent)'}}>{selectedCount}</div>
              </div>
            </div>

            <div style={{display:'flex',gap:'6px',marginBottom:'10px',flexWrap:'wrap',fontSize:'11px'}}>
              <button onClick={() => setSelectedRowIds(new Set(parsedRows.filter(p => p.valid && !findDuplicate(p)).map(p => p.rowIndex)))}
                style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',cursor:'pointer',fontWeight:600,fontSize:'10.5px'}}>
                Select non-duplicates
              </button>
              <button onClick={() => setSelectedRowIds(new Set(parsedRows.filter(p => p.valid).map(p => p.rowIndex)))}
                style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',cursor:'pointer',fontWeight:600,fontSize:'10.5px'}}>
                Select all valid
              </button>
              <button onClick={() => setSelectedRowIds(new Set())}
                style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-2)',cursor:'pointer',fontWeight:600,fontSize:'10.5px'}}>
                Clear
              </button>
            </div>

            <div style={{maxHeight:'400px',overflowY:'auto',border:'1px solid var(--border)',borderRadius:'6px'}}>
              <table style={{width:'100%',fontSize:'11px',borderCollapse:'collapse'}}>
                <thead style={{position:'sticky',top:0,background:'var(--bg-hover)'}}>
                  <tr>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px',width:'30px'}}>✓</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Date</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Payee</th>
                    <th style={{padding:'6px 8px',textAlign:'right',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Amount</th>
                    <th style={{padding:'6px 8px',textAlign:'left',fontWeight:700,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontSize:'9px'}}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map(p => {
                    const dup = p.valid ? findDuplicate(p) : null;
                    const selected = selectedRowIds.has(p.rowIndex);
                    return (
                      <tr key={p.rowIndex} onClick={() => p.valid && toggleRow(p.rowIndex)}
                        style={{borderBottom:'1px solid var(--border)',cursor: p.valid ? 'pointer' : 'default',opacity: p.valid ? 1 : 0.4,background: selected ? 'rgba(197,169,94,0.05)' : 'transparent'}}>
                        <td style={{padding:'5px 8px'}}>
                          {p.valid && <input type="checkbox" checked={selected} onChange={() => toggleRow(p.rowIndex)} onClick={e => e.stopPropagation()}/>}
                        </td>
                        <td style={{padding:'5px 8px',color:'var(--text-2)',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{p.date || '—'}</td>
                        <td style={{padding:'5px 8px',color:'var(--text-1)',maxWidth:'220px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.payee || '(no payee)'}</td>
                        <td style={{padding:'5px 8px',textAlign:'right',fontVariantNumeric:'tabular-nums',color: p.amount < 0 ? 'var(--red)' : 'var(--green)',fontWeight:600}}>{fmtUSD(p.amount)}</td>
                        <td style={{padding:'5px 8px',fontSize:'10px'}}>
                          {!p.valid ? (
                            <span style={{color:'var(--red)'}}>{p.warnings.join(', ')}</span>
                          ) : dup ? (
                            <span style={{color:'#f59e0b'}} title={dup.reason}>dup ({dup.reason})</span>
                          ) : (
                            <span style={{color:'var(--green)'}}>new</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{marginTop:'10px',fontSize:'10.5px',color:'var(--text-3)',lineHeight:1.5,fontStyle:'italic'}}>
              Duplicates are detected by exact date + amount + matching payee, or by matching bank reference ID. They're unchecked by default but you can re-select if you actually want to import them.
            </div>

            {/* Save-as-profile prompt — only when not already using a saved profile */}
            {!appliedProfileId && (
              <div style={{marginTop:'10px',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                {!showSaveProfile ? (
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                    <span style={{fontSize:'11px',color:'var(--text-2)'}}>
                      Save this mapping as a bank profile? Next time, just upload — column mapping happens automatically.
                    </span>
                    <button onClick={() => { setShowSaveProfile(true); setNewProfileName(defaultAccount || ''); }}
                      style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--accent)',borderRadius:'5px',color:'var(--accent)',cursor:'pointer',fontSize:'10.5px',fontWeight:700,flexShrink:0}}>
                      Save mapping
                    </button>
                  </div>
                ) : (
                  <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
                    <input type="text" value={newProfileName} onChange={e => setNewProfileName(e.target.value)}
                      placeholder='e.g. "Chase Business Checking"' autoFocus
                      style={{flex:'1 1 200px',padding:'5px 8px',background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-1)',fontSize:'11.5px',outline:'none'}}/>
                    <button onClick={saveAsProfile} disabled={savingProfile || !newProfileName.trim()}
                      style={{padding:'5px 10px',background:'var(--accent)',border:'none',borderRadius:'5px',color:'var(--bg-base)',cursor:'pointer',fontSize:'10.5px',fontWeight:700,opacity:(!newProfileName.trim())?0.4:1}}>
                      {savingProfile ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setShowSaveProfile(false)}
                      style={{padding:'5px 10px',background:'transparent',border:'1px solid var(--border)',borderRadius:'5px',color:'var(--text-3)',cursor:'pointer',fontSize:'10.5px'}}>Cancel</button>
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions" style={{display:'flex',justifyContent:'space-between',gap:'8px',marginTop:'14px'}}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('map')}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={doImport} disabled={selectedCount === 0}>
                Import {selectedCount} {selectedCount === 1 ? 'row' : 'rows'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4: importing ── */}
        {step === 'importing' && (
          <div style={{padding:'40px',textAlign:'center'}}>
            <div style={{fontSize:'14px',color:'var(--text-1)',marginBottom:'4px'}}>Importing…</div>
            <div style={{fontSize:'11px',color:'var(--text-3)'}}>Inserting {selectedCount} transactions</div>
          </div>
        )}

        {/* ── STEP 5: done ── */}
        {step === 'done' && importResult && (
          <div>
            <div style={{padding:'30px 20px',textAlign:'center',background: importResult.inserted > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.06)',border: `1px solid ${importResult.inserted > 0 ? 'var(--green)' : '#f59e0b'}`,borderRadius:'10px',marginBottom:'12px'}}>
              <div style={{fontSize:'40px',marginBottom:'6px'}}>{importResult.inserted > 0 ? '✓' : '!'}</div>
              <div style={{fontSize:'18px',fontWeight:800,color: importResult.inserted > 0 ? 'var(--green)' : '#f59e0b',marginBottom:'4px'}}>
                {importResult.inserted} {importResult.inserted === 1 ? 'transaction' : 'transactions'} imported
              </div>
              {importResult.errors.length > 0 && (
                <div style={{fontSize:'11px',color:'var(--red)',marginTop:'8px'}}>
                  {importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}:
                  <div style={{marginTop:'4px',fontStyle:'italic'}}>{importResult.errors.slice(0,3).join(' · ')}</div>
                </div>
              )}
            </div>
            <div style={{padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'11px',color:'var(--text-3)',lineHeight:1.5}}>
              Newly-imported rows are uncategorized. Open them in the Ledger to assign tax categories and lead-gen / recruiting systems. Bulk-categorization tools coming in a future build.
            </div>
            <div className="modal-actions" style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'14px'}}>
              <button type="button" className="btn btn-primary" onClick={finishUp}>Done</button>
            </div>
          </div>
        )}

        </>)}
      </div>
    </div>
  );
}

// ─── Payee normalization + category auto-suggest ─────────────────────
// Strips the bank cruft that breaks naive payee matching. After this,
// "POS PURCHASE STARBUCKS #4521 TAMPA FL" and "STARBUCKS #1029 LUTZ FL"
// both normalize to "starbucks" so they suggest the same category.
