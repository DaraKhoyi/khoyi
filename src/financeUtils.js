// financeUtils — shared money/percent/hours formatters.
// Extracted from AccountingViews.jsx so the finance, prospecting and systems
// bundles can each import them without pulling in the whole accounting monolith.

export const fmtUSD = (n) => {
  const v = Number(n) || 0;
  const isNeg = v < 0;
  return (isNeg ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
};

export const fmtUSDCents = (n) => {
  const v = Number(n) || 0;
  const isNeg = v < 0;
  return (isNeg ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const fmtPct = (n, digits = 1) => `${(Number(n) * 100).toFixed(digits)}%`;

export const fmtHours = (mins) => {
  const h = (Number(mins) || 0) / 60;
  return h < 10 ? h.toFixed(1) : Math.round(h).toString();
};

// Payee normalisation + the category suggester. They live here rather than in
// CsvImportModal because a STATIC import of them from AccountingViews would
// defeat the modal's dynamic import and pull the whole importer back into the
// finance chunk (rollup warns about exactly this).
export function normalizePayee(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // Common bank/card-network prefixes that contain no merchant info
    .replace(/\b(pos|atm|ach|eft|wire|debit|credit|purchase|payment|deposit|withdrawal|transfer|recurring|online|online banking|automatic|electronic|p2p|venmo|zelle|paypal payment to|paypal payment from|paypal\*?|sq ?\*|tst\*?|amzn ?mktp ?us|amazon\.com|amazon mktpl|amzn digital)\b/g, ' ')
    // Strip city/state/zip cruft at the end (e.g. "TAMPA FL", "lutz fl 33548")
    .replace(/\s+[a-z]{3,20}\s+[a-z]{2}\s*\d{0,5}\s*$/i, ' ')
    // Strip reference numbers, transaction IDs, store numbers
    .replace(/[#*]\s*\d+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    // Strip punctuation
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a category-suggestion lookup from past categorized transactions.
// Returns { suggest(payee) → { categoryId, systemId, confidence, source } | null }
// confidence: 'exact' (same normalized payee), 'prefix' (first 2 words match),
//             'fuzzy' (first word match with >2 prior occurrences).

export function buildSuggester(categorizedTransactions) {
  // Group prior transactions by normalized payee → most-recent category mapping
  const byPayee = new Map();  // normalized → { cats: Map<id, {count, latest}>, syss: Map<id, {count, latest}> }
  for (const t of categorizedTransactions) {
    const norm = normalizePayee(t.payee);
    if (!norm) continue;
    if (!byPayee.has(norm)) byPayee.set(norm, { cats: new Map(), syss: new Map() });
    const e = byPayee.get(norm);
    if (t.tax_category_id) {
      const c = e.cats.get(t.tax_category_id) || { count: 0, latest: '' };
      c.count++;
      if (t.date > c.latest) c.latest = t.date;
      e.cats.set(t.tax_category_id, c);
    }
    if (t.lead_gen_system_id) {
      const s = e.syss.get(t.lead_gen_system_id) || { count: 0, latest: '' };
      s.count++;
      if (t.date > s.latest) s.latest = t.date;
      e.syss.set(t.lead_gen_system_id, s);
    }
  }
  // Pre-compute first-N-word indexes for fuzzy lookups
  const firstWordIndex = new Map();  // first word → Set of normalized payees containing it
  const twoWordIndex = new Map();
  for (const norm of byPayee.keys()) {
    const words = norm.split(' ');
    const first = words[0];
    const two = words.slice(0, 2).join(' ');
    if (first) {
      if (!firstWordIndex.has(first)) firstWordIndex.set(first, new Set());
      firstWordIndex.get(first).add(norm);
    }
    if (two && two !== first) {
      if (!twoWordIndex.has(two)) twoWordIndex.set(two, new Set());
      twoWordIndex.get(two).add(norm);
    }
  }
  // Pick the most-frequent (count, then most-recent) entry from a Map
  function topPick(m) {
    let best = null;
    for (const [id, info] of m.entries()) {
      if (!best || info.count > best.info.count ||
          (info.count === best.info.count && info.latest > best.info.latest)) {
        best = { id, info };
      }
    }
    return best ? best.id : null;
  }
  // Aggregate cats/syss across multiple matching normalized payees
  function combineEntries(norms) {
    const cats = new Map();
    const syss = new Map();
    for (const n of norms) {
      const e = byPayee.get(n);
      if (!e) continue;
      for (const [id, info] of e.cats.entries()) {
        const c = cats.get(id) || { count: 0, latest: '' };
        c.count += info.count;
        if (info.latest > c.latest) c.latest = info.latest;
        cats.set(id, c);
      }
      for (const [id, info] of e.syss.entries()) {
        const s = syss.get(id) || { count: 0, latest: '' };
        s.count += info.count;
        if (info.latest > s.latest) s.latest = info.latest;
        syss.set(id, s);
      }
    }
    return { cats, syss };
  }

  return {
    suggest(payee) {
      const norm = normalizePayee(payee);
      if (!norm) return null;
      // Tier 1: exact normalized match
      if (byPayee.has(norm)) {
        const e = byPayee.get(norm);
        const catId = topPick(e.cats);
        const sysId = topPick(e.syss);
        if (catId) return { categoryId: catId, systemId: sysId, confidence: 'exact', matchedFrom: norm };
      }
      // Tier 2: first-2-words prefix match
      const words = norm.split(' ');
      if (words.length >= 2) {
        const two = words.slice(0, 2).join(' ');
        const matches = twoWordIndex.get(two);
        if (matches && matches.size > 0) {
          const { cats, syss } = combineEntries(matches);
          const catId = topPick(cats);
          const sysId = topPick(syss);
          if (catId) return { categoryId: catId, systemId: sysId, confidence: 'prefix', matchedFrom: two };
        }
      }
      // Tier 3: first-word fuzzy (only if >=3 prior matches to avoid noise)
      const first = words[0];
      if (first && first.length >= 3) {
        const matches = firstWordIndex.get(first);
        if (matches && matches.size > 0) {
          const { cats, syss } = combineEntries(matches);
          // Need at least 3 prior occurrences total to confidently fuzzy-match
          let total = 0;
          for (const info of cats.values()) total += info.count;
          if (total >= 3) {
            const catId = topPick(cats);
            const sysId = topPick(syss);
            if (catId) return { categoryId: catId, systemId: sysId, confidence: 'fuzzy', matchedFrom: first };
          }
        }
      }
      return null;
    },
  };
}

// ─── BulkCategorizeModal ─────────────────────────────────────────────
// Cleans up the backlog of uncategorized transactions in one screen.
// Auto-suggests tax category + lead-gen system per row from payee history,
// then lets the user accept all or adjust per row, plus a "match this
// payee to all similar rows" shortcut. Single batched UPDATE on save.
