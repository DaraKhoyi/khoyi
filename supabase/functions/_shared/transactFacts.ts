// transactFacts.ts — CAN THIS PERSON TRANSACT? From their own words, with receipts.
//
// Marguerite (panel), 30 Sep: "If it tells me this person mentioned they're
// pre-approved at a specific number… I open that before every call. A LinkedIn
// summary I don't need." One reader, used by contact-research, ari-call-prep,
// the morning sweep (contact-transact) and lead-qualify's prompt.
//
// Rules, each for a reason:
//   * FIRST-PARTY ONLY — what the person wrote to this agent (emails, texts).
//     Never the web: inferring someone's finances from public data is the
//     credit-screening line (FCRA), and it would be guesswork anyway.
//   * EVERY FACT HAS A RECEIPT — their exact words, the date, and whether it was
//     an email or a text. A quote that does not appear, word for word, in the
//     message it claims to come from is DROPPED. A model that invents
//     "pre-approved at $400K" is worse than no feature at all.
//   * NEWEST WINS — "we're pre-approved" in March and "our approval expired" in
//     August is the August fact.

import "./aiGuard.ts";

export const TRANSACT_SYSTEM = `You read what one person has written to their real-estate agent and extract ONLY what THEY stated about their own ability to buy, sell or rent. Never infer. Never use words the agent wrote or quoted. If they did not say it, the value is null.
Messages are numbered [n]. For every fact give "msg": the number of the message it came from, and "quote": their exact words copied character for character from that message (under 120 characters). When two messages disagree, use the NEWER one.
Return JSON only:
{"preapproval":{"value":"yes"|"no"|"in_progress"|"cash"|"expired"|null,"quote":string|null,"msg":number|null},
 "preapproval_amount":{"value":number|null,"quote":string|null,"msg":number|null},
 "lender":{"value":string|null,"quote":string|null,"msg":number|null},
 "budget_max":{"value":number|null,"quote":string|null,"msg":number|null},
 "down_payment":{"value":string|null,"quote":string|null,"msg":number|null},
 "must_sell_first":{"value":true|false|null,"quote":string|null,"msg":number|null},
 "timeline":{"value":"now"|"1-3m"|"3-6m"|"6-12m"|"12m+"|null,"quote":string|null,"msg":number|null},
 "has_agent":{"value":true|false|null,"quote":string|null,"msg":number|null},
 "move_in":{"value":string|null,"quote":string|null,"msg":number|null},
 "selling":{"value":true|false|null,"quote":string|null,"msg":number|null}}
"cash" = they said they are paying cash. "now" = within about a month. "selling" = they said they want to sell a home.`;

export type Msg = { at: string; via: "email" | "text"; text: string };
export type Fact = { value: unknown; quote: string; at: string; via: string };
export type Facts = Record<string, Fact>;

const norm = (s: string) => String(s || "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

// Their own part of a message: drop quoted replies ("On … wrote:", "> …") so the
// agent's words, quoted back, are never mistaken for theirs.
export function ownPart(t: string): string {
  return String(t || "")
    .split(/\n(?:On .{5,120}wrote:|-{2,} ?Original Message|From: .+\n(?:Sent|Date): )/)[0]
    .split("\n").filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

// Gather what this person wrote to this agent: inbound email from any of their
// addresses, inbound texts from any of their numbers. Newest last, capped.
export async function gatherOwnWords(admin: any, userId: string, emails: string[], phones: string[], limit = 30): Promise<Msg[]> {
  const out: Msg[] = [];
  const em = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase().trim()))].slice(0, 5);
  const p10 = [...new Set(phones.map((p) => String(p || "").replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10))].slice(0, 5);
  if (em.length) {
    const { data } = await admin.from("email_messages").select("internal_date, body_text, snippet, from_address")
      .eq("user_id", userId).eq("direction", "inbound").in("from_address", em)
      .order("internal_date", { ascending: false }).limit(limit);
    // from_address case can differ from what we hold; fall back to ilike on the first.
    let rows = data || [];
    if (!rows.length && em[0]) {
      const r2 = await admin.from("email_messages").select("internal_date, body_text, snippet, from_address")
        .eq("user_id", userId).eq("direction", "inbound").ilike("from_address", em[0]).order("internal_date", { ascending: false }).limit(limit);
      rows = r2.data || [];
    }
    for (const m of rows) { const t = ownPart(m.body_text || m.snippet || ""); if (t) out.push({ at: m.internal_date, via: "email", text: t.slice(0, 1200) }); }
  }
  if (p10.length) {
    const { data } = await admin.from("quo_messages").select("op_created_at, body, from_number, direction")
      .eq("user_id", userId).eq("direction", "incoming").order("op_created_at", { ascending: false }).limit(400);
    for (const m of data || []) {
      const n = String(m.from_number || "").replace(/\D/g, "").slice(-10);
      if (p10.includes(n) && m.body) out.push({ at: m.op_created_at, via: "text", text: String(m.body).slice(0, 600) });
      if (out.filter((x) => x.via === "text").length >= limit) break;
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-limit);
}

// Ask the model, then keep only facts whose quote is really in the message.
export async function extractTransactFacts(msgs: Msg[], opts: { model?: string; onUsage?: (u: any) => Promise<void> | void } = {}): Promise<Facts> {
  if (!msgs.length) return {};
  const numbered = msgs.map((m, i) => `[${i + 1}] ${String(m.at).slice(0, 10)} ${m.via}: ${m.text.replace(/\s+/g, " ")}`).join("\n").slice(0, 9000);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: opts.model || "claude-haiku-4-5", max_tokens: 700, system: TRANSACT_SYSTEM,
      messages: [{ role: "user", content: `Today is ${new Date().toISOString().slice(0, 10)}. Timelines are measured from today.\n\nWhat they wrote (oldest first):\n\n${numbered}` }] }),
  });
  const data = await r.json().catch(() => null);
  try { if (opts.onUsage) await opts.onUsage(data?.usage); } catch (_) { /* best-effort */ }
  const txt = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const m = txt.match(/\{[\s\S]*\}/);
  let raw: any = null;
  try { raw = m ? JSON.parse(m[0]) : null; } catch { raw = null; }
  return verifyFacts(raw, msgs);
}

// The receipt check. Exported so the gate can test it without a model.
export function verifyFacts(raw: any, msgs: Msg[]): Facts {
  const facts: Facts = {};
  if (!raw || typeof raw !== "object") return facts;
  for (const [k, v] of Object.entries(raw) as [string, any][]) {
    if (!v || v.value === null || v.value === undefined || !v.quote) continue;
    const q = norm(v.quote);
    if (q.length < 3) continue;
    const i = Number(v.msg) - 1;
    const src = Number.isInteger(i) && msgs[i] && norm(msgs[i].text).includes(q) ? msgs[i]
      : msgs.slice().reverse().find((mm) => norm(mm.text).includes(q));   // model gave the wrong number, quote is real
    if (!src) continue;                                                     // no receipt, no fact
    facts[k] = { value: v.value, quote: String(v.quote).slice(0, 140), at: src.at, via: src.via };
  }
  return facts;
}

const money = (n: number) => n >= 1e6 ? "$" + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M" : "$" + Math.round(n / 1000) + "K";
const when = (f: Fact) => `${f.via} ${new Date(f.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}`;
const PRE: Record<string, string> = { yes: "Pre-approved", cash: "Paying cash", in_progress: "Talking to a lender", no: "Not pre-approved yet", expired: "Pre-approval expired" };
const TL: Record<string, string> = { now: "wants to move within a month", "1-3m": "1–3 months out", "3-6m": "3–6 months out", "6-12m": "6–12 months out", "12m+": "a year or more out" };

// ONE sentence the agent reads before dialling, every fact with its receipt.
export function transactLine(f: Facts): { line: string; ask: string | null; known: boolean } {
  const parts: string[] = [];
  if (f.preapproval) {
    let s = PRE[String(f.preapproval.value)] || String(f.preapproval.value);
    if (f.preapproval_amount && typeof f.preapproval_amount.value === "number") s += ` at ${money(f.preapproval_amount.value)}`;
    if (f.lender) s += ` (${f.lender.value})`;
    parts.push(`${s} — “${f.preapproval.quote}”, ${when(f.preapproval)}`);
  } else if (f.preapproval_amount && typeof f.preapproval_amount.value === "number") {
    parts.push(`Approved for ${money(f.preapproval_amount.value)} — “${f.preapproval_amount.quote}”, ${when(f.preapproval_amount)}`);
  }
  if (f.budget_max && typeof f.budget_max.value === "number" && !f.preapproval_amount) parts.push(`Budget up to ${money(f.budget_max.value)} — ${when(f.budget_max)}`);
  if (f.must_sell_first && f.must_sell_first.value === true) parts.push(`Must sell first — ${when(f.must_sell_first)}`);
  if (f.timeline) parts.push(`${TL[String(f.timeline.value)] || String(f.timeline.value)} — ${when(f.timeline)}`);
  if (f.move_in) parts.push(`Move-in ${f.move_in.value} — ${when(f.move_in)}`);
  if (f.has_agent && f.has_agent.value === true) parts.push(`Says they already have an agent — ${when(f.has_agent)}`);
  const known = parts.length > 0;
  let ask: string | null = null;
  const pre = f.preapproval?.value;
  if (!f.preapproval && !f.preapproval_amount) ask = "Are you pre-approved yet, and for how much?";
  else if (pre === "expired" || pre === "no") ask = "Would it help if I connected you with a lender this week?";
  else if (!f.timeline && !f.move_in) ask = "When are you hoping to be in your new home?";
  return { line: known ? parts.join(" · ") : "Nothing said yet about financing or timing", ask, known };
}

// Refresh one contact's answer, stored on profiles. Free when nothing new has
// arrived since the last read (no model call). Used by contact-research,
// ari-call-prep, contact-transact (the screen and the morning sweep).
export async function refreshTransact(admin: any, contact: any, opts: { force?: boolean; onUsage?: (u: any) => Promise<void> | void } = {}) {
  const emails = [contact.email, ...((Array.isArray(contact.emails) ? contact.emails : []).map((e: any) => (e && (e.value || e.email)) || e))]
    .filter((e: any) => typeof e === "string" && e.includes("@"));
  const phones = [contact.phone, ...((Array.isArray(contact.phones) ? contact.phones : []).map((p: any) => (p && (p.number || p.value)) || p))]
    .filter((p: any) => typeof p === "string");
  const { data: prof } = await admin.from("profiles").select("id, transact_through, transact_line, transact_ask, transact_facts, transact_at")
    .eq("contact_id", contact.id).maybeSingle();
  const msgs = await gatherOwnWords(admin, contact.user_id, emails, phones);
  const latest = msgs.length ? msgs[msgs.length - 1].at : null;
  if (!opts.force && prof && prof.transact_at && (!latest || (prof.transact_through && latest <= prof.transact_through))) {
    return { line: prof.transact_line, ask: prof.transact_ask, facts: prof.transact_facts || {}, through: prof.transact_through, cached: true, messages: msgs.length };
  }
  const facts = msgs.length ? await extractTransactFacts(msgs, { onUsage: opts.onUsage }) : {};
  const t = transactLine(facts);
  const row = { transact_facts: facts, transact_line: t.line, transact_ask: t.ask, transact_through: latest, transact_at: new Date().toISOString() };
  if (prof) await admin.from("profiles").update(row).eq("id", prof.id);
  else await admin.from("profiles").insert({ contact_id: contact.id, user_id: contact.user_id, subject_kind: "contact", ...row });
  return { line: t.line, ask: t.ask, facts, through: latest, cached: false, messages: msgs.length };
}
