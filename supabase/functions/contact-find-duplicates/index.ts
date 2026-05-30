// contact-find-duplicates
// Surfaces likely duplicate contacts for user review. Never auto-merges.
// Groups by: exact email match, exact phone match, normalized-name + same company.
//
// POST body: { user_id: uuid }
// Returns: { ok, groups: [{ key, reason, contacts: [...], suggested_canonical_id }] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function normalizeName(name: string | null): string {
  if (!name) return "";
  return name.toLowerCase().trim()
    .replace(/\b(mr|mrs|ms|miss|dr|prof|rev|sr|jr|ii|iii|iv|esq|cpa|md|phd)\.?$/gi, "")
    .replace(/[.,'"`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompany(company: string | null): string {
  if (!company) return "";
  return company.toLowerCase().trim()
    .replace(/\b(inc|llc|ltd|corp|co|corporation|limited|company|group|llp|pllc|pa|pc)\.?,?$/gi, "")
    .replace(/[.,'"`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.substring(1);
  if (digits.length === 10) return digits;
  return digits;  // partial or international — still group exact matches
}

function normalizeEmail(email: string | null): string {
  return (email || "").toLowerCase().trim();
}

// Score "completeness" of a contact record — used to suggest which one to keep
function completenessScore(c: any): number {
  let score = 0;
  if (c.name) score += 1;
  if (c.email) score += 2;
  if (c.phone) score += 2;
  if (c.company) score += 1;
  if (c.role) score += 1;
  if (c.notes && c.notes.length > 20) score += 2;
  if (c.last_contact_at) score += 1;
  if (c.tags && Array.isArray(c.tags) && c.tags.length > 0) score += 1;
  return score;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
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

    const { data: contacts } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", user_id);

    if (!contacts || contacts.length === 0) {
      return new Response(JSON.stringify({ ok: true, groups: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build indices
    const byEmail = new Map<string, any[]>();
    const byPhone = new Map<string, any[]>();
    const byNameCompany = new Map<string, any[]>();

    for (const c of contacts) {
      const email = normalizeEmail(c.email);
      const phone = normalizePhone(c.phone);
      const name = normalizeName(c.name);
      const company = normalizeCompany(c.company);

      if (email) {
        if (!byEmail.has(email)) byEmail.set(email, []);
        byEmail.get(email)!.push(c);
      }
      if (phone && phone.length === 10) {
        if (!byPhone.has(phone)) byPhone.set(phone, []);
        byPhone.get(phone)!.push(c);
      }
      if (name) {
        const key = `${name}|${company}`;
        if (!byNameCompany.has(key)) byNameCompany.set(key, []);
        byNameCompany.get(key)!.push(c);
      }
    }

    const groups: any[] = [];
    const seenGroupKeys = new Set<string>();  // dedupe — a pair of contacts can match by multiple criteria

    function groupKey(contacts: any[]): string {
      return contacts.map(c => c.id).sort().join("|");
    }

    function addGroup(reason: string, contacts: any[]) {
      if (contacts.length < 2) return;
      const key = groupKey(contacts);
      if (seenGroupKeys.has(key)) {
        // Already added — but augment the reason on the existing group
        const existing = groups.find(g => groupKey(g.contacts) === key);
        if (existing && !existing.reason.includes(reason)) {
          existing.reason = existing.reason + " + " + reason;
        }
        return;
      }
      seenGroupKeys.add(key);
      // Suggest canonical: most-complete record
      const scored = contacts.map(c => ({ c, s: completenessScore(c) }));
      scored.sort((a, b) => b.s - a.s);
      groups.push({
        key,
        reason,
        contacts: contacts.map(c => ({
          id: c.id, name: c.name, email: c.email, phone: c.phone,
          company: c.company, role: c.role, type: c.type, notes: c.notes,
          last_contact_at: c.last_contact_at, created_at: c.created_at,
          completeness_score: completenessScore(c),
        })),
        suggested_canonical_id: scored[0].c.id,
      });
    }

    // Pass 1: exact email match
    for (const [email, list] of byEmail) {
      if (list.length >= 2) addGroup("same email", list);
    }
    // Pass 2: exact phone match
    for (const [phone, list] of byPhone) {
      if (list.length >= 2) addGroup("same phone", list);
    }
    // Pass 3: exact name + same company
    for (const [key, list] of byNameCompany) {
      const [name, company] = key.split("|");
      if (!name) continue;
      if (list.length >= 2) {
        // Only flag if company is present OR if neither has a company (the "no employer, just same name" case is a softer match — let's still flag it)
        addGroup(company ? "same name + company" : "same name", list);
      }
    }

    // Sort groups: high-confidence (email/phone) first, then name-only
    groups.sort((a, b) => {
      const aScore = (a.reason.includes("email") ? 3 : 0) + (a.reason.includes("phone") ? 2 : 0) + (a.reason.includes("company") ? 1 : 0);
      const bScore = (b.reason.includes("email") ? 3 : 0) + (b.reason.includes("phone") ? 2 : 0) + (b.reason.includes("company") ? 1 : 0);
      return bScore - aScore;
    });

    return new Response(JSON.stringify({
      ok: true,
      scanned: contacts.length,
      group_count: groups.length,
      groups: groups.slice(0, 100),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
