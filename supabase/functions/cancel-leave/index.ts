// /supabase/functions/cancel-leave/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

// --------------------------- CORS ---------------------------
const allowedOrigins = [
  "https://leave-app-v2.vercel.app",
  "http://localhost:5173",
];
function getCORSHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}

// --------------------------- Microsoft Graph (disable OOO) ---------------------------
const TENANT_ID =
  Deno.env.get("MICROSOFT_TENANT_ID") ||
  Deno.env.get("AZURE_TENANT_ID") ||
  "";
const CLIENT_ID =
  Deno.env.get("MICROSOFT_CLIENT_ID") ||
  Deno.env.get("AZURE_CLIENT_ID") ||
  "";
const CLIENT_SECRET =
  Deno.env.get("MICROSOFT_CLIENT_SECRET") ||
  Deno.env.get("AZURE_CLIENT_SECRET") ||
  "";

const GRAPH_TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function getGraphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });
  const res = await fetch(GRAPH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Graph token error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token as string;
}

async function disableOutOfOffice(userEmail: string) {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing Graph secrets (TENANT_ID / CLIENT_ID / CLIENT_SECRET).");
  }
  const token = await getGraphToken();
  const res = await fetch(`${GRAPH_BASE}/users/${encodeURIComponent(userEmail)}/mailboxSettings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ automaticRepliesSetting: { status: "disabled" } }),
  });
  if (!res.ok) throw new Error(`disable OOO failed ${res.status}: ${await res.text()}`);
}

// --------------------------- Handler ---------------------------
serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();
    if (!request_id) {
      return new Response(JSON.stringify({ error: "request_id is required" }), { status: 400, headers: corsHeaders });
    }

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling?
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), { status: 401, headers: corsHeaders });
    }

    // Load leave (need user_id, enable_ooo, dates, manager_email, email)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, email, manager_email, status, start_date, end_date, enable_ooo, calendar_event_id")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), { status: 404, headers: corsHeaders });
    }

    // Permissions: employee can cancel own leave; admin can cancel anything; manager can cancel for their report
    const { data: caller } = await supabase
      .from("users")
      .select("id, email, role")
      .eq("id", user.id)
      .maybeSingle();

    const isOwner = user.id === leave.user_id;
    const isAdmin = caller?.role === "admin";
    const isManager = caller?.email === leave.manager_email;

    if (!isOwner && !isAdmin && !isManager) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), { status: 403, headers: corsHeaders });
    }

    // Update status to Cancelled
    const { error: updErr } = await supabase
      .from("leave_requests")
      .update({ status: "Cancelled", cancel_date: new Date().toISOString() })
      .eq("id", request_id);

    if (updErr) {
      return new Response(JSON.stringify({ error: "İptal başarısız" }), { status: 500, headers: corsHeaders });
    }

    // Optional: remove shared calendar event if you store its id
    // If you have a helper like cancelCalendarEvent, call it here with leave.calendar_event_id

    // Disable OOO if it was enabled/scheduled
    try {
      if (leave.enable_ooo === true) {
        await disableOutOfOffice(leave.email);
        console.log(`OOO disabled for ${leave.email} due to cancellation`);
      }
    } catch (e) {
      console.error("Failed to disable OOO:", e);
    }

    // Log
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: caller?.email || user.email,
        action: "cancel_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: leave.status,
        status_after: "Cancelled",
        details: { enable_ooo: leave.enable_ooo, start_date: leave.start_date, end_date: leave.end_date },
      }]);
    } catch (logErr) {
      console.error("Log kaydı başarısız:", logErr);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    console.error("cancel-leave error:", e);
    return new Response(JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }), {
      status: 500, headers: getCORSHeaders(req.headers.get("origin") || ""),
    });
  }
});
