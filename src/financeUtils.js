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

