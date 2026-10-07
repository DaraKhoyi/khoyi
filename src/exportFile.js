// exportFile — the one place a report leaves PrismOS as a file.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Export to PDF, CSV and Excel."
// "Your data stays yours and leaves in standard formats."
//
// A report is the table shape from src/bookReports.js. CSV and Excel carry the
// raw numbers (so a CPA's spreadsheet can add them); the printed page, which
// the phone or computer saves as a PDF, carries them formatted.
import { tableRows } from './bookReports.js';

const safeName = (s) => String(s || 'report').replace(/[^A-Za-z0-9 ._-]+/g, '').replace(/\s+/g, '-').slice(0, 80) || 'report';

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// A cell for CSV: quoted when it must be, and never able to run as a formula
// when the file is opened in a spreadsheet (a payee named "=HYPERLINK(...)").
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

export function downloadCsv(name, tables) {
  const list = Array.isArray(tables) ? tables : [tables];
  const rows = list.flatMap((t, i) => (i ? [[], []] : []).concat(tableRows(t)));
  save(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), safeName(name) + '.csv');
}

// One sheet per table. The spreadsheet library is large and rarely needed, so
// it is fetched only when someone asks for an Excel file.
async function workbook(tables) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const t of (Array.isArray(tables) ? tables : [tables])) {
    const ws = XLSX.utils.aoa_to_sheet(tableRows(t).map((r) => r.map((c) => (typeof c === 'string' && /^[=+\-@]/.test(c) ? "'" + c : c))));
    ws['!cols'] = t.columns.map((_, i) => ({ wch: i === 0 ? 44 : 16 }));
    let sheet = String(t.title || 'Report').replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Report';
    for (let n = 2; used.has(sheet); n++) sheet = sheet.slice(0, 25) + ' ' + n;
    used.add(sheet);
    XLSX.utils.book_append_sheet(wb, ws, sheet);
  }
  return { XLSX, wb };
}
export async function downloadXlsx(name, tables) {
  const { XLSX, wb } = await workbook(tables);
  XLSX.writeFile(wb, safeName(name) + '.xlsx');
}
// The same workbook as bytes, for putting inside a bundle.
export async function workbookBytes(tables) {
  const { XLSX, wb } = await workbook(tables);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
export const saveBlob = (blob, name) => save(blob, name);
export const fileName = safeName;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function tableHtml(t) {
  const fig = t.columns.map((_, k) => k > 0 && t.rows.some((r) => typeof r.cells[k] === 'number'));
  const cell = (c, i) => `<td class="${fig[i] ? 'n' : ''}">${typeof c === 'number' ? ((t.plain || []).includes(i) ? String(c) : money(c)) : esc(c)}</td>`;
  const body = t.rows.map((r) => (r.kind === 'head' ? `<tr class="h"><td colspan="${t.columns.length}">${esc(r.cells[0])}</td></tr>`
    : r.kind === 'note' ? `<tr class="note"><td colspan="${t.columns.length}">${esc(r.cells[0])}</td></tr>`
      : `<tr class="${r.kind}">${r.cells.map(cell).join('')}</tr>`)).join('');
  return `<h1>${esc(t.title)}</h1>${t.subtitle ? `<p class="sub">${esc(t.subtitle)}</p>` : ''}<table><thead><tr>${t.columns.map((c, i) => `<th class="${fig[i] ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

// Print (and so "Save as PDF") without leaving the screen: the report is laid
// out in a hidden frame and that frame is printed.
export function printTables(heading, tables) {
  const list = Array.isArray(tables) ? tables : [tables];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(heading)}</title><style>
    body{font:12px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:24px}
    .who{font-size:11px;color:#555;margin:0 0 14px} h1{font-size:17px;margin:18px 0 2px} .sub{margin:0 0 8px;color:#444}
    table{width:100%;border-collapse:collapse;margin-bottom:10px;page-break-inside:auto} tr{page-break-inside:avoid}
    th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top} .n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#555;border-bottom:1.5px solid #111}
    tr.h td{font-weight:700;background:#f1f1f1;border-bottom:0;padding-top:8px} tr.total td{font-weight:700;border-top:1px solid #111} tr.note td{font-style:italic;color:#7a2e1e}
    .page{page-break-after:always} .page:last-child{page-break-after:auto}
  </style></head><body><p class="who">${esc(heading)}</p>${list.map((t) => `<div class="page">${tableHtml(t)}</div>`).join('')}</body></html>`;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } finally { setTimeout(() => frame.remove(), 60000); } }, 250);
}
