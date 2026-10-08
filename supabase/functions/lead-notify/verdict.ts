// lead-notify/verdict.ts — the decision, as pure functions (no I/O), so it can
// be checked without a database. index.ts gathers the facts and asks here.

export type Verdict = { send: boolean; reason: string; score: number };

export const MACHINE = /(no-?reply|do-?not-?reply|notification|mailer-daemon|postmaster|bounce|unsubscribe|@e\.|@email\.|@mail\.|@reply\.|@news|@marketing|@campaign|@sendgrid|@mailchimp|@constantcontact|@hubspot|@salesforce|@zillow\.com|@leads\.|automated|alerts?@|info@|support@|billing@|admin@|team@|sales@|hello@|contact@)/i;
export const BULK = /(unsubscribe|view (this )?(email )?in (your )?browser|manage (your )?preferences|you (are )?receiv(ing|ed) this|privacy policy|©\s?20\d\d|all rights reserved|opt[- ]out|update your preferences|sent to you by|this is an automated)/i;
export const INTENT = /(interested in|looking (for|to)|can you|could you|would you|do you have|available|showing|schedule|appointment|tour|walk[- ]?through|offer|listing|list my|sell my|buy(ing)?|rent(al|ing)?|price|square (feet|foot)|bedroom|property|house|home|condo|address|call me|reach me|get back to me|question about|referral|\?)/i;

export const THRESHOLD = 55;
// PORTAL LEADS (Oct 7 2026). A lead recognised by its portal TEMPLATE (the
// lead_sources table: Zillow, realtor.com, Homes.com, Redfin, rental portals,
// IDX/brokerage sites, CRM platforms, showing and home-value requests) or sent
// from a portal's per-buyer relay address is a lead by construction. The
// generic score was built for unknown senders and scored Zillow's own
// "<name> is requesting information about <address>" at 35, so Ola's buyers
// never reached her. Portal leads get a floor above the threshold. Nothing
// else is loosened: unknown senders still need 55 on their own.
export const PORTAL_FLOOR = 60;
// Zillow/Trulia give every buyer their own relay address. Other portals put
// the buyer's real address in the body, so for them the template is the signal.
export const PORTAL_RELAY = /@(convo\.zillow\.com|convo\.trulia\.com)$/i;
const NOT_PORTAL = new Set(["direct inquiry", "referral"]);

export function portalOf(lead: any): string | null {
  const src = String(lead?.source || "").trim();
  if (src && !NOT_PORTAL.has(src.toLowerCase())) return src;
  const addr = String(lead?.lead_email || "").trim().toLowerCase();
  if (PORTAL_RELAY.test(addr)) return /trulia/.test(addr) ? "Trulia" : "Zillow";
  return null;
}

/** The additive signal score (unchanged from v9). */
export function scoreOf(lead: any, text: string): number {
  const cat = String(lead.triage || "").toLowerCase();
  const name = String(lead.lead_name || "");
  let score = 0;
  if (/urgent|requires_response/.test(cat)) score += 40;
  if (INTENT.test(text)) score += 35;
  if (text.includes("?")) score += 10;
  if (name && /\s/.test(name.trim())) score += 10;          // a real first and last name
  if (/\b\d{3}[.\-\s]?\d{3}[.\-\s]?\d{4}\b/.test(text)) score += 15;  // left a number
  if (lead.channel === "text" || lead.channel === "missed_call") score += 20;
  return score;
}

export function judge(lead: any, body: string): Verdict {
  const from = String(lead.lead_email || "").toLowerCase();
  const text = String(body || "");
  if (!from && !lead.lead_phone) return { send: false, reason: "no way to identify the sender", score: 0 };
  if (from && MACHINE.test(from)) return { send: false, reason: "machine or role address", score: 0 };
  if (BULK.test(text)) return { send: false, reason: "bulk-mail markers in the body", score: 0 };
  const cat = String(lead.triage || "").toLowerCase();
  if (cat && /promo|market|newsletter|spam|junk|no_?action|fyi/.test(cat)) {
    return { send: false, reason: `triage says ${cat}`, score: 0 };
  }
  const len = text.trim().length;
  if (len < 15) return { send: false, reason: "too short to act on", score: 0 };
  if (len > 4000) return { send: false, reason: "too long to be an enquiry", score: 0 };
  const score = scoreOf(lead, text);
  if (score < THRESHOLD) return { send: false, reason: `not enough signal (${score})`, score };
  return { send: true, reason: `looks like a real enquiry (${score})`, score };
}

export type Facts = {
  lead: any; text: string;
  muted: boolean; vouched: boolean; colleague: boolean; repeat: boolean;
  portalLive: boolean;            // notification_runtime.portal_live
};

export function decide(f: Facts): Verdict & { portal: string | null } {
  const { lead, text, muted, vouched, colleague, repeat } = f;
  const addr = String(lead.lead_email || "").trim().toLowerCase();
  const subj = (text.match(/^\s*Subject:\s*(.+)$/im) || [])[1] || "";
  const isReply = /^\s*(re|fwd?|fw)\s*:/i.test(subj);
  const roleBox = /^(repairs|manager|service|accounting|escrow|closing|orders|billing|leasing|maintenance|office|hr|payroll|compliance)@/.test(addr);
  const hay = (subj + " " + text).toLowerCase();
  const wantsProperty = /(buy|buying|sell|selling|list(ing)?\b|purchase|offer|showing|tour|view the|interested in|looking for a|market value|what.s my home worth|pre-?approv|represent me|work with you|available\?|still on the market)/.test(hay);
  const isBilling = /(invoice|a bill from|payment request|past due|remittance|statement attached|w-?9|receipt)/.test(hay);
  const portal = f.portalLive ? portalOf(lead) : null;

  if (portal) {
    // The agent's own word and the hard exclusions still come first.
    if (muted) return { send: false, reason: "you marked this sender Not lead", score: 0, portal };
    if (vouched && !isReply) return { send: true, reason: "you marked this sender True lead", score: 100, portal };
    if (colleague) return { send: false, reason: "sender is one of our own agents", score: 0, portal };
    if (repeat) return { send: false, reason: "already notified about this sender this week", score: 0, portal };
    // A "Re:" through a relay is the middle of a conversation, and on 4 Sep it
    // was a phishing link dressed as Zillow. Never an alert.
    if (isReply) return { send: false, reason: "a reply in an existing thread, not a new lead", score: 0, portal };
    const raw = scoreOf(lead, text);
    const score = Math.max(raw, PORTAL_FLOOR);
    return { send: true, reason: `portal lead (${portal}) · score floor ${PORTAL_FLOOR} (raw ${raw})`, score, portal };
  }

  // Everything else: the v9 chain, unchanged and in the same order.
  const v: Verdict = muted
    ? { send: false, reason: "you marked this sender Not lead", score: 0 }
    : vouched && !isReply
    ? { send: true, reason: "you marked this sender True lead", score: 100 }
    : colleague ? { send: false, reason: "sender is one of our own agents", score: 0 }
    : roleBox ? { send: false, reason: "operational mailbox, not a person", score: 0 }
    : repeat ? { send: false, reason: "already notified about this sender this week", score: 0 }
    : isReply ? { send: false, reason: "a reply in an existing thread, not a new lead", score: 0 }
    : isBilling ? { send: false, reason: "an invoice or payment request", score: 0 }
    : !wantsProperty ? { send: false, reason: "nothing said about buying, selling or renting", score: 0 }
    : judge(lead, text);
  return { ...v, portal };
}

// ── when a push may ring ───────────────────────────────────────────────────
// Agent lead pushes: 8 AM–9 PM ET. Outside that, only a lead under 15 minutes
// old rings (it is a race); it goes out with an urgent "lead-" tag so the
// agent's own quiet hours let it through (push_gate: urgent breaks quiet unless
// the agent turned that off). Anything older at night waits: no push, the
// email is the record.
export const QUIET_START = 21, QUIET_END = 8, FRESH_MIN = 15;
export function pushPlan(firstSeenIso: string, now: Date, hourET: number, leadId: string):
  { push: boolean; tag?: string; why: string } {
  const ageMin = (now.getTime() - new Date(firstSeenIso).getTime()) / 60000;
  const fresh = ageMin >= 0 && ageMin < FRESH_MIN;
  const quiet = hourET >= QUIET_START || hourET < QUIET_END;
  if (fresh) return { push: true, tag: "lead-new-" + leadId, why: "fresh lead" };
  if (!quiet) return { push: true, tag: "new-lead-" + leadId, why: "daytime" };
  return { push: false, why: "push skipped: quiet hours (9 PM–8 AM ET), lead older than 15 min" };
}

export const RATE_PER_HOUR = 6;   // lead alerts per agent per rolling hour
