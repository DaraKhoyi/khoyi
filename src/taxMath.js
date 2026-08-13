// taxMath — self-employment and quarterly-estimate arithmetic.
// Pure functions, no JSX, so the lightweight QuarterlyTaxBanner and the full tax
// reports can each use them without pulling the other in.
// Extracted from AccountingViews.jsx.

export const SE_TAX_2026 = {
  ss_wage_base: 184500,                          // 2026 Social Security wage base
  ss_rate: 0.124,                                // SS tax rate (employer + employee)
  medicare_rate: 0.029,                          // Medicare tax rate
  additional_medicare_rate: 0.009,               // Additional Medicare on high earners
  additional_medicare_threshold_single: 200000,
  additional_medicare_threshold_mfj: 250000,
  se_deduction_factor: 0.9235,                   // 1 - (0.0765 / 2) ≈ accounts for the
                                                 //   "employer half" excluded from SE base
};
// Note on SSTB (Specified Service Trade or Business): real-estate brokers
// are NOT classified as SSTBs by the IRS — only specific professions like
// law, health, and accounting are. Real-estate agents qualify for the full
// QBI deduction regardless of income. SSTB thresholds are $201,775 single
// / $403,500 MFJ in 2026 if ever needed for other use cases.

// ─── Tax computation helpers ────────────────────────────────────────

export function computeFederalIncomeTax(taxableIncome, filingStatus = 'single') {
  const brackets = TAX_BRACKETS_2026[filingStatus] || TAX_BRACKETS_2026.single;
  if (!Number.isFinite(taxableIncome) || taxableIncome <= 0) {
    return { tax: 0, marginalRate: brackets[0].rate, effectiveRate: 0, usedBrackets: [] };
  }
  let tax = 0;
  let lastBracket = brackets[0];
  const usedBrackets = [];
  for (const b of brackets) {
    if (taxableIncome > b.min) {
      const top = Math.min(taxableIncome, b.max == null ? Infinity : b.max);
      const inBracket = Math.max(0, top - b.min);
      const t = inBracket * b.rate;
      tax += t;
      usedBrackets.push({ ...b, incomeInBracket: inBracket, taxInBracket: t });
      lastBracket = b;
    }
  }
  return {
    tax,
    marginalRate: lastBracket.rate,
    effectiveRate: tax / taxableIncome,
    usedBrackets,
  };
}

// Computes Schedule C net profit from transactions + mileage. Used by
// QuarterlyTaxReport so its number lines up with the ScheduleCReport.

export function computeNetProfitFromData(transactions, taxCategories, mileageEntries) {
  const grossReceipts = transactions
    .filter(t => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  const catMap = Object.fromEntries(taxCategories.map(c => [c.id, c]));
  const businessExpenses = transactions
    .filter(t => Number(t.amount) < 0 && t.tax_category_id)
    .reduce((s, t) => {
      const cat = catMap[t.tax_category_id];
      if (!cat) return s;
      // Skip categories not on Schedule C (estimated tax payments, etc.)
      if (cat.schedule_c_line === '(not Schedule C)') return s;
      const ded = Number(cat.deduction_pct || 1);
      return s + Math.abs(Number(t.amount)) * ded;
    }, 0);
  const mileageDeduction = (mileageEntries || [])
    .filter(m => m.category === 'business')
    .reduce((s, m) => s + Number(m.computed_deduction || 0), 0);
  return {
    grossReceipts,
    businessExpenses,
    mileageDeduction,
    totalExpenses: businessExpenses + mileageDeduction,
    netProfit: grossReceipts - businessExpenses - mileageDeduction,
  };
}

// The full annual-tax projection. Pure function — takes settings + YTD
// data, returns everything the UI needs to render.

export function computeQuarterlyTaxProjection({
  ytdNetProfit, monthsElapsed, year, filingStatus, otherIncome, withholding,
  useQbi, itemizedDeductions, priorYearTax, priorYearAgi, ytdEstimatedPaid,
}) {
  // Annualize YTD net profit to a full-year projection.
  // If we're in month 6, multiply by 12/6 = 2. Early in the year this is
  // noisy — by Q3 it stabilizes. Tail end of year, basically YTD = annual.
  const annualizedNetProfit = monthsElapsed > 0
    ? (ytdNetProfit * 12 / monthsElapsed)
    : ytdNetProfit;

  // SE tax computed on the annualized projection
  const se = computeSETax(annualizedNetProfit, filingStatus);

  // Adjusted Gross Income: Schedule C net + other income − half SE tax
  const agi = annualizedNetProfit + (otherIncome || 0) - se.aboveLineDeduction;

  // QBI deduction (Sec 199A). For real-estate agents (NOT an SSTB), full 20%
  // applies regardless of income. For SSTBs above the threshold, the
  // deduction phases out — out of scope for v1.
  let qbiDeduction = 0;
  if (useQbi && annualizedNetProfit > 0) {
    const qbiBase = annualizedNetProfit - se.aboveLineDeduction;
    qbiDeduction = Math.max(0, Math.min(qbiBase * 0.20, Math.max(0, agi) * 0.20));
  }

  // Use itemized if it exceeds the standard
  const stdDeduction = STD_DEDUCTION_2026[filingStatus] || STD_DEDUCTION_2026.single;
  const deductionUsed = (itemizedDeductions && itemizedDeductions > stdDeduction)
    ? itemizedDeductions
    : stdDeduction;
  const deductionType = (itemizedDeductions && itemizedDeductions > stdDeduction) ? 'itemized' : 'standard';

  // Taxable income after all deductions
  const taxableIncome = Math.max(0, agi - deductionUsed - qbiDeduction);

  // Federal income tax via bracket walk
  const fed = computeFederalIncomeTax(taxableIncome, filingStatus);

  // Total tax owed for the projected year (SE + federal income)
  const totalAnnualTax = se.total + fed.tax;

  // Net of W-2 withholding (if the user has any). Estimated payments
  // counted separately below in "currently owed" math.
  const totalAfterWithholding = Math.max(0, totalAnnualTax - (withholding || 0));

  // IRS safe harbor: pay 100% of prior-year tax (110% if AGI > $150K)
  // Avoids underpayment penalty regardless of actual current-year income.
  const safeHarborMultiplier = (priorYearAgi || 0) > 150000 ? 1.10 : 1.00;
  const safeHarborAnnual = priorYearTax ? Math.max(0, priorYearTax * safeHarborMultiplier - (withholding || 0)) : null;

  // The lower of the two strategies (current-year 90% rule vs prior-year safe harbor)
  const quarterlyByCurrentYear = totalAfterWithholding / 4;
  const quarterlyBySafeHarbor = safeHarborAnnual != null ? safeHarborAnnual / 4 : null;
  const recommendedQuarterly = quarterlyBySafeHarbor != null
    ? Math.min(quarterlyByCurrentYear, quarterlyBySafeHarbor)
    : quarterlyByCurrentYear;

  // Quarterly due dates (Apr 15 / Jun 15 / Sep 15 / Jan 15 of next year)
  const quarters = [
    { id: 'Q1', label: 'Q1', due: new Date(year, 3, 15), covers: 'Jan–Mar' },
    { id: 'Q2', label: 'Q2', due: new Date(year, 5, 15), covers: 'Apr–May' },
    { id: 'Q3', label: 'Q3', due: new Date(year, 8, 15), covers: 'Jun–Aug' },
    { id: 'Q4', label: 'Q4', due: new Date(year + 1, 0, 15), covers: 'Sep–Dec' },
  ];
  const now = new Date();
  const quartersPassed = quarters.filter(q => q.due <= now).length;
  const expectedYtdPaid = quartersPassed * recommendedQuarterly;
  const currentlyOwed = Math.max(0, expectedYtdPaid - (ytdEstimatedPaid || 0));
  const nextDueQuarter = quarters.find(q => q.due > now) || null;

  return {
    annualizedNetProfit, se, agi, qbiDeduction, deductionUsed, deductionType,
    taxableIncome, fed, totalAnnualTax, totalAfterWithholding,
    safeHarborAnnual, quarterlyByCurrentYear, quarterlyBySafeHarbor, recommendedQuarterly,
    quarters, quartersPassed, expectedYtdPaid, currentlyOwed, nextDueQuarter,
  };
}

// ─── QuarterlyTaxReport ──────────────────────────────────────────────
// Self-employment tax + federal income tax projection with a quarterly
// payment schedule. Sits on top of the same Schedule C data, then layers
// on SE tax (Schedule SE) and federal bracket math to produce the
// actionable number: "set aside $X per quarter."
//
// Florida has no state income tax — no state-side math needed.

export function nextQuarterDueLabel() {
  const now = new Date();
  const dates = [
    { date: new Date(now.getFullYear(), 3, 15),  label: 'due Apr 15' },
    { date: new Date(now.getFullYear(), 5, 15),  label: 'due Jun 15' },
    { date: new Date(now.getFullYear(), 8, 15),  label: 'due Sep 15' },
    { date: new Date(now.getFullYear()+1, 0, 15), label: 'due Jan 15' },
  ];
  const next = dates.find(d => d.date > now);
  return next ? next.label : 'this quarter';
}

// ─── FinanceBlueprint ────────────────────────────────────────────────

// Schedule C lines offered when creating/editing a custom business category.
