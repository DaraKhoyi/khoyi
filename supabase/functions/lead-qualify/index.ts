// lead-qualify — can this person actually buy (or rent, or sell), and when?
//
// Marguerite (panel, 27 Sep): "I am not going to answer 568 things to close 1
// deal. The number that matters is whether the lead could ever buy... CINC shows
// pre-approval status before the agent ever picks up." This is that, built for
// how leads really arrive here:
//
//   * Per PERSON, not per card. Chris Baron sent realtor.com two inquiries in
//     eleven minutes ($339,500 and $345,000, both Land O Lakes) — that is one
//     buyer with a budget, an area and urgency, not two cards.
//   * FACTS FROM THE TEMPLATE, no AI: listing prices -> budget band, cities ->
//     areas, how many inquiries and how recently, closed with us before (a past
//     client in brokerage_transactions).
//   * FACTS FROM THE PERSON'S OWN WORDS, read by a small model only when there
//     are words to read: pre-approved / cash / talking to a lender, timeline,
//     must sell first, already has an agent, move-in date. Every fact carries
//     the buyer's quote. Nothing is inferred — a portal lead that says only
//     "I'm interested in 4745 Canterbury Dr" has an UNKNOWN pre-approval, and
//     the card says so and gives the question to ask.
//   * Pre-approval is only ever known because the buyer said it — CINC's badge
//     is the buyer's own answer on a sign-up form. So the first reply now asks
//     it (and offers a lender), and this reads the answer when it arrives.
//
// Runs every 15 minutes (cron, QCP) over recognised leads from the last 60 days,
// re-reading a person only when something new arrived from them. Also called by
// lead-concierge the moment a lead lands. Cost: a fraction of a cent per person
// with words to read; nothing for template-only leads.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
import { isServiceCaller } from "../_shared/serviceCaller.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "claude-haiku-4-5";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const PORTAL = /(zillow|realtor\.com|move\.com|homes\.com|rent\.com|redfin|xomio|apartments\.com|noreply|no-reply|myrealtyonegroup|realtyonegroup)/i;
const phone10 = (p?: string | null) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : null; };
const money = (n: number) => n >= 1e6 ? "$" + (n / 1e6).toFixed(n % 1e6 ? 2 : 0).replace(/\.?0+$/, "") + "M" : "$" + Math.round(n / 1000) + "k";

type Inquiry = { source: string; at: string; text: string; owner: string | null; property?: string | null; answered_at?: string | null };


// ── Template facts ──────────────────────────────────────────────────────────
function prices(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{4,8})(?![\d,])/g)].map((m) => Number(m[1].replace(/,/g, "")));
}
// "Land O Lakes, FL 34639" -> Land O Lakes; "1250 Redondo Way Zephyrhills, FL"
// -> Zephyrhills (the street is dropped at its last suffix word).
const STREET = /\b(Way|Dr|Drive|St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Ct|Court|Blvd|Cir|Circle|Pl|Place|Ter|Terrace|Trl|Trail|Pkwy|Hwy|Loop|Run|Pt|Point)\.?\s+/g;
function areas(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/([A-Z][A-Za-z.'’-]*(?: [A-Z][A-Za-z.'’-]*){0,4})\s*,\s*(?:FL|Florida)\b/g)) {
    let city = m[1].replace(/^(?:Property Address|Address|City)\s*:?\s*/i, "").trim();
    const parts = city.split(STREET);
    if (parts.length > 1) city = parts[parts.length - 1].trim();
    if (city && !/^(Customer|Office|Basic|View|Listing)/.test(city)) out.add(city);
  }
  return [...out].slice(0, 3);
}
function intentOf(sources: string[], text: string): "buy" | "rent" | "sell" {
  if (sources.some((s) => /rent|apartment|zumper|hotpads/i.test(s))) return "rent";
  if (sources.some((s) => /home-?value/i.test(s)) || /what('s| is) my (home|house)/i.test(text)) return "sell";
  return "buy";
}
// The buyer's own words inside a portal template: realtor.com's "Comment:",
// Zillow's message, the IDX "Please get in touch!". Template furniture is not
// the buyer speaking, so it is not handed to the model.
function ownWords(text: string): string {
  const m = text.match(/Comment:\s*([\s\S]*?)(?:\n\s*\n|This consumer inquired|$)/i);
  const said = (m ? m[1] : "").trim();
  return /^i'?m interested in\b[^.]*\.?$/i.test(said) ? "" : said;
}

// ── The person's words, read by a model ────────────────────────────────────
const SYSTEM = `You read what a real-estate lead has written and extract ONLY what THEY stated about themselves. Never infer. Never use what an agent wrote. If they did not say it, the value is null.
Return JSON only:
{"preapproval":{"value":"yes"|"no"|"in_progress"|"cash"|null,"quote":string|null},
 "timeline":{"value":"now"|"1-3m"|"3-6m"|"6-12m"|"12m+"|null,"quote":string|null},
 "budget_max":{"value":number|null,"quote":string|null},
 "must_sell_first":{"value":true|false|null,"quote":string|null},
 "has_agent":{"value":true|false|null,"quote":string|null},
 "move_in":{"value":string|null,"quote":string|null},
 "motivation":{"value":string|null,"quote":string|null}}
"quote" is their exact words (under 120 characters). "cash" means they said they are paying cash. "now" means within about a month.`;

async function readWords(words: string[], userId: string | null, admin: any, subjectId: string | null) {
  const text = words.join("\n---\n").slice(0, 6000);
  if (!text.trim()) return null;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, system: SYSTEM, messages: [{ role: "user", content: `Today is ${new Date().toISOString().slice(0, 10)}. Timelines are measured from today.\n\nWhat the lead wrote (newest last):\n\n` + text }] }),
  });
  const data = await r.json();
  try { await logAiUsage(admin, { userId, fn: "lead-qualify", model: MODEL, usage: data?.usage, usedOwn: false, subjectType: "lead", subjectId }); } catch (_) { /* logged best-effort */ }
  const out = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const m = out.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

// ── Grade and next question ────────────────────────────────────────────────
function grade(intent: string, f: any, inquiries: number, pastClient: boolean) {
  const pre = f.preapproval?.value, tl = f.timeline?.value;
  const canPay = pre === "yes" || pre === "cash";
  const soon = tl === "now" || tl === "1-3m";
  let g: "ready" | "active" | "early" | "unknown" = "unknown";
  if (intent === "rent") {
    const mi = f.move_in?.value;
    g = mi ? "active" : inquiries > 1 ? "active" : "unknown";
    if (soon) g = "ready";
  } else if (intent === "sell") {
    g = soon ? "ready" : tl ? (tl === "6-12m" || tl === "12m+" ? "early" : "active") : "active";
  } else {
    if (canPay && soon) g = "ready";
    else if (canPay || pre === "in_progress" || soon || inquiries > 1 || pastClient) g = "active";
    else if (tl === "6-12m" || tl === "12m+") g = "early";
  }
  let ask: string | null = null;
  if (intent === "buy") {
    if (!pre) ask = "Are you already pre-approved? If not, I can connect you with a lender today.";
    else if (!tl) ask = "When are you hoping to be in your new home?";
    else if (f.must_sell_first?.value == null && pre !== "cash") ask = "Do you have a home to sell first?";
  } else if (intent === "rent") {
    if (!f.move_in?.value) ask = "When do you need to move in?";
  } else if (!tl) ask = "When are you thinking of selling?";
  return { grade: g, ask };
}

async function qualifyPerson(admin: any, key: { email: string | null; p10: string | null }) {
  const { email, p10 } = key;
  const since = new Date(Date.now() - 180 * 864e5).toISOString();

  // Every inquiry this person made, from either path.
  const inq: Inquiry[] = [];
  const lcq = admin.from("lead_concierge").select("id,user_id,source,first_seen_at,inbound_text,first_response_at,lead_name,lead_phone")
    .eq("kind", "lead").not("source", "is", null).not("status", "in", "(not_a_lead,trash)").gte("first_seen_at", since);
  const { data: lc } = email ? await lcq.ilike("lead_email", email) : await lcq.not("lead_phone", "is", null);
  for (const r of lc || []) {
    if (!email && phone10((r as any).lead_phone) !== p10) continue;
    inq.push({ source: r.source, at: r.first_seen_at, text: r.inbound_text || "", owner: r.user_id, answered_at: r.first_response_at });
  }
  const blq = admin.from("brokerage_leads").select("id,received_by,assigned_to,source,received_at,excerpt,property,lead_name,lead_phone,provider_message_id,first_response_at").gte("received_at", since);
  const { data: bl } = email ? await blq.ilike("lead_email", email) : await blq.not("lead_phone", "is", null);
  for (const r of bl || []) {
    if (!email && phone10(r.lead_phone) !== p10) continue;
    let text = r.excerpt || "";
    if (r.provider_message_id) {
      const { data: m } = await admin.from("email_messages").select("body_text").eq("provider_message_id", r.provider_message_id).limit(1).maybeSingle();
      if (m?.body_text) text = m.body_text;
    }
    inq.push({ source: r.source, at: r.received_at, text, owner: r.assigned_to || r.received_by, property: r.property, answered_at: r.first_response_at });
  }
  if (!inq.length) return { skipped: "no inquiries" };
  inq.sort((a, b) => a.at.localeCompare(b.at));
  // One email delivered to two mailboxes is one inquiry, not two (the IDX site
  // copies Dara and Josh). Same source, same words, within ten minutes.
  for (let i = inq.length - 1; i > 0; i--) {
    const a = inq[i - 1], b = inq[i];
    if (a.source === b.source && a.text === b.text
        && Date.parse(b.at) - Date.parse(a.at) < 10 * 60e3) inq.splice(i, 1);
  }

  // What the person wrote to us directly — email and text — after inquiring.
  const words: { at: string; text: string }[] = [];
  for (const q of inq) { const w = ownWords(q.text); if (w) words.push({ at: q.at, text: w }); }
  if (email && !PORTAL.test(email)) {
    const { data: em } = await admin.from("email_messages").select("internal_date,body_text,snippet")
      .ilike("from_address", email).eq("direction", "inbound").gte("internal_date", inq[0].at).order("internal_date").limit(20);
    for (const m of em || []) {
      const t = String(m.body_text || m.snippet || "").split(/\n(?:On .{5,80} wrote:|-{2,} ?Original Message|From: )/)[0].trim();
      if (t) words.push({ at: m.internal_date, text: t.slice(0, 1500) });
    }
  }
  if (p10) {
    const { data: sms } = await admin.from("quo_messages").select("op_created_at,body,from_number,direction")
      .ilike("from_number", "%" + p10).gte("op_created_at", inq[0].at).order("op_created_at").limit(30);
    for (const m of sms || []) if (!/out/i.test(m.direction || "") && m.body) words.push({ at: m.op_created_at, text: m.body });
  }
  words.sort((a, b) => a.at.localeCompare(b.at));
  const firstAnswer = inq.map((q) => q.answered_at).filter(Boolean).sort()[0] || null;
  const replied = firstAnswer ? words.filter((w) => w.at > firstAnswer!).map((w) => w.at)[0] || null : null;

  const evidence = [...inq.map((q) => q.at), ...words.map((w) => w.at)].sort().pop()!;
  const { data: prior } = await admin.from("lead_readiness").select("id,evidence_through,facts")
    .or([email ? `email.ilike.${email}` : null, p10 ? `phone10.eq.${p10}` : null].filter(Boolean).join(","))
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (prior && prior.evidence_through && prior.evidence_through >= evidence) return { skipped: "nothing new" };

  // Template facts.
  const all = inq.map((q) => q.text + " " + (q.property || "")).join("\n");
  const sources = [...new Set(inq.map((q) => q.source))];
  const intent = intentOf(sources, all);
  const ps = prices(all).filter((n) => intent === "rent" ? n >= 300 && n < 20000 : n >= 30000 && n < 50e6);
  const facts: any = { ...(prior?.facts || {}) };
  if (ps.length) facts.budget = { min: Math.min(...ps), max: Math.max(...ps), basis: ps.length > 1 ? "prices of the homes they asked about" : "price of the home they asked about" };
  const ar = areas(all);
  if (ar.length) facts.areas = ar;

  // Closed with us before?
  let pastClient: any = null;
  if (email) {
    const { data: tx } = await admin.from("brokerage_transactions").select("date_paid,year").ilike("client_email", email).order("date_paid", { ascending: false }).limit(1);
    if (tx && tx.length) pastClient = { year: tx[0].year || String(tx[0].date_paid || "").slice(0, 4) };
  }

  // Their words — only when there are any, only what is new since last read.
  const newWords = words.filter((w) => !prior?.evidence_through || w.at > prior.evidence_through).map((w) => w.text);
  const ownerUser = inq[inq.length - 1].owner;
  if (newWords.length) {
    const said = await readWords(words.map((w) => w.text), ownerUser, admin, null);
    if (said) {
      for (const k of ["preapproval", "timeline", "must_sell_first", "has_agent", "move_in", "motivation"]) {
        const v = said[k];
        if (v && v.value !== null && v.value !== undefined) facts[k] = { value: v.value, quote: v.quote || null, source: "said" };
      }
      if (said.budget_max?.value) facts.budget = { ...(facts.budget || {}), max: said.budget_max.value, said_max: said.budget_max.value, quote: said.budget_max.quote || null };
    }
  }

  // Signals: the plain-language reasons on the card.
  const signals: string[] = [];
  const last30 = inq.filter((q) => q.at > new Date(Date.now() - 30 * 864e5).toISOString()).length;
  if (inq.length > 1) signals.push(`${inq.length} inquiries${last30 === inq.length ? " this month" : ""}`);
  if (facts.budget?.said_max) signals.push(`Budget up to ${money(facts.budget.said_max)} (their words)`);
  else if (facts.budget?.min) signals.push(facts.budget.min === facts.budget.max ? `Asked about a ${money(facts.budget.min)} home` : `Looking at ${money(facts.budget.min)}–${money(facts.budget.max)}`);
  if (facts.areas?.length) signals.push(facts.areas.join(", "));
  if (pastClient) signals.push(`Closed with us before (${pastClient.year})`);
  if (replied) signals.push("Wrote back");
  if (facts.has_agent?.value === true) signals.push("Says they already have an agent");

  const { grade: g, ask } = grade(intent, facts, inq.length, !!pastClient);
  const row = {
    email, phone10: p10, name: null as string | null, intent, grade: g, facts, signals, ask_next: ask,
    inquiries: inq.length, first_inquiry_at: inq[0].at, last_inquiry_at: inq[inq.length - 1].at,
    lead_replied_at: replied, evidence_through: evidence, updated_at: new Date().toISOString(),
  };
  const nameFrom = (lc || [])[0]?.lead_name || (bl || [])[0]?.lead_name || null;
  row.name = nameFrom;
  if (prior) await admin.from("lead_readiness").update(row).eq("id", prior.id);
  else await admin.from("lead_readiness").insert(row);
  return { grade: g, intent, inquiries: inq.length, words: words.length };
}

Deno.serve(async (req) => {
  if (!(await isServiceCaller(req))) return json({ error: "Forbidden" }, 403);
  const admin = createClient(SUPABASE_URL, SERVICE);
  const body = await req.json().catch(() => ({}));
  const people = new Map<string, { email: string | null; p10: string | null }>();
  const add = (e?: string | null, p?: string | null) => {
    const email = e && !PORTAL.test(e) ? e.toLowerCase().trim() : null;
    const p10 = phone10(p);
    if (!email && !p10) return;
    people.set(email || p10!, { email, p10 });
  };
  if (body.email || body.phone) add(body.email, body.phone);
  else {
    const since = new Date(Date.now() - 60 * 864e5).toISOString();
    const { data: a } = await admin.from("lead_concierge").select("lead_email,lead_phone").eq("kind", "lead").not("source", "is", null)
      .not("status", "in", "(not_a_lead,trash)").gte("first_seen_at", since);
    const { data: b } = await admin.from("brokerage_leads").select("lead_email,lead_phone").gte("received_at", since);
    for (const r of [...(a || []), ...(b || [])]) add(r.lead_email, r.lead_phone);
  }
  const results: any[] = [];
  for (const [k, key] of people) {
    try { results.push({ who: k.replace(/(.{3}).*(@.*)?/, "$1…"), ...(await qualifyPerson(admin, key)) }); }
    catch (e) { results.push({ who: k.slice(0, 3) + "…", error: String((e as Error)?.message || e) }); }
  }
  return json({ ok: true, people: people.size, results });
});
