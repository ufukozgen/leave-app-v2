// /supabase/functions/approve-leave/index.ts
// Deno Edge Function: Approve a leave, create calendar event, send email, (optional) set OOO

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";
import { sendGraphEmail } from "../helpers/sendGraphEmail.ts";
import { createCalendarEvent } from "../helpers/createCalendarEvent.ts";
import { reconcileUserOOO } from "../helpers/reconcileUserOOO.ts";


// --------------------------- Config / CORS ---------------------------
const sharedCalendarEmail = Deno.env.get("SHARED_CALENDAR_EMAIL");

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
function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function assertUserIsActive(
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
  message = "User is archived",
) {
  const { data, error } = await supabase
    .from("users")
    .select("is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) return jsonResponse({ error: "User lookup failed" }, 500, corsHeaders);

  if (!data || data.is_active === false) {
    return jsonResponse({ error: message }, 403, corsHeaders);
  }

  return null;
}

// --------------------------- Microsoft Graph (OOO) ---------------------------
// Try both naming schemes so you can reuse existing secrets without renaming
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

// If these are empty, OOO calls will fail (but approval flow will still continue)
const GRAPH_TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
// Windows TZ ID required by Graph:
const TURKEY_TZ = "Turkey Standard Time";

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
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Graph token error: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

function addDaysISO(yyyyMmDd: string, days: number) {
  const d = new Date(`${yyyyMmDd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function toTR(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-");
  return `${d}.${m}.${y}`;
}

function buildDefaultMessage(startISO: string, endISO: string, managerEmail?: string | null) {
  const s = toTR(startISO);
  const e = toTR(endISO);
  const urgent = managerEmail ? ` (acil/urgent: ${managerEmail})` : "";
  const tr = `Merhaba, ${s} - ${e} tarihleri arasında izindeyim${urgent}.\nDöndüğümde yanıtlayacağım.`;
  const en = `Hello, I’m out of the office from ${s} to ${e}${urgent}.\nI will reply upon my return.`;
  return `${tr}\n\n${en}`;
}

// Accept a fully-built message (custom or default) to avoid scope issues
async function setOutOfOffice(opts: {
  userEmail: string;
  startDateISO: string;   // YYYY-MM-DD
  endDateISO: string;     // YYYY-MM-DD
  returnDateISO?: string; // YYYY-MM-DD (optional — if absent, day after end)
  message: string;        // final text to set (custom or default)
}) {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing Graph secrets (TENANT_ID / CLIENT_ID / CLIENT_SECRET).");
  }

  const token = await getGraphToken();

  // Schedule 09:00 on start date to 09:00 on return date (or day after end)
  const startDateTime = `${opts.startDateISO}T09:00:00`;
  const endISO = opts.returnDateISO ?? addDaysISO(opts.endDateISO, 1);
  const endDateTime = `${endISO}T09:00:00`;

  const body = {
    automaticRepliesSetting: {
      status: "scheduled",
      internalReplyMessage: opts.message,
      externalReplyMessage: opts.message,
      scheduledStartDateTime: { dateTime: startDateTime, timeZone: TURKEY_TZ },
      scheduledEndDateTime:   { dateTime: endDateTime,   timeZone: TURKEY_TZ },
      // externalAudience: "all", // uncomment if you want external replies to go to everyone
    },
  };

  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(opts.userEmail)}/mailboxSettings`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`setOutOfOffice failed: ${res.status} ${txt}`);
  }
}

// --------------------------- Main Handler ---------------------------
serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { request_id } = await req.json();

    if (!request_id) {
      return new Response(JSON.stringify({ error: "request_id is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // JWT from Authorization header
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    // Supabase client with service role (bypass RLS inside functions)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Who is calling?
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Kullanıcı doğrulanamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }
// ✅ Actor guard: caller must be active
{
  const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
  if (blocked) return blocked;
}

    // Load leave request (include enable_ooo, return_date, ooo_custom_message)
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select(
        "id, user_id, email, manager_email, status, start_date, end_date, return_date, days, location, note, duration_type, enable_ooo, ooo_custom_message"
      )
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return new Response(JSON.stringify({ error: "Talep bulunamadı" }), {
        status: 404,
        headers: corsHeaders,
      });
    }
// ✅ Target guard: request owner must be active (recommended)
{
  const blockedTarget = await assertUserIsActive(
    supabase,
    leave.user_id,
    corsHeaders,
    "Target user is archived",
  );
  if (blockedTarget) {
    return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
  }
}

    // Caller role & permissions
    const { data: userRow } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (!userRow) {
      return new Response(JSON.stringify({ error: "Kullanıcı bulunamadı" }), {
        status: 401,
        headers: corsHeaders,
      });
    }

    const isManager = userRow.email === leave.manager_email;
    const isAdmin = userRow.role === "admin";
    if (!isManager && !isAdmin) {
      return new Response(JSON.stringify({ error: "Yetkiniz yok." }), {
        status: 403,
        headers: corsHeaders,
      });
    }

    // Approve the request
    const { error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "Approved", approval_date: new Date().toISOString() })
      .eq("id", request_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Onaylama başarısız" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Audit log (non-blocking)
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: user.email,
        action: "approve_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: leave.status,
        status_after: "Approved",
        details: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          days: leave.days,
          location: leave.location,
          note: leave.note,
          enable_ooo: leave.enable_ooo,
        },
      }]);
    } catch (logError) {
      console.error("Log kaydı başarısız:", logError);
    }

    // Employee (leave owner)
    const { data: employee } = await supabase
      .from("users")
      .select("id, email, name")
      .eq("id", leave.user_id)
      .maybeSingle();

    if (!employee) {
      return new Response(JSON.stringify({ error: "Çalışan bulunamadı (mail gönderilemedi)" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Create event on shared calendar
    let eventId: string | null = null;
    try {
      const event = await createCalendarEvent({
        sharedCalendarEmail,
        employeeEmail: employee.email,
        employeeName: employee.name,
        leave: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          duration_type: leave.duration_type,
          note: leave.note,
        },
      });
      eventId = event?.id ?? null;

      if (eventId) {
        await supabase
          .from("leave_requests")
          .update({ calendar_event_id: eventId })
          .eq("id", leave.id);
      }
    } catch (calendarError) {
      console.error("Takvim etkinliği oluşturulamadı:", calendarError);
    }

    // Optional: Set Out-of-Office if user opted in (non-blocking)
    try {
  if (employee.email) {
    await reconcileUserOOO(supabase, { user_id: employee.id, email: employee.email });
  }
} catch (e) {
  console.error("reconcileUserOOO (after approve) failed:", e);
}
    // Notify employee by email
    await sendGraphEmail({
      to: employee.email,
      subject: "İzin Talebiniz Onaylandı",
      html: `
        <p>Sayın ${employee.name},</p>
        <p>Yöneticiniz ${userRow.name || ""} aşağıdaki izin talebinizi <b>onayladı</b>:</p>
        <ul>
          <li>Başlangıç: ${leave.start_date}</li>
          <li>Bitiş: ${leave.end_date}</li>
          <li>Gün: ${leave.days}</li>
        </ul>
        <p>İyi tatiller dileriz!</p>

        <br/>
        <a href="https://leave-app-v2.vercel.app"
           style="
             display:inline-block;
             padding:10px 20px;
             background:#F39200;
             color:#fff;
             border-radius:8px;
             text-decoration:none;
             font-weight:bold;
             font-family:Calibri, Arial, sans-serif;
             font-size:16px;
             margin-top:10px;
           ">
           İzin Uygulamasına Git
        </a>
      `,
    });

    return new Response(JSON.stringify({ success: true, calendar_event_id: eventId }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (e: any) {
    console.error("approve-leave error:", e);
    return new Response(
      JSON.stringify({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }),
      { status: 500, headers: corsHeaders },
    );
  }
});
