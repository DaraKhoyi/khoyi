import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
// Claude vision works best with the longest edge <= ~1568px. Large phone photos
// can exceed the API's dimension/size limits and cause a 400. Downscale first.
const MAX_IMAGE_EDGE = 1568;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const MAX_HISTORY_TURNS = 20; // keep prompt size sane
async function callClaude(system, messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages
    })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic ${r.status}: ${t.slice(0, 400)}`);
  }
  const j = await r.json();
  const text = (j.content || []).filter((b)=>b.type === "text").map((b)=>b.text).join("");
  return {
    text,
    usage: j.usage
  };
}
// Detect mime type from file path extension
function mimeFromPath(path) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}
// Encode arbitrary bytes to base64 in chunks (avoids stack overflow on large images)
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for(let i = 0; i < bytes.length; i += chunk){
    const slice = bytes.subarray(i, i + chunk);
    for(let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
  }
  return btoa(binary);
}
// Download an image from the 'receipts' bucket and return as base64 + media type.
// Returns null on failure (e.g. file not found, mime unrecognized) so callers
// can decide whether to proceed without vision.
async function loadImageAsBase64(supabase, imagePath) {
  try {
    const { data, error } = await supabase.storage.from("receipts").download(imagePath);
    if (error || !data) return null;
    const ab = await data.arrayBuffer();
    let bytes = new Uint8Array(ab);
    if (bytes.length === 0) return null;
    let mediaType = mimeFromPath(imagePath);
    // Downscale oversized images so we never trip Claude's dimension/size limits.
    if (mediaType === "image/jpeg" || mediaType === "image/png") {
      try {
        const img = await Image.decode(bytes);
        const longest = Math.max(img.width, img.height);
        if (longest > MAX_IMAGE_EDGE) {
          const scale = MAX_IMAGE_EDGE / longest;
          img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
        }
        bytes = await img.encodeJPEG(82);
        mediaType = "image/jpeg";
      } catch (_e) {
        // decode failed -> fall back to raw bytes below
      }
    }
    // Final guard: Claude vision caps around 5MB per image.
    if (bytes.length > 6 * 1024 * 1024) return null;
    return {
      data: bytesToBase64(bytes),
      media_type: mediaType
    };
  } catch (_e) {
    return null;
  }
}
// Call the parse-receipt edge function with the user's JWT. Returns the
// structured fields if the image is a receipt (confidence is part of the
// payload ﻗ callers decide whether confidence is high enough to surface).
// Returns null on any failure.
async function parseReceiptInternal(receiptPath, jwt) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${jwt}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        receipt_path: receiptPath
      })
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.error) return null;
    return j;
  } catch (_e) {
    return null;
  }
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const body = await req.json().catch(()=>({}));
    const { robot_id, message, history = [], image_path } = body || {};
    // message can be empty string when only an image is sent
    if (!robot_id || typeof message !== "string" && !image_path) {
      return new Response(JSON.stringify({
        error: "robot_id and (message or image_path) required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const userMessage = typeof message === "string" ? message : "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // SECURITY: derive user_id from JWT only
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const userId = user.id;
    // Load the robot. Each robot now belongs to a single user (Pass 2 Batch A).
    // We require the robot to belong to the calling user ﻗ passing another user's
    // robot_id would otherwise leak their custom system_prompt.
    const { data: robot, error: rErr } = await supabase.from("robots").select("id, name, role, system_prompt, active, user_id").eq("id", robot_id).maybeSingle();
    if (rErr || !robot) {
      return new Response(JSON.stringify({
        error: "Robot not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (robot.user_id !== userId) {
      return new Response(JSON.stringify({
        error: "Robot not found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!robot.active) {
      return new Response(JSON.stringify({
        error: "Robot is inactive"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Validate image_path if provided: must live under the user's folder
    if (image_path) {
      if (typeof image_path !== "string" || !image_path.startsWith(`${userId}/`)) {
        return new Response(JSON.stringify({
          error: "Invalid image_path"
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    // Build message list. Cap history.
    const cleanHistory = Array.isArray(history) ? history.filter((m)=>m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-MAX_HISTORY_TURNS).map((m)=>({
        role: m.role,
        content: m.content
      })) // strip extra fields for Claude
     : [];
    // Build the current user turn. With an image, content becomes an array
    // of blocks per Anthropic's vision format. Without an image it stays a string.
    let currentTurnContent = userMessage;
    let receiptParsePromise = Promise.resolve(null);
    if (image_path) {
      const imageData = await loadImageAsBase64(supabase, image_path);
      if (!imageData) {
        return new Response(JSON.stringify({
          error: "Could not load image (not found, too large, or invalid format)"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      // Build vision content blocks
      const blocks = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: imageData.media_type,
            data: imageData.data
          }
        }
      ];
      // Add text block if user wrote anything; otherwise nudge Claude
      if (userMessage.trim()) {
        blocks.push({
          type: "text",
          text: userMessage
        });
      } else {
        blocks.push({
          type: "text",
          text: "(The user shared this image without a caption ﻗ describe what you see briefly. If it's a receipt or invoice, mention what was extracted and offer to add it to accounting.)"
        });
      }
      currentTurnContent = blocks;
      // Start the parse-receipt call in parallel with the Claude conversation
      receiptParsePromise = parseReceiptInternal(image_path, token);
    }
    const messages = [
      ...cleanHistory,
      {
        role: "user",
        content: currentTurnContent
      }
    ];
    const baseSystem = robot.system_prompt || `You are ${robot.name}, an AI assistant.`;
    // Tell the assistant what tools the UI gives her so her answers match what
    // the user actually sees. Kept short to preserve the user's prompt voice.
    const capabilities = [
      "You can see and discuss images the user attaches.",
      "When the user sends a photo of a receipt or invoice, the app automatically extracts vendor, amount, date, and category ﻗ a 'Push to accounting' button appears under your reply for them to confirm. You do not need to write any structured data yourself; just acknowledge what was found and let them confirm with the button.",
      "If an image is unrelated to accounting, just discuss it naturally."
    ].join(" ");
    const system = `${baseSystem}\n\nCapabilities: ${capabilities}`;
    // Run chat completion and (if image) receipt parse in parallel
    const [chatResult, receiptResult] = await Promise.all([
      callClaude(system, messages),
      receiptParsePromise
    ]);
    const text = chatResult.text;
    const usage = chatResult.usage;
    // Build receipt_data response payload if confidence is meaningful
    let receiptData = null;
    if (receiptResult && typeof receiptResult.confidence === "number" && receiptResult.confidence >= 0.4) {
      receiptData = {
        vendor: receiptResult.vendor || null,
        date: receiptResult.date || null,
        amount: receiptResult.amount ?? null,
        scope: receiptResult.is_business_likely === false ? "personal" : "business",
        confidence: receiptResult.confidence,
        tax_category_id: receiptResult.suggested_tax_category_id || null,
        lead_gen_system_id: receiptResult.suggested_lead_gen_system_id || null,
        description_guess: receiptResult.description_guess || null,
        line_items: receiptResult.line_items || null,
        receipt_path: image_path
      };
    }
    // Persist conversation. Schema: { user_id, robot_id, messages jsonb }.
    // Upsert on (user_id, robot_id) ﻗ append new turns to the rolling thread.
    // Image attachments stored as image_path on the user turn (no signed URL ﻗ
    // signed URLs expire; the client mints fresh ones at render time).
    const userTurn = {
      role: "user",
      content: userMessage,
      ts: new Date().toISOString()
    };
    if (image_path) userTurn.image_path = image_path;
    const assistantTurn = {
      role: "assistant",
      content: text,
      ts: new Date().toISOString()
    };
    if (receiptData) assistantTurn.receipt_data = receiptData;
    const newTurns = [
      userTurn,
      assistantTurn
    ];
    const { data: existing } = await supabase.from("robot_conversations").select("id, messages").eq("user_id", userId).eq("robot_id", robot_id).maybeSingle();
    if (existing) {
      const merged = Array.isArray(existing.messages) ? [
        ...existing.messages,
        ...newTurns
      ] : newTurns;
      // Cap stored history to last 200 turns to keep row size sane
      const capped = merged.slice(-200);
      await supabase.from("robot_conversations").update({
        messages: capped,
        updated_at: new Date().toISOString()
      }).eq("id", existing.id);
    } else {
      await supabase.from("robot_conversations").insert({
        user_id: userId,
        robot_id,
        messages: newTurns
      });
    }
    const responsePayload = {
      response: text,
      meta: {
        model: MODEL,
        tokens: usage
      }
    };
    if (receiptData) responsePayload.receipt_data = receiptData;
    return new Response(JSON.stringify(responsePayload), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    return new Response(JSON.stringify({
      error: msg
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
