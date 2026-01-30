// /supabase/functions/approve-leave/index.ts
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

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
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

serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = getCORSHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const reqId = crypto.randomUUID();

  try {
    const { request_id } = await req.json();
    if (!request_id) return jsonResponse({ error: "request_id is required" }, 400, corsHeaders);

    // JWT from Authorization header
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return jsonResponse({ error: "Missing Authorization token" }, 401, corsHeaders);

    // Service role client (consistent pattern)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    // Who is calling?
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return jsonResponse({ error: "Kullanıcı doğrulanamadı" }, 401, corsHeaders);
    }

    console.log(`[approve-leave ${reqId}] caller:`, user.email, "request_id:", request_id);

    // ✅ Actor guard
    {
      const blocked = await assertUserIsActive(supabase, user.id, corsHeaders);
      if (blocked) return blocked;
    }

    // Load leave request
    const { data: leave, error: leaveError } = await supabase
      .from("leave_requests")
      .select("id, user_id, email, manager_email, status, start_date, end_date, return_date, days, location, note, duration_type, enable_ooo, ooo_custom_message")
      .eq("id", request_id)
      .maybeSingle();

    if (leaveError || !leave) {
      return jsonResponse({ error: "Talep bulunamadı" }, 404, corsHeaders);
    }

    // ✅ Target guard
    {
      const blockedTarget = await assertUserIsActive(
        supabase,
        leave.user_id,
        corsHeaders,
        "Target user is archived",
      );
      if (blockedTarget) return jsonResponse({ error: "Target user is archived" }, 409, corsHeaders);
    }

    // Caller role & permissions
    const { data: userRow, error: userRowErr } = await supabase
      .from("users")
      .select("role, email, name")
      .eq("id", user.id)
      .maybeSingle();

    if (userRowErr) console.log(`[approve-leave ${reqId}] actor lookup error:`, userRowErr);
    if (!userRow) return jsonResponse({ error: "Kullanıcı bulunamadı" }, 401, corsHeaders);

    const isManager = normalizeEmail(userRow.email) === normalizeEmail(leave.manager_email);
    const isAdmin = userRow.role === "admin";
    if (!isManager && !isAdmin) return jsonResponse({ error: "Yetkiniz yok." }, 403, corsHeaders);

    // Only allow approve from Pending (prevents double-approve races)
    if (leave.status !== "Pending") {
      return jsonResponse({ error: `Bu durumda onaylanamaz: ${leave.status}` }, 409, corsHeaders);
    }

    // Approve the request (conditional)
    const { data: updatedRows, error: updateError } = await supabase
      .from("leave_requests")
      .update({ status: "Approved", approval_date: new Date().toISOString() })
      .eq("id", request_id)
      .eq("status", "Pending")
      .select("id")
      .limit(1);

    if (updateError) {
      console.error(`[approve-leave ${reqId}] approve update failed:`, updateError);
      return jsonResponse({ error: "Onaylama başarısız" }, 500, corsHeaders);
    }
    if (!updatedRows || updatedRows.length === 0) {
      return jsonResponse({ error: "Talep zaten işlenmiş olabilir (durumu değişmiş)." }, 409, corsHeaders);
    }

    console.log(`[approve-leave ${reqId}] approved leave id:`, leave.id);

    // Audit log (DB may fail due to RLS)
    try {
      await supabase.from("logs").insert([{
        user_id: user.id,
        actor_email: user.email,
        action: "approve_request",
        target_table: "leave_requests",
        target_id: leave.id,
        status_before: "Pending",
        status_after: "Approved",
        details: {
          start_date: leave.start_date,
          end_date: leave.end_date,
          days: leave.days,
          location: leave.location,
          note: leave.note,
          enable_ooo: leave.enable_ooo,
          req_id: reqId,
        },
      }]);
    } catch (logError) {
      console.error(`[approve-leave ${reqId}] DB logging failed (RLS likely):`, logError);
    }

    // Robust employee identity for downstream actions
    const employeeEmail = normalizeEmail(leave.email);

    // Optional name lookup (nice-to-have)
    let employeeName = "";
    try {
      const { data: empRow, error: empErr } = await supabase
        .from("users")
        .select("name")
        .eq("id", leave.user_id)
        .maybeSingle();
      if (empErr) console.log(`[approve-leave ${reqId}] employee name lookup error:`, empErr);
      employeeName = empRow?.name || "";
    } catch (_e) {
      // ignore
    }

    // Create event on shared calendar (non-blocking)
    let eventId: string | null = null;
    try {
      if (!employeeEmail) throw new Error("Missing leave.email (employeeEmail) for calendar event");

      const event = await createCalendarEvent({
        sharedCalendarEmail,
        employeeEmail,
        employeeName: employeeName || employeeEmail,
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

      console.log(`[approve-leave ${reqId}] calendar event created:`, eventId);
    } catch (calendarError) {
      console.error(`[approve-leave ${reqId}] calendar event creation failed:`, calendarError);
    }

    // Reconcile OOO (non-blocking)
    try {
      if (employeeEmail) {
        await reconcileUserOOO(supabase, { user_id: leave.user_id, email: employeeEmail });
        console.log(`[approve-leave ${reqId}] reconcileUserOOO done for:`, employeeEmail);
      }
    } catch (e) {
      console.error(`[approve-leave ${reqId}] reconcileUserOOO failed:`, e);
    }

    // Notify employee by email (robust; never depends on users lookup)
    if (!employeeEmail) {
      console.log(`[approve-leave ${reqId}] Missing employeeEmail; skipping email notify.`);
    } else {
      console.log(`[approve-leave ${reqId}] About to email employee:`, employeeEmail);
      try {
        await sendGraphEmail({
          to: employeeEmail,
          subject: "İzin Talebiniz Onaylandı",
          html: `
            <p>Sayın ${employeeName || employeeEmail},</p>
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
        console.log(`[approve-leave ${reqId}] employee email SENT`);
      } catch (e) {
        console.error(`[approve-leave ${reqId}] employee email FAILED:`, e);
      }
    }

    return jsonResponse({ success: true, calendar_event_id: eventId, req_id: reqId }, 200, corsHeaders);
  } catch (e: any) {
    console.error("approve-leave error:", e);
    return jsonResponse({ error: "Beklenmeyen hata: " + (e?.message || String(e)) }, 500, corsHeaders);
  }
});
