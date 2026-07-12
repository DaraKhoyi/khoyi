// iOS Share ingest: an Apple Shortcut POSTs shared content here with a per-user
// token. Routes by type into the same pipelines the Android share target uses:
// audio -> recording + transcribe, document -> documents + extract, vCard ->
// contact, text/URL -> journal. Auth = the user's ingest token (no JWT).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-ingest-token, x-filename", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const safe = (n: string) => (n || "file").replace(/[^a-zA-Z0-9._-]/g, "_");

function parseVCard(raw: string): any {
  if (!raw || !/BEGIN:VCARD/i.test(raw)) return null;
  const block = (raw.match(/BEGIN:VCARD[\s\S]*?END:VCARD/i) || [raw])[0];
  const lines = block.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const dec = (v: string, p: any) => { let s = v; if (/QUOTED-PRINTABLE/i.test(p.ENCODING || "")) { s = s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))); try { s = decodeURIComponent(escape(s)); } catch (_) {} } return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim(); };
  const c: any = { phones: [], emails: [], notes: "" }; let fn = "", n: any = null; const extra: string[] = [];
  for (const line of lines) {
    const ci = line.indexOf(":"); if (ci < 0) continue;
    const left = line.slice(0, ci), rawVal = line.slice(ci + 1); const segs = left.split(";");
    let prop = segs[0].toUpperCase(); if (prop.includes(".")) prop = prop.split(".").pop()!;
    const params: any = {}; const types: string[] = [];
    for (let i = 1; i < segs.length; i++) { const seg = segs[i]; if (seg.includes("=")) { const idx = seg.indexOf("="); const k = seg.slice(0, idx).toUpperCase(); const vv = seg.slice(idx + 1); params[k] = vv; if (k === "TYPE") types.push(...vv.split(",").map((x) => x.toUpperCase())); } else types.push(seg.toUpperCase()); }
    const value = dec(rawVal, params); if (!value && prop !== "N") continue;
    switch (prop) {
      case "FN": fn = value; break;
      case "N": n = value.split(";"); break;
      case "TEL": { const label = (types.includes("CELL") || types.includes("MOBILE")) ? "Mobile" : types.includes("WORK") ? "Work" : types.includes("HOME") ? "Home" : "Mobile"; c.phones.push({ value, label, is_default: c.phones.length === 0 }); break; }
      case "EMAIL": { const label = types.includes("WORK") ? "Work" : "Personal"; c.emails.push({ value, label, is_default: c.emails.length === 0 }); break; }
      case "ORG": c.company = value.split(";")[0].trim(); break;
      case "TITLE": c.role = value; break;
      case "NOTE": c.notes = value; break;
      case "URL": extra.push("Website: " + value); break;
      case "BDAY": extra.push("Birthday: " + value); break;
      case "ADR": { const a = value.split(";"); const street = [a[0], a[1], a[2]].filter(Boolean).join(" ").trim(); if (types.includes("WORK")) { c.business_address = street; c.business_city = a[3] || ""; c.business_state = a[4] || ""; c.business_zip = a[5] || ""; } else { c.home_address = street; c.home_city = a[3] || ""; c.home_state = a[4] || ""; c.home_zip = a[5] || ""; } break; }
    }
  }
  if (fn) c.name = fn; else if (n) c.name = [n[3], n[1], n[2], n[0], n[4]].filter(Boolean).join(" ").trim();
  if (!c.name) c.name = ((c.emails[0] && c.emails[0].value) || (c.phones[0] && c.phones[0].value) || "New contact");
  if (extra.length) c.notes = (c.notes ? c.notes + "\n" : "") + extra.join("\n");
  return c;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const url = new URL(req.url);
    const token = req.headers.get("x-ingest-token") || url.searchParams.get("token") || "";
    if (!token) return json({ error: "missing_token" }, 401);
    const { data: row } = await admin.from("ingest_tokens").select("user_id").eq("token", token).maybeSingle();
    if (!row) return json({ error: "invalid_token" }, 403);
    const userId = row.user_id;

    const filename = url.searchParams.get("filename") || req.headers.get("x-filename") || "";
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    const lname = filename.toLowerCase();
    let kind = url.searchParams.get("kind") || "";
    if (!kind) {
      if (/\.(m4a|mp3|wav|aac|ogg|opus|amr|3gp|caf|mp4|m4b|flac)$/i.test(lname) || ct.startsWith("audio/")) kind = "audio";
      else if (/\.vcf$/i.test(lname) || ct.includes("vcard") || ct.includes("directory")) kind = "contact";
      else if (/\.(pdf|jpg|jpeg|png|heic|heif|webp|gif|doc|docx|txt|csv|rtf)$/i.test(lname) || ct.startsWith("image/") || ct.includes("pdf") || ct.includes("word") || ct.includes("msword")) kind = "document";
      else kind = "text";
    }
    const buf = new Uint8Array(await req.arrayBuffer());

    if (kind === "audio") {
      const fn = filename || "shared-recording.m4a";
      const { data: rec, error } = await admin.from("recordings").insert({ user_id: userId, title: fn.replace(/\.[^.]+$/, ""), mime_type: ct || "audio/mp4", size_bytes: buf.length, recorded_at: new Date().toISOString(), transcription_status: "pending" }).select("id").single();
      if (error || !rec) return json({ error: "recording_insert_failed" }, 500);
      const path = `${userId}/${rec.id}/${safe(fn)}`;
      const up = await admin.storage.from("recordings").upload(path, buf, { contentType: ct || "audio/mp4", upsert: false });
      if (up.error) return json({ error: "upload_failed" }, 500);
      await admin.from("recordings").update({ storage_path: path }).eq("id", rec.id);
      fetch(`${SUPABASE_URL}/functions/v1/recording-transcribe`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ recording_id: rec.id, user_id: userId }) }).catch(() => {});
      return json({ ok: true, kind, id: rec.id });
    }
    if (kind === "document") {
      const fn = filename || "shared-document";
      const docId = crypto.randomUUID();
      const path = `${userId}/${docId}/${safe(fn)}`;
      const up = await admin.storage.from("documents").upload(path, buf, { contentType: ct || "application/octet-stream", upsert: false });
      if (up.error) return json({ error: "upload_failed" }, 500);
      await admin.from("documents").insert({ id: docId, user_id: userId, title: fn, storage_path: path, mime_type: ct || null, size_bytes: buf.length, status: "pending" });
      fetch(`${SUPABASE_URL}/functions/v1/document-extract`, { method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ document_id: docId }) }).catch(() => {});
      return json({ ok: true, kind, id: docId });
    }
    if (kind === "contact") {
      const c = parseVCard(new TextDecoder().decode(buf));
      if (!c) return json({ error: "bad_vcard" }, 400);
      const ins: any = { user_id: userId, name: c.name, type: "lead", origin: "manual", phones: c.phones || [], emails: c.emails || [], notes: c.notes || null, company: c.company || null, role: c.role || null, home_address: c.home_address || null, home_city: c.home_city || null, home_state: c.home_state || null, home_zip: c.home_zip || null, business_address: c.business_address || null, business_city: c.business_city || null, business_state: c.business_state || null, business_zip: c.business_zip || null };
      const { data: created, error } = await admin.from("contacts").insert(ins).select("id").single();
      if (error || !created) return json({ error: "contact_insert_failed", detail: error?.message }, 500);
      return json({ ok: true, kind, id: created.id });
    }
    // text / URL -> journal
    const text = (new TextDecoder().decode(buf).trim()) || url.searchParams.get("text") || "";
    if (!text) return json({ error: "empty" }, 400);
    const day = new Date().toISOString().slice(0, 10);
    const { data: je, error } = await admin.from("journal_entries").insert({ user_id: userId, day, content: text, occurred_at: new Date().toISOString() }).select("id").single();
    if (error) return json({ error: "journal_insert_failed", detail: error.message }, 500);
    return json({ ok: true, kind: "text", id: je?.id });
  } catch (e) { return json({ error: String(e) }, 500); }
});
