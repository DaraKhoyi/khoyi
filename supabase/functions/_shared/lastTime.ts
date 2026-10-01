// lastTime.ts — "what did I say last time?", in plain words, with no judgement.
//
// Ray (panel), 30 Sep: "I always forget what I said last time… if it did that
// one thing I would not feel stupid." And: "The thing that would make me close
// it is if it shows me a score or a rating of my relationship" — or how long
// it has been since he got in touch. So this gives exactly three things:
//
//   * what YOU last said to them (email or text), in one sentence
//   * what THEY last said to you, in one sentence
//   * what the last CALL was about, in one sentence
//
// each with a calendar date ("Aug 12") — never "47 days ago", never a gap, a
// score, a health rating or a nudge that he should have reached out sooner.
// Used by contact-transact (the contact screen), ari-call-prep and
// prismTools contact_details. Stored on profiles.last_time; the model runs only
// when a newer message or call exists.

import "./aiGuard.ts";
import { ownPart } from "./transactFacts.ts";

type Item = { at: string; via: "email" | "text" | "call"; who: "you" | "them" | "call"; text: string };
export type LastTime = { you?: { on: string; via: string; said: string }; them?: { on: string; via: string; said: string }; call?: { on: string; about: string } };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric", timeZone: "America/New_York" });

async function latest(admin: any, contact: any): Promise<{ you?: Item; them?: Item; call?: Item }> {
  const uid = contact.user_id;
  const emails = [contact.email, ...((Array.isArray(contact.emails) ? contact.emails : []).map((e: any) => (e && (e.value || e.email)) || e))]
    .filter((e: any) => typeof e === "string" && e.includes("@")).map((e: string) => e.toLowerCase().trim());
  const p10s = [contact.phone, ...((Array.isArray(contact.phones) ? contact.phones : []).map((p: any) => (p && (p.number || p.value)) || p))]
    .map((p: any) => String(p || "").replace(/\D/g, "").slice(-10)).filter((p: string) => p.length === 10);
  const out: { you?: Item; them?: Item; call?: Item } = {};
  const take = (k: "you" | "them" | "call", it: Item) => { if (!out[k] || it.at > out[k]!.at) out[k] = it; };

  if (emails.length) {
    const { data: inb } = await admin.from("email_messages").select("internal_date, body_text, snippet, subject")
      .eq("user_id", uid).eq("direction", "inbound").in("from_address", emails).order("internal_date", { ascending: false }).limit(1);
    if (inb?.[0]) take("them", { at: inb[0].internal_date, via: "email", who: "them", text: `${inb[0].subject || ""}\n${ownPart(inb[0].body_text || inb[0].snippet || "")}` });
    // Outbound: to_addresses is jsonb [{name, email}]. The filter must be sent as
    // JSON text — the client's .contains() turns an array of objects into
    // "[object Object]" and silently matches nothing.
    for (const e of emails.slice(0, 3)) {
      const { data: outb } = await admin.from("email_messages").select("internal_date, body_text, snippet, subject")
        .eq("user_id", uid).eq("direction", "outbound").filter("to_addresses", "cs", JSON.stringify([{ email: e }])).order("internal_date", { ascending: false }).limit(1);
      if (outb?.[0]) take("you", { at: outb[0].internal_date, via: "email", who: "you", text: `${outb[0].subject || ""}\n${ownPart(outb[0].body_text || outb[0].snippet || "")}` });
    }
  }
  if (p10s.length) {
    const { data: sms } = await admin.from("quo_messages").select("op_created_at, body, from_number, to_number, direction")
      .eq("user_id", uid).order("op_created_at", { ascending: false }).limit(300);
    for (const m of sms || []) {
      const other = String(m.direction === "incoming" ? m.from_number : m.to_number || "").replace(/\D/g, "").slice(-10);
      if (!p10s.includes(other) || !m.body) continue;
      take(m.direction === "incoming" ? "them" : "you", { at: m.op_created_at, via: "text", who: m.direction === "incoming" ? "them" : "you", text: String(m.body) });
    }
  }
  const { data: calls } = await admin.from("quo_calls").select("op_created_at, created_at, summary")
    .eq("user_id", uid).eq("contact_id", contact.id).not("summary", "is", null).order("op_created_at", { ascending: false }).limit(1);
  if (calls?.[0]?.summary) take("call", { at: calls[0].op_created_at || calls[0].created_at, via: "call", who: "call", text: String(calls[0].summary) });
  return out;
}

const SYSTEM = `You help a real estate agent remember the last thing said in a conversation, so he walks in prepared.
For each item, write ONE short plain sentence (under 25 words) saying WHAT was said — the substance, names, properties, numbers, any promise or question left open.
Never mention dates, how long ago, gaps, frequency, or that anyone should have written sooner. Never judge, score or rate the relationship. No advice.
"you" items: start with "You". "them" items: start with their first name or "They". "call" items: start with "You talked about".
Return JSON only: {"you": string|null, "them": string|null, "call": string|null}`;

// A sentence that slips into recency or judgement is dropped rather than shown.
// Exported so the gate can test it without a model.
export function plainSentence(s: any): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  return /\b(\d+\s+(day|week|month|year)s?(\s+(ago|since))?|it'?s been|haven'?t (spoken|talked|reached|heard|been in touch)|overdue|too long|a while|long time|should have|lately|recently|in ages|out of touch|relationship (score|health))\b/i.test(s) ? null : s.trim();
}

export async function refreshLastTime(admin: any, contact: any, opts: { force?: boolean; onUsage?: (u: any) => Promise<void> | void } = {}): Promise<LastTime | null> {
  const items = await latest(admin, contact);
  const newest = [items.you, items.them, items.call].filter(Boolean).map((i) => i!.at).sort().pop() || null;
  const { data: prof } = await admin.from("profiles").select("id, last_time, last_time_through").eq("contact_id", contact.id).maybeSingle();
  if (!newest) return null;
  if (!opts.force && prof?.last_time && prof.last_time_through && newest <= prof.last_time_through) return prof.last_time;

  const first = String(contact.name || "").trim().split(/\s+/)[0] || "They";
  const lines = (["you", "them", "call"] as const).filter((k) => items[k]).map((k) => `${k.toUpperCase()} (${items[k]!.via}): ${items[k]!.text.replace(/\s+/g, " ").slice(0, 1500)}`);
  let said: any = {};
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 300, system: SYSTEM,
        messages: [{ role: "user", content: `The other person's first name: ${first}.\n\n${lines.join("\n\n")}` }] }),
    });
    const data = await r.json();
    try { if (opts.onUsage) await opts.onUsage(data?.usage); } catch (_) { /* best-effort */ }
    const txt = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    const m = txt.match(/\{[\s\S]*\}/); said = m ? JSON.parse(m[0]) : {};
  } catch (_) { said = {}; }

  // Belt and braces: a sentence that slips into recency or judgement is dropped
  // rather than shown — the whole point is that this never makes him feel behind.
  const clean = plainSentence;
  const lt: LastTime = {};
  if (items.you && clean(said.you)) lt.you = { on: day(items.you.at), via: items.you.via, said: clean(said.you)! };
  if (items.them && clean(said.them)) lt.them = { on: day(items.them.at), via: items.them.via, said: clean(said.them)! };
  if (items.call && clean(said.call)) lt.call = { on: day(items.call.at), about: clean(said.call)! };

  const row = { last_time: lt, last_time_through: newest };
  if (prof) await admin.from("profiles").update(row).eq("id", prof.id);
  else await admin.from("profiles").insert({ contact_id: contact.id, user_id: contact.user_id, subject_kind: "contact", ...row });
  return lt;
}
