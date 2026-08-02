// contact-link-emails
// Scans all inbound email senders from the user's connected Gmail and links them
// to contact records. Two pass strategy:
//   1) AUTO-LINK: if a contact has the exact email already, just refresh their
//      last_contact_at from the most recent inbound message.
//   2) AUTO-FILL: if a contact has NO email but the sender's display_name matches
//      a contact's name (case-insensitive, exact OR first+last token match),
//      fill in the email and link.
//   3) SUGGEST: for ambiguous matches (multiple candidates, fuzzy name match
//      below threshold), return suggestions for the user to confirm in the UI.
//
// Promotional / no-reply senders are filtered out so the noise doesn't pollute
// the results.
//
// POST { user_id: uuid, account_id?: uuid, apply_auto?: boolean }
//   apply_auto: if true (default), writes auto-link and auto-fill changes.
//               if false, dry-run that returns counts without writing.
//
// Returns: { auto_linked: n, auto_filled: n, suggestions: [...], scanned: n }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Senders we never want to link — automated systems, marketing, etc.
const SENDER_BLOCKLIST_PATTERNS = [
  /noreply/i, /no-reply/i, /notifications?@/i, /news(letters?)?@/i,
  /alerts?@/i, /updates?@/i, /digest@/i, /broadcast@/i,
  /donotreply/i, /info@.*\.(realtor|news|inman|cbre|nmrk)/i,
  // Role mailboxes — never a personal correspondent (the local-part before @).
  // Deliberately NOT blocking whole corporate domains, so real people like
  // firstname.lastname@realtyonegroup.com are still linked; only role@ is skipped.
  /^customer[-.]?care@/i, /^customer[-.]?service@/i, /^support@/i, /^helpdesk@/i,
  /^marketing@/i, /^hello@/i, /^sales@/i, /^billing@/i, /^admin@/i, /^team@/i,
  // Bulk marketing platforms
  /mailchimpapp\.com$/i, /sendgrid\.net$/i, /mailgun\.org$/i,
  /mandrillapp\.com$/i, /amazonses\.com$/i, /mailjet\.com$/i,
  /campaignmonitor\.com$/i, /constantcontact\.com$/i,
  /icontact\.com$/i, /klaviyo(mail)?\.com$/i,
  // Generic marketing domains
  /@(e\.mail|info|mail|news|email|alerts|updates|click|link|em|campaign|marketing)\..*\.(com|net|org|info|click|lat|world|bond|garden|click)$/i,
  /@(cloze|inman|housingwire|beehiiv|substack|amazon|walmart|ebay|chase|capitalone|bankofamerica|wellsfargo|paypal|google|microsoft|apple|verizon|att|tmobile)\.com$/i,
  /@.*\.(invalid|test|example)$/i,
];
const NAME_BLOCKLIST_PATTERNS = [
  /^(MLS|Inman|HousingWire|CBRE|Newmark|Encore|Realtor|Cloze|Viking|Chase|eBay|Amazon|Walmart|Verizon|Google Cloud|Microsoft)\b/i,
  /\b(Newsletter|Notification|Alerts?|Digest|Headlines|Updates?|Reports?|Marketing)\b/i,
];

function isLikelyHuman(fromAddress, fromName) {
  const addr = (fromAddress || "").toLowerCase();
  const nm = (fromName || "").trim();
  if (!addr) return false;
  for (const p of SENDER_BLOCKLIST_PATTERNS) if (p.test(addr)) return false;
  for (const p of NAME_BLOCKLIST_PATTERNS) if (nm && p.test(nm)) return false;
  // Heuristic: real people usually have a name + a name-shaped email
  if (!nm) return false;
  // Reject mailers that look like "Newsletter X" or "X Updates"
  return true;
}

// Minimum messages required for a new-contact suggestion.
// 3 is the sweet spot: enough that it's a real relationship (not a one-off),
// not so high that genuine new contacts wait forever.
const NEW_CONTACT_MIN_MESSAGES = 3;

// Stricter version of isLikelyHuman for new-contact suggestions.
// The existing isLikelyHuman is forgiving (used for linking to YOUR existing
// contacts, where false-positives don't cost much). This one is stricter:
// these senders would actually become NEW contacts, so spam slipping through
// pollutes your CRM permanently. Be aggressive about rejection.
//
// Additional checks beyond isLikelyHuman:
//   - Name must look like a real person's name (1-4 tokens, alpha-dominant)
//   - Address local-part can't be obviously bulk (random digits/strings)
//   - TLD can't be in the "marketing burner" list
//   - No DKIM-like envelope characters in name (e.g. "via mail.something")
const STRICT_NAME_REJECT = [
  /\b(team|support|sales|admin|hello|hi|info|help|contact|customer|service|community|tech|noreply)\b/i,
  /\b(via|on behalf of|sent by|powered by|@)\b/i,
  /(\?|!){2,}/,            // multiple punctuation in name
  /[\u{1F300}-\u{1FAFF}]/u, // emoji
  /^[A-Z\s]+$/,            // ALL CAPS NAMES (mostly marketing)
];
const STRICT_DOMAIN_REJECT = [
  // Cheap promo TLDs heavily abused by spammers
  /\.(lat|world|bond|garden|click|life|live|shop|space|monster|icu|xyz|win|loan|review|stream|trade|date|party|webcam|men|gdn|host|press|today|info|click|link|help|guru|fit|fyi|run|wtf|biz|cam|cfd|email|tk|ml|ga|cf|gq)$/i,
  // Common spam-host providers and notification subdomains
  /\.(sendgrid|mandrill|mailgun|mailchimp|constantcontact|klaviyo|sparkpost|amazonses|mailjet|hubspotemail|braze|ccsend|servermail|completeit)\./i,
  /^notifications?\./i,        // notifications.foo.com
  /^(vm|voicemail|fax)[-.]/i,  // voicemail systems
];
function isLikelyHumanStrict(fromAddress, fromName, ownNames) {
  if (!isLikelyHuman(fromAddress, fromName)) return false;
  const nm = (fromName || "").trim();
  const addr = (fromAddress || "").toLowerCase();

  // Self-spoof check: a sender claiming to be you, from an email that isn't yours
  // (ownNames is the set of lowercased name tokens of the account owner)
  if (ownNames && ownNames.size > 0) {
    const nmTokens = nameTokens(nm);
    // If ALL of the sender's name tokens match the owner's name AND it's not the owner's own email
    const allMatch = nmTokens.length >= 1 && nmTokens.every(t => ownNames.has(t));
    if (allMatch) return false;
  }

  // Phone numbers as display name (voicemail forwarders, etc.)
  if (/^[+\d][\d\s().-]{6,}$/.test(nm)) return false;
  // Display names with pipe character (usually system-generated: "VoiceMail | something.com")
  if (nm.includes("|")) return false;
  // Local-part starts with vm- or voicemail
  const localPart = (addr.split("@")[0] || "").toLowerCase();
  if (/^(vm[-.]|voicemail[-.]|fax[-.])/.test(localPart)) return false;

  // Name shape check
  if (nm.length > 60) return false;       // long names are usually marketing copy
  const tokens = nameTokens(nm);
  if (tokens.length === 0) return false;
  if (tokens.length > 4) return false;    // 5+ "name" tokens is almost always a sender like "X from Acme, Inc."
  for (const p of STRICT_NAME_REJECT) if (p.test(nm)) return false;

  // Domain check
  for (const p of STRICT_DOMAIN_REJECT) if (p.test(addr)) return false;

  // Name vs. local-part mismatch check: if both look name-shaped but share NO tokens,
  // it's a spoof (e.g., "Ethan Calvert <elianastewart@...>")
  // Only apply for personal-style local parts (no digits/dashes — those legitimately differ)
  if (/^[a-z]{4,}$/.test(localPart) && tokens.length >= 1) {
    const localLooksLikeName = localPart;
    const anyNameTokenInLocal = tokens.some(t => localLooksLikeName.includes(t) && t.length >= 4);
    const localInAnyNameToken = tokens.some(t => t.includes(localLooksLikeName) && localLooksLikeName.length >= 4);
    if (!anyNameTokenInLocal && !localInAnyNameToken) {
      // Pure-name local part that shares NOTHING with display name → spoofed
      return false;
    }
  }
  // Combined "firstlast" pattern check
  if (tokens.length >= 2) {
    const firstLast = (tokens[0] + tokens[tokens.length - 1]).toLowerCase();
    const lastFirst = (tokens[tokens.length - 1] + tokens[0]).toLowerCase();
    const firstDotLast = `${tokens[0]}.${tokens[tokens.length - 1]}`;
    const firstInitial = `${tokens[0][0]}${tokens[tokens.length - 1]}`;
    // Strip dots/dashes/underscores from local for comparison
    const localStripped = localPart.replace(/[._-]/g, "");
    const candidates = [tokens[0], tokens[tokens.length - 1], firstLast, lastFirst,
                        firstDotLast.replace(/\./g, ""), firstInitial];
    const matches = candidates.some(c => localStripped.includes(c) || localPart.includes(c));
    // If none of the common patterns match AND the local part looks like a "name" string,
    // it's probably a spoofed display name
    if (!matches && /^[a-z]+$/.test(localStripped) && localStripped.length >= 5) {
      return false;
    }
  }

  // Local-part check (the part before @): random-looking strings suggest tracking/automation
  // Pure-random: lots of digits and no letters in a row
  if (/^[a-z]*\d{6,}[a-z]*$/.test(localPart)) return false;
  // Hash-shaped: 20+ char hex
  if (/^[a-f0-9]{20,}$/.test(localPart)) return false;
  // Has 4+ digits AND no clear name (e.g., "u239847")
  if ((localPart.match(/\d/g) || []).length >= 4 && tokens.length < 2) return false;

  return true;
}

// Build "why this person looks like a real contact" signals to show in the UI.
// Returns small array of human-readable strings.
function buildConfidenceSignals(s) {
  const signals = [];
  signals.push(`${s.count} message${s.count === 1 ? '' : 's'} received`);
  if (s.min_date && s.max_date && s.min_date !== s.max_date) {
    const days = Math.round((new Date(s.max_date).getTime() - new Date(s.min_date).getTime()) / 86400000);
    if (days >= 7) signals.push(`Spans ${days} days (not a one-off blast)`);
  }
  // Domain shape: personal Gmail/Outlook is one signal; a company domain is another
  const domain = (s.email.split("@")[1] || "").toLowerCase();
  const personalDomains = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "me.com", "mac.com"]);
  if (personalDomains.has(domain)) {
    signals.push("Personal email account");
  } else if (domain && !domain.includes("noreply") && !domain.includes("mail.")) {
    signals.push(`Business domain: ${domain}`);
  }
  return signals;
}

function normalizeName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function nameTokens(s) {
  return normalizeName(s).split(" ").filter(t => t.length >= 2);
}

// Score 0-100 of how well a sender's display name matches a contact name.
function nameMatchScore(senderName, contactName) {
  const sTokens = nameTokens(senderName);
  const cTokens = nameTokens(contactName);
  if (sTokens.length === 0 || cTokens.length === 0) return 0;
  const sNorm = normalizeName(senderName);
  const cNorm = normalizeName(contactName);
  if (sNorm === cNorm) return 100;
  // Last name match is the biggest signal
  const sLast = sTokens[sTokens.length - 1];
  const cLast = cTokens[cTokens.length - 1];
  const lastMatch = sLast === cLast;
  // First name match
  const firstMatch = sTokens[0] === cTokens[0];
  if (lastMatch && firstMatch) return 95;
  if (lastMatch && sTokens.length >= 2 && cTokens.length >= 2) return 80;
  if (firstMatch && lastMatch === false && sTokens.length === 1 && cTokens.length === 1) return 70; // both single-name like "Alicia"
  // Substring contains (handles "Alex Khoyi" vs "Alexander Khoyi")
  if (cNorm.includes(sNorm) || sNorm.includes(cNorm)) {
    // Make sure it's not just a tiny common word
    if (Math.min(sNorm.length, cNorm.length) >= 4) return 65;
  }
  return 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { account_id, apply_auto = true } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    // SECURITY: derive user_id from JWT only
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = user.id;

    // Load contacts (just what we need)
    const { data: contacts, error: cErr } = await supabase
      .from("contacts")
      .select("id, name, email, last_contact_at, type")
      .eq("user_id", user_id);
    if (cErr) throw cErr;

    // Load the user's own aliases — never link these to contacts (they're "me")
    const { data: aliases } = await supabase
      .from("email_aliases").select("email_address, display_name").eq("user_id", user_id);
    const ownAddresses = new Set(
      (aliases || []).map(a => (a.email_address || "").toLowerCase())
        .filter(Boolean)
    );
    // Build a set of name tokens that belong to the account owner. Used to detect
    // self-spoofing (sender display name = your name, but email isn't yours).
    const ownNames = new Set();
    for (const a of aliases || []) {
      for (const t of nameTokens(a.display_name || "")) ownNames.add(t);
    }
    // Also include the user's own from_name from sent mail (e.g. their display name)
    try {
      const { data: sentSample } = await supabase
        .from("email_messages").select("from_name")
        .eq("user_id", user_id).eq("direction", "outbound")
        .not("from_name", "is", null).limit(20);
      for (const m of sentSample || []) {
        for (const t of nameTokens(m.from_name || "")) ownNames.add(t);
      }
    } catch (_) { /* non-fatal */ }

    // Load dismissals so we don't re-suggest things the user already rejected
    const { data: dismissals } = await supabase
      .from("contact_link_dismissals").select("sender_email, contact_id, reason")
      .eq("user_id", user_id);
    const dismissedPairs = new Set();
    const dismissedSenders = new Set();
    const dismissedNewContact = new Set();
    for (const d of dismissals || []) {
      const addr = (d.sender_email || "").toLowerCase();
      if (d.reason === 'block_sender') {
        dismissedSenders.add(addr);
      } else if (d.reason === 'not_a_new_contact') {
        dismissedNewContact.add(addr);
      } else if (d.contact_id) {
        dismissedPairs.add(`${addr}|${d.contact_id}`);
      }
    }

// Aggregate senders in the database (one GROUP BY over all inbound mail) instead of
    // pulling thousands of rows and churning them in JS — keeps the scan under ~1s.
    const { data: digest, error: mErr } = await supabase.rpc("email_sender_digest", { p_user: user_id, p_account: account_id || null, p_limit: 4000 });
    if (mErr) throw mErr;
    const senders = (digest || [])
      .filter((d: any) => d.email && !ownAddresses.has(String(d.email).toLowerCase()))
      .map((d: any) => ({ email: String(d.email).toLowerCase(), name: d.name || null, count: Number(d.cnt) || 0, max_date: d.max_date, min_date: d.min_date, subject_samples: [] }));

    // Index contacts by lowercase email
    const byContactEmail = new Map();
    for (const c of contacts) {
      if (c.email) byContactEmail.set(c.email.toLowerCase().trim(), c);
    }

    let autoLinked = 0;
    let autoFilled = 0;
    const suggestions = [];
    const autoFillDetails = [];
    // Option B: new-contact suggestions (frequent senders unmatched to existing contacts)
    const newContactSuggestions = [];
    const touchedContactIds = new Set();
    const updatesQueue = [];

    for (const s of senders) {
      if (dismissedSenders.has(s.email)) continue;  // user blocked this sender

      // Pass 1: exact email match
      const exactContact = byContactEmail.get(s.email);
      if (exactContact) {
        autoLinked++;
        touchedContactIds.add(exactContact.id);
        if (s.max_date && (!exactContact.last_contact_at || new Date(s.max_date) > new Date(exactContact.last_contact_at))) {
          updatesQueue.push({ id: exactContact.id, last_contact_at: s.max_date });
        }
        continue;
      }

      // Skip non-human senders before name matching
      if (!isLikelyHuman(s.email, s.name)) continue;

      // Pass 2: name match — only meaningful if contact has no email
      let bestMatch = null;
      let bestScore = 0;
      let runnerUpScore = 0;
      const allHits = [];
      for (const c of contacts) {
        if (!c.name) continue;
        if (c.email) continue;
        const score = nameMatchScore(s.name, c.name);
        if (score > 0) allHits.push({ c, score });
        if (score > bestScore) {
          runnerUpScore = bestScore;
          bestScore = score;
          bestMatch = c;
        } else if (score > runnerUpScore) {
          runnerUpScore = score;
        }
      }

      // Auto-fill: requires (a) very high score (95+) (b) clear winner over runner-up
      // (c) sender name and contact name share BOTH first AND last token (or single-token exact match)
      const senderTokens = nameTokens(s.name);
      const contactTokens = bestMatch ? nameTokens(bestMatch.name) : [];
      const bothMultiTokenMatch =
        senderTokens.length >= 2 && contactTokens.length >= 2 &&
        senderTokens[0] === contactTokens[0] &&
        senderTokens[senderTokens.length - 1] === contactTokens[contactTokens.length - 1];
      const singleTokenExact =
        senderTokens.length === 1 && contactTokens.length === 1 &&
        senderTokens[0] === contactTokens[0];
      const safeAutoFill = bothMultiTokenMatch || (bestScore === 100);

      if (bestMatch && bestScore >= 95 && (bestScore - runnerUpScore >= 25) && safeAutoFill) {
        autoFilled++;
        touchedContactIds.add(bestMatch.id);
        updatesQueue.push({
          id: bestMatch.id,
          email: s.email,
          last_contact_at: s.max_date,
        });
        autoFillDetails.push({
          contact_id: bestMatch.id,
          contact_name: bestMatch.name,
          email_filled: s.email,
          sender_name: s.name,
          msg_count: s.count,
        });
        byContactEmail.set(s.email, bestMatch);
        continue;
      }

      // Suggest: reasonable match, but not safe enough to auto-apply
      if (bestMatch && bestScore >= 65) {
        const pairKey = `${s.email}|${bestMatch.id}`;
        if (dismissedPairs.has(pairKey)) continue;
        suggestions.push({
          sender: { name: s.name, email: s.email, msg_count: s.count, last_seen: s.max_date },
          contact: { id: bestMatch.id, name: bestMatch.name, type: bestMatch.type },
          score: bestScore,
          ambiguous: allHits.filter(h => h.score >= bestScore - 5).length > 1,
        });
        continue;
      }

      // OPTION B: New-contact suggestion
      // This sender has no good match in existing contacts. If they sent
      // enough emails (and pass extra-strict spam/automation filters), suggest
      // creating a new contact for them.
      const meetsThreshold = s.count >= NEW_CONTACT_MIN_MESSAGES;
      const passesStrictHumanCheck = isLikelyHumanStrict(s.email, s.name, ownNames);
      const dismissedNew = dismissedNewContact.has(s.email);
      if (meetsThreshold && passesStrictHumanCheck && !dismissedNew) {
        newContactSuggestions.push({
          sender: { name: s.name, email: s.email, msg_count: s.count, last_seen: s.max_date },
          first_seen: s.min_date,
          confidence_signals: buildConfidenceSignals(s),
        });
      }
    }

    // Apply updates if requested
    if (apply_auto && updatesQueue.length > 0) {
      const merged = new Map();
      for (const u of updatesQueue) {
        const existing = merged.get(u.id) || { id: u.id };
        for (const k of Object.keys(u)) if (k !== "id") existing[k] = u[k];
        merged.set(u.id, existing);
      }
      for (const u of merged.values()) {
        const patch = { ...u };
        delete patch.id;
        await supabase.from("contacts").update(patch).eq("id", u.id);
      }
    }

    suggestions.sort((a, b) => (b.score - a.score) || (b.sender.msg_count - a.sender.msg_count));
    // Sort new-contact suggestions by message volume (most frequent first)
    newContactSuggestions.sort((a, b) => b.sender.msg_count - a.sender.msg_count);

    return new Response(JSON.stringify({
      ok: true,
      scanned_senders: senders.length,
      auto_linked: autoLinked,
      auto_filled: autoFilled,
      auto_fill_details: autoFillDetails,
      contacts_touched: touchedContactIds.size,
      suggestions_count: suggestions.length,
      suggestions: suggestions.slice(0, 100),
      new_contact_suggestions_count: newContactSuggestions.length,
      new_contact_suggestions: newContactSuggestions.slice(0, 50),
      applied: apply_auto,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
