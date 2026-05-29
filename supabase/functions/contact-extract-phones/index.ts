// contact-extract-phones
// Scans email bodies from known contacts and extracts phone numbers from
// signatures. Auto-fills contact.phone for contacts where email matches and
// phone is currently empty.
//
// POST body: { user_id: uuid, apply?: boolean }
//   apply=true (default): write the phone field
//   apply=false: dry-run, returns what would be filled
//
// Returns: { ok, scanned_contacts, filled, suggestions }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// US/Canada phone patterns. We're conservative: require either explicit
// formatting (parens, dashes, dots, spaces) OR a 'phone:'/'tel:'/'cell:' label.
// Reject ZIP+4, dates, and 9-digit numbers that are likely SSNs or IDs.
const PHONE_PATTERNS = [
  // (813) 555-1234, (813)555.1234, etc — high confidence (parens)
  /\(\s*(\d{3})\s*\)\s*[-.\s]?\s*(\d{3})\s*[-.\s]?\s*(\d{4})\b/g,
  // 813-555-1234, 813.555.1234 — high confidence (separators)
  /\b(\d{3})[-.](\d{3})[-.](\d{4})\b/g,
  // +1 813 555 1234, +1-813-555-1234
  /\+1[-.\s]?(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g,
];
// Labelled patterns (after stripping label): allow space-only separators
const LABELLED_PATTERNS = [
  /\b(?:phone|tel|cell|mobile|direct|office|fax|p|c|m|o|d)\s*[:.-]?\s*(?:\+?1\s*)?[-.\s(]*(\d{3})[-.\s)]*\s*(\d{3})[-.\s]*\s*(\d{4})\b/gi,
];

// Reject patterns: numbers that look like account numbers, tracking IDs, etc.
function isLikelyJunk(digits) {
  // 555-0100 to 555-0199 = officially fake (movie phone numbers)
  if (digits.length === 10 && digits.substring(3, 6) === "555" && digits.substring(6, 8) === "01") return true;
  // All same digit
  if (/^(\d)\1+$/.test(digits)) return true;
  // Sequential (1234567890)
  if (digits === "1234567890" || digits === "0123456789") return true;
  // Area codes starting with 0 or 1 are invalid (NANP)
  const area = digits.substring(0, 3);
  if (area.startsWith("0") || area.startsWith("1")) return true;
  // Central office code (positions 3-5) starts with 0 or 1 → invalid
  const co = digits.substring(3, 6);
  if (co.startsWith("0") || co.startsWith("1")) return true;
  return false;
}

function normalize(digits) {
  // Strip leading 1 (country code) if length is 11
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.substring(1);
  if (digits.length !== 10) return null;
  if (isLikelyJunk(digits)) return null;
  // Format: (XXX) XXX-XXXX
  return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6, 10)}`;
}

function extractPhones(text) {
  if (!text) return [];
  const found = new Map();  // normalized -> { count, contexts: [snippet] }

  function record(d1, d2, d3, source) {
    const digits = d1 + d2 + d3;
    const normalized = normalize(digits);
    if (!normalized) return;
    if (!found.has(normalized)) found.set(normalized, { count: 0, source });
    found.get(normalized).count++;
  }

  // Try labelled patterns first (highest confidence)
  for (const re of LABELLED_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) record(m[1], m[2], m[3], 'labelled');
  }
  for (const re of PHONE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) record(m[1], m[2], m[3], 'formatted');
  }
  return Array.from(found.entries()).map(([phone, meta]) => ({ phone, ...meta }));
}

// Extract from the BOTTOM portion of a message body (signatures are at the bottom)
function extractFromSignature(bodyText, bodyHtml) {
  const text = bodyText || stripHtml(bodyHtml || "");
  if (!text) return [];
  // Look at the last 30 lines (or last 2000 chars) — typical signature area
  const lines = text.split('\n');
  const tail = lines.slice(Math.max(0, lines.length - 30)).join('\n');
  return extractPhones(tail);
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { user_id, apply = true } = body;
    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Get all contacts with email but NO phone
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, email, phone")
      .eq("user_id", user_id)
      .not("email", "is", null)
      .or("phone.is.null,phone.eq.");

    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ ok: true, scanned_contacts: 0, filled: 0, suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const suggestions = [];
    let filled = 0;

    for (const c of contacts) {
      if (!c.email) continue;
      const email = c.email.toLowerCase().trim();
      if (!email) continue;

      // Pull recent inbound messages from this contact
      const { data: msgs } = await supabase
        .from("email_messages")
        .select("body_text, body_html")
        .eq("user_id", user_id)
        .eq("direction", "inbound")
        .ilike("from_address", email)
        .order("internal_date", { ascending: false })
        .limit(10);

      if (!msgs || msgs.length === 0) continue;

      // Find phones that appear in MORE THAN ONE message (consistency = signature)
      const phoneScores = new Map();  // phone -> count of messages it appeared in
      for (const m of msgs) {
        const phones = extractFromSignature(m.body_text, m.body_html);
        const seenInThisMsg = new Set();
        for (const p of phones) {
          if (seenInThisMsg.has(p.phone)) continue;
          seenInThisMsg.add(p.phone);
          phoneScores.set(p.phone, (phoneScores.get(p.phone) || 0) + 1);
        }
      }

      // Pick the most consistent phone (appears in most messages)
      const sorted = Array.from(phoneScores.entries()).sort((a, b) => b[1] - a[1]);
      if (sorted.length === 0) continue;

      const [bestPhone, bestCount] = sorted[0];
      // Require at least 2 message appearances OR a single message with 1 hit if total is 1 msg
      const minCount = msgs.length === 1 ? 1 : 2;
      if (bestCount < minCount) continue;

      suggestions.push({
        contact_id: c.id,
        contact_name: c.name,
        contact_email: c.email,
        phone: bestPhone,
        appeared_in: bestCount,
        of_messages: msgs.length,
      });

      if (apply) {
        const { error } = await supabase
          .from("contacts").update({ phone: bestPhone }).eq("id", c.id);
        if (!error) filled++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      scanned_contacts: contacts.length,
      filled: apply ? filled : 0,
      suggestions: suggestions.slice(0, 200),
      applied: apply,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
