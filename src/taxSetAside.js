// taxSetAside — how much of one commission to hold back for taxes.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Tax set-aside. On each
// commission, a suggested hold-back and the next quarterly date. Labeled an
// estimate, not advice."
//
// The figure is the EXTRA tax this one commission adds: the tax on the year's
// profit with it, less the tax on the year's profit without it. That is
// self-employment tax plus federal income tax at whatever bracket the money
// lands in (Florida has no state income tax). It uses the same arithmetic as
// the quarterly report (taxMath.js), so the two cannot disagree. Pure.
import { STD_DEDUCTION_2026, computeFederalIncomeTax, computeSETax } from './taxMath.js';

const yearTax = (profit, filingStatus, otherIncome) => {
  const p = Math.max(0, Number(profit) || 0);
  const se = computeSETax(p, filingStatus);
  const std = STD_DEDUCTION_2026[filingStatus] || STD_DEDUCTION_2026.single;
  const taxable = Math.max(0, (Number(otherIncome) || 0) + p - se.aboveLineDeduction - std);
  return se.total + computeFederalIncomeTax(taxable, filingStatus).tax;
};

export function setAside(amount, profitBefore, { filingStatus = 'single', otherIncome = 0 } = {}) {
  const a = Number(amount) || 0, before = Number(profitBefore) || 0;
  if (a <= 0) return { amount: 0, pct: 0 };
  const extra = Math.max(0, yearTax(before + a, filingStatus, otherIncome) - yearTax(before, filingStatus, otherIncome));
  const hold = Math.round(extra);
  return { amount: hold, pct: Math.round((hold / a) * 100) };
}

// The next estimated-tax due date on or after `today` (YYYY-MM-DD), in words.
export function nextEstimatedDue(today) {
  const y = Number(String(today).slice(0, 4));
  const due = [[`${y}-04-15`, 'April 15'], [`${y}-06-15`, 'June 15'], [`${y}-09-15`, 'September 15'], [`${y + 1}-01-15`, 'January 15']];
  return (due.find(([d]) => d >= String(today)) || due[3])[1];
}

export function setAsideSentence(amount, profitBefore, settings, today) {
  const s = setAside(amount, profitBefore, settings);
  if (!s.amount) return '';
  return `Suggested hold-back for taxes: about $${s.amount.toLocaleString('en-US')} (${s.pct}%). The next estimated payment is due ${nextEstimatedDue(today)}. This is an estimate, not tax advice.`;
}
