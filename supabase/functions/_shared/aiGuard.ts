// aiGuard.ts — nothing that identifies a person's money or government ID
// leaves PrismOS for an outside AI model.
//
// The Sentinel + the Fiduciary (panel), 30 Sep: "contact-research prompt
// construction may include contacts.tax_id_last4 — confirm the prompt builder
// excludes tax fields." Checked: it does not (every AI function picks named
// fields; the tax columns are empty and a trigger keeps them so). The real
// exposure was wider — FREE TEXT. An agent's notes, an email from a title
// company with wiring instructions, a text, a call summary: any of them can
// carry an SSN, a bank account or a card number, and all of them are read by AI.
//
// So the guard sits at the one place every AI call passes: the outbound request.
// Importing this file (one line, `import "../_shared/aiGuard.ts";`) wraps fetch
// for the AI hosts only, and blanks those numbers in every TEXT field of the
// request — never inside image/PDF data, which is left byte-for-byte intact.
// smoke/ai_guard.mjs fails the gate for any function that calls an AI host
// without importing it, and proves the patterns against known answers.

const AI_HOSTS = /^https:\/\/(api\.anthropic\.com|api\.openai\.com|api\.voyageai\.com|generativelanguage\.googleapis\.com)\//;

const luhn = (digits: string): boolean => {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
};

// Each rule is deliberately narrow: a phone (813-310-0773), a ZIP+4, a price,
// a date or an MLS number must pass through untouched, or the AI stops being
// useful. Numbers without a telling shape are only caught next to a label.
const LABEL_SSN = /(ssn|s\.s\.n\.?|social security(?: number| no\.?| #)?|soc\.? sec\.?|tax ?id|taxpayer id|\btin\b|\bitin\b)/i;
const LABEL_EIN = /(\bein\b|\bfein\b|employer id(?:entification)?(?: number)?|federal tax id)/i;
const LABEL_ACCT = /(account|acct|a\/c|routing|\baba\b|iban|swift|wire to|beneficiary account)/i;

export function redactText(s: string): { text: string; hits: number } {
  if (!s || typeof s !== "string") return { text: s, hits: 0 };
  let hits = 0;
  let t = s;
  // SSN / ITIN with its dashes or spaces: 123-45-6789 (never 000, 666, 9xx area).
  t = t.replace(/(?<![\d-])(?!000|666|9\d\d)\d{3}([- ])(?!00)\d{2}\1(?!0000)\d{4}(?![\d-])/g, () => { hits++; return "[SSN removed]"; });
  // Nine bare digits right after an SSN / tax-ID label.
  t = t.replace(new RegExp(LABEL_SSN.source + "(\\W{0,12})(\\d{9})(?!\\d)", "gi"), (_m, lab, gap) => { hits++; return `${lab}${gap}[ID removed]`; });
  // EIN 12-3456789, only when labelled (the shape alone is too common).
  t = t.replace(new RegExp(LABEL_EIN.source + "(\\W{0,12})(\\d{2}-?\\d{7})(?!\\d)", "gi"), (_m, lab, gap) => { hits++; return `${lab}${gap}[EIN removed]`; });
  // Card numbers: 13–19 digits (spaces/dashes allowed) that pass the Luhn check
  // and start like a card (3, 4, 5, 6).
  t = t.replace(/(?<![\d-])[3-6](?:[ -]?\d){12,18}(?![\d-])/g, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19 || !luhn(d)) return m;
    hits++; return "[card number removed]";
  });
  // Bank account / routing numbers: 6–17 digits right after such a label.
  t = t.replace(new RegExp(LABEL_ACCT.source + "([^\\d\\n]{0,24})(\\d[\\d -]{4,20}\\d)(?!\\d)", "gi"), (m, lab, gap, num) => {
    const d = num.replace(/\D/g, "");
    if (d.length < 6 || d.length > 17) return m;
    hits++; return `${lab}${gap}[account number removed]`;
  });
  return { text: t, hits };
}

// Walk a JSON request and redact every string EXCEPT binary payloads: Anthropic
// { type:"base64", data }, OpenAI image_url data URLs, Gemini inline_data.
function walk(v: any, counter: { n: number }, parentKey = ""): any {
  if (typeof v === "string") {
    if (parentKey === "data" || parentKey === "url" && v.startsWith("data:")) return v;
    const r = redactText(v); counter.n += r.hits; return r.text;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, counter, parentKey));
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) out[k] = (k === "data" && typeof x === "string") ? x : walk(x, counter, k);
    return out;
  }
  return v;
}

export function redactRequestBody(body: string): { body: string; hits: number } {
  const counter = { n: 0 };
  try {
    const parsed = JSON.parse(body);
    const next = walk(parsed, counter);
    return counter.n ? { body: JSON.stringify(next), hits: counter.n } : { body, hits: 0 };
  } catch {
    const r = redactText(body);
    return { body: r.text, hits: r.hits };
  }
}

// Install once per isolate.
const g = globalThis as any;
if (!g.__prismAiGuard && typeof g.fetch === "function") {
  g.__prismAiGuard = true;
  const original = g.fetch.bind(globalThis);
  g.fetch = (input: any, init?: any) => {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
      if (AI_HOSTS.test(url) && init && typeof init.body === "string") {
        const r = redactRequestBody(init.body);
        if (r.hits) {
          console.warn(`[aiGuard] removed ${r.hits} sensitive number(s) before calling ${new URL(url).host}`);
          init = { ...init, body: r.body };
        }
      }
    } catch (_) { /* the guard never blocks a call it cannot read */ }
    return original(input, init);
  };
}
