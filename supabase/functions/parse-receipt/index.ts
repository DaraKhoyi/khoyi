// parse-receipt ﻗ Claude vision-powered receipt OCR + categorization.
//
// Input:  { receipt_path: string }   path within the 'receipts' bucket
//         The image must already have been uploaded by the client.
//
// Output: { vendor, date, amount, line_items[], suggested_tax_category_id|null,
//           suggested_lead_gen_system_id|null, description_guess,
//           confidence (0..1), raw_extract, receipt_url }
//
// The function:
//   1. Verifies the caller is authenticated (RLS auth header passed through)
//   2. Loads the user's tax_categories and lead_gen_systems so Claude can map
//      to the agent's actual chart of accounts (not generic names)
//   3. Downloads the receipt image bytes from storage
//   4. Calls Claude (anthropic.messages.create with vision) with a strict
//      JSON-only instruction and the user's categories as context
//   5. Parses the JSON response, maps category names ﻗ IDs, returns to client
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';
import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';
// Claude vision works best when the longest edge is <= ~1568px. Large phone
// photos (e.g. 4000x3000, 2MB+) can exceed the API's dimension/size limits and
// cause a 400 -> we downscale first. This also shrinks the base64 payload ~10x.
const MAX_EDGE = 1568;
async function toClaudeImage(buf: Uint8Array, mediaType: string): Promise<{ data: string; media_type: string }> {
  // PDFs are passed through untouched (handled as a document, not an image).
  if (mediaType === 'application/pdf') {
    return { data: bytesToBase64(buf), media_type: mediaType };
  }
  try {
    const img = await Image.decode(buf);
    const longest = Math.max(img.width, img.height);
    if (longest > MAX_EDGE) {
      const scale = MAX_EDGE / longest;
      img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
    }
    const jpeg = await img.encodeJPEG(82);
    return { data: bytesToBase64(jpeg), media_type: 'image/jpeg' };
  } catch (_e) {
    // If decode fails (unsupported format like HEIC), fall back to the raw bytes
    // and let Claude try — better to attempt than to hard-fail.
    return { data: bytesToBase64(buf), media_type: mediaType };
  }
}
// Stack-safe base64 (String.fromCharCode.apply blows the stack on big buffers).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
  }
  return btoa(binary);
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// Use sonnet 4.6 for vision ﻗ fast + accurate, $3/MTok input
const MODEL = 'claude-sonnet-4-6';
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  if (req.method !== 'POST') return jsonResponse({
    error: 'POST only'
  }, 405);
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({
      error: 'Missing Authorization header'
    }, 401);
    const body = await req.json();
    const receiptPath = body?.receipt_path;
    if (!receiptPath) return jsonResponse({
      error: 'receipt_path required'
    }, 400);
    // ﻗﻗ Identify caller via anon-key client honoring their JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({
      error: 'Not authenticated'
    }, 401);
    // Defense in depth: receipt_path must start with this user's id
    if (!receiptPath.startsWith(`${user.id}/`)) {
      return jsonResponse({
        error: 'Forbidden: path must be under your user folder'
      }, 403);
    }
    // ﻗﻗ Service-role client for storage + privileged reads
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    // 1. Fetch user's tax categories + lead-gen systems for context
    const [{ data: taxCats }, { data: systems }] = await Promise.all([
      adminClient.from('tax_categories').select('id,name,schedule_c_line,description').eq('user_id', user.id).eq('is_archived', false).order('sort_order'),
      adminClient.from('lead_gen_systems').select('id,name,is_overhead').eq('user_id', user.id).eq('is_active', true).order('name')
    ]);
    // 2. Download the receipt image
    const { data: file, error: dlErr } = await adminClient.storage.from('receipts').download(receiptPath);
    if (dlErr || !file) return jsonResponse({
      error: 'Could not download receipt: ' + dlErr?.message
    }, 500);
    const buf = new Uint8Array(await file.arrayBuffer());
    // Detect media type from extension
    const ext = receiptPath.split('.').pop()?.toLowerCase() || 'jpg';
    const mediaTypeMap = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif',
      pdf: 'application/pdf'
    };
    const mediaType = mediaTypeMap[ext] || 'image/jpeg';
    // Downscale oversized images + base64-encode (stack-safe).
    const claudeImage = await toClaudeImage(buf, mediaType);
    // 3. Build Claude prompt with the user's chart of accounts
    const taxList = (taxCats || []).map((c)=>`- ${c.name} (Schedule C ${c.schedule_c_line}): ${c.description || ''}`).join('\n');
    const sysList = (systems || []).map((s)=>`- ${s.name}${s.is_overhead ? ' (default/overhead)' : ''}`).join('\n');
    const systemPrompt = `You are a receipt-parsing assistant for a real-estate agent's bookkeeping app. Extract structured data from the receipt image. Your output must be valid JSON only, no markdown, no commentary, no code fences.

The agent's tax categories (Schedule C buckets) are:
${taxList}

The agent's active lead-generation systems are:
${sysList}

Output schema (all fields required; use null where unknown):
{
  "vendor": "Merchant name as printed",
  "date": "YYYY-MM-DD (today if illegible)",
  "amount": 0.00,  // total amount paid (post-tax, post-tip if applicable). Always positive.
  "line_items": [{"description": "...", "amount": 0.00}],  // optional, can be empty array
  "suggested_tax_category": "EXACT name from the list above, or null",
  "suggested_lead_gen_system": "EXACT name from the list above, or null",
  "description_guess": "Short one-line description for the ledger",
  "confidence": 0.0,  // 0..1 ﻗ how sure you are about vendor/amount/date
  "is_business_likely": true,  // best guess if this is a deductible biz expense vs personal
  "notes": "Optional brief note for anything unusual"
}

Mapping rules:
- If the receipt is from a marketing/ad platform (Facebook Ads, Google Ads, Zillow, Realtor.com, Mailchimp, etc.), suggest "Advertising & Marketing" as tax category AND match a lead-gen system if one fits.
- Gas, vehicle service, auto insurance ﻗ "Auto"
- Office supplies, software, hardware, subscriptions like Adobe/Microsoft ﻗ "Office"
- Coaching, conferences, books, courses ﻗ "Education & Development"
- Bank/credit-card fees ﻗ "Bank & Card Fees"
- MLS, NAR, board, lockbox ﻗ "Dues & Subscriptions"
- Client lunches, conference travel ﻗ "Travel & Meals"
- Accountant, attorney, VA ﻗ "Professional Services"
- If unsure, use "Other Business Expenses" rather than guessing.
- If the receipt looks personal (grocery, drugstore, kid's school, etc.), leave both suggestions null and set is_business_likely false.`;
    // 4. Call Claude
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: claudeImage.media_type === 'application/pdf' ? 'document' : 'image',
                source: {
                  type: 'base64',
                  media_type: claudeImage.media_type,
                  data: claudeImage.data
                }
              },
              {
                type: 'text',
                text: 'Parse this receipt and return JSON only.'
              }
            ]
          }
        ]
      })
    });
    if (!claudeResp.ok) {
      const errText = await claudeResp.text();
      return jsonResponse({
        error: 'Claude API error',
        status: claudeResp.status,
        body: errText.slice(0, 500)
      }, 502);
    }
    const claudeData = await claudeResp.json();
    try { await logAiUsage(adminClient, { userId: user?.id, fn: "parse-receipt", model: MODEL, usage: claudeData?.usage, usedOwn: false }); } catch (_) {}
    const rawText = claudeData?.content?.[0]?.text || '';
    // 5. Parse the JSON Claude returned (strip any accidental fences)
    let parsed = {};
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return jsonResponse({
        error: 'Could not parse Claude response as JSON',
        raw_text: rawText.slice(0, 500)
      }, 500);
    }
    // 6. Map category/system names ﻗ IDs
    let suggestedTaxCatId = null;
    if (parsed.suggested_tax_category && taxCats) {
      const cat = taxCats.find((c)=>c.name.toLowerCase() === String(parsed.suggested_tax_category).toLowerCase());
      suggestedTaxCatId = cat?.id || null;
    }
    let suggestedSysId = null;
    if (parsed.suggested_lead_gen_system && systems) {
      const sys = systems.find((s)=>s.name.toLowerCase() === String(parsed.suggested_lead_gen_system).toLowerCase());
      suggestedSysId = sys?.id || null;
    }
    // 7. Build a signed URL (1 hour) so the client can preview the image
    const { data: signed } = await adminClient.storage.from('receipts').createSignedUrl(receiptPath, 3600);
    return jsonResponse({
      vendor: parsed.vendor || null,
      date: parsed.date || new Date().toISOString().slice(0, 10),
      amount: Number(parsed.amount) || 0,
      line_items: Array.isArray(parsed.line_items) ? parsed.line_items : [],
      suggested_tax_category: parsed.suggested_tax_category || null,
      suggested_tax_category_id: suggestedTaxCatId,
      suggested_lead_gen_system: parsed.suggested_lead_gen_system || null,
      suggested_lead_gen_system_id: suggestedSysId,
      description_guess: parsed.description_guess || '',
      is_business_likely: parsed.is_business_likely !== false,
      confidence: Number(parsed.confidence) || 0.5,
      notes: parsed.notes || '',
      raw_extract: parsed,
      receipt_url: signed?.signedUrl || null,
      receipt_path: receiptPath
    });
  } catch (e) {
    return jsonResponse({
      error: 'Internal error',
      message: String(e?.message || e)
    }, 500);
  }
});
